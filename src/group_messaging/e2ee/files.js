import sodium from "libsodium-wrappers";

import {
  completeGroupEncryptedFileUploadIntent,
  createGroupEncryptedFileUploadIntents,
} from "../api.js";
import { fromBase64, toBase64 } from "../../messenger/e2ee/devices/index.js";

export const E2EE_FILE_TYPE = "e2ee.group_file";
export const E2EE_FILE_VERSION = 1;

const E2EE_FILE_AAD = "parrot:e2ee.group_file:v1";
const decryptedAttachmentBlobCache = new Map();
let fileAdditionalData = null;

export function clearGroupE2EEFileRuntimeCaches() {
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

export async function encryptSelectedFilesForGroupMessage(
  selectedFiles,
  { clientMessageId, onProgress, roomId } = {},
) {
  const files = Array.isArray(selectedFiles) ? selectedFiles : [];
  if (files.length === 0) {
    return [];
  }

  if (!clientMessageId || !roomId) {
    throw new Error("Attachment upload authorization is incomplete.");
  }

  await sodium.ready;
  emitFileTransferProgress(onProgress, {
    phase: "encrypting",
    percent: 0,
  });

  let encryptedFileCount = 0;
  const encryptedFiles = await Promise.all(
    files.map(async (selectedFile, index) => {
      const encryptedFile = await encryptSelectedFile(selectedFile, index);
      encryptedFileCount += 1;
      emitFileTransferProgress(onProgress, {
        completed: encryptedFileCount,
        phase: "encrypting",
        percent: Math.round((encryptedFileCount / files.length) * 100),
        total: files.length,
      });
      return encryptedFile;
    }),
  );
  emitFileTransferProgress(onProgress, {
    phase: "uploading",
    percent: 0,
  });

  const uploadIntentResponse = await createGroupEncryptedFileUploadIntents(
    roomId,
    {
      client_message_id: clientMessageId,
      attachments: encryptedFiles.map((encryptedFile) => ({
        id: encryptedFile.id,
        file_name: encryptedFile.file_name,
        mime_type: encryptedFile.mime_type,
        file_size_bytes: encryptedFile.file_size_bytes,
        encrypted_file_size_bytes: encryptedFile.encryptedBlob.size,
        sort_order: encryptedFile.sort_order,
      })),
    },
  );
  const uploadIntentResult =
    uploadIntentResponse?.data?.result || uploadIntentResponse?.data || {};
  const uploadIntents = Array.isArray(uploadIntentResult.upload_intents)
    ? uploadIntentResult.upload_intents
    : [];

  if (uploadIntents.length !== encryptedFiles.length) {
    throw new Error("Attachment upload authorization did not match selected files.");
  }

  const uploadBytesByIndex = new Map();
  const totalUploadBytes = encryptedFiles.reduce(
    (total, encryptedFile) => total + encryptedFile.encryptedBlob.size,
    0,
  );
  const emitUploadProgress = (index, loadedBytes) => {
    uploadBytesByIndex.set(index, loadedBytes);
    const loaded = encryptedFiles.reduce((currentLoaded, encryptedFile, fileIndex) => {
      const fileLoaded = uploadBytesByIndex.get(fileIndex) || 0;
      return currentLoaded + Math.min(fileLoaded, encryptedFile.encryptedBlob.size);
    }, 0);
    const percent = totalUploadBytes
      ? Math.min(Math.round((loaded / totalUploadBytes) * 100), 100)
      : null;

    emitFileTransferProgress(onProgress, {
      loaded,
      phase: "uploading",
      percent,
      total: totalUploadBytes,
    });
  };

  return Promise.all(
    encryptedFiles.map((encryptedFile, index) =>
      uploadEncryptedFileWithIntent(encryptedFile, uploadIntents[index], {
        onProgress: (progress) => {
          emitUploadProgress(index, progress.loaded || 0);
        },
        roomId,
      }),
    ),
  ).then((attachments) => {
    emitFileTransferProgress(onProgress, {
      loaded: totalUploadBytes,
      phase: "uploading",
      percent: 100,
      total: totalUploadBytes,
    });
    return attachments;
  });
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
    plaintextBlob: file,
    file_key: toBase64(fileKey),
    nonce: toBase64(nonce),
    file_name: file.name || `Attachment ${index + 1}`,
    mime_type: file.type || "application/octet-stream",
    file_size_bytes: file.size,
    file_type: selectedFile.fileType || "document",
    attachment_kind: normalizeOptionalAttachmentKind(
      selectedFile.attachmentKind,
    ),
    duration_seconds: normalizeOptionalPositiveNumber(
      selectedFile.durationSeconds,
    ),
    waveform: normalizeOptionalWaveform(selectedFile.waveform),
    sort_order: index,
  };
}

function normalizeOptionalAttachmentKind(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalPositiveNumber(value) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.round(numberValue)
    : null;
}

function normalizeOptionalWaveform(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, 80)
    .map((level) => Number(level))
    .filter((level) => Number.isFinite(level))
    .map((level) => Math.min(Math.max(level, 0), 1));
}

async function uploadEncryptedFileWithIntent(
  encryptedFile,
  uploadIntent,
  { onProgress, roomId } = {},
) {
  if (!uploadIntent?.id || !uploadIntent?.upload_url || !uploadIntent?.parameters) {
    throw new Error("Attachment upload authorization is invalid.");
  }

  const formData = new FormData();
  Object.entries(uploadIntent.parameters).forEach(([key, value]) => {
    formData.append(key, value);
  });
  formData.append("file", encryptedFile.encryptedBlob, `${encryptedFile.id}.txt`);

  const uploadResult = await uploadFormDataWithProgress(
    uploadIntent.upload_url,
    formData,
    (progress) => {
      emitFileTransferProgress(onProgress, {
        loaded: progress.loaded,
        phase: "uploading",
        total: progress.total,
      });
    },
  );

  const completionResponse = await completeGroupEncryptedFileUploadIntent(
    roomId,
    uploadIntent.id,
    uploadResult,
  );
  const completedFile = getUploadResult(completionResponse);
  const encryptedFileUrl = completedFile.encrypted_file_url;

  if (!encryptedFileUrl) {
    throw new Error("Encrypted attachment upload did not return a file URL.");
  }

  const { encryptedBlob, plaintextBlob, ...attachment } = encryptedFile;
  const completedAttachment = {
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

  if (plaintextBlob) {
    decryptedAttachmentBlobCache.set(
      getEncryptedAttachmentCacheKey(completedAttachment),
      Promise.resolve(plaintextBlob),
    );
  }

  return completedAttachment;
}

function uploadFormDataWithProgress(uploadUrl, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open("POST", uploadUrl);
    request.responseType = "json";

    request.upload.onprogress = (event) => {
      emitFileTransferProgress(onProgress, {
        loaded: Number(event.loaded) || 0,
        total: event.lengthComputable ? Number(event.total) || 0 : 0,
      });
    };
    request.onerror = () => {
      reject(new Error("Encrypted attachment upload failed."));
    };
    request.onabort = () => {
      reject(new Error("Encrypted attachment upload was cancelled."));
    };
    request.onload = () => {
      const uploadResult =
        request.response ||
        tryParseJson(request.responseText) ||
        {};

      if (request.status < 200 || request.status >= 300) {
        reject(
          new Error(
            uploadResult?.error?.message || "Encrypted attachment upload failed.",
          ),
        );
        return;
      }

      resolve(uploadResult);
    };

    request.send(formData);
  });
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function emitFileTransferProgress(onProgress, progress) {
  if (typeof onProgress !== "function") {
    return;
  }

  onProgress(progress);
}

export async function decryptEncryptedAttachmentBlob(
  attachment,
  { onProgress } = {},
) {
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
    emitFileTransferProgress(onProgress, {
      phase: "downloading",
      percent: 0,
    });

    const decryptPromise = fetch(sourceUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to fetch encrypted attachment.");
        }

        const ciphertext = await readEncryptedAttachmentBytes(
          response,
          attachment,
          onProgress,
        );
        emitFileTransferProgress(onProgress, {
          phase: "decrypting",
          percent: null,
        });

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
      .then((blob) => {
        emitFileTransferProgress(onProgress, {
          phase: "ready",
          percent: 100,
        });
        return blob;
      })
      .catch((error) => {
        decryptedAttachmentBlobCache.delete(cacheKey);
        throw error;
      });

    decryptedAttachmentBlobCache.set(cacheKey, decryptPromise);
  } else {
    emitFileTransferProgress(onProgress, {
      phase: "decrypting",
      percent: null,
    });
  }

  return decryptedAttachmentBlobCache.get(cacheKey).then((blob) => {
    emitFileTransferProgress(onProgress, {
      phase: "ready",
      percent: 100,
    });
    return blob;
  });
}

async function readEncryptedAttachmentBytes(response, attachment, onProgress) {
  const contentLength = Number(response.headers.get("content-length"));
  const fallbackLength = Number(attachment?.encrypted_file_size_bytes);
  const total = Number.isFinite(contentLength) && contentLength > 0
    ? contentLength
    : Number.isFinite(fallbackLength) && fallbackLength > 0
      ? fallbackLength
      : 0;

  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    emitFileTransferProgress(onProgress, {
      loaded: buffer.byteLength,
      phase: "downloading",
      percent: 100,
      total: total || buffer.byteLength,
    });
    return new Uint8Array(buffer);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
    loaded += value.byteLength;
    emitFileTransferProgress(onProgress, {
      loaded,
      phase: "downloading",
      percent: total ? Math.min(Math.round((loaded / total) * 100), 100) : null,
      total,
    });
  }

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });

  return bytes;
}
