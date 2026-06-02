import sodium from "libsodium-wrappers";

import {
  completeMessengerStoryUploadIntent,
  createMessengerStoryUploadIntents,
} from "../api.js";
import {
  decryptEncryptedAttachmentBlob,
  E2EE_FILE_TYPE,
  E2EE_FILE_VERSION,
} from "./files.js";
import { toBase64 } from "./devices/index.js";

const E2EE_FILE_AAD = "parrot:e2ee.file:v1";
const STORY_MEDIA_PAYLOAD_TYPE = "parrot.story.media";
const STORY_MEDIA_PAYLOAD_VERSION = 1;
const STORY_TEXT_PAYLOAD_TYPE = "parrot.story.text";
const STORY_TEXT_PAYLOAD_VERSION = 1;

let fileAdditionalData = null;

function getFileAdditionalData() {
  if (!fileAdditionalData) {
    fileAdditionalData = sodium.from_string(E2EE_FILE_AAD);
  }

  return fileAdditionalData;
}

export function createStoryClientId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `story-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getStoryMediaType(file) {
  const mimeType = String(file?.type || "").toLowerCase();

  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (mimeType.startsWith("video/")) {
    return "video";
  }

  return "";
}

export function isSupportedStoryMediaFile(file) {
  return Boolean(getStoryMediaType(file));
}

export async function encryptSelectedFilesForStory(
  selectedFiles,
  { audienceAccountNumbers, caption, clientStoryId, onProgress, text } = {},
) {
  const files = Array.isArray(selectedFiles) ? selectedFiles : [];
  if (files.length === 0) {
    return {
      encryptedPayload: "",
      media: [],
      uploadIntentIds: [],
    };
  }

  if (!clientStoryId) {
    throw new Error("Story upload is missing a client story id.");
  }

  await sodium.ready;
  emitStoryTransferProgress(onProgress, {
    phase: "encrypting",
    percent: 0,
  });

  let encryptedFileCount = 0;
  const encryptedFiles = await Promise.all(
    files.map(async (file, index) => {
      const encryptedFile = await encryptStoryFile(file, index);
      encryptedFileCount += 1;
      emitStoryTransferProgress(onProgress, {
        completed: encryptedFileCount,
        phase: "encrypting",
        percent: Math.round((encryptedFileCount / files.length) * 100),
        total: files.length,
      });
      return encryptedFile;
    }),
  );

  emitStoryTransferProgress(onProgress, {
    phase: "uploading",
    percent: 0,
  });

  const uploadIntentResponse = await createMessengerStoryUploadIntents({
    audience_account_numbers: Array.isArray(audienceAccountNumbers)
      ? audienceAccountNumbers
      : [],
    client_story_id: clientStoryId,
    media: encryptedFiles.map((encryptedFile) => ({
      id: encryptedFile.id,
      file_name: encryptedFile.file_name,
      media_type: encryptedFile.media_type,
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
    throw new Error("Story upload authorization did not match selected media.");
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

    emitStoryTransferProgress(onProgress, {
      loaded,
      phase: "uploading",
      percent,
      total: totalUploadBytes,
    });
  };

  const completedMedia = await Promise.all(
    encryptedFiles.map((encryptedFile, index) =>
      uploadStoryFileWithIntent(encryptedFile, uploadIntents[index], {
        onProgress: (progress) => {
          emitUploadProgress(index, progress.loaded || 0);
        },
      }),
    ),
  );

  emitStoryTransferProgress(onProgress, {
    loaded: totalUploadBytes,
    phase: "uploading",
    percent: 100,
    total: totalUploadBytes,
  });

  return {
    encryptedPayload: JSON.stringify({
      v: STORY_MEDIA_PAYLOAD_VERSION,
      type: STORY_MEDIA_PAYLOAD_TYPE,
      caption: String(caption ?? text ?? "").trim(),
      media: completedMedia.map((media) => ({
        file_key: media.file_key,
        file_name: media.file_name,
        file_size_bytes: media.file_size_bytes,
        id: media.id,
        media_index: media.media_index,
        media_type: media.media_type,
        mime_type: media.mime_type,
        nonce: media.nonce,
        sort_order: media.sort_order,
        type: media.type,
        upload_intent_id: media.upload_intent_id,
        v: media.v,
      })),
    }),
    media: completedMedia,
    uploadIntentIds: completedMedia.map((media) => media.upload_intent_id),
  };
}

async function encryptStoryFile(file, index) {
  const mediaType = getStoryMediaType(file);
  if (!mediaType) {
    throw new Error("Stories only support image and video files.");
  }

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
  const id = createStoryClientId();

  return {
    id,
    v: E2EE_FILE_VERSION,
    type: E2EE_FILE_TYPE,
    e2ee: true,
    encryptedBlob,
    file_key: toBase64(fileKey),
    file_name: file.name || `Story media ${index + 1}`,
    file_size_bytes: file.size,
    media_index: index,
    media_type: mediaType,
    mime_type: file.type || `${mediaType}/*`,
    nonce: toBase64(nonce),
    plaintextBlob: file,
    sort_order: index,
  };
}

async function uploadStoryFileWithIntent(
  encryptedFile,
  uploadIntent,
  { onProgress } = {},
) {
  if (!uploadIntent?.id || !uploadIntent?.upload_url || !uploadIntent?.parameters) {
    throw new Error("Story upload authorization is invalid.");
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
      emitStoryTransferProgress(onProgress, {
        loaded: progress.loaded,
        phase: "uploading",
        total: progress.total,
      });
    },
  );

  const completionResponse = await completeMessengerStoryUploadIntent(
    uploadIntent.id,
    uploadResult,
  );
  const result = completionResponse?.data?.result || completionResponse?.data || {};
  const completedFile = result.file || result || {};
  const encryptedFileUrl = completedFile.encrypted_file_url;

  if (!encryptedFileUrl) {
    throw new Error("Encrypted story upload did not return a file URL.");
  }

  const { encryptedBlob, plaintextBlob, ...media } = encryptedFile;
  return {
    ...media,
    encrypted_file_size_bytes:
      completedFile.encrypted_file_size_bytes || encryptedBlob.size,
    encrypted_file_url: encryptedFileUrl,
    upload_intent_id: completedFile.upload_intent_id || uploadIntent.id,
  };
}

function uploadFormDataWithProgress(uploadUrl, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open("POST", uploadUrl);
    request.responseType = "json";

    request.upload.onprogress = (event) => {
      emitStoryTransferProgress(onProgress, {
        loaded: Number(event.loaded) || 0,
        total: event.lengthComputable ? Number(event.total) || 0 : 0,
      });
    };
    request.onerror = () => {
      reject(new Error("Encrypted story upload failed."));
    };
    request.onabort = () => {
      reject(new Error("Encrypted story upload was cancelled."));
    };
    request.onload = () => {
      const uploadResult =
        request.response ||
        tryParseJson(request.responseText) ||
        {};

      if (request.status < 200 || request.status >= 300) {
        reject(
          new Error(
            uploadResult?.error?.message || "Encrypted story upload failed.",
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

function emitStoryTransferProgress(onProgress, progress) {
  if (typeof onProgress !== "function") {
    return;
  }

  onProgress(progress);
}

export function parseStoryMediaPayload(value) {
  return parseStoryMediaEnvelope(value)?.media || [];
}

export function getStoryMediaCaption(value) {
  return parseStoryMediaEnvelope(value)?.caption || "";
}

function parseStoryMediaEnvelope(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    const payload = JSON.parse(value);
    if (
      payload?.type !== STORY_MEDIA_PAYLOAD_TYPE ||
      Number(payload?.v) !== STORY_MEDIA_PAYLOAD_VERSION ||
      !Array.isArray(payload?.media)
    ) {
      return null;
    }

    return {
      media: payload.media,
      caption:
        typeof payload.caption === "string"
          ? payload.caption
          : typeof payload.text === "string"
            ? payload.text
            : "",
    };
  } catch {
    return null;
  }
}

export function createStoryTextPayload({ text, theme } = {}) {
  return JSON.stringify({
    v: STORY_TEXT_PAYLOAD_VERSION,
    type: STORY_TEXT_PAYLOAD_TYPE,
    text: String(text || "").trim(),
    theme: String(theme || "lavender"),
  });
}

export function parseStoryTextPayload(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    const payload = JSON.parse(value);
    if (
      payload?.type !== STORY_TEXT_PAYLOAD_TYPE ||
      Number(payload?.v) !== STORY_TEXT_PAYLOAD_VERSION ||
      typeof payload?.text !== "string"
    ) {
      return null;
    }

    return {
      text: payload.text,
      theme: typeof payload.theme === "string" ? payload.theme : "lavender",
    };
  } catch {
    return null;
  }
}

export function mergeStoryMediaCrypto(story) {
  const mediaKeys = parseStoryMediaPayload(story?.encrypted_payload);
  const mediaKeysByIndex = new Map(
    mediaKeys.map((media) => [
      Number(media.media_index ?? media.sort_order ?? 0),
      media,
    ]),
  );

  return (Array.isArray(story?.media) ? story.media : []).map((media, index) => {
    const mediaIndex = Number(media.sort_order ?? index);
    const keyData = mediaKeysByIndex.get(mediaIndex) || {};

    return {
      ...media,
      ...keyData,
      encrypted_file_url: media.encrypted_file_url,
      id: media.id || keyData.id || `story-media-${index}`,
      media_index: mediaIndex,
      media_type: media.media_type || keyData.media_type,
      mime_type: media.mime_type || keyData.mime_type,
    };
  });
}

export async function decryptStoryMediaBlob(media, options) {
  return decryptEncryptedAttachmentBlob(
    {
      ...media,
      e2ee: true,
      file_type: media.media_type,
    },
    options,
  );
}
