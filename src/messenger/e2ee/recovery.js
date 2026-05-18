import sodium from "libsodium-wrappers";

import {
  getMessengerCryptoKeyBackup,
} from "../api.js";
import {
  createMessengerDeviceId,
  fromBase64,
  getOrCreateMessengerDeviceIdentity,
  registerMessengerDeviceIdentity,
  saveDefaultDeviceRecoveryBackup,
  saveMessengerDeviceIdentity,
  toBase64,
} from "./devices/index.js";

export const E2EE_KEY_BACKUP_VERSION = 1;

const BACKUP_AAD = "parrot:e2ee.key-backup:v1";
const BACKUP_KDF_ALGORITHM = "PBKDF2-SHA256";
const BACKUP_KDF_ITERATIONS = 600000;
const BACKUP_SALT_BYTES = 16;
const BACKUP_KEY_BYTES = 32;
const MIN_RECOVERY_PASSWORD_LENGTH = 12;
const RECOVERY_KEY_STORAGE_PREFIX = "parrot:e2ee.recovery-key:v1";
const RECOVERY_KEY_ACK_STORAGE_PREFIX = "parrot:e2ee.recovery-key-ack:v1";

function getResult(response) {
  return response?.data?.result || response?.data || {};
}

function encodeText(value) {
  return new TextEncoder().encode(String(value || ""));
}

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

function getRecoveryKeyStorageKey(user) {
  const scope = getUserStorageScope(user);

  return scope ? `${RECOVERY_KEY_STORAGE_PREFIX}:${scope}` : "";
}

function getRecoveryKeyAcknowledgementStorageKey(user) {
  const scope = getUserStorageScope(user);

  return scope ? `${RECOVERY_KEY_ACK_STORAGE_PREFIX}:${scope}` : "";
}

function getLocalStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function storeRecoveryKey(user, recoveryPassword) {
  const storageKey = getRecoveryKeyStorageKey(user);
  const storage = getLocalStorage();

  if (!storageKey || !storage) {
    return;
  }

  try {
    storage.setItem(storageKey, String(recoveryPassword || ""));
  } catch {
    // The encrypted backup is still valid if the browser blocks local storage.
  }
}

function getRecoveryBackupRevision(backup) {
  return String(
    backup?.updated_at ||
      backup?.created_at ||
      backup?.nonce ||
      backup?.encrypted_private_key ||
      "",
  );
}

export function getStoredRecoveryKey(user) {
  const storageKey = getRecoveryKeyStorageKey(user);
  const storage = getLocalStorage();

  if (!storageKey || !storage) {
    return "";
  }

  try {
    return storage.getItem(storageKey) || "";
  } catch {
    return "";
  }
}

export function clearStoredRecoveryKey(user) {
  const storageKey = getRecoveryKeyStorageKey(user);
  const storage = getLocalStorage();

  if (!storageKey || !storage) {
    return;
  }

  try {
    storage.removeItem(storageKey);
  } catch {
    // Clearing local recovery state is best effort.
  }
}

export function getAcknowledgedRecoveryBackupRevision(user) {
  const storageKey = getRecoveryKeyAcknowledgementStorageKey(user);
  const storage = getLocalStorage();

  if (!storageKey || !storage) {
    return "";
  }

  try {
    return storage.getItem(storageKey) || "";
  } catch {
    return "";
  }
}

export function acknowledgeRecoveryKeyBackup(user, backup) {
  const backupRevision = getRecoveryBackupRevision(backup);
  const storageKey = getRecoveryKeyAcknowledgementStorageKey(user);
  const storage = getLocalStorage();

  if (!backupRevision || !storageKey || !storage) {
    return;
  }

  try {
    storage.setItem(storageKey, backupRevision);
  } catch {
    // The device can still continue if local acknowledgement storage is blocked.
  }
}

export function clearRecoveryKeyBackupAcknowledgement(user) {
  const storageKey = getRecoveryKeyAcknowledgementStorageKey(user);
  const storage = getLocalStorage();

  if (!storageKey || !storage) {
    return;
  }

  try {
    storage.removeItem(storageKey);
  } catch {
    // Clearing local recovery acknowledgement is best effort.
  }
}

export function isRecoveryKeyBackupAcknowledged(user, backup) {
  const backupRevision = getRecoveryBackupRevision(backup);

  return Boolean(
    backupRevision &&
      getAcknowledgedRecoveryBackupRevision(user) === backupRevision,
  );
}

async function deriveBackupKey(recoveryPassword, salt, iterations) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Recovery backup requires browser crypto support.");
  }

  const importedKey = await globalThis.crypto.subtle.importKey(
    "raw",
    encodeText(recoveryPassword),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    importedKey,
    BACKUP_KEY_BYTES * 8,
  );

  return new Uint8Array(derivedBits);
}

export async function getRecoveryKeyBackupStatus() {
  const response = await getMessengerCryptoKeyBackup();
  return getResult(response);
}

export async function createRecoveryKeyBackup(user, recoveryPassword) {
  const normalizedPassword = String(recoveryPassword || "");

  if (normalizedPassword.length < MIN_RECOVERY_PASSWORD_LENGTH) {
    throw new Error(
      `Recovery key must be at least ${MIN_RECOVERY_PASSWORD_LENGTH} characters.`,
    );
  }

  await sodium.ready;

  const identity = await getOrCreateMessengerDeviceIdentity(user);
  const salt = sodium.randombytes_buf(BACKUP_SALT_BYTES);
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  );
  const backupKey = await deriveBackupKey(
    normalizedPassword,
    salt,
    BACKUP_KDF_ITERATIONS,
  );
  const identityPayload = sodium.from_string(
    JSON.stringify({
      v: E2EE_KEY_BACKUP_VERSION,
      device_id: identity.device_id,
      public_key: identity.public_key,
      private_key: identity.private_key,
    }),
  );
  const encryptedIdentity = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    identityPayload,
    sodium.from_string(BACKUP_AAD),
    null,
    nonce,
    backupKey,
  );

  return {
    public_key: identity.public_key,
    encrypted_private_key: toBase64(encryptedIdentity),
    salt: toBase64(salt),
    nonce: toBase64(nonce),
    kdf_algorithm: BACKUP_KDF_ALGORITHM,
    kdf_iterations: BACKUP_KDF_ITERATIONS,
  };
}

export async function saveRecoveryKeyBackup(user, recoveryPassword) {
  const normalizedPassword = String(recoveryPassword || "");
  const backupPayload = await createRecoveryKeyBackup(user, normalizedPassword);
  const response = await saveDefaultDeviceRecoveryBackup(user, backupPayload);
  const result = getResult(response);

  storeRecoveryKey(user, normalizedPassword);
  acknowledgeRecoveryKeyBackup(user, result.backup);

  return result;
}

export async function decryptRecoveryKeyBackup(backup, recoveryPassword) {
  await sodium.ready;

  const backupKey = await deriveBackupKey(
    recoveryPassword,
    fromBase64(backup.salt),
    Number(backup.kdf_iterations || BACKUP_KDF_ITERATIONS),
  );
  const decryptedPayload = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    fromBase64(backup.encrypted_private_key),
    sodium.from_string(BACKUP_AAD),
    fromBase64(backup.nonce),
    backupKey,
  );

  return JSON.parse(sodium.to_string(decryptedPayload));
}

export async function restoreRecoveryKeyBackup(user, backup, recoveryPassword) {
  const restoredIdentity = await decryptRecoveryKeyBackup(
    backup,
    recoveryPassword,
  );

  if (Number(restoredIdentity?.v) !== E2EE_KEY_BACKUP_VERSION) {
    throw new Error("This recovery backup is not supported.");
  }

  const identity = await saveMessengerDeviceIdentity(user, {
    device_id: createMessengerDeviceId(),
    public_key: restoredIdentity.public_key,
    private_key: restoredIdentity.private_key,
  });

  const result = await registerMessengerDeviceIdentity(identity);
  acknowledgeRecoveryKeyBackup(user, backup);

  return result;
}

export async function verifyRecoveryKeyBackup(user, backup, recoveryPassword) {
  const restoredIdentity = await decryptRecoveryKeyBackup(
    backup,
    recoveryPassword,
  );

  if (Number(restoredIdentity?.v) !== E2EE_KEY_BACKUP_VERSION) {
    throw new Error("This recovery backup is not supported.");
  }

  acknowledgeRecoveryKeyBackup(user, backup);

  return restoredIdentity;
}
