import sodium from "libsodium-wrappers";

import { uploadMessengerEncryptedFile } from "../api.js";
import { fromBase64, toBase64 } from "./devices/index.js";

export const E2EE_FILE_TYPE = "e2ee.file";
export const E2EE_FILE_VERSION = 1;

const E2EE_FILE_AAD = "parrot:e2ee.file:v1";
const decryptedAttachmentBlobCache = new Map();
let fileAdditionalData = null;

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

export async function encryptSelectedFilesForMessage(selectedFiles) {
  const files = Array.isArray(selectedFiles) ? selectedFiles : [];
  await sodium.ready;

  return Promise.all(
    files.map((selectedFile, index) =>
      encryptSelectedFileForMessage(selectedFile, index),
    ),
  );
}

async function encryptSelectedFileForMessage(selectedFile, index) {
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
  const formData = new FormData();

  formData.append("file", encryptedBlob, `${selectedFile.id}.txt`);

  const response = await uploadMessengerEncryptedFile(formData);
  const uploadedFile = getUploadResult(response);
  const encryptedFileUrl = uploadedFile.encrypted_file_url;

  if (!encryptedFileUrl) {
    throw new Error("Encrypted attachment upload did not return a file URL.");
  }

  return {
    id: selectedFile.id,
    v: E2EE_FILE_VERSION,
    type: E2EE_FILE_TYPE,
    e2ee: true,
    encrypted_file_url: encryptedFileUrl,
    encrypted_file_size_bytes:
      uploadedFile.encrypted_file_size_bytes || ciphertext.length,
    file_key: toBase64(fileKey),
    nonce: toBase64(nonce),
    file_name: file.name || `Attachment ${index + 1}`,
    mime_type: file.type || "application/octet-stream",
    file_size_bytes: file.size,
    file_type: selectedFile.fileType || "document",
    sort_order: index,
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
