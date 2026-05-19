import sodium from "libsodium-wrappers";

import {
  completeMessengerEncryptedFileUploadIntent,
  createMessengerEncryptedFileUploadIntents,
} from "../api.js";
import { fromBase64, toBase64 } from "./devices/index.js";

export const E2EE_FILE_TYPE = "e2ee.file";
export const E2EE_FILE_VERSION = 1;

const E2EE_FILE_AAD = "parrot:e2ee.file:v1";
const decryptedAttachmentBlobCache = new Map();
let fileAdditionalData = null;

export function clearE2EEFileRuntimeCaches() {
  decryptedAttachmentBlobCache.clear();
}

function getUploadResult(response) {
  const result = response?.data?.result || response?.data;
  return result?.file || result || {};
}

function getAttachmentSourceUrl(attachment) {
  return attachment?.encrypted_file_url || attachment?.file_url || "";
}

function getFileAdditionalData() {
  if (!fileAdditionalData) {
    fileAdditionalData = sodium.from_string(E2EE_FILE_AAD);
  }

  return fileAdditionalData;
}

function getEncryptedAttachmentCacheKey(attachment) {
  return [
    getAttachmentSourceUrl(attachment),
    attachment?.file_key || "",
    attachment?.nonce || "",
    attachment?.mime_type || "",
  ].join("|");
}

export function isEncryptedAttachment(attachment) {
  return Boolean(
    attachment?.e2ee ||
      attachment?.type === E2EE_FILE_TYPE ||
      attachment?.encrypted_file_url,
  );
}

export async function encryptSelectedFilesForMessage(
  selectedFiles,
  { clientMessageId, recipientAccountNumber } = {},
) {
  const files = Array.isArray(selectedFiles) ? selectedFiles : [];
  if (files.length === 0) {
    return [];
  }

  if (!clientMessageId || !recipientAccountNumber) {
    throw new Error("Attachment upload authorization is incomplete.");
  }

  await sodium.ready;

  const encryptedFiles = await Promise.all(
    files.map((selectedFile, index) => encryptSelectedFile(selectedFile, index)),
  );
  const uploadIntentResponse = await createMessengerEncryptedFileUploadIntents({
    recipient_account_number: recipientAccountNumber,
    client_message_id: clientMessageId,
    attachments: encryptedFiles.map((encryptedFile) => ({
      id: encryptedFile.id,
      file_name: encryptedFile.file_name,
      mime_type: encryptedFile.mime_type,
      file_size_bytes: encryptedFile.file_size_bytes,
      encrypted_file_size_bytes: encryptedFile.encryptedBlob.size,
      sort_order: encryptedFile.sort_order,
    })),
  });
  const uploadIntentResult =
    uploadIntentResponse?.data?.result || uploadIntentResponse?.data || {};
  const uploadIntents = Array.isArray(uploadIntentResult.upload_intents)
    ? uploadIntentResult.upload_intents
    : [];

  if (uploadIntents.length !== encryptedFiles.length) {
    throw new Error("Attachment upload authorization did not match selected files.");
  }

  return Promise.all(
    encryptedFiles.map((encryptedFile, index) =>
      uploadEncryptedFileWithIntent(encryptedFile, uploadIntents[index]),
    ),
  );
}

async function encryptSelectedFile(selectedFile, index) {
  const file = selectedFile.file;
  const fileKey = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
  );
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  );
  const plaintextBytes = new Uint8Array(await file.arrayBuffer());
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintextBytes,
    getFileAdditionalData(),
    null,
    nonce,
    fileKey,
  );
  const encryptedBlob = new Blob([ciphertext], {
    type: "application/octet-stream",
  });

  return {
    id: selectedFile.id,
    v: E2EE_FILE_VERSION,
    type: E2EE_FILE_TYPE,
    e2ee: true,
    encryptedBlob,
    file_key: toBase64(fileKey),
    nonce: toBase64(nonce),
    file_name: file.name || `Attachment ${index + 1}`,
    mime_type: file.type || "application/octet-stream",
    file_size_bytes: file.size,
    file_type: selectedFile.fileType || "document",
    sort_order: index,
  };
}

async function uploadEncryptedFileWithIntent(encryptedFile, uploadIntent) {
  if (!uploadIntent?.id || !uploadIntent?.upload_url || !uploadIntent?.parameters) {
    throw new Error("Attachment upload authorization is invalid.");
  }

  const formData = new FormData();
  Object.entries(uploadIntent.parameters).forEach(([key, value]) => {
    formData.append(key, value);
  });
  formData.append("file", encryptedFile.encryptedBlob, `${encryptedFile.id}.txt`);

  const uploadResponse = await fetch(uploadIntent.upload_url, {
    method: "POST",
    body: formData,
  });
  const uploadResult = await uploadResponse.json().catch(() => null);

  if (!uploadResponse.ok || !uploadResult) {
    throw new Error(
      uploadResult?.error?.message || "Encrypted attachment upload failed.",
    );
  }

  const completionResponse = await completeMessengerEncryptedFileUploadIntent(
    uploadIntent.id,
    uploadResult,
  );
  const completedFile = getUploadResult(completionResponse);
  const encryptedFileUrl = completedFile.encrypted_file_url;

  if (!encryptedFileUrl) {
    throw new Error("Encrypted attachment upload did not return a file URL.");
  }

  const { encryptedBlob, ...attachment } = encryptedFile;

  return {
    ...attachment,
    upload_intent_id: completedFile.upload_intent_id || uploadIntent.id,
    encrypted_file_url: encryptedFileUrl,
    encrypted_file_size_bytes:
      completedFile.encrypted_file_size_bytes || encryptedBlob.size,
    cloudinary_public_id: completedFile.cloudinary_public_id || "",
    cloudinary_asset_id: completedFile.cloudinary_asset_id || "",
    cloudinary_resource_type: completedFile.cloudinary_resource_type || "raw",
    cloudinary_folder: completedFile.cloudinary_folder || "",
  };
}

export async function decryptEncryptedAttachmentBlob(attachment) {
  if (!isEncryptedAttachment(attachment)) {
    throw new Error("Attachment is not encrypted.");
  }

  await sodium.ready;

  const sourceUrl = getAttachmentSourceUrl(attachment);
  if (!sourceUrl || !attachment.file_key || !attachment.nonce) {
    throw new Error("Encrypted attachment metadata is incomplete.");
  }

  const cacheKey = getEncryptedAttachmentCacheKey(attachment);

  if (!decryptedAttachmentBlobCache.has(cacheKey)) {
    const decryptPromise = fetch(sourceUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to fetch encrypted attachment.");
        }

        const ciphertext = new Uint8Array(await response.arrayBuffer());
        const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
          null,
          ciphertext,
          getFileAdditionalData(),
          fromBase64(attachment.nonce),
          fromBase64(attachment.file_key),
        );

        return new Blob([plaintext], {
          type: attachment.mime_type || "application/octet-stream",
        });
      })
      .catch((error) => {
        decryptedAttachmentBlobCache.delete(cacheKey);
        throw error;
      });

    decryptedAttachmentBlobCache.set(cacheKey, decryptPromise);
  }

  return decryptedAttachmentBlobCache.get(cacheKey);
}
