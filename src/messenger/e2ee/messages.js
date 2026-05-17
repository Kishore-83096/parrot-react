import sodium from "libsodium-wrappers";

import { getMessengerRecipientCryptoDevices } from "../api.js";
import {
  ensureMessengerDeviceKey,
  fromBase64,
  getStoredMessengerDeviceIdentity,
  toBase64,
} from "./device.js";

export const E2EE_MESSAGE_TYPE = "e2ee.message";
export const E2EE_MESSAGE_VERSION = 1;

const E2EE_MESSAGE_AAD = "parrot:e2ee.message:v1";
const ENCRYPTED_MESSAGE_PREVIEW = "Encrypted message";
const DECRYPTION_FAILED_TEXT = "Unable to decrypt message";

function getCurrentUserId(user) {
  const userId = user?.id || user?.user_id;
  return userId ? Number(userId) : null;
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
  recipientAccountNumber,
  text,
  user,
}) {
  const plaintext = String(text || "");
  const encryptedAttachments = Array.isArray(attachments) ? attachments : [];
  const senderUserId = getCurrentUserId(user);

  if (!plaintext.trim() && encryptedAttachments.length === 0) {
    throw new Error("Message text or attachment is required.");
  }

  if (!recipientAccountNumber) {
    throw new Error("Recipient is required.");
  }

  await sodium.ready;

  const senderIdentity = await ensureMessengerDeviceKey(user);
  if (!senderIdentity) {
    throw new Error("Cannot initialize encrypted messaging without a user identity.");
  }

  const recipientResponse = await getMessengerRecipientCryptoDevices(
    recipientAccountNumber,
  );
  const recipientDevices = getDevicesFromResponse(recipientResponse)
    .map(normalizeDevice)
    .filter(Boolean);

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
  const additionalData = sodium.from_string(E2EE_MESSAGE_AAD);
  const payload = sodium.from_string(
    JSON.stringify({
      text: plaintext,
      attachments: encryptedAttachments,
    }),
  );
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    payload,
    additionalData,
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

export async function decryptMessageForUser(message, user) {
  if (!message) {
    return message;
  }

  const replyTo = message.reply_to
    ? await decryptMessageForUser(message.reply_to, user)
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
    await sodium.ready;

    const currentUserId = getCurrentUserId(user);
    const identity = await getStoredMessengerDeviceIdentity(user);
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
      sodium.from_string(E2EE_MESSAGE_AAD),
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
  return Promise.all(
    messageList.map((message) => decryptMessageForUser(message, user)),
  );
}

export async function decryptRoomsForUser(rooms, user) {
  const roomList = Array.isArray(rooms) ? rooms : [];

  return Promise.all(
    roomList.map(async (room) => {
      if (!room?.last_message) {
        return room;
      }

      return {
        ...room,
        last_message: await decryptMessageForUser(room.last_message, user),
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

  if (message?.is_encrypted && message?.decryption_status === "ok") {
    return "";
  }

  return isEncryptedMessageText(message?.text)
    ? ENCRYPTED_MESSAGE_PREVIEW
    : "";
}
