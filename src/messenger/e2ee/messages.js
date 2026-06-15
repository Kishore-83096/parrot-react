import sodium from "libsodium-wrappers";

import { getMessengerRecipientCryptoDevices } from "../api.js";
import {
  getSharedContactPreviewLabel,
  normalizeSharedContacts,
} from "../sharedContacts.js";
import {
  ensureMessengerDeviceKey,
  fromBase64,
  getStoredMessengerDeviceIdentity,
  toBase64,
} from "./devices/index.js";

export const E2EE_MESSAGE_TYPE = "e2ee.message";
export const E2EE_MESSAGE_VERSION = 1;

const E2EE_MESSAGE_AAD = "parrot:e2ee.message:v1";
const ENCRYPTED_MESSAGE_PREVIEW = "Encrypted message";
const DECRYPTION_FAILED_TEXT = "Unable to decrypt message";
const RECIPIENT_DEVICE_CACHE_TTL_MS = 10000;
const recipientDeviceCache = new Map();
let messageAdditionalData = null;

function getCurrentUserId(user) {
  const userId = user?.id || user?.user_id;
  return userId ? Number(userId) : null;
}

function getCurrentUserCacheScope(user) {
  const userId = user?.id || user?.user_id;

  if (userId) {
    return `user:${String(userId)}`;
  }

  if (user?.account_number) {
    return `account:${String(user.account_number)}`;
  }

  return "anonymous";
}

export function clearE2EEMessageRuntimeCaches() {
  recipientDeviceCache.clear();
}

function getDevicesFromResponse(response) {
  const result = response?.data?.result || response?.data;
  return Array.isArray(result?.devices) ? result.devices : [];
}

function normalizeDevice(device) {
  if (!device?.device_id || !device?.public_key) {
    return null;
  }

  try {
    const publicKeyBytes = fromBase64(device.public_key);

    if (publicKeyBytes.length !== sodium.crypto_box_PUBLICKEYBYTES) {
      return null;
    }

    return {
      user_id: device.user_id ? Number(device.user_id) : null,
      device_id: String(device.device_id),
      public_key: device.public_key,
      publicKeyBytes,
    };
  } catch {
    return null;
  }
}

function getMessageAdditionalData() {
  if (!messageAdditionalData) {
    messageAdditionalData = sodium.from_string(E2EE_MESSAGE_AAD);
  }

  return messageAdditionalData;
}

async function getCachedRecipientDevices(recipientAccountNumber, user) {
  const recipientScope = String(recipientAccountNumber || "").trim();

  if (!recipientScope) {
    return [];
  }

  const cacheKey = `${getCurrentUserCacheScope(user)}:${recipientScope}`;
  const now = Date.now();
  const cachedEntry = recipientDeviceCache.get(cacheKey);

  if (cachedEntry && cachedEntry.expiresAt > now) {
    return cachedEntry.promise;
  }

  const promise = (async () => {
    const recipientResponse =
      await getMessengerRecipientCryptoDevices(recipientScope);

    return getDevicesFromResponse(recipientResponse)
      .map(normalizeDevice)
      .filter(Boolean);
  })().catch((error) => {
    if (recipientDeviceCache.get(cacheKey)?.promise === promise) {
      recipientDeviceCache.delete(cacheKey);
    }

    throw error;
  });

  recipientDeviceCache.set(cacheKey, {
    expiresAt: now + RECIPIENT_DEVICE_CACHE_TTL_MS,
    promise,
  });

  return promise;
}

export async function preloadRecipientDevicesForMessage(
  recipientAccountNumber,
  user,
) {
  await sodium.ready;
  return getCachedRecipientDevices(recipientAccountNumber, user);
}

function getEnvelopeKey(device) {
  return `${device.user_id || "unknown"}:${device.device_id}`;
}

function getKeyEnvelopesForIdentity(keys, identity, currentUserId) {
  const preferredEnvelopes = [];
  const fallbackEnvelopes = [];

  (Array.isArray(keys) ? keys : []).forEach((key) => {
    if (!key?.encrypted_key) {
      return;
    }

    const isCurrentUserEnvelope =
      !key.user_id || !currentUserId || Number(key.user_id) === currentUserId;
    if (!isCurrentUserEnvelope) {
      return;
    }

    if (String(key.device_id || "") === String(identity.device_id)) {
      preferredEnvelopes.push(key);
      return;
    }

    fallbackEnvelopes.push(key);
  });

  return [...preferredEnvelopes, ...fallbackEnvelopes];
}

function openMessageKeyForIdentity(keyEnvelopes, identity) {
  for (const keyEnvelope of keyEnvelopes) {
    try {
      return sodium.crypto_box_seal_open(
        fromBase64(keyEnvelope.encrypted_key),
        fromBase64(identity.public_key),
        fromBase64(identity.private_key),
      );
    } catch {
      // Restored devices can share the same private key across different device ids.
      // Keep trying same-user envelopes until one opens.
    }
  }

  return null;
}

async function getMessageDecryptionContext(user) {
  await sodium.ready;

  return {
    currentUserId: getCurrentUserId(user),
    identity: await getStoredMessengerDeviceIdentity(user),
  };
}

function buildEncryptedMessagePayload({
  ciphertext,
  keys,
  nonce,
  senderDeviceId,
}) {
  return {
    v: E2EE_MESSAGE_VERSION,
    type: E2EE_MESSAGE_TYPE,
    alg: "xchacha20poly1305-ietf+sealedbox",
    sender_device_id: senderDeviceId,
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
    keys,
  };
}

export function parseEncryptedMessageText(text) {
  if (typeof text !== "string") {
    return null;
  }

  const normalizedText = text.trim();
  if (!normalizedText || normalizedText[0] !== "{") {
    return null;
  }

  try {
    const payload = JSON.parse(normalizedText);

    if (
      payload?.type !== E2EE_MESSAGE_TYPE ||
      Number(payload?.v) !== E2EE_MESSAGE_VERSION ||
      typeof payload?.nonce !== "string" ||
      typeof payload?.ciphertext !== "string" ||
      !Array.isArray(payload?.keys)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function isEncryptedMessageText(text) {
  return Boolean(parseEncryptedMessageText(text));
}

export async function encryptMessageText({
  attachments = [],
  edit = null,
  recipientAccountNumber,
  sharedContacts = [],
  text,
  user,
}) {
  const plaintext = String(text || "");
  const encryptedAttachments = Array.isArray(attachments) ? attachments : [];
  const normalizedSharedContacts = normalizeSharedContacts(sharedContacts);
  const senderUserId = getCurrentUserId(user);

  if (
    !plaintext.trim() &&
    encryptedAttachments.length === 0 &&
    normalizedSharedContacts.length === 0
  ) {
    throw new Error("Message text, attachment, or contact is required.");
  }

  if (!recipientAccountNumber) {
    throw new Error("Recipient is required.");
  }

  await sodium.ready;

  const senderIdentity = await ensureMessengerDeviceKey(user);
  if (!senderIdentity) {
    throw new Error("Cannot initialize encrypted messaging without a user identity.");
  }

  const recipientDevices = await getCachedRecipientDevices(
    recipientAccountNumber,
    user,
  );

  if (recipientDevices.length === 0) {
    throw new Error("This contact has not enabled encrypted messaging yet.");
  }

  const senderPublicKeyBytes = fromBase64(senderIdentity.public_key);
  const messageKey = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
  );
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  );
  const payload = sodium.from_string(
    JSON.stringify({
      text: plaintext,
      attachments: encryptedAttachments,
      shared_contacts: normalizedSharedContacts,
      edit: normalizeEditMetadata(edit),
    }),
  );
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    payload,
    getMessageAdditionalData(),
    null,
    nonce,
    messageKey,
  );
  const envelopeDevicesByKey = new Map();

  envelopeDevicesByKey.set(
    getEnvelopeKey({
      user_id: senderUserId,
      device_id: senderIdentity.device_id,
    }),
    {
      user_id: senderUserId,
      device_id: senderIdentity.device_id,
      publicKeyBytes: senderPublicKeyBytes,
    },
  );

  recipientDevices.forEach((device) => {
    envelopeDevicesByKey.set(getEnvelopeKey(device), device);
  });

  const keys = Array.from(envelopeDevicesByKey.values()).map((device) => ({
    user_id: device.user_id,
    device_id: device.device_id,
    encrypted_key: toBase64(
      sodium.crypto_box_seal(messageKey, device.publicKeyBytes),
    ),
  }));

  return JSON.stringify(
    buildEncryptedMessagePayload({
      ciphertext,
      keys,
      nonce,
      senderDeviceId: senderIdentity.device_id,
    }),
  );
}

export async function decryptMessageForUser(message, user, decryptionContext) {
  if (!message) {
    return message;
  }

  const replyTo = message.reply_to
    ? await decryptMessageForUser(message.reply_to, user, decryptionContext)
    : message.reply_to;
  const encryptedPayload = parseEncryptedMessageText(message.text);

  if (!encryptedPayload) {
    return {
      ...message,
      reply_to: replyTo,
      decrypted_text: message.text || "",
      decryption_status: "plaintext",
      is_encrypted: false,
    };
  }

  try {
    const context =
      decryptionContext || (await getMessageDecryptionContext(user));
    const currentUserId = context.currentUserId;
    const identity = context.identity;
    if (!identity) {
      return {
        ...message,
        reply_to: replyTo,
        decrypted_text: "",
        decryption_status: "missing_key",
        is_encrypted: true,
      };
    }

    const keyEnvelopes = getKeyEnvelopesForIdentity(
      encryptedPayload.keys,
      identity,
      currentUserId,
    );
    const messageKey = openMessageKeyForIdentity(keyEnvelopes, identity);

    if (!messageKey) {
      return {
        ...message,
        reply_to: replyTo,
        decrypted_text: "",
        decryption_status: "missing_key",
        is_encrypted: true,
      };
    }

    const plaintextBytes = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      fromBase64(encryptedPayload.ciphertext),
      getMessageAdditionalData(),
      fromBase64(encryptedPayload.nonce),
      messageKey,
    );
    const plaintextPayload = JSON.parse(sodium.to_string(plaintextBytes));

    return {
      ...message,
      reply_to: replyTo,
      decrypted_text:
        typeof plaintextPayload?.text === "string" ? plaintextPayload.text : "",
      decrypted_attachments: Array.isArray(plaintextPayload?.attachments)
        ? plaintextPayload.attachments
            .map(normalizeDecryptedAttachment)
            .filter(Boolean)
        : [],
      decrypted_shared_contacts: normalizeSharedContacts(
        plaintextPayload?.shared_contacts,
      ),
      edit_metadata: normalizeEditMetadata(plaintextPayload?.edit),
      edit_change_type: normalizeEditMetadata(plaintextPayload?.edit).change_type,
      decryption_status: "ok",
      is_encrypted: true,
    };
  } catch {
    return {
      ...message,
      reply_to: replyTo,
      decrypted_text: "",
      decryption_status: "error",
      is_encrypted: true,
    };
  }
}

function normalizeEditMetadata(edit) {
  if (!edit || typeof edit !== "object") {
    return {};
  }

  const changeType = String(edit.change_type || "");
  if (!["text", "attachments", "text_attachments"].includes(changeType)) {
    return {};
  }

  return {
    change_type: changeType,
  };
}

function normalizeDecryptedAttachment(attachment, index) {
  if (!attachment || typeof attachment !== "object") {
    return null;
  }

  return {
    ...attachment,
    id: attachment.id || `e2ee-attachment-${index}`,
    e2ee: Boolean(attachment.e2ee || attachment.encrypted_file_url),
    file_type: attachment.file_type || "document",
    file_name: attachment.file_name || `Attachment ${index + 1}`,
    mime_type: attachment.mime_type || "application/octet-stream",
    sort_order: Number.isFinite(Number(attachment.sort_order))
      ? Number(attachment.sort_order)
      : index,
  };
}

export async function decryptMessagesForUser(messages, user) {
  const messageList = Array.isArray(messages) ? messages : [];
  const decryptionContext = await getMessageDecryptionContext(user);

  return Promise.all(
    messageList.map((message) =>
      decryptMessageForUser(message, user, decryptionContext),
    ),
  );
}

export async function decryptRoomsForUser(rooms, user) {
  const roomList = Array.isArray(rooms) ? rooms : [];
  const decryptionContext = await getMessageDecryptionContext(user);

  return Promise.all(
    roomList.map(async (room) => {
      if (!room?.last_message) {
        return room;
      }

      return {
        ...room,
        last_message: await decryptMessageForUser(
          room.last_message,
          user,
          decryptionContext,
        ),
      };
    }),
  );
}

export function getRenderableMessageText(message) {
  if (!message) {
    return "";
  }

  if (message.is_encrypted) {
    if (message.decryption_status === "ok") {
      return message.decrypted_text || "";
    }

    return DECRYPTION_FAILED_TEXT;
  }

  if (isEncryptedMessageText(message.text)) {
    return ENCRYPTED_MESSAGE_PREVIEW;
  }

  return String(message.text || "");
}

export function getMessagePreviewLabel(message) {
  const text = getRenderableMessageText(message).trim();

  if (text) {
    return text;
  }

  const sharedContactPreview = getSharedContactPreviewLabel(
    message?.decrypted_shared_contacts || message?.shared_contacts,
  );

  if (sharedContactPreview) {
    return sharedContactPreview;
  }

  if (message?.is_encrypted && message?.decryption_status === "ok") {
    return "";
  }

  return isEncryptedMessageText(message?.text)
    ? ENCRYPTED_MESSAGE_PREVIEW
    : "";
}
