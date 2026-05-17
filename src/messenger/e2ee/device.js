import sodium from "libsodium-wrappers";

import { registerMessengerCryptoDevice } from "../api.js";

const E2EE_STORAGE_PREFIX = "parrot:e2ee:v1";
const DEVICE_ID_KEY = "device_id";
const PUBLIC_KEY_KEY = "public_key";
const PRIVATE_KEY_KEY = "private_key";
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

function getStorageKey(scope, key) {
  return `${E2EE_STORAGE_PREFIX}:${scope}:${key}`;
}

export function createMessengerDeviceId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

function readStoredDeviceIdentity(scope) {
  const deviceId = localStorage.getItem(getStorageKey(scope, DEVICE_ID_KEY));
  const publicKey = localStorage.getItem(getStorageKey(scope, PUBLIC_KEY_KEY));
  const privateKey = localStorage.getItem(getStorageKey(scope, PRIVATE_KEY_KEY));

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
  } catch {
    return null;
  }

  return {
    device_id: deviceId,
    public_key: publicKey,
    private_key: privateKey,
  };
}

function storeDeviceIdentity(scope, identity) {
  localStorage.setItem(getStorageKey(scope, DEVICE_ID_KEY), identity.device_id);
  localStorage.setItem(getStorageKey(scope, PUBLIC_KEY_KEY), identity.public_key);
  localStorage.setItem(getStorageKey(scope, PRIVATE_KEY_KEY), identity.private_key);
}

function clearStoredDeviceIdentity(scope) {
  localStorage.removeItem(getStorageKey(scope, DEVICE_ID_KEY));
  localStorage.removeItem(getStorageKey(scope, PUBLIC_KEY_KEY));
  localStorage.removeItem(getStorageKey(scope, PRIVATE_KEY_KEY));
}

function validateDeviceIdentity(identity) {
  if (!identity?.device_id || !identity?.public_key || !identity?.private_key) {
    return false;
  }

  try {
    const publicKeyBytes = fromBase64(identity.public_key);
    const privateKeyBytes = fromBase64(identity.private_key);
    const derivedPublicKeyBytes = sodium.crypto_scalarmult_base(privateKeyBytes);

    return (
      publicKeyBytes.length === sodium.crypto_box_PUBLICKEYBYTES &&
      privateKeyBytes.length === sodium.crypto_box_SECRETKEYBYTES &&
      toBase64(derivedPublicKeyBytes) === identity.public_key
    );
  } catch {
    return false;
  }
}

function createDeviceIdentity() {
  const keyPair = sodium.crypto_box_keypair();

  return {
    device_id: createMessengerDeviceId(),
    public_key: toBase64(keyPair.publicKey),
    private_key: toBase64(keyPair.privateKey),
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
    return storedIdentity;
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

  return readStoredDeviceIdentity(scope);
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

  if (!validateDeviceIdentity(identity)) {
    throw new Error("Recovery backup does not contain a valid encryption key.");
  }

  pendingDeviceSetupByUser.delete(scope);
  storeDeviceIdentity(scope, identity);
  return identity;
}

export async function registerMessengerDeviceIdentity(identity) {
  const response = await registerMessengerCryptoDevice({
    device_id: identity.device_id,
    device_name: getMessengerDeviceName(),
    public_key: identity.public_key,
  });

  return {
    ...identity,
    registered_device: response.data?.result?.device || null,
  };
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
