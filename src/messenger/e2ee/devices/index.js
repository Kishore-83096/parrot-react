import sodium from "libsodium-wrappers";

import {
  registerMessengerCryptoDevice,
  revokeMessengerCryptoDevice,
  saveMessengerCryptoKeyBackup,
  setMessengerDefaultCryptoDevice,
  updateMessengerDefaultDevicePassword,
} from "../../api.js";

const E2EE_STORAGE_PREFIX = "parrot:e2ee:v1";
const DEVICE_ID_KEY = "device_id";
const PUBLIC_KEY_KEY = "public_key";
const PRIVATE_KEY_KEY = "private_key";
const MANAGEMENT_PUBLIC_KEY_KEY = "management_public_key";
const MANAGEMENT_PRIVATE_KEY_KEY = "management_private_key";
const DEVICE_ACTION_SIGNATURE_VERSION = "parrot-device-action-v1";
const pendingDeviceSetupByUser = new Map();

function getUserStorageScope(user) {
  const userId = user?.id || user?.user_id;
  const accountNumber = user?.account_number;

  if (userId) {
    return `user:${userId}`;
  }

  if (accountNumber) {
    return `account:${accountNumber}`;
  }

  return "";
}

function getUserId(user) {
  const userId = user?.id || user?.user_id;

  return userId ? String(userId) : "";
}

function getStorageKey(scope, key) {
  return `${E2EE_STORAGE_PREFIX}:${scope}:${key}`;
}

export function createMessengerDeviceId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createActionNonce() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `nonce-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getBrowserName() {
  const userAgent = navigator.userAgent || "";

  if (/Edg\//.test(userAgent)) {
    return "Edge";
  }

  if (/OPR\//.test(userAgent)) {
    return "Opera";
  }

  if (/Firefox\//.test(userAgent)) {
    return "Firefox";
  }

  if (/Chrome\//.test(userAgent) || /CriOS\//.test(userAgent)) {
    return "Chrome";
  }

  if (/Safari\//.test(userAgent)) {
    return "Safari";
  }

  return "Browser";
}

function getPlatformName() {
  const userAgent = navigator.userAgent || "";
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  const platformText = `${platform} ${userAgent}`;

  if (/Android/i.test(platformText)) {
    return "Android";
  }

  if (/iPhone|iPad|iPod|iOS/i.test(platformText)) {
    return "iOS";
  }

  if (/Win/i.test(platformText)) {
    return "Windows";
  }

  if (/Mac/i.test(platformText)) {
    return "macOS";
  }

  if (/Linux/i.test(platformText)) {
    return "Linux";
  }

  return "this device";
}

export function getMessengerDeviceName() {
  return `${getBrowserName()} on ${getPlatformName()}`;
}

export function toBase64(bytes) {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

export function fromBase64(value) {
  return sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
}

function readStorageValue(scope, key) {
  try {
    return localStorage.getItem(getStorageKey(scope, key));
  } catch {
    return "";
  }
}

function writeStorageValue(scope, key, value) {
  localStorage.setItem(getStorageKey(scope, key), value);
}

function removeStorageValue(scope, key) {
  localStorage.removeItem(getStorageKey(scope, key));
}

function readStoredDeviceIdentity(scope) {
  const deviceId = readStorageValue(scope, DEVICE_ID_KEY);
  const publicKey = readStorageValue(scope, PUBLIC_KEY_KEY);
  const privateKey = readStorageValue(scope, PRIVATE_KEY_KEY);
  const managementPublicKey = readStorageValue(scope, MANAGEMENT_PUBLIC_KEY_KEY);
  const managementPrivateKey = readStorageValue(scope, MANAGEMENT_PRIVATE_KEY_KEY);

  if (!deviceId || !publicKey || !privateKey) {
    return null;
  }

  try {
    const publicKeyBytes = fromBase64(publicKey);
    const privateKeyBytes = fromBase64(privateKey);

    if (
      publicKeyBytes.length !== sodium.crypto_box_PUBLICKEYBYTES ||
      privateKeyBytes.length !== sodium.crypto_box_SECRETKEYBYTES
    ) {
      return null;
    }

    if (managementPublicKey || managementPrivateKey) {
      const managementPublicKeyBytes = fromBase64(managementPublicKey);
      const managementPrivateKeyBytes = fromBase64(managementPrivateKey);

      if (
        managementPublicKeyBytes.length !== sodium.crypto_sign_PUBLICKEYBYTES ||
        managementPrivateKeyBytes.length !== sodium.crypto_sign_SECRETKEYBYTES
      ) {
        return null;
      }
    }
  } catch {
    return null;
  }

  return {
    device_id: deviceId,
    public_key: publicKey,
    encryption_public_key: publicKey,
    private_key: privateKey,
    management_public_key: managementPublicKey || "",
    management_private_key: managementPrivateKey || "",
  };
}

function storeDeviceIdentity(scope, identity) {
  writeStorageValue(scope, DEVICE_ID_KEY, identity.device_id);
  writeStorageValue(scope, PUBLIC_KEY_KEY, identity.public_key);
  writeStorageValue(scope, PRIVATE_KEY_KEY, identity.private_key);
  writeStorageValue(scope, MANAGEMENT_PUBLIC_KEY_KEY, identity.management_public_key);
  writeStorageValue(scope, MANAGEMENT_PRIVATE_KEY_KEY, identity.management_private_key);
}

function clearStoredDeviceIdentity(scope) {
  removeStorageValue(scope, DEVICE_ID_KEY);
  removeStorageValue(scope, PUBLIC_KEY_KEY);
  removeStorageValue(scope, PRIVATE_KEY_KEY);
  removeStorageValue(scope, MANAGEMENT_PUBLIC_KEY_KEY);
  removeStorageValue(scope, MANAGEMENT_PRIVATE_KEY_KEY);
}

function validateDeviceIdentity(identity) {
  if (
    !identity?.device_id ||
    !identity?.public_key ||
    !identity?.private_key ||
    !identity?.management_public_key ||
    !identity?.management_private_key
  ) {
    return false;
  }

  try {
    const publicKeyBytes = fromBase64(identity.public_key);
    const privateKeyBytes = fromBase64(identity.private_key);
    const derivedPublicKeyBytes = sodium.crypto_scalarmult_base(privateKeyBytes);
    const managementPublicKeyBytes = fromBase64(identity.management_public_key);
    const managementPrivateKeyBytes = fromBase64(identity.management_private_key);
    const managementProof = sodium.from_string("parrot-device-management-proof");
    const managementSignature = sodium.crypto_sign_detached(
      managementProof,
      managementPrivateKeyBytes,
    );

    return (
      publicKeyBytes.length === sodium.crypto_box_PUBLICKEYBYTES &&
      privateKeyBytes.length === sodium.crypto_box_SECRETKEYBYTES &&
      toBase64(derivedPublicKeyBytes) === identity.public_key &&
      managementPublicKeyBytes.length === sodium.crypto_sign_PUBLICKEYBYTES &&
      managementPrivateKeyBytes.length === sodium.crypto_sign_SECRETKEYBYTES &&
      sodium.crypto_sign_verify_detached(
        managementSignature,
        managementProof,
        managementPublicKeyBytes,
      )
    );
  } catch {
    return false;
  }
}

function createManagementIdentity() {
  const keyPair = sodium.crypto_sign_keypair();

  return {
    management_public_key: toBase64(keyPair.publicKey),
    management_private_key: toBase64(keyPair.privateKey),
  };
}

function ensureManagementIdentity(identity) {
  if (identity?.management_public_key && identity?.management_private_key) {
    return identity;
  }

  return {
    ...identity,
    ...createManagementIdentity(),
  };
}

function createDeviceIdentity() {
  const keyPair = sodium.crypto_box_keypair();

  return {
    device_id: createMessengerDeviceId(),
    public_key: toBase64(keyPair.publicKey),
    encryption_public_key: toBase64(keyPair.publicKey),
    private_key: toBase64(keyPair.privateKey),
    ...createManagementIdentity(),
  };
}

export async function getOrCreateMessengerDeviceIdentity(user) {
  const scope = getUserStorageScope(user);

  if (!scope) {
    throw new Error("Cannot initialize encrypted messaging without a user identity.");
  }

  await sodium.ready;

  const storedIdentity = readStoredDeviceIdentity(scope);
  if (storedIdentity) {
    const nextIdentity = ensureManagementIdentity(storedIdentity);
    if (!validateDeviceIdentity(nextIdentity)) {
      throw new Error("Stored encrypted messaging identity is invalid.");
    }

    if (nextIdentity !== storedIdentity) {
      storeDeviceIdentity(scope, nextIdentity);
    }

    return nextIdentity;
  }

  const nextIdentity = createDeviceIdentity();
  storeDeviceIdentity(scope, nextIdentity);
  return nextIdentity;
}

export async function getStoredMessengerDeviceIdentity(user) {
  const scope = getUserStorageScope(user);

  if (!scope) {
    return null;
  }

  await sodium.ready;

  const storedIdentity = readStoredDeviceIdentity(scope);
  if (!storedIdentity) {
    return null;
  }

  const nextIdentity = ensureManagementIdentity(storedIdentity);
  if (!validateDeviceIdentity(nextIdentity)) {
    return null;
  }

  if (nextIdentity !== storedIdentity) {
    storeDeviceIdentity(scope, nextIdentity);
  }

  return nextIdentity;
}

export async function clearStoredMessengerDeviceIdentity(user) {
  const scope = getUserStorageScope(user);

  if (!scope) {
    return;
  }

  pendingDeviceSetupByUser.delete(scope);
  clearStoredDeviceIdentity(scope);
}

export async function saveMessengerDeviceIdentity(user, identity) {
  const scope = getUserStorageScope(user);

  if (!scope) {
    throw new Error("Cannot save encrypted messaging keys without a user identity.");
  }

  await sodium.ready;

  const nextIdentity = ensureManagementIdentity({
    ...identity,
    encryption_public_key: identity.public_key,
  });

  if (!validateDeviceIdentity(nextIdentity)) {
    throw new Error("Recovery backup does not contain a valid encryption key.");
  }

  pendingDeviceSetupByUser.delete(scope);
  storeDeviceIdentity(scope, nextIdentity);
  return nextIdentity;
}

export async function registerMessengerDeviceIdentity(identity) {
  const response = await registerMessengerCryptoDevice({
    device_id: identity.device_id,
    device_name: getMessengerDeviceName(),
    public_key: identity.public_key,
    encryption_public_key: identity.public_key,
    management_public_key: identity.management_public_key,
  });

  return {
    ...identity,
    registered_device: response.data?.result?.device || null,
  };
}

function buildDeviceActionMessage({
  action,
  actingDeviceId,
  nonce,
  targetDeviceId,
  timestamp,
  userId,
}) {
  return [
    DEVICE_ACTION_SIGNATURE_VERSION,
    String(action),
    String(userId),
    String(actingDeviceId),
    String(targetDeviceId || ""),
    String(timestamp),
    String(nonce),
  ].join("\n");
}

export async function createSignedDeviceActionPayload(user, action, targetDeviceId) {
  await sodium.ready;

  const identity = await getStoredMessengerDeviceIdentity(user);
  const userId = getUserId(user);

  if (!identity?.device_id || !identity?.management_private_key || !userId) {
    throw new Error("This device is not ready to manage linked devices.");
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = createActionNonce();
  const message = buildDeviceActionMessage({
    action,
    actingDeviceId: identity.device_id,
    nonce,
    targetDeviceId,
    timestamp,
    userId,
  });
  const signature = sodium.crypto_sign_detached(
    sodium.from_string(message),
    fromBase64(identity.management_private_key),
  );

  return {
    acting_device_id: identity.device_id,
    action_timestamp: timestamp,
    action_nonce: nonce,
    action_signature: toBase64(signature),
  };
}

export async function setDefaultMessengerDevice(
  user,
  deviceId,
  { defaultPassword = "" } = {},
) {
  const payload = await createSignedDeviceActionPayload(
    user,
    "device.default",
    deviceId,
  );

  return setMessengerDefaultCryptoDevice(deviceId, {
    ...payload,
    default_password: defaultPassword,
  });
}

export async function updateDefaultMessengerDevicePassword(
  user,
  { currentPassword = "", newPassword = "" } = {},
) {
  const payload = await createSignedDeviceActionPayload(
    user,
    "device.default_password.update",
    "default-password",
  );

  return updateMessengerDefaultDevicePassword({
    ...payload,
    current_default_password: currentPassword,
    new_default_password: newPassword,
  });
}

export async function revokeMessengerDevice(user, deviceId) {
  const payload = await createSignedDeviceActionPayload(
    user,
    "device.revoke",
    deviceId,
  );

  return revokeMessengerCryptoDevice(deviceId, payload);
}

export async function logoutCurrentMessengerDevice(user) {
  const identity = await getStoredMessengerDeviceIdentity(user);

  if (!identity?.device_id) {
    return {
      device_id: "",
      deleted: false,
      revoked: false,
      retained_default: false,
      local_device_should_clear: false,
    };
  }

  try {
    const response = await revokeMessengerDevice(user, identity.device_id);
    const result = response.data?.result || response.data || {};

    return {
      device_id: identity.device_id,
      deleted: Boolean(result.deleted),
      revoked: Boolean(result.revoked),
      retained_default: Boolean(result.retained_default),
      local_device_should_clear: Boolean(result.local_device_should_clear),
    };
  } catch (error) {
    const responseStatus = Number(error?.response?.status || 0);

    if (responseStatus === 403 || responseStatus === 404) {
      return {
        device_id: identity.device_id,
        deleted: false,
        revoked: false,
        retained_default: false,
        local_device_should_clear: true,
      };
    }

    throw error;
  }
}

export async function saveDefaultDeviceRecoveryBackup(user, backupPayload) {
  const actionPayload = await createSignedDeviceActionPayload(
    user,
    "recovery.backup.save",
    "key-backup",
  );

  return saveMessengerCryptoKeyBackup({
    ...backupPayload,
    ...actionPayload,
  });
}

export async function ensureMessengerDeviceKey(user) {
  const scope = getUserStorageScope(user);

  if (!scope) {
    return null;
  }

  if (!pendingDeviceSetupByUser.has(scope)) {
    pendingDeviceSetupByUser.set(
      scope,
      getOrCreateMessengerDeviceIdentity(user)
        .then(registerMessengerDeviceIdentity)
        .finally(() => {
          pendingDeviceSetupByUser.delete(scope);
        }),
    );
  }

  return pendingDeviceSetupByUser.get(scope);
}
