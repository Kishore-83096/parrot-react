import {
  Ban,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Mic,
  Music,
  MessageCircle,
  Paperclip,
  Pause,
  Play,
  Reply,
  Send,
  Trash2,
  Video,
  Volume1,
  Volume2,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createMessengerClientMessageId,
  getMessengerErrorMessage,
  getMessengerRoomMessages,
  getMessengerRoomWebSocketUrl,
  getMessengerToken,
  markMessengerRoomRead,
  MESSENGER_INBOX_EVENT_NAME,
  reactToMessengerMessage,
  sendMessengerMessage,
} from "../../api.js";
import {
  decryptMessageForUser,
  decryptMessagesForUser,
  encryptMessageText,
  getRenderableMessageText,
} from "../../e2ee/messages.js";
import {
  decryptEncryptedAttachmentBlob,
  encryptSelectedFilesForMessage,
  isEncryptedAttachment,
} from "../../e2ee/files.js";
import {
  formatRoomTime,
  getConversationPeerAccount,
  getContactName,
  getCurrentUserId,
  getMessageDateDividerLabel,
  getMessageDateKey,
  getMessageStatusLabel,
  upsertMessage,
} from "./roomHelpers.js";

const MESSAGE_PAGE_SIZE = 20;
const OLDER_MESSAGES_SCROLL_THRESHOLD = 8;
const MESSAGE_REPLY_DRAG_THRESHOLD = 48;
const MESSAGE_REPLY_DRAG_LIMIT = 76;
const MAX_MESSAGE_ATTACHMENTS = 10;
const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;
const MEDIA_CACHE_NAME = "parrot-message-media-v1";
const ATTACHMENT_PREVIEW_LIMIT = 4;
const TYPING_REFRESH_INTERVAL_MS = 3000;
const TYPING_STOP_DELAY_MS = 1600;
const TYPING_REMOTE_TIMEOUT_MS = 8000;
const ROOM_SOCKET_PING_INTERVAL_MS = 25000;
const MESSAGE_ACTION_LONG_PRESS_MS = 420;
const MESSAGE_ACTION_LONG_PRESS_MOVE_TOLERANCE = 10;
const VOICE_NOTE_ATTACHMENT_KIND = "voice_note";
const VOICE_NOTE_MAX_DURATION_SECONDS = 180;
const VOICE_NOTE_AUDIO_BITRATE = 32000;
const VOICE_NOTE_WAVEFORM_BARS = 40;
const VOICE_NOTE_MIME_TYPE_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];
const DEFAULT_VOICE_NOTE_WAVEFORM = [
  0.24, 0.48, 0.34, 0.72, 0.42, 0.58, 0.88, 0.36, 0.52, 0.76,
  0.3, 0.64, 0.44, 0.82, 0.56, 0.38, 0.7, 0.5, 0.9, 0.46,
  0.6, 0.34, 0.74, 0.54, 0.42, 0.8, 0.48, 0.66, 0.36, 0.58,
  0.86, 0.4, 0.62, 0.5, 0.78, 0.32, 0.68, 0.44, 0.56, 0.72,
];
const MESSAGE_REACTIONS = [
  { key: "thumbs_up", emoji: "\u{1F44D}", label: "Thumbs up" },
  { key: "heart", emoji: "\u2764\uFE0F", label: "Heart" },
  { key: "laugh", emoji: "\u{1F602}", label: "Laugh" },
  { key: "surprised", emoji: "\u{1F62E}", label: "Surprised" },
  { key: "sad", emoji: "\u{1F622}", label: "Sad" },
];
const MESSAGE_REACTION_KEYS = MESSAGE_REACTIONS.map((reaction) => reaction.key);
function getEmptyMessagePagination() {
  return {
    hasMore: false,
    nextBeforeMessageId: null,
  };
}
const TEXT_DOCUMENT_EXTENSIONS = new Set(["csv", "json", "md", "rtf", "txt"]);
const OFFICE_DOCUMENT_EXTENSIONS = new Set([
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
]);
const OFFICE_DOCUMENT_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function getReactionConfig(reactionKey) {
  return (
    MESSAGE_REACTIONS.find((reaction) => reaction.key === reactionKey) || null
  );
}

function normalizeReactionGroups(reactions, myReaction = null) {
  const countByReaction = new Map();

  (Array.isArray(reactions) ? reactions : []).forEach((reactionItem) => {
    const reactionKey = String(reactionItem?.reaction || "");
    const count = Math.max(Number(reactionItem?.count || 0), 0);

    if (!MESSAGE_REACTION_KEYS.includes(reactionKey) || count <= 0) {
      return;
    }

    countByReaction.set(
      reactionKey,
      (countByReaction.get(reactionKey) || 0) + count,
    );
  });

  return MESSAGE_REACTIONS.map((reaction) => {
    const count = countByReaction.get(reaction.key) || 0;

    return count > 0
      ? {
          reaction: reaction.key,
          count,
          reacted_by_me: reaction.key === myReaction,
        }
      : null;
  }).filter(Boolean);
}

function getMessageMyReaction(message) {
  const explicitReaction = String(message?.my_reaction || "");

  if (MESSAGE_REACTION_KEYS.includes(explicitReaction)) {
    return explicitReaction;
  }

  const reactedByMe = (Array.isArray(message?.reactions)
    ? message.reactions
    : []
  ).find((reactionItem) => reactionItem?.reacted_by_me);
  const reactionKey = String(reactedByMe?.reaction || "");

  return MESSAGE_REACTION_KEYS.includes(reactionKey) ? reactionKey : null;
}

function applyOptimisticReaction(message, reactionKey, currentUserId) {
  const currentReaction = getMessageMyReaction(message);
  const nextReaction = currentReaction === reactionKey ? null : reactionKey;
  const counts = new Map();

  normalizeReactionGroups(message?.reactions, currentReaction).forEach(
    (reactionItem) => {
      counts.set(reactionItem.reaction, reactionItem.count);
    },
  );

  if (currentReaction) {
    counts.set(
      currentReaction,
      Math.max((counts.get(currentReaction) || 0) - 1, 0),
    );
  }

  if (nextReaction) {
    counts.set(nextReaction, (counts.get(nextReaction) || 0) + 1);
  }

  const reactions = MESSAGE_REACTIONS.map((reaction) => {
    const count = counts.get(reaction.key) || 0;

    return count > 0
      ? {
          reaction: reaction.key,
          count,
          reacted_by_me: reaction.key === nextReaction,
        }
      : null;
  }).filter(Boolean);

  return {
    ...message,
    reactions,
    my_reaction: nextReaction,
  };
}

function applyReactionSnapshot(message, snapshot, currentUserId) {
  const actingUserId = Number(snapshot?.user_id);
  const nextMyReaction =
    actingUserId && actingUserId === Number(currentUserId)
      ? snapshot?.reaction || null
      : getMessageMyReaction(message);

  return {
    ...message,
    reactions: normalizeReactionGroups(snapshot?.reactions, nextMyReaction),
    my_reaction: nextMyReaction,
  };
}

function isTextEntryElement(element) {
  if (!element) {
    return false;
  }

  if (element.isContentEditable) {
    return true;
  }

  return ["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName);
}

function supportsFineHoverPointer() {
  return (
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(hover: hover) and (pointer: fine)").matches
  );
}

function supportsMobileMessageTap() {
  return (
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(hover: none), (pointer: coarse)").matches
  );
}

function getMessagePreviewText(message) {
  const text = getRenderableMessageText(message).trim();

  if (text) {
    return text;
  }

  const attachments = getMessageAttachments(message);
  const voiceNoteCount = attachments.filter(isVoiceNoteAttachment).length;

  if (voiceNoteCount > 0 && voiceNoteCount === attachments.length) {
    return voiceNoteCount === 1 ? "Voice note" : `${voiceNoteCount} voice notes`;
  }

  const attachmentCount = getMessageAttachmentCount(message);

  return attachmentCount > 0 ? "Attachment" : "Message";
}

function getMessageAttachments(message) {
  if (
    Array.isArray(message?.decrypted_attachments) &&
    message.decrypted_attachments.length > 0
  ) {
    return message.decrypted_attachments;
  }

  return Array.isArray(message?.attachments) ? message.attachments : [];
}

function getMessageAttachmentCount(message) {
  const attachments = getMessageAttachments(message);

  if (attachments.length > 0) {
    return attachments.length;
  }

  return Number(message?.attachment_count || 0);
}

function createSelectedFileId(file) {
  return [
    file.name,
    file.size,
    file.lastModified,
    Math.random().toString(36).slice(2),
  ].join("-");
}

function isVoiceNoteSelectedFile(selectedFile) {
  return selectedFile?.attachmentKind === VOICE_NOTE_ATTACHMENT_KIND;
}

function isVoiceNoteAttachment(attachment) {
  return (
    attachment?.attachment_kind === VOICE_NOTE_ATTACHMENT_KIND ||
    attachment?.attachmentKind === VOICE_NOTE_ATTACHMENT_KIND ||
    attachment?.kind === VOICE_NOTE_ATTACHMENT_KIND ||
    attachment?.is_voice_note === true
  );
}

function createOptimisticAttachmentPreviews(selectedFiles) {
  return selectedFiles.map((selectedFile, index) => {
    const localPreviewUrl = URL.createObjectURL(selectedFile.file);
    const durationSeconds = normalizeVoiceNoteDuration(
      selectedFile.durationSeconds,
    );

    return {
      id: selectedFile.id,
      file_url: localPreviewUrl,
      local_preview_url: localPreviewUrl,
      file_name: selectedFile.file.name || `Attachment ${index + 1}`,
      mime_type: selectedFile.file.type || "application/octet-stream",
      file_size_bytes: selectedFile.file.size,
      file_type: selectedFile.fileType || "document",
      attachment_kind: selectedFile.attachmentKind || "",
      duration_seconds: durationSeconds,
      waveform: normalizeVoiceNoteWaveform(selectedFile.waveform),
      sort_order: index,
      is_local_preview: true,
    };
  });
}

function releaseOptimisticAttachmentPreviews(attachments) {
  attachments.forEach((attachment) => {
    if (attachment?.local_preview_url) {
      URL.revokeObjectURL(attachment.local_preview_url);
    }
  });
}

function getAttachmentLabel(attachment) {
  if (isVoiceNoteAttachment(attachment)) {
    return "Voice note";
  }

  return attachment?.file_name || attachment?.file_type || "File";
}

function getAttachmentDownloadName(attachment) {
  return getAttachmentLabel(attachment).replace(/[\\/:*?"<>|]+/g, "_");
}

function getAttachmentExtension(attachment) {
  const fileName = String(attachment?.file_name || "");
  const extension = fileName.split(".").pop()?.toLowerCase() || "";

  return extension && extension !== fileName.toLowerCase() ? extension : "";
}

function getAttachmentKey(attachment) {
  return String(attachment?.id || attachment?.file_url || "");
}

function isPdfAttachment(attachment) {
  const mimeType = String(attachment?.mime_type || "").toLowerCase();
  const fileName = String(attachment?.file_name || "").toLowerCase();

  return mimeType === "application/pdf" || fileName.endsWith(".pdf");
}

function getAttachmentKind(attachment) {
  if (attachment?.file_type === "image") {
    return "image";
  }

  if (isPdfAttachment(attachment)) {
    return "pdf";
  }

  if (attachment?.file_type === "video") {
    return "video";
  }

  if (attachment?.file_type === "audio") {
    return "audio";
  }

  return "file";
}

function getAttachmentKindLabel(kind, count) {
  const labels = {
    image: ["image", "images"],
    pdf: ["PDF", "PDFs"],
    video: ["video", "videos"],
    audio: ["audio", "audio"],
    file: ["file", "files"],
  };
  const [singleLabel, pluralLabel] = labels[kind] || labels.file;

  return count === 1 ? singleLabel : pluralLabel;
}

function getAttachmentSummary(attachments) {
  const counts = (attachments || []).reduce(
    (currentCounts, attachment) => {
      const kind = getAttachmentKind(attachment);
      currentCounts[kind] += 1;
      return currentCounts;
    },
    {
      image: 0,
      pdf: 0,
      video: 0,
      audio: 0,
      file: 0,
    },
  );

  return ["image", "pdf", "video", "audio", "file"]
    .filter((kind) => counts[kind] > 0)
    .map(
      (kind) =>
        `${counts[kind]} ${getAttachmentKindLabel(kind, counts[kind])}`,
    )
    .join(", ");
}

function isTextPreviewAttachment(attachment) {
  const mimeType = String(attachment?.mime_type || "").toLowerCase();
  const extension = getAttachmentExtension(attachment);

  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    TEXT_DOCUMENT_EXTENSIONS.has(extension)
  );
}

function isOfficePreviewAttachment(attachment) {
  const mimeType = String(attachment?.mime_type || "").toLowerCase();
  const extension = getAttachmentExtension(attachment);

  return (
    OFFICE_DOCUMENT_MIME_TYPES.has(mimeType) ||
    OFFICE_DOCUMENT_EXTENSIONS.has(extension)
  );
}

function getDocumentPreviewMode(attachment) {
  if (isPdfAttachment(attachment)) {
    return "pdf";
  }

  if (isTextPreviewAttachment(attachment)) {
    return "text";
  }

  if (isOfficePreviewAttachment(attachment)) {
    return "office";
  }

  return "embed";
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

function formatMediaTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const roundedSeconds = Math.floor(seconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = String(roundedSeconds % 60).padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

function normalizeVoiceNoteDuration(value) {
  const duration = Number(value);

  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0;
}

function normalizeVoiceNoteWaveform(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, 80)
    .map((level) => Number(level))
    .filter((level) => Number.isFinite(level))
    .map((level) => Math.min(Math.max(level, 0.08), 1));
}

function getVoiceNoteDuration(attachment) {
  return normalizeVoiceNoteDuration(
    attachment?.duration_seconds || attachment?.durationSeconds,
  );
}

function getReliableVoiceNoteDuration(declaredDuration, mediaDuration, fallbackDuration = 0) {
  if (declaredDuration > 0) {
    return declaredDuration;
  }

  return Number.isFinite(mediaDuration) && mediaDuration > 0
    ? mediaDuration
    : fallbackDuration;
}

function getVoiceNoteWaveform(attachment) {
  const waveform = normalizeVoiceNoteWaveform(attachment?.waveform);

  return waveform.length > 0 ? waveform : DEFAULT_VOICE_NOTE_WAVEFORM;
}

function waitForMediaReady(media) {
  if (!media || media.readyState >= 2) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let timeout = null;
    const cleanup = () => {
      if (timeout) {
        globalThis.clearTimeout(timeout);
      }
      media.removeEventListener("canplay", handleReady);
      media.removeEventListener("loadedmetadata", handleReady);
      media.removeEventListener("error", handleError);
    };
    const handleReady = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Voice note audio is unavailable."));
    };
    timeout = globalThis.setTimeout(handleReady, 900);

    media.addEventListener("canplay", handleReady, { once: true });
    media.addEventListener("loadedmetadata", handleReady, { once: true });
    media.addEventListener("error", handleError, { once: true });
  });
}

function getSupportedVoiceNoteMimeType() {
  if (typeof globalThis.MediaRecorder === "undefined") {
    return "";
  }

  return (
    VOICE_NOTE_MIME_TYPE_CANDIDATES.find((mimeType) =>
      globalThis.MediaRecorder.isTypeSupported(mimeType),
    ) || ""
  );
}

function getVoiceNoteFileExtension(mimeType) {
  const normalizedMimeType = String(mimeType || "").toLowerCase();

  if (normalizedMimeType.includes("ogg")) {
    return "ogg";
  }

  if (normalizedMimeType.includes("mp4")) {
    return "m4a";
  }

  return "webm";
}

async function createVoiceNoteWaveform(blob) {
  const AudioContextConstructor =
    globalThis.AudioContext || globalThis.webkitAudioContext;

  if (!AudioContextConstructor || !blob?.size) {
    return DEFAULT_VOICE_NOTE_WAVEFORM;
  }

  const audioContext = new AudioContextConstructor();

  try {
    const audioBuffer = await audioContext.decodeAudioData(
      await blob.arrayBuffer(),
    );
    const channelData = audioBuffer.getChannelData(0);
    const samplesPerBar = Math.max(
      1,
      Math.floor(channelData.length / VOICE_NOTE_WAVEFORM_BARS),
    );
    const bars = Array.from({ length: VOICE_NOTE_WAVEFORM_BARS }, (_, index) => {
      const start = index * samplesPerBar;
      const end = Math.min(start + samplesPerBar, channelData.length);
      let total = 0;

      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        total += Math.abs(channelData[sampleIndex] || 0);
      }

      return total / Math.max(end - start, 1);
    });
    const peak = Math.max(...bars, 0.01);

    return bars.map((level) =>
      Number(Math.max(0.08, Math.min(level / peak, 1)).toFixed(2)),
    );
  } catch {
    return DEFAULT_VOICE_NOTE_WAVEFORM;
  } finally {
    audioContext.close?.();
  }
}

function clampMediaVolume(volume) {
  return Math.min(Math.max(Number(volume) || 0, 0), 1);
}

function getOfficePreviewUrl(fileUrl) {
  if (!isHttpUrl(fileUrl)) {
    return "";
  }

  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(
    fileUrl,
  )}`;
}

function getPdfThumbnailUrl(fileUrl) {
  const cleanUrl = String(fileUrl || "").split("#")[0];

  return cleanUrl
    ? `${cleanUrl}#page=1&toolbar=0&navpanes=0&scrollbar=0&view=FitH`
    : "";
}

async function getCachedMediaResponse(url) {
  if (!url || !("caches" in globalThis)) {
    return null;
  }

  const cache = await globalThis.caches.open(MEDIA_CACHE_NAME);
  const cachedResponse = await cache.match(url);

  if (cachedResponse) {
    return cachedResponse;
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Unable to fetch media.");
  }

  await cache.put(url, response.clone());
  return response;
}

async function downloadCachedAttachment(attachment) {
  if (!attachment?.file_url && !attachment?.encrypted_file_url) {
    return;
  }

  try {
    const blob = isEncryptedAttachment(attachment)
      ? await decryptEncryptedAttachmentBlob(attachment)
      : await getCachedMediaResponse(attachment.file_url).then((response) => {
          if (!response) {
            throw new Error("Media cache unavailable.");
          }

          return response.blob();
        });
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");
    downloadLink.href = objectUrl;
    downloadLink.download = getAttachmentDownloadName(attachment);
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (error) {
    if (isEncryptedAttachment(attachment)) {
      throw error;
    }

    const fallbackLink = document.createElement("a");
    fallbackLink.href = attachment.file_url;
    fallbackLink.target = "_blank";
    fallbackLink.rel = "noreferrer";
    fallbackLink.download = getAttachmentDownloadName(attachment);
    document.body.appendChild(fallbackLink);
    fallbackLink.click();
    fallbackLink.remove();
  }
}

async function openCachedAttachment(attachment) {
  if (!attachment?.file_url && !attachment?.encrypted_file_url) {
    return;
  }

  const openedWindow = globalThis.open?.("about:blank", "_blank");

  if (openedWindow) {
    openedWindow.opener = null;
  }

  try {
    const blob = isEncryptedAttachment(attachment)
      ? await decryptEncryptedAttachmentBlob(attachment)
      : await getCachedMediaResponse(attachment.file_url).then((response) => {
          if (!response) {
            throw new Error("Media cache unavailable.");
          }

          return response.blob();
        });
    const objectUrl = URL.createObjectURL(blob);

    if (openedWindow) {
      openedWindow.location.href = objectUrl;
    } else {
      const openLink = document.createElement("a");
      openLink.href = objectUrl;
      openLink.target = "_blank";
      openLink.rel = "noreferrer";
      document.body.appendChild(openLink);
      openLink.click();
      openLink.remove();
    }

    globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  } catch (error) {
    if (isEncryptedAttachment(attachment)) {
      if (openedWindow) {
        openedWindow.close();
      }
      throw error;
    }

    if (openedWindow) {
      openedWindow.location.href = attachment.file_url;
    } else {
      const fallbackLink = document.createElement("a");
      fallbackLink.href = attachment.file_url;
      fallbackLink.target = "_blank";
      fallbackLink.rel = "noreferrer";
      document.body.appendChild(fallbackLink);
      fallbackLink.click();
      fallbackLink.remove();
    }
  }
}

function useCachedMediaUrl(attachment) {
  const fileUrl = attachment?.file_url || "";
  const encryptedFileUrl = attachment?.encrypted_file_url || "";
  const isEncrypted = isEncryptedAttachment(attachment);
  const sourceUrl = isEncrypted ? encryptedFileUrl : fileUrl;
  const [cachedMedia, setCachedMedia] = useState({
    sourceUrl: "",
    objectUrl: "",
  });

  useEffect(() => {
    let objectUrl = "";
    let isMounted = true;
    setCachedMedia({
      sourceUrl,
      objectUrl: "",
    });

    async function loadCachedMedia() {
      if (!sourceUrl) {
        return;
      }

      if (isEncrypted) {
        const blob = await decryptEncryptedAttachmentBlob(attachment);
        if (!isMounted) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setCachedMedia({
          sourceUrl,
          objectUrl,
        });
        return;
      }

      if (!("caches" in globalThis)) {
        return;
      }

      const cache = await globalThis.caches.open(MEDIA_CACHE_NAME);
      const cachedResponse = await cache.match(sourceUrl);

      if (!cachedResponse || !isMounted) {
        return;
      }

      const blob = await cachedResponse.blob();
      objectUrl = URL.createObjectURL(blob);
      setCachedMedia({
        sourceUrl,
        objectUrl,
      });
    }

    loadCachedMedia().catch(() => {});

    return () => {
      isMounted = false;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [
    attachment,
    isEncrypted,
    sourceUrl,
  ]);

  if (isEncrypted) {
    return cachedMedia.sourceUrl === sourceUrl ? cachedMedia.objectUrl : "";
  }

  return cachedMedia.sourceUrl === sourceUrl && cachedMedia.objectUrl
    ? cachedMedia.objectUrl
    : sourceUrl;
}

function CachedImage({
  alt,
  fallbackClassName,
  fallbackSize = 24,
  src,
}) {
  const [imageStatus, setImageStatus] = useState(src ? "loading" : "error");

  useEffect(() => {
    setImageStatus(src ? "loading" : "error");
  }, [src]);

  const shouldShowImage = Boolean(src) && imageStatus !== "error";

  return (
    <>
      {shouldShowImage ? (
        <img
          className={
            imageStatus === "ready"
              ? undefined
              : "parent-layout-page__image-loading"
          }
          src={src}
          alt={alt}
          onLoad={() => setImageStatus("ready")}
          onError={() => setImageStatus("error")}
        />
      ) : null}
      {imageStatus !== "ready" ? (
        <span className={fallbackClassName} aria-hidden="true">
          <ImageIcon size={fallbackSize} />
        </span>
      ) : null}
    </>
  );
}

function AttachmentPreviewTile({
  attachment,
  index,
  overflowCount,
  onOpen,
}) {
  const previewUrl = useCachedMediaUrl(attachment);
  const label = getAttachmentLabel(attachment);
  const kind = getAttachmentKind(attachment);
  const shouldShowMediaPreview =
    kind === "image" || kind === "video" || kind === "pdf";

  return (
    <button
      type="button"
      className={`parent-layout-page__message-attachment-tile is-${kind}`}
      onClick={() => onOpen(attachment)}
      aria-label={`Open ${label}`}
    >
      {kind === "image" ? (
        <CachedImage
          src={previewUrl}
          alt={label}
          fallbackClassName="parent-layout-page__message-attachment-image-fallback"
          fallbackSize={24}
        />
      ) : null}
      {kind === "video" ? (
        <video src={previewUrl} muted playsInline preload="metadata" />
      ) : null}
      {kind === "pdf" ? (
        <PdfAttachmentThumbnail label={label} sourceUrl={previewUrl} />
      ) : null}
      {!shouldShowMediaPreview ? (
        <span className="parent-layout-page__message-attachment-tile-icon">
          <AttachmentIcon fileType={kind} size={22} />
        </span>
      ) : null}
      <span className="parent-layout-page__message-attachment-tile-shade" />
      {index === ATTACHMENT_PREVIEW_LIMIT - 1 && overflowCount > 0 ? (
        <span className="parent-layout-page__message-attachment-more">
          +{overflowCount}
        </span>
      ) : null}
      <span className="parent-layout-page__message-attachment-type">
        {getAttachmentKindLabel(kind, 1)}
      </span>
    </button>
  );
}

function PdfAttachmentThumbnail({ label, sourceUrl }) {
  const thumbnailUrl = getPdfThumbnailUrl(sourceUrl);

  return (
    <span
      className="parent-layout-page__message-attachment-pdf-thumb"
      aria-hidden="true"
    >
      {thumbnailUrl ? (
        <iframe
          src={thumbnailUrl}
          title={`${label} first page`}
          loading="lazy"
          tabIndex="-1"
        />
      ) : (
        <AttachmentIcon fileType="pdf" size={28} />
      )}
    </span>
  );
}

function AttachmentMediaPlayer({
  attachment,
  initialPlayback = null,
  label,
  type,
}) {
  const sourceUrl = useCachedMediaUrl(attachment);
  const mediaRef = useRef(null);
  const didApplyInitialPlaybackRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const attachmentKey = getAttachmentKey(attachment);
  const shouldUseInitialPlayback =
    initialPlayback?.attachmentKey &&
    initialPlayback.attachmentKey === attachmentKey;
  const initialPlaybackTime = shouldUseInitialPlayback
    ? Math.max(Number(initialPlayback.currentTime) || 0, 0)
    : 0;
  const shouldAutoPlayInitialPlayback = Boolean(
    shouldUseInitialPlayback && initialPlayback.shouldPlay,
  );

  const isVideo = type === "video";
  const mediaClassName = isVideo
    ? "parent-layout-page__attachment-modal-media"
    : "parent-layout-page__attachment-modal-audio-source";

  useEffect(() => {
    didApplyInitialPlaybackRef.current = false;
    setCurrentTime(initialPlaybackTime);
    setDuration(0);
    setIsPlaying(false);
  }, [initialPlaybackTime, sourceUrl]);

  const syncMediaState = useCallback(() => {
    const media = mediaRef.current;

    if (!media) {
      return;
    }

    setCurrentTime(Number.isFinite(media.currentTime) ? media.currentTime : 0);
    setDuration(Number.isFinite(media.duration) ? media.duration : 0);
    setIsPlaying(!media.paused && !media.ended);
    setVolume(media.muted ? 0 : clampMediaVolume(media.volume));
  }, []);

  const applyInitialPlayback = useCallback(() => {
    const media = mediaRef.current;

    if (!media || didApplyInitialPlaybackRef.current || !sourceUrl) {
      return;
    }

    didApplyInitialPlaybackRef.current = true;

    if (initialPlaybackTime > 0) {
      const seekTime =
        Number.isFinite(media.duration) && media.duration > 0
          ? Math.min(initialPlaybackTime, media.duration)
          : initialPlaybackTime;
      media.currentTime = seekTime;
      setCurrentTime(seekTime);
    }

    if (shouldAutoPlayInitialPlayback) {
      media.muted = false;

      if (media.volume === 0) {
        media.volume = 1;
      }

      media.play().catch(() => {
        setIsPlaying(false);
      });
    }
  }, [initialPlaybackTime, shouldAutoPlayInitialPlayback, sourceUrl]);

  useEffect(() => {
    if (mediaRef.current?.readyState >= 1) {
      applyInitialPlayback();
    }
  }, [applyInitialPlayback, sourceUrl]);

  const handleLoadedMetadata = useCallback(() => {
    syncMediaState();
    applyInitialPlayback();
  }, [applyInitialPlayback, syncMediaState]);

  const handleTogglePlay = useCallback(() => {
    const media = mediaRef.current;

    if (!media) {
      return;
    }

    if (media.paused || media.ended) {
      media.muted = false;

      if (media.volume === 0) {
        media.volume = 1;
      }

      media.play().catch(() => {
        setIsPlaying(false);
      });
    } else {
      media.pause();
    }
  }, []);

  const handleSeek = useCallback((event) => {
    const media = mediaRef.current;
    const nextTime = Number(event.target.value);

    if (!media || !Number.isFinite(nextTime)) {
      return;
    }

    media.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, []);

  const applyVolume = useCallback((nextVolume) => {
    const media = mediaRef.current;
    const normalizedVolume = clampMediaVolume(nextVolume);

    if (media) {
      media.volume = normalizedVolume;
      media.muted = normalizedVolume === 0;
    }

    setVolume(normalizedVolume);
  }, []);

  const handleVolumeChange = useCallback(
    (event) => {
      applyVolume(event.target.value);
    },
    [applyVolume],
  );

  const handleVolumeStep = useCallback(
    (step) => {
      applyVolume(volume + step);
    },
    [applyVolume, volume],
  );

  const progressValue = duration
    ? Math.min(currentTime, duration)
    : currentTime;

  return (
    <div
      className={`parent-layout-page__attachment-player is-${type}`}
      onClick={(event) => event.stopPropagation()}
    >
      {isVideo ? (
        <video
          ref={mediaRef}
          playsInline
          preload="metadata"
          src={sourceUrl}
          className={mediaClassName}
          onClick={handleTogglePlay}
          onDurationChange={syncMediaState}
          onEnded={syncMediaState}
          onLoadedMetadata={handleLoadedMetadata}
          onPause={syncMediaState}
          onPlay={syncMediaState}
          onTimeUpdate={syncMediaState}
          onVolumeChange={syncMediaState}
        >
          <a href={attachment.file_url}>{label}</a>
        </video>
      ) : (
        <div className="parent-layout-page__attachment-audio-visual">
          <AttachmentIcon fileType="audio" size={38} />
          <strong>{label}</strong>
          <audio
            ref={mediaRef}
            preload="metadata"
            src={sourceUrl}
            className={mediaClassName}
            onDurationChange={syncMediaState}
            onEnded={syncMediaState}
            onLoadedMetadata={handleLoadedMetadata}
            onPause={syncMediaState}
            onPlay={syncMediaState}
            onTimeUpdate={syncMediaState}
            onVolumeChange={syncMediaState}
          >
            <a href={attachment.file_url}>{label}</a>
          </audio>
        </div>
      )}

      <div className="parent-layout-page__attachment-player-controls">
        <button
          type="button"
          className="parent-layout-page__attachment-player-button"
          onClick={handleTogglePlay}
          aria-label={isPlaying ? "Pause attachment" : "Play attachment"}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Pause size={18} aria-hidden="true" />
          ) : (
            <Play size={18} aria-hidden="true" />
          )}
        </button>

        <span className="parent-layout-page__attachment-player-time">
          {formatMediaTime(currentTime)}
        </span>

        <input
          className="parent-layout-page__attachment-player-progress"
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={progressValue}
          onChange={handleSeek}
          disabled={!duration}
          aria-label="Seek attachment"
        />

        <span className="parent-layout-page__attachment-player-time">
          {formatMediaTime(duration)}
        </span>

        <div className="parent-layout-page__attachment-player-volume">
          <button
            type="button"
            className="parent-layout-page__attachment-player-button"
            onClick={() => handleVolumeStep(-0.1)}
            aria-label="Decrease volume"
            title="Decrease volume"
          >
            <Volume1 size={17} aria-hidden="true" />
          </button>
          <input
            className="parent-layout-page__attachment-player-volume-range"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={handleVolumeChange}
            aria-label="Volume"
          />
          <button
            type="button"
            className="parent-layout-page__attachment-player-button"
            onClick={() => handleVolumeStep(0.1)}
            aria-label="Increase volume"
            title="Increase volume"
          >
            <Volume2 size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function InlineMediaAttachmentPlayer({ attachment, onMaximize }) {
  const sourceUrl = useCachedMediaUrl(attachment);
  const mediaRef = useRef(null);
  const label = getAttachmentLabel(attachment);
  const kind = getAttachmentKind(attachment);
  const isVideo = kind === "video";
  const [mediaState, setMediaState] = useState({
    currentTime: 0,
    duration: getVoiceNoteDuration(attachment),
    isPlaying: false,
  });

  useEffect(() => {
    setMediaState({
      currentTime: 0,
      duration: getVoiceNoteDuration(attachment),
      isPlaying: false,
    });
  }, [attachment, sourceUrl]);

  const syncMediaState = useCallback(() => {
    const media = mediaRef.current;

    if (!media) {
      return;
    }

    setMediaState((currentState) => ({
      currentTime: Number.isFinite(media.currentTime) ? media.currentTime : 0,
      duration:
        Number.isFinite(media.duration) && media.duration > 0
          ? media.duration
          : currentState.duration,
      isPlaying: !media.paused && !media.ended,
    }));
  }, []);

  const handleTogglePlay = useCallback((event) => {
    event?.stopPropagation();

    const media = mediaRef.current;

    if (!media || !sourceUrl) {
      return;
    }

    if (media.paused || media.ended) {
      media.muted = false;

      if (media.volume === 0) {
        media.volume = 1;
      }

      media.play().catch(() => {
        setMediaState((currentState) => ({
          ...currentState,
          isPlaying: false,
        }));
      });
    } else {
      media.pause();
    }
  }, [sourceUrl]);

  const handleMaximize = useCallback((event) => {
    event?.stopPropagation();

    if (!sourceUrl) {
      return;
    }

    const media = mediaRef.current;
    const wasPlaying = Boolean(media && !media.paused && !media.ended);
    const currentTime = Number.isFinite(media?.currentTime)
      ? media.currentTime
      : mediaState.currentTime;

    if (wasPlaying) {
      media.pause();
    }

    onMaximize(attachment, {
      currentTime,
      shouldPlay: wasPlaying,
    });
  }, [attachment, mediaState.currentTime, onMaximize, sourceUrl]);

  const handlePreviewKeyDown = useCallback(
    (event) => {
      if (event.target !== event.currentTarget) {
        return;
      }

      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      handleMaximize(event);
    },
    [handleMaximize],
  );

  const playButtonLabel = mediaState.isPlaying ? "Pause attachment" : "Play attachment";
  const playButtonIcon = !sourceUrl ? (
    <LoaderCircle size={20} aria-hidden="true" />
  ) : mediaState.isPlaying ? (
    <Pause size={20} aria-hidden="true" />
  ) : (
    <Play size={20} aria-hidden="true" />
  );

  return (
    <div className={`parent-layout-page__inline-media is-${kind}`}>
      {isVideo ? (
        <div
          className="parent-layout-page__inline-media-stage"
          onClick={handleMaximize}
          onKeyDown={handlePreviewKeyDown}
          role="button"
          tabIndex={sourceUrl ? 0 : -1}
          aria-label={`Open ${label} in expanded player`}
          title={`Open ${label}`}
        >
          <video
            ref={mediaRef}
            playsInline
            preload="metadata"
            src={sourceUrl || undefined}
            onDurationChange={syncMediaState}
            onEnded={syncMediaState}
            onLoadedMetadata={syncMediaState}
            onPause={syncMediaState}
            onPlay={syncMediaState}
            onTimeUpdate={syncMediaState}
          >
            <a href={attachment.file_url}>{label}</a>
          </video>
          <button
            type="button"
            className="parent-layout-page__inline-media-play-overlay"
            onClick={handleTogglePlay}
            aria-label={playButtonLabel}
            title={mediaState.isPlaying ? "Pause" : "Play"}
            disabled={!sourceUrl}
          >
            {playButtonIcon}
          </button>
        </div>
      ) : (
        <>
          <audio
            ref={mediaRef}
            preload="metadata"
            src={sourceUrl || undefined}
            onDurationChange={syncMediaState}
            onEnded={syncMediaState}
            onLoadedMetadata={syncMediaState}
            onPause={syncMediaState}
            onPlay={syncMediaState}
            onTimeUpdate={syncMediaState}
          >
            <a href={attachment.file_url}>{label}</a>
          </audio>
          <div
            className="parent-layout-page__inline-media-audio-visual"
            onClick={handleMaximize}
            onKeyDown={handlePreviewKeyDown}
            role="button"
            tabIndex={sourceUrl ? 0 : -1}
            aria-label={`Open ${label} in expanded player`}
            title={`Open ${label}`}
          >
            <span>
              <Music size={22} aria-hidden="true" />
            </span>
            <strong>{label}</strong>
            <button
              type="button"
              className="parent-layout-page__inline-media-play-overlay"
              onClick={handleTogglePlay}
              aria-label={playButtonLabel}
              title={mediaState.isPlaying ? "Pause" : "Play"}
              disabled={!sourceUrl}
            >
              {playButtonIcon}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function VoiceNotePlayer({ attachment }) {
  const audioRef = useRef(null);
  const sourceUrl = useCachedMediaUrl(attachment);
  const declaredDuration = getVoiceNoteDuration(attachment);
  const waveform = getVoiceNoteWaveform(attachment);
  const isLoadingAudio = isEncryptedAttachment(attachment) && !sourceUrl;
  const [playbackState, setPlaybackState] = useState({
    currentTime: 0,
    duration: declaredDuration,
    isPlaying: false,
  });
  const duration = playbackState.duration || declaredDuration;
  const displayCurrentTime = duration
    ? Math.min(playbackState.currentTime, duration)
    : playbackState.currentTime;
  const progressRatio = duration
    ? Math.min(displayCurrentTime / duration, 1)
    : 0;
  const playedBars = Math.round(progressRatio * waveform.length);

  useEffect(() => {
    setPlaybackState({
      currentTime: 0,
      duration: declaredDuration,
      isPlaying: false,
    });
  }, [attachment, declaredDuration, sourceUrl]);

  const syncAudioState = useCallback(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    setPlaybackState((currentState) => {
      const nextDuration = getReliableVoiceNoteDuration(
        declaredDuration,
        audio.duration,
        currentState.duration,
      );
      const nextCurrentTime = Number.isFinite(audio.currentTime)
        ? audio.currentTime
        : 0;

      return {
        currentTime: nextDuration
          ? Math.min(nextCurrentTime, nextDuration)
          : nextCurrentTime,
        duration: nextDuration,
        isPlaying: !audio.paused && !audio.ended,
      };
    });
  }, [declaredDuration]);

  const playAudio = useCallback(async () => {
    const audio = audioRef.current;

    if (!audio || !sourceUrl) {
      return;
    }

    if (audio.getAttribute("src") !== sourceUrl) {
      audio.src = sourceUrl;
      audio.load();
    }

    audio.muted = false;

    if (audio.volume === 0) {
      audio.volume = 1;
    }

    await waitForMediaReady(audio);
    await audio.play();
    syncAudioState();
  }, [sourceUrl, syncAudioState]);

  const handleTogglePlay = useCallback((event) => {
    event?.stopPropagation();

    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (!audio.paused && !audio.ended) {
      audio.pause();
      return;
    }

    playAudio().catch(() => {
      setPlaybackState((currentState) => ({
        ...currentState,
        isPlaying: false,
      }));
    });
  }, [playAudio]);

  const handleWaveformSeek = useCallback(
    (event) => {
      event.stopPropagation();

      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = rect.width
        ? Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
        : 0;

      playAudio()
        .then(() => {
          const audio = audioRef.current;
          const seekDuration = getReliableVoiceNoteDuration(
            declaredDuration,
            audio?.duration,
            duration,
          );

          if (!audio || !seekDuration) {
            return;
          }

          audio.currentTime = seekDuration * ratio;
          syncAudioState();
        })
        .catch(() => {});
    },
    [declaredDuration, duration, playAudio, syncAudioState],
  );

  return (
    <div className="parent-layout-page__voice-note">
      <button
        type="button"
        className="parent-layout-page__voice-note-play"
        onClick={handleTogglePlay}
        aria-label={playbackState.isPlaying ? "Pause voice note" : "Play voice note"}
        title={playbackState.isPlaying ? "Pause" : "Play"}
        disabled={isLoadingAudio || !sourceUrl}
      >
        {isLoadingAudio || !sourceUrl ? (
          <LoaderCircle size={18} aria-hidden="true" />
        ) : playbackState.isPlaying ? (
          <Pause size={18} aria-hidden="true" />
        ) : (
          <Play size={18} aria-hidden="true" />
        )}
      </button>
      <div className="parent-layout-page__voice-note-body">
        <button
          type="button"
          className="parent-layout-page__voice-note-waveform"
          onClick={handleWaveformSeek}
          aria-label="Seek voice note"
          title="Seek"
        >
          {waveform.map((level, index) => (
            <span
              className={index < playedBars ? "is-played" : undefined}
              key={`${index}-${level}`}
              style={{ "--voice-note-bar-level": level }}
            />
          ))}
        </button>
        <span className="parent-layout-page__voice-note-time">
          {formatMediaTime(displayCurrentTime)} / {formatMediaTime(duration)}
        </span>
      </div>
      <audio
        ref={audioRef}
        preload="metadata"
        src={sourceUrl || undefined}
        onDurationChange={syncAudioState}
        onEnded={syncAudioState}
        onLoadedMetadata={syncAudioState}
        onPause={syncAudioState}
        onPlay={syncAudioState}
        onTimeUpdate={syncAudioState}
      />
    </div>
  );
}

function MessageAttachments({ attachments, onOpen }) {
  const voiceNoteAttachments = attachments.filter(isVoiceNoteAttachment);
  const regularAttachments = attachments.filter(
    (attachment) => !isVoiceNoteAttachment(attachment),
  );
  const shouldRenderInlineMedia =
    regularAttachments.length === 1 &&
    ["audio", "video"].includes(getAttachmentKind(regularAttachments[0]));
  const visibleAttachments = regularAttachments.slice(0, ATTACHMENT_PREVIEW_LIMIT);
  const hiddenAttachmentCount = Math.max(
    regularAttachments.length - ATTACHMENT_PREVIEW_LIMIT,
    0,
  );

  const handleMaximizeInlineMedia = useCallback(
    (attachment, playback) => {
      onOpen(regularAttachments, attachment, {
        playback: {
          attachmentKey: getAttachmentKey(attachment),
          currentTime: playback.currentTime,
          shouldPlay: playback.shouldPlay,
        },
      });
    },
    [onOpen, regularAttachments],
  );

  return (
    <div className="parent-layout-page__message-attachments">
      {voiceNoteAttachments.map((attachment) => (
        <VoiceNotePlayer
          attachment={attachment}
          key={getAttachmentKey(attachment)}
        />
      ))}

      {regularAttachments.length > 0 ? (
        shouldRenderInlineMedia ? (
          <InlineMediaAttachmentPlayer
            attachment={regularAttachments[0]}
            onMaximize={handleMaximizeInlineMedia}
          />
        ) : (
          <>
          <div
            className={`parent-layout-page__message-attachment-grid is-count-${Math.min(
              visibleAttachments.length,
              ATTACHMENT_PREVIEW_LIMIT,
            )}`}
          >
            {visibleAttachments.map((attachment, index) => (
              <AttachmentPreviewTile
                attachment={attachment}
                index={index}
                key={getAttachmentKey(attachment)}
                overflowCount={hiddenAttachmentCount}
                onOpen={() => onOpen(regularAttachments, attachment)}
              />
            ))}
          </div>

          <button
            type="button"
            className="parent-layout-page__message-attachment-summary"
            onClick={() => onOpen(regularAttachments)}
          >
            <Paperclip size={14} aria-hidden="true" />
            <span>{getAttachmentSummary(regularAttachments)}</span>
          </button>
        </>
        )
      ) : null}
    </div>
  );
}

function useAttachmentTextPreview(sourceUrl, enabled) {
  const [textPreview, setTextPreview] = useState({
    error: "",
    status: "idle",
    text: "",
  });

  useEffect(() => {
    if (!enabled || !sourceUrl) {
      setTextPreview({
        error: "",
        status: "idle",
        text: "",
      });
      return undefined;
    }

    const controller = new AbortController();
    let isMounted = true;

    setTextPreview({
      error: "",
      status: "loading",
      text: "",
    });

    fetch(sourceUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to load document preview.");
        }

        return response.text();
      })
      .then((text) => {
        if (!isMounted) {
          return;
        }

        setTextPreview({
          error: "",
          status: "ready",
          text,
        });
      })
      .catch((error) => {
        if (!isMounted || error?.name === "AbortError") {
          return;
        }

        setTextPreview({
          error: "Preview is not available for this document.",
          status: "error",
          text: "",
        });
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [enabled, sourceUrl]);

  return textPreview;
}

function AttachmentDocumentPreview({ attachment, initialPlayback = null }) {
  const previewUrl = useCachedMediaUrl(attachment);
  const label = getAttachmentLabel(attachment);
  const kind = getAttachmentKind(attachment);
  const previewMode = getDocumentPreviewMode(attachment);
  const officePreviewUrl =
    previewMode === "office" ? getOfficePreviewUrl(attachment?.file_url) : "";
  const frameUrl = previewMode === "office" ? officePreviewUrl : previewUrl;
  const textPreview = useAttachmentTextPreview(
    previewUrl,
    previewMode === "text",
  );

  let stageContent = null;

  if (kind === "image") {
    stageContent = (
      <div className="parent-layout-page__attachment-media-preview">
        <CachedImage
          src={previewUrl}
          alt={label}
          fallbackClassName="parent-layout-page__attachment-image-fallback parent-layout-page__attachment-image-fallback--stage"
          fallbackSize={42}
        />
      </div>
    );
  } else if (kind === "video") {
    stageContent = (
      <div className="parent-layout-page__attachment-media-preview">
        <AttachmentMediaPlayer
          attachment={attachment}
          initialPlayback={initialPlayback}
          label={label}
          type="video"
        />
      </div>
    );
  } else if (kind === "audio") {
    stageContent = (
      <div className="parent-layout-page__attachment-media-preview">
        <AttachmentMediaPlayer
          attachment={attachment}
          initialPlayback={initialPlayback}
          label={label}
          type="audio"
        />
      </div>
    );
  } else if (previewMode === "text") {
    if (textPreview.status === "loading") {
      stageContent = (
        <div className="parent-layout-page__attachment-document-message">
          <LoaderCircle size={22} aria-hidden="true" />
          <span>Loading preview...</span>
        </div>
      );
    } else if (textPreview.status === "ready") {
      stageContent = <pre>{textPreview.text}</pre>;
    } else {
      stageContent = (
        <div className="parent-layout-page__attachment-document-message">
          <FileText size={24} aria-hidden="true" />
          <span>
            {textPreview.error || "Preview is not available for this document."}
          </span>
        </div>
      );
    }
  } else if (frameUrl) {
    stageContent = (
      <iframe
        src={frameUrl}
        title={`${label} preview`}
        className="parent-layout-page__attachment-document-frame"
      />
    );
  } else {
    stageContent = (
      <div className="parent-layout-page__attachment-document-message">
        <FileText size={24} aria-hidden="true" />
        <span>Preview is not available for this document.</span>
      </div>
    );
  }

  return (
    <div className="parent-layout-page__attachment-document-preview is-modal-preview">
      <div className="parent-layout-page__attachment-document-stage">
        {stageContent}
      </div>
    </div>
  );
}

function AttachmentViewerModal({
  attachments,
  initialPlayback,
  selectedAttachmentId,
  onClose,
  onOpen,
  onDownload,
  onNavigate,
}) {
  const safeAttachments = Array.isArray(attachments) ? attachments : [];
  const selectedIndex = Math.max(
    safeAttachments.findIndex(
      (attachment) => getAttachmentKey(attachment) === selectedAttachmentId,
    ),
    0,
  );
  const selectedAttachment =
    safeAttachments[selectedIndex] || safeAttachments[0] || null;
  const selectedAttachmentLabel = getAttachmentLabel(selectedAttachment);
  const selectedAttachmentKind = getAttachmentKind(selectedAttachment);
  const hasManyAttachments = safeAttachments.length > 1;
  const counterLabel = `${selectedIndex + 1}/${safeAttachments.length} files`;

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (
        ["AUDIO", "VIDEO"].includes(event.target?.tagName) ||
        event.target?.closest?.(
          ".parent-layout-page__attachment-player-controls",
        )
      ) {
        return;
      }

      if (event.key === "Escape") {
        onClose();
      } else if (hasManyAttachments && event.key === "ArrowLeft") {
        onNavigate(-1);
      } else if (hasManyAttachments && event.key === "ArrowRight") {
        onNavigate(1);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [hasManyAttachments, onClose, onNavigate]);

  if (!selectedAttachment) {
    return null;
  }

  const viewer = (
    <div
      className="parent-layout-page__attachment-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Message attachments"
    >
      <button
        type="button"
        className="parent-layout-page__attachment-viewer-backdrop"
        onClick={onClose}
        aria-label="Close attachments"
      />
      <div className="parent-layout-page__attachment-viewer-surface is-minimal">
        <button
          type="button"
          className="parent-layout-page__attachment-viewer-close"
          onClick={onClose}
          aria-label="Close attachments"
          title="Close"
        >
          <X size={20} aria-hidden="true" />
        </button>
        <div className="parent-layout-page__attachment-viewer-content">
          {hasManyAttachments ? (
            <button
              type="button"
              className="parent-layout-page__attachment-viewer-nav is-prev"
              onClick={() => onNavigate(-1)}
              aria-label="Previous attachment"
              title="Previous"
            >
              <ChevronLeft size={24} aria-hidden="true" />
            </button>
          ) : null}
          <AttachmentDocumentPreview
            key={getAttachmentKey(selectedAttachment)}
            attachment={selectedAttachment}
            initialPlayback={initialPlayback}
          />
          {hasManyAttachments ? (
            <button
              type="button"
              className="parent-layout-page__attachment-viewer-nav is-next"
              onClick={() => onNavigate(1)}
              aria-label="Next attachment"
              title="Next"
            >
              <ChevronRight size={24} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <footer className="parent-layout-page__attachment-viewer-footer">
          <div className="parent-layout-page__attachment-viewer-file">
            <span>
              <AttachmentIcon fileType={selectedAttachmentKind} size={17} />
            </span>
            <strong>{selectedAttachmentLabel}</strong>
          </div>
          <div className="parent-layout-page__attachment-viewer-count">
            {counterLabel}
          </div>
          <div className="parent-layout-page__attachment-viewer-actions">
            <button
              type="button"
              onClick={() => onOpen(selectedAttachment)}
              aria-label={`Open ${selectedAttachmentLabel} in a new tab`}
              title="Open in new tab"
            >
              <ExternalLink size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onDownload(selectedAttachment)}
              aria-label={`Download ${selectedAttachmentLabel}`}
              title="Download"
            >
              <Download size={16} aria-hidden="true" />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return viewer;
  }

  return createPortal(viewer, document.body);
}

function getSelectedFileType(file) {
  const mimeType = file.type || "";
  const extension = file.name.split(".").pop()?.toLowerCase() || "";

  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (mimeType.startsWith("video/")) {
    return "video";
  }

  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  if (mimeType === "application/pdf" || extension === "pdf") {
    return "pdf";
  }

  return "document";
}

function AttachmentIcon({ fileType, size = 16 }) {
  if (fileType === "image") {
    return <ImageIcon size={size} aria-hidden="true" />;
  }

  if (fileType === "video") {
    return <Video size={size} aria-hidden="true" />;
  }

  if (fileType === "audio") {
    return <Music size={size} aria-hidden="true" />;
  }

  return <FileText size={size} aria-hidden="true" />;
}

function getParticipantDisplayName(participant) {
  return (
    participant?.display_name ||
    participant?.account_number ||
    ""
  );
}

function getReplyAuthorLabel(message, currentUserId, participantNamesByUserId) {
  const senderUserId = Number(message?.sender_user_id);

  return senderUserId === Number(currentUserId)
    ? "You"
    : participantNamesByUserId.get(senderUserId) || "Contact";
}

function mergeMessagePage(currentMessages, pageMessages) {
  const messagesById = new Map();

  [...currentMessages, ...pageMessages].forEach((message) => {
    if (message?.id) {
      messagesById.set(Number(message.id), message);
    }
  });

  return Array.from(messagesById.values()).sort((first, second) => {
    const firstTime = new Date(first.created_at || 0).getTime();
    const secondTime = new Date(second.created_at || 0).getTime();

    if (firstTime === secondTime) {
      return Number(first.id || 0) - Number(second.id || 0);
    }

    return firstTime - secondTime;
  });
}

function MessageReactionSummary({ message, onSelect }) {
  const reactions = normalizeReactionGroups(
    message?.reactions,
    getMessageMyReaction(message) || null,
  );

  if (reactions.length === 0) {
    return null;
  }

  return (
    <div
      className="parent-layout-page__message-reactions"
      aria-label="Message reactions"
    >
      {reactions.map((reactionItem) => {
        const reactionConfig = getReactionConfig(reactionItem.reaction);

        if (!reactionConfig) {
          return null;
        }

        return (
          <button
            key={reactionItem.reaction}
            type="button"
            className={`parent-layout-page__message-reaction-pill${
              reactionItem.reacted_by_me ? " is-selected" : ""
            }`}
            onClick={() => onSelect(message, reactionItem.reaction)}
            aria-label={`${reactionConfig.label} reaction${
              reactionItem.count > 1 ? `, ${reactionItem.count}` : ""
            }`}
            title={reactionConfig.label}
          >
            <span>{reactionConfig.emoji}</span>
            {reactionItem.count > 1 ? <strong>{reactionItem.count}</strong> : null}
          </button>
        );
      })}
    </div>
  );
}

function MessageReactionPicker({ message, onSelect }) {
  const myReaction = message?.my_reaction || null;

  return (
    <div
      className="parent-layout-page__message-reaction-picker"
      role="menu"
      aria-label="Choose reaction"
      data-reaction-picker-root="true"
    >
      {MESSAGE_REACTIONS.map((reaction) => (
        <button
          key={reaction.key}
          type="button"
          className={myReaction === reaction.key ? "is-selected" : ""}
          onClick={() => onSelect(message, reaction.key)}
          role="menuitem"
          aria-label={reaction.label}
          title={reaction.label}
        >
          <span>{reaction.emoji}</span>
        </button>
      ))}
    </div>
  );
}

function MessengerConversation({
  selectedContact,
  selectedRoom,
  user,
  releasedMessagesVersion,
  cachedConversation,
  onRoomMessage,
  onRoomRead,
  onConversationCacheChange,
}) {
  const [roomMessages, setRoomMessages] = useState([]);
  const [roomMessagesCacheRoomId, setRoomMessagesCacheRoomId] = useState(null);
  const [roomMessage, setRoomMessage] = useState("");
  const [isRoomMessagesLoading, setIsRoomMessagesLoading] = useState(false);
  const [isOlderMessagesLoading, setIsOlderMessagesLoading] = useState(false);
  const [messagePagination, setMessagePagination] = useState(
    getEmptyMessagePagination,
  );
  const [messageDraft, setMessageDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [voiceRecording, setVoiceRecording] = useState({
    durationSeconds: 0,
    startedAt: 0,
    status: "idle",
  });
  const [pendingReplyScrollId, setPendingReplyScrollId] = useState(null);
  const [isReplyTargetLoading, setIsReplyTargetLoading] = useState(false);
  const [replyDrag, setReplyDrag] = useState({
    messageId: null,
    offsetX: 0,
  });
  const [activeMessageActionsId, setActiveMessageActionsId] = useState(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState(null);
  const [attachmentViewer, setAttachmentViewer] = useState({
    attachments: [],
    playback: null,
    selectedAttachmentId: "",
  });
  const [typingUserIds, setTypingUserIds] = useState([]);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const roomSocketRef = useRef(null);
  const messagesListRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageDraftRef = useRef(null);
  const fileInputRef = useRef(null);
  const voiceRecorderRef = useRef(null);
  const voiceRecordingChunksRef = useRef([]);
  const voiceRecordingStreamRef = useRef(null);
  const voiceRecordingTimerRef = useRef(null);
  const voiceRecordingStartedAtRef = useRef(0);
  const voiceRecordingMimeTypeRef = useRef("");
  const isVoiceRecordingStoppingRef = useRef(false);
  const sendQueueRef = useRef([]);
  const isProcessingSendQueueRef = useRef(false);
  const optimisticMessageSequenceRef = useRef(0);
  const readMarkedMessageIdsRef = useRef(new Set());
  const activeConversationRef = useRef({
    peerAccountNumber: "",
    roomId: null,
  });
  const olderMessagesScrollRef = useRef(null);
  const skipNextAutoScrollRef = useRef(false);
  const isOlderMessagesLoadingRef = useRef(false);
  const replyDragStateRef = useRef(null);
  const messageActionLongPressRef = useRef(null);
  const ignoreNextMessageBubbleClickRef = useRef(null);
  const reactionRequestSequenceRef = useRef(new Map());
  const typingStopTimeoutRef = useRef(null);
  const typingRemoteTimeoutsRef = useRef(new Map());
  const isTypingSentRef = useRef(false);
  const lastTypingStartedAtRef = useRef(0);
  const cachedConversationRef = useRef(cachedConversation || null);
  cachedConversationRef.current = cachedConversation || null;
  const isAttachmentViewerOpen = attachmentViewer.attachments.length > 0;
  const isVoiceRecording =
    voiceRecording.status === "recording" ||
    voiceRecording.status === "finishing";
  const isVoiceRecordingFinishing = voiceRecording.status === "finishing";

  const focusMessageDraft = useCallback(() => {
    const textarea = messageDraftRef.current;

    if (!textarea || isAttachmentViewerOpen) {
      return;
    }

    textarea.focus({ preventScroll: true });
    const cursorPosition = textarea.value.length;
    textarea.setSelectionRange(cursorPosition, cursorPosition);
  }, [isAttachmentViewerOpen]);

  const focusMessageDraftUnlessTextEntryIsActive = useCallback(() => {
    const activeElement = globalThis.document?.activeElement;

    if (
      activeElement !== messageDraftRef.current &&
      isTextEntryElement(activeElement)
    ) {
      return;
    }

    focusMessageDraft();
  }, [focusMessageDraft]);

  const currentUserId = getCurrentUserId(user);
  const selectedPeerAccountNumber = getConversationPeerAccount({
    selectedContact,
    selectedRoom,
    user,
  });
  const hasActiveConversation = Boolean(selectedPeerAccountNumber);

  const clearMessageActionLongPress = useCallback(() => {
    if (messageActionLongPressRef.current?.timeoutId) {
      globalThis.clearTimeout(messageActionLongPressRef.current.timeoutId);
    }

    messageActionLongPressRef.current = null;
  }, []);

  useEffect(() => {
    activeConversationRef.current = {
      peerAccountNumber: selectedPeerAccountNumber,
      roomId: selectedRoom?.id || null,
    };
  }, [selectedPeerAccountNumber, selectedRoom?.id]);

  useEffect(() => {
    return () => {
      clearMessageActionLongPress();
    };
  }, [clearMessageActionLongPress]);

  const clearTypingStopTimeout = useCallback(() => {
    if (typingStopTimeoutRef.current) {
      globalThis.clearTimeout(typingStopTimeoutRef.current);
      typingStopTimeoutRef.current = null;
    }
  }, []);

  const sendRoomSocketEvent = useCallback((eventType) => {
    const socket = roomSocketRef.current;

    if (!socket || socket.readyState !== globalThis.WebSocket?.OPEN) {
      return false;
    }

    socket.send(JSON.stringify({ type: eventType }));
    return true;
  }, []);

  const sendTypingStopped = useCallback(() => {
    clearTypingStopTimeout();

    if (!isTypingSentRef.current) {
      return;
    }

    sendRoomSocketEvent("typing.stopped");
    isTypingSentRef.current = false;
    lastTypingStartedAtRef.current = 0;
  }, [clearTypingStopTimeout, sendRoomSocketEvent]);

  useEffect(() => {
    if (!isAttachmentViewerOpen) {
      return;
    }

    if (globalThis.document?.activeElement === messageDraftRef.current) {
      messageDraftRef.current.blur();
    }

    sendTypingStopped();
  }, [isAttachmentViewerOpen, sendTypingStopped]);

  const scheduleTypingStopped = useCallback(() => {
    clearTypingStopTimeout();
    typingStopTimeoutRef.current = globalThis.setTimeout(() => {
      sendTypingStopped();
    }, TYPING_STOP_DELAY_MS);
  }, [clearTypingStopTimeout, sendTypingStopped]);

  const sendTypingStarted = useCallback(() => {
    const now = Date.now();

    if (
      !isTypingSentRef.current ||
      now - lastTypingStartedAtRef.current >= TYPING_REFRESH_INTERVAL_MS
    ) {
      if (sendRoomSocketEvent("typing.started")) {
        isTypingSentRef.current = true;
        lastTypingStartedAtRef.current = now;
      }
    }

    scheduleTypingStopped();
  }, [scheduleTypingStopped, sendRoomSocketEvent]);

  const clearVoiceRecordingTimer = useCallback(() => {
    if (voiceRecordingTimerRef.current) {
      globalThis.clearInterval(voiceRecordingTimerRef.current);
      voiceRecordingTimerRef.current = null;
    }
  }, []);

  const stopVoiceRecordingStream = useCallback(() => {
    voiceRecordingStreamRef.current?.getTracks?.().forEach((track) => {
      track.stop();
    });
    voiceRecordingStreamRef.current = null;
  }, []);

  const resetVoiceRecordingState = useCallback(() => {
    clearVoiceRecordingTimer();
    stopVoiceRecordingStream();
    voiceRecorderRef.current = null;
    voiceRecordingChunksRef.current = [];
    voiceRecordingStartedAtRef.current = 0;
    voiceRecordingMimeTypeRef.current = "";
    isVoiceRecordingStoppingRef.current = false;
    setVoiceRecording({
      durationSeconds: 0,
      startedAt: 0,
      status: "idle",
    });
  }, [clearVoiceRecordingTimer, stopVoiceRecordingStream]);

  const finishVoiceRecording = useCallback(
    ({ discard = false } = {}) =>
      new Promise((resolve, reject) => {
        const recorder = voiceRecorderRef.current;
        const startedAt = voiceRecordingStartedAtRef.current || Date.now();
        const mimeType =
          voiceRecordingMimeTypeRef.current ||
          recorder?.mimeType ||
          "audio/webm";

        const finalize = () => {
          const chunks = voiceRecordingChunksRef.current;
          const durationSeconds = Math.max(
            1,
            Math.round((Date.now() - startedAt) / 1000),
          );

          resetVoiceRecordingState();

          if (discard) {
            resolve(null);
            return;
          }

          const blob = new Blob(chunks, {
            type: mimeType,
          });

          if (!blob.size) {
            reject(new Error("Voice note recording is empty."));
            return;
          }

          resolve({
            blob,
            durationSeconds,
            mimeType: blob.type || mimeType,
          });
        };

        if (!recorder || recorder.state === "inactive") {
          finalize();
          return;
        }

        if (isVoiceRecordingStoppingRef.current) {
          reject(new Error("Voice note is already stopping."));
          return;
        }

        isVoiceRecordingStoppingRef.current = true;
        setVoiceRecording((currentRecording) => ({
          ...currentRecording,
          status: "finishing",
        }));

        recorder.addEventListener("stop", finalize, { once: true });
        recorder.addEventListener(
          "error",
          () => {
            resetVoiceRecordingState();
            reject(new Error("Voice note recording failed."));
          },
          { once: true },
        );
        recorder.stop();
      }),
    [resetVoiceRecordingState],
  );

  const handleStartVoiceRecording = useCallback(async () => {
    if (isVoiceRecording || !hasActiveConversation) {
      return;
    }

    if (
      typeof globalThis.MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setRoomMessage("Voice recording is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const mimeType = getSupportedVoiceNoteMimeType();
      const recorderOptions = {
        audioBitsPerSecond: VOICE_NOTE_AUDIO_BITRATE,
        ...(mimeType ? { mimeType } : {}),
      };
      const recorder = new MediaRecorder(stream, recorderOptions);
      const startedAt = Date.now();

      voiceRecordingChunksRef.current = [];
      voiceRecordingStreamRef.current = stream;
      voiceRecorderRef.current = recorder;
      voiceRecordingStartedAtRef.current = startedAt;
      voiceRecordingMimeTypeRef.current = recorder.mimeType || mimeType;
      isVoiceRecordingStoppingRef.current = false;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size > 0) {
          voiceRecordingChunksRef.current.push(event.data);
        }
      });
      recorder.addEventListener("error", () => {
        resetVoiceRecordingState();
        setRoomMessage("Voice recording stopped unexpectedly.");
      });

      recorder.start(1000);
      clearVoiceRecordingTimer();
      voiceRecordingTimerRef.current = globalThis.setInterval(() => {
        const elapsedSeconds = Math.min(
          VOICE_NOTE_MAX_DURATION_SECONDS,
          Math.floor((Date.now() - startedAt) / 1000),
        );

        setVoiceRecording((currentRecording) => ({
          ...currentRecording,
          durationSeconds: elapsedSeconds,
        }));
      }, 250);
      setVoiceRecording({
        durationSeconds: 0,
        startedAt,
        status: "recording",
      });
      setRoomMessage("");
      sendTypingStopped();
      messageDraftRef.current?.blur();
    } catch (error) {
      resetVoiceRecordingState();
      setRoomMessage(
        error?.name === "NotAllowedError"
          ? "Microphone permission is required to record a voice note."
          : "Unable to start voice recording.",
      );
    }
  }, [
    clearVoiceRecordingTimer,
    hasActiveConversation,
    isVoiceRecording,
    resetVoiceRecordingState,
    sendTypingStopped,
  ]);

  const handleCancelVoiceRecording = useCallback(() => {
    finishVoiceRecording({ discard: true })
      .then(() => {
        setRoomMessage("");
        globalThis.requestAnimationFrame(focusMessageDraft);
      })
      .catch(() => {
        resetVoiceRecordingState();
      });
  }, [finishVoiceRecording, focusMessageDraft, resetVoiceRecordingState]);

  useEffect(() => {
    return () => {
      resetVoiceRecordingState();
    };
  }, [resetVoiceRecordingState]);

  const removeRemoteTypingUser = useCallback((userId) => {
    const numericUserId = Number(userId);

    if (!numericUserId) {
      return;
    }

    const timeout = typingRemoteTimeoutsRef.current.get(numericUserId);
    if (timeout) {
      globalThis.clearTimeout(timeout);
      typingRemoteTimeoutsRef.current.delete(numericUserId);
    }

    setTypingUserIds((currentUserIds) =>
      currentUserIds.filter((currentUserId) => currentUserId !== numericUserId),
    );
  }, []);

  const setRemoteTypingUser = useCallback(
    (userId, expiresInSeconds) => {
      const numericUserId = Number(userId);

      if (!numericUserId || numericUserId === Number(currentUserId)) {
        return;
      }

      setTypingUserIds((currentUserIds) =>
        currentUserIds.includes(numericUserId)
          ? currentUserIds
          : [...currentUserIds, numericUserId],
      );

      const previousTimeout =
        typingRemoteTimeoutsRef.current.get(numericUserId);
      if (previousTimeout) {
        globalThis.clearTimeout(previousTimeout);
      }

      const timeout = globalThis.setTimeout(
        () => removeRemoteTypingUser(numericUserId),
        Math.max(
          Number(expiresInSeconds || 0) * 1000,
          TYPING_REMOTE_TIMEOUT_MS,
        ),
      );
      typingRemoteTimeoutsRef.current.set(numericUserId, timeout);
    },
    [currentUserId, removeRemoteTypingUser],
  );

  const clearRemoteTypingUsers = useCallback(() => {
    typingRemoteTimeoutsRef.current.forEach((timeout) => {
      globalThis.clearTimeout(timeout);
    });
    typingRemoteTimeoutsRef.current.clear();
    setTypingUserIds([]);
  }, []);

  const markRoomReadForMessages = useCallback(
    async (roomId, messages) => {
      if (!roomId || !currentUserId || !messages.length) {
        return;
      }

      const latestIncomingMessage = [...messages]
        .reverse()
        .find((message) => Number(message.sender_user_id) !== currentUserId);

      if (!latestIncomingMessage) {
        return;
      }

      await markMessengerRoomRead(roomId, {
        last_read_message_id: latestIncomingMessage.id,
      });
      onRoomRead(roomId);
    },
    [currentUserId, onRoomRead],
  );

  const applyMessageStatusEvent = useCallback(
    (eventPayload) => {
      if (
        (eventPayload?.type !== "message.read" &&
          eventPayload?.type !== "message.delivered") ||
        Number(eventPayload.room_id) !==
          Number(activeConversationRef.current.roomId)
      ) {
        return;
      }

      const status = eventPayload.type === "message.read" ? "read" : "delivered";
      const lastMessageId =
        eventPayload.last_read_message_id ||
        eventPayload.last_delivered_message_id;

      if (Number(eventPayload.user_id) === currentUserId || !lastMessageId) {
        return;
      }

      setRoomMessages((currentMessages) =>
        currentMessages.map((message) => {
          if (
            Number(message.sender_user_id) !== currentUserId ||
            Number(message.id) > Number(lastMessageId) ||
            (status === "delivered" && message.status === "read")
          ) {
            return message;
          }

          return {
            ...message,
            status,
          };
        }),
      );
    },
    [currentUserId],
  );

  const applyMessageReactionEvent = useCallback(
    (eventPayload) => {
      if (
        eventPayload?.type !== "message.reaction_updated" ||
        Number(eventPayload.room_id) !==
          Number(activeConversationRef.current.roomId)
      ) {
        return;
      }

      setRoomMessages((currentMessages) =>
        currentMessages.map((message) =>
          Number(message.id) === Number(eventPayload.message_id)
            ? applyReactionSnapshot(message, eventPayload, currentUserId)
            : message,
        ),
      );
    },
    [currentUserId],
  );

  const markIncomingRoomMessageRead = useCallback(
    (roomId, nextMessage) => {
      const messageId = String(nextMessage?.id || "");

      if (
        !roomId ||
        !messageId ||
        Number(nextMessage?.sender_user_id) === currentUserId ||
        readMarkedMessageIdsRef.current.has(messageId)
      ) {
        return;
      }

      if (readMarkedMessageIdsRef.current.size > 500) {
        readMarkedMessageIdsRef.current.clear();
      }
      readMarkedMessageIdsRef.current.add(messageId);

      markMessengerRoomRead(roomId, {
        last_read_message_id: nextMessage.id,
      })
        .then(() => onRoomRead(roomId))
        .catch(() => {
          readMarkedMessageIdsRef.current.delete(messageId);
        });
    },
    [currentUserId, onRoomRead],
  );

  const loadRoomMessages = useCallback(
    async (
      roomId,
      {
        markRead = true,
        silent = false,
        beforeMessageId = null,
        aroundMessageId = null,
        mode = "replace",
      } = {},
    ) => {
      if (!roomId) {
        setRoomMessages([]);
        setRoomMessagesCacheRoomId(null);
        setMessagePagination(getEmptyMessagePagination());
        setRoomMessage("");
        return {
          messages: [],
          pagination: getEmptyMessagePagination(),
        };
      }

      if (!silent) {
        setIsRoomMessagesLoading(true);
      }
      setRoomMessage("");

      try {
        const response = await getMessengerRoomMessages(roomId, {
          limit: MESSAGE_PAGE_SIZE,
          before_message_id: beforeMessageId,
          around_message_id: aroundMessageId,
        });
        const messagesResult = response.data?.result || response.data;
        const nextMessages = Array.isArray(messagesResult?.messages)
          ? messagesResult.messages
          : [];
        const decryptedMessages = await decryptMessagesForUser(nextMessages, user);
        const pagination = messagesResult?.pagination || {};
        const nextPagination = {
          hasMore: Boolean(pagination.has_more),
          nextBeforeMessageId: pagination.next_before_message_id || null,
        };

        if (
          Number(activeConversationRef.current.roomId || 0) !== Number(roomId)
        ) {
          return {
            messages: decryptedMessages,
            pagination: nextPagination,
            stale: true,
          };
        }

        setRoomMessagesCacheRoomId(roomId);
        setRoomMessages((currentMessages) =>
          mode === "prepend" || mode === "merge"
            ? mergeMessagePage(currentMessages, decryptedMessages)
            : decryptedMessages,
        );
        setMessagePagination((currentPagination) =>
          mode === "merge" && currentPagination?.hasMore
            ? currentPagination
            : nextPagination,
        );

        if (markRead) {
          markRoomReadForMessages(roomId, decryptedMessages).catch(() => {});
        }

        return {
          messages: decryptedMessages,
          pagination: nextPagination,
        };
      } catch (error) {
        if (mode !== "prepend" && !silent) {
          setRoomMessages([]);
        }
        setRoomMessage(
          getMessengerErrorMessage(error, "Unable to load messages."),
        );
        return {
          error,
          messages: [],
          pagination: null,
        };
      } finally {
        if (!silent) {
          setIsRoomMessagesLoading(false);
        }
      }
    },
    [markRoomReadForMessages, user],
  );

  useEffect(() => {
    sendTypingStopped();
    resetVoiceRecordingState();
    clearRemoteTypingUsers();
    setMessageDraft("");
    setReplyTarget(null);
    setActiveMessageActionsId(null);
    setReactionPickerMessageId(null);
    setSelectedFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setPendingReplyScrollId(null);
    setRoomMessage("");
    setMessagePagination(getEmptyMessagePagination());

    if (!selectedRoom?.id) {
      setRoomMessagesCacheRoomId(null);
      setRoomMessages([]);
      setIsRoomMessagesLoading(false);
      return;
    }

    const cachedRoomConversation = cachedConversationRef.current;
    const cachedMessages = Array.isArray(cachedRoomConversation?.messages)
      ? cachedRoomConversation.messages
      : [];
    const cachedPagination = cachedRoomConversation?.pagination;

    setRoomMessagesCacheRoomId(selectedRoom.id);

    if (cachedMessages.length > 0 || cachedPagination) {
      setRoomMessages(cachedMessages);
      setMessagePagination({
        hasMore: Boolean(cachedPagination?.hasMore),
        nextBeforeMessageId: cachedPagination?.nextBeforeMessageId || null,
      });
      setIsRoomMessagesLoading(false);
      loadRoomMessages(selectedRoom.id, {
        mode: "merge",
        silent: true,
      });
      return;
    }

    loadRoomMessages(selectedRoom.id);
  }, [
    clearRemoteTypingUsers,
    loadRoomMessages,
    releasedMessagesVersion,
    resetVoiceRecordingState,
    selectedPeerAccountNumber,
    selectedRoom?.id,
    sendTypingStopped,
  ]);

  useEffect(() => {
    if (
      !selectedRoom?.id ||
      String(roomMessagesCacheRoomId || "") !== String(selectedRoom.id)
    ) {
      return;
    }

    onConversationCacheChange?.(selectedRoom.id, {
      messages: roomMessages,
      pagination: messagePagination,
    });
  }, [
    messagePagination,
    onConversationCacheChange,
    roomMessages,
    roomMessagesCacheRoomId,
    selectedRoom?.id,
  ]);

  useEffect(() => {
    if (!hasActiveConversation || isAttachmentViewerOpen) {
      return undefined;
    }

    const focusFrame = globalThis.requestAnimationFrame(focusMessageDraft);

    return () => globalThis.cancelAnimationFrame(focusFrame);
  }, [
    focusMessageDraft,
    hasActiveConversation,
    isAttachmentViewerOpen,
    selectedPeerAccountNumber,
  ]);

  useEffect(() => {
    if (!hasActiveConversation || isAttachmentViewerOpen) {
      return undefined;
    }

    const handleConversationKeyDown = (event) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.key.length !== 1 ||
        isTextEntryElement(event.target)
      ) {
        return;
      }

      focusMessageDraft();
    };

    globalThis.document.addEventListener("keydown", handleConversationKeyDown);

    return () => {
      globalThis.document.removeEventListener(
        "keydown",
        handleConversationKeyDown,
      );
    };
  }, [focusMessageDraft, hasActiveConversation, isAttachmentViewerOpen]);

  useEffect(() => {
    if (!reactionPickerMessageId && !activeMessageActionsId) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (event.target?.closest?.("[data-reaction-picker-root]")) {
        return;
      }

      setReactionPickerMessageId(null);
      setActiveMessageActionsId(null);
    };

    globalThis.document?.addEventListener("pointerdown", handlePointerDown);

    return () => {
      globalThis.document?.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [activeMessageActionsId, reactionPickerMessageId]);

  useLayoutEffect(() => {
    const scrollSnapshot = olderMessagesScrollRef.current;

    if (!scrollSnapshot) {
      return;
    }

    const messagesList = messagesListRef.current;
    if (messagesList) {
      messagesList.scrollTop =
        messagesList.scrollHeight -
        scrollSnapshot.scrollHeight +
        scrollSnapshot.scrollTop;
    }

    olderMessagesScrollRef.current = null;
  }, [roomMessages.length]);

  useEffect(() => {
    const roomId = selectedRoom?.id;

    if (!roomId) {
      return undefined;
    }

    let isMounted = true;
    let reconnectAttempt = 0;
    let reconnectTimeout = null;
    let pingInterval = null;
    let socket = null;

    const clearPingInterval = () => {
      if (pingInterval) {
        globalThis.clearInterval(pingInterval);
        pingInterval = null;
      }
    };

    const startPingInterval = (nextSocket) => {
      clearPingInterval();
      pingInterval = globalThis.setInterval(() => {
        if (nextSocket.readyState !== globalThis.WebSocket?.OPEN) {
          return;
        }

        nextSocket.send(JSON.stringify({ type: "ping" }));
      }, ROOM_SOCKET_PING_INTERVAL_MS);
    };

    const scheduleReconnect = (forceRefresh = false) => {
      if (!isMounted) {
        return;
      }

      const nextDelay = Math.min(1200 * (reconnectAttempt + 1), 7000);
      reconnectAttempt += 1;
      reconnectTimeout = globalThis.setTimeout(() => {
        connectRoomSocket(forceRefresh);
      }, nextDelay);
    };

    const connectRoomSocket = async (forceRefresh = false) => {
      try {
        const token = await getMessengerToken({ forceRefresh });

        if (!isMounted) {
          return;
        }

        socket = new WebSocket(getMessengerRoomWebSocketUrl(roomId, token));
        roomSocketRef.current = socket;

        socket.onopen = () => {
          reconnectAttempt = 0;
          startPingInterval(socket);
          if (messageDraftRef.current?.value.trim()) {
            sendTypingStarted();
          }
        };

        socket.onmessage = async (event) => {
          let eventPayload;

          try {
            eventPayload = JSON.parse(event.data);
          } catch {
            return;
          }

          if (
            eventPayload.type === "connection.accepted" ||
            eventPayload.type === "pong"
          ) {
            return;
          }

          if (
            eventPayload.type === "typing.snapshot" &&
            Number(eventPayload.room_id) === Number(roomId)
          ) {
            clearRemoteTypingUsers();
            (eventPayload.typing_user_ids || []).forEach((typingUserId) => {
              setRemoteTypingUser(typingUserId, eventPayload.expires_in);
            });
            return;
          }

          if (
            (eventPayload.type === "typing.started" ||
              eventPayload.type === "typing.stopped") &&
            Number(eventPayload.room_id) === Number(roomId)
          ) {
            if (Number(eventPayload.user_id) === Number(currentUserId)) {
              return;
            }

            if (eventPayload.type === "typing.started") {
              setRemoteTypingUser(eventPayload.user_id, eventPayload.expires_in);
            } else {
              removeRemoteTypingUser(eventPayload.user_id);
            }
            return;
          }

          if (
            eventPayload.type === "message.sent" &&
            Number(eventPayload.message?.room_id) === Number(roomId)
          ) {
            const nextMessage = await decryptMessageForUser(
              eventPayload.message,
              user,
            );
            if (!isMounted) {
              return;
            }
            setRoomMessages((currentMessages) =>
              upsertMessage(currentMessages, nextMessage),
            );
            onRoomMessage(eventPayload.room, nextMessage, {
              selectRoom: true,
            });
            markIncomingRoomMessageRead(roomId, nextMessage);
            return;
          }

          if (
            (eventPayload.type === "message.read" ||
              eventPayload.type === "message.delivered") &&
            Number(eventPayload.room_id) === Number(roomId)
          ) {
            applyMessageStatusEvent(eventPayload);
            return;
          }

          if (
            eventPayload.type === "message.reaction_updated" &&
            Number(eventPayload.room_id) === Number(roomId)
          ) {
            applyMessageReactionEvent(eventPayload);
          }
        };

        socket.onclose = (event) => {
          clearPingInterval();
          if (roomSocketRef.current === socket) {
            roomSocketRef.current = null;
          }

          if (!isMounted) {
            return;
          }

          scheduleReconnect(event.code === 4401);
        };

        socket.onerror = () => {
          socket.close();
        };
      } catch {
        scheduleReconnect(true);
      }
    };

    connectRoomSocket();

    return () => {
      isMounted = false;

      if (reconnectTimeout) {
        globalThis.clearTimeout(reconnectTimeout);
      }

      clearPingInterval();

      if (socket) {
        sendTypingStopped();
        if (roomSocketRef.current === socket) {
          roomSocketRef.current = null;
        }
        socket.close(1000, "Conversation changed");
      }
    };
  }, [
    clearRemoteTypingUsers,
    currentUserId,
    applyMessageStatusEvent,
    applyMessageReactionEvent,
    loadRoomMessages,
    markIncomingRoomMessageRead,
    onRoomMessage,
    removeRemoteTypingUser,
    sendTypingStarted,
    selectedRoom?.id,
    sendTypingStopped,
    setRemoteTypingUser,
    user,
  ]);

  useEffect(() => {
    const handleInboxEvent = async (event) => {
      const eventPayload = event.detail;
      const roomId = activeConversationRef.current.roomId;

      if (!roomId) {
        return;
      }

      if (
        eventPayload?.type === "message.sent" &&
        Number(eventPayload.message?.room_id) === Number(roomId)
      ) {
        try {
          const nextMessage = await decryptMessageForUser(
            eventPayload.message,
            user,
          );
          if (Number(activeConversationRef.current.roomId) !== Number(roomId)) {
            return;
          }
          setRoomMessages((currentMessages) =>
            upsertMessage(currentMessages, nextMessage),
          );
          onRoomMessage(eventPayload.room, nextMessage, {
            selectRoom: true,
          });
          markIncomingRoomMessageRead(roomId, nextMessage);
        } catch {
          if (Number(activeConversationRef.current.roomId) !== Number(roomId)) {
            return;
          }
          setRoomMessages((currentMessages) =>
            upsertMessage(currentMessages, eventPayload.message),
          );
          onRoomMessage(eventPayload.room, eventPayload.message, {
            selectRoom: true,
          });
          markIncomingRoomMessageRead(roomId, eventPayload.message);
        }
        return;
      }

      if (
        eventPayload?.type === "message.read" ||
        eventPayload?.type === "message.delivered"
      ) {
        applyMessageStatusEvent(eventPayload);
        return;
      }

      if (eventPayload?.type === "message.reaction_updated") {
        applyMessageReactionEvent(eventPayload);
      }
    };

    globalThis.addEventListener(
      MESSENGER_INBOX_EVENT_NAME,
      handleInboxEvent,
    );

    return () => {
      globalThis.removeEventListener(
        MESSENGER_INBOX_EVENT_NAME,
        handleInboxEvent,
      );
    };
  }, [
    applyMessageStatusEvent,
    applyMessageReactionEvent,
    markIncomingRoomMessageRead,
    onRoomMessage,
    user,
  ]);

  useEffect(() => {
    if (!hasActiveConversation || isRoomMessagesLoading) {
      return;
    }

    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      return;
    }

    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [
    hasActiveConversation,
    isRoomMessagesLoading,
    roomMessages.length,
    selectedRoom?.id,
  ]);

  const groupedMessages = useMemo(() => {
    let previousDateKey = "";

    return roomMessages.map((message) => {
      const dateKey = getMessageDateKey(message.created_at);
      const dateLabel = getMessageDateDividerLabel(message.created_at);
      const shouldShowDateDivider = dateKey && dateKey !== previousDateKey;

      previousDateKey = dateKey || previousDateKey;

      return {
        dateLabel,
        message,
        shouldShowDateDivider,
      };
    });
  }, [roomMessages]);

  const messagesById = useMemo(() => {
    const nextMessagesById = new Map();

    roomMessages.forEach((message) => {
      if (message?.id) {
        nextMessagesById.set(Number(message.id), message);
      }
    });

    return nextMessagesById;
  }, [roomMessages]);

  const participantNamesByUserId = useMemo(() => {
    const namesByUserId = new Map();
    const participants = [
      ...(Array.isArray(selectedRoom?.participants)
        ? selectedRoom.participants
        : []),
      ...(Array.isArray(selectedRoom?.other_participants)
        ? selectedRoom.other_participants
        : []),
    ];

    participants.forEach((participant) => {
      const userId = Number(participant?.user_id);

      if (!userId || namesByUserId.has(userId)) {
        return;
      }

      const selectedContactName =
        selectedContact &&
        String(selectedContact.account_number || "") ===
          String(participant?.account_number || "")
          ? getContactName(selectedContact)
          : "";
      const displayName =
        selectedContactName || getParticipantDisplayName(participant);

      if (displayName) {
        namesByUserId.set(userId, displayName);
      }
    });

    return namesByUserId;
  }, [selectedContact, selectedRoom]);

  const typingIndicatorText = useMemo(() => {
    const typingNames = typingUserIds
      .map(
        (typingUserId) =>
          participantNamesByUserId.get(Number(typingUserId)) || "Contact",
      )
      .filter(Boolean);

    if (typingNames.length === 0) {
      return "";
    }

    if (typingNames.length === 1) {
      return `${typingNames[0]} is typing`;
    }

    return `${typingNames.slice(0, 2).join(", ")} are typing`;
  }, [participantNamesByUserId, typingUserIds]);

  const getReplyPreview = useCallback(
    (message) => {
      if (!message?.reply_to_message_id) {
        return null;
      }

      return (
        message.reply_to ||
        messagesById.get(Number(message.reply_to_message_id)) ||
        null
      );
    },
    [messagesById],
  );

  const handleSelectReplyTarget = useCallback(
    (message) => {
      if (!message?.id) {
        return;
      }

      setActiveMessageActionsId(null);
      setReactionPickerMessageId(null);
      setReplyTarget(message);
      focusMessageDraft();
    },
    [focusMessageDraft],
  );

  const handleMessageBubbleMouseEnter = useCallback((message) => {
    if (!message?.id || !supportsFineHoverPointer()) {
      return;
    }

    setActiveMessageActionsId(message.id);
  }, []);

  const handleMessageMouseLeave = useCallback(
    (message) => {
      if (!message?.id || !supportsFineHoverPointer()) {
        return;
      }

      const messageId = Number(message.id);

      if (Number(activeMessageActionsId) === messageId) {
        setActiveMessageActionsId(null);
      }

      if (Number(reactionPickerMessageId) === messageId) {
        setReactionPickerMessageId(null);
      }
    },
    [activeMessageActionsId, reactionPickerMessageId],
  );

  const handleMessageBubbleClick = useCallback((event, message) => {
    const messageId = Number(message?.id);

    if (
      !messageId ||
      !supportsMobileMessageTap() ||
      event.defaultPrevented ||
      event.target?.closest?.(
        "a, button, input, select, textarea, [role='button'], [data-reaction-picker-root]",
      )
    ) {
      return;
    }

    const ignoredClick = ignoreNextMessageBubbleClickRef.current;
    if (
      ignoredClick?.messageId === messageId &&
      ignoredClick.until > Date.now()
    ) {
      ignoreNextMessageBubbleClickRef.current = null;
      return;
    }

    setActiveMessageActionsId(messageId);
    setReactionPickerMessageId(messageId);
  }, []);

  const handleClearReplyTarget = useCallback(() => {
    setReplyTarget(null);
    focusMessageDraft();
  }, [focusMessageDraft]);

  const handleSelectMessageReaction = useCallback(
    async (message, reactionKey) => {
      const messageId = Number(message?.id);

      if (
        !messageId ||
        messageId < 0 ||
        !MESSAGE_REACTION_KEYS.includes(reactionKey)
      ) {
        return;
      }

      const previousMessage = messagesById.get(messageId) || message;
      const requestId =
        (reactionRequestSequenceRef.current.get(messageId) || 0) + 1;
      reactionRequestSequenceRef.current.set(messageId, requestId);
      setActiveMessageActionsId(null);
      setReactionPickerMessageId(null);
      setRoomMessage("");
      setRoomMessages((currentMessages) =>
        currentMessages.map((currentMessage) =>
          Number(currentMessage.id) === messageId
            ? applyOptimisticReaction(currentMessage, reactionKey, currentUserId)
            : currentMessage,
        ),
      );

      try {
        const response = await reactToMessengerMessage(messageId, reactionKey);
        const reactionResult = response.data?.result || response.data;

        if (reactionRequestSequenceRef.current.get(messageId) !== requestId) {
          return;
        }

        reactionRequestSequenceRef.current.delete(messageId);
        setRoomMessages((currentMessages) =>
          currentMessages.map((currentMessage) =>
            Number(currentMessage.id) === messageId
              ? applyReactionSnapshot(
                  currentMessage,
                  reactionResult,
                  currentUserId,
                )
              : currentMessage,
          ),
        );
      } catch (error) {
        if (reactionRequestSequenceRef.current.get(messageId) !== requestId) {
          return;
        }

        reactionRequestSequenceRef.current.delete(messageId);
        setRoomMessages((currentMessages) =>
          currentMessages.map((currentMessage) =>
            Number(currentMessage.id) === messageId
              ? previousMessage
              : currentMessage,
          ),
        );
        setRoomMessage(
          getMessengerErrorMessage(error, "Unable to update reaction."),
        );
      }
    },
    [currentUserId, messagesById],
  );

  const handleFileInputChange = useCallback((event) => {
    const incomingFiles = Array.from(event.target.files || []);

    if (incomingFiles.length === 0) {
      return;
    }

    setRoomMessage("");
    setSelectedFiles((currentFiles) => {
      const availableSlots = MAX_MESSAGE_ATTACHMENTS - currentFiles.length;

      if (availableSlots <= 0) {
        setRoomMessage(`You can attach up to ${MAX_MESSAGE_ATTACHMENTS} files.`);
        return currentFiles;
      }

      const validFiles = [];
      const rejectedFiles = [];

      incomingFiles.slice(0, availableSlots).forEach((file) => {
        if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
          rejectedFiles.push(file.name);
          return;
        }

        validFiles.push({
          id: createSelectedFileId(file),
          file,
          fileType: getSelectedFileType(file),
        });
      });

      if (incomingFiles.length > availableSlots) {
        setRoomMessage(`Only ${availableSlots} more file(s) can be attached.`);
      } else if (rejectedFiles.length > 0) {
        setRoomMessage("One or more files exceed the 25 MB attachment limit.");
      }

      return [...currentFiles, ...validFiles];
    });

    event.target.value = "";
    focusMessageDraft();
  }, [focusMessageDraft]);

  const handleRemoveSelectedFile = useCallback((fileId) => {
    setSelectedFiles((currentFiles) =>
      currentFiles.filter((selectedFile) => selectedFile.id !== fileId),
    );
    focusMessageDraft();
  }, [focusMessageDraft]);

  const handleDownloadAttachment = useCallback((attachment) => {
    downloadCachedAttachment(attachment).catch(() => {
      setRoomMessage("Unable to decrypt this attachment.");
    });
  }, []);

  const handleOpenAttachment = useCallback((attachment) => {
    openCachedAttachment(attachment).catch(() => {
      setRoomMessage("Unable to decrypt this attachment.");
    });
  }, []);

  const handleOpenAttachmentViewer = useCallback((attachments, attachment, options = {}) => {
    const selectedAttachment = attachment || attachments[0] || null;

    setAttachmentViewer({
      attachments,
      playback: options.playback || null,
      selectedAttachmentId: selectedAttachment
        ? getAttachmentKey(selectedAttachment)
        : "",
    });
  }, []);

  const handleCloseAttachmentViewer = useCallback(() => {
    setAttachmentViewer({
      attachments: [],
      playback: null,
      selectedAttachmentId: "",
    });
  }, []);

  const handleNavigateAttachment = useCallback((direction) => {
    setAttachmentViewer((currentViewer) => {
      const currentAttachments = currentViewer.attachments;

      if (currentAttachments.length <= 1) {
        return currentViewer;
      }

      const currentIndex = Math.max(
        currentAttachments.findIndex(
          (attachment) =>
            getAttachmentKey(attachment) === currentViewer.selectedAttachmentId,
        ),
        0,
      );
      const nextIndex =
        (currentIndex + direction + currentAttachments.length) %
        currentAttachments.length;

      return {
        ...currentViewer,
        selectedAttachmentId: getAttachmentKey(currentAttachments[nextIndex]),
      };
    });
  }, []);

  const scrollToMessageElement = useCallback((messageId) => {
    const numericMessageId = Number(messageId);

    if (!numericMessageId) {
      return false;
    }

    const messageElement = messagesListRef.current?.querySelector(
      `[data-message-id="${numericMessageId}"]`,
    );

    if (!messageElement) {
      return false;
    }

    messageElement.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
    messageElement.classList.remove("is-highlighted");
    void messageElement.offsetWidth;
    messageElement.classList.add("is-highlighted");
    globalThis.setTimeout(() => {
      messageElement.classList.remove("is-highlighted");
    }, 1400);

    return true;
  }, []);

  useEffect(() => {
    if (!pendingReplyScrollId) {
      return undefined;
    }

    const scrollFrame = globalThis.requestAnimationFrame(() => {
      if (scrollToMessageElement(pendingReplyScrollId)) {
        setPendingReplyScrollId(null);
      }
    });

    return () => globalThis.cancelAnimationFrame(scrollFrame);
  }, [pendingReplyScrollId, roomMessages.length, scrollToMessageElement]);

  const handleScrollToReplyTarget = useCallback(
    async (messageId) => {
      const numericMessageId = Number(messageId);

      if (!numericMessageId) {
        return;
      }

      if (scrollToMessageElement(numericMessageId)) {
        return;
      }

      if (messagesById.has(numericMessageId)) {
        setPendingReplyScrollId(numericMessageId);
        return;
      }

      if (!selectedRoom?.id) {
        setRoomMessage("Original message is no longer available in this chat.");
        return;
      }

      if (isOlderMessagesLoadingRef.current) {
        setPendingReplyScrollId(numericMessageId);
        return;
      }

      setRoomMessage("");
      setPendingReplyScrollId(numericMessageId);
      setIsReplyTargetLoading(true);
      setIsOlderMessagesLoading(true);
      isOlderMessagesLoadingRef.current = true;
      skipNextAutoScrollRef.current = true;

      try {
        const pageResult = await loadRoomMessages(selectedRoom.id, {
          aroundMessageId: numericMessageId,
          markRead: false,
          mode: "prepend",
          silent: true,
        });
        const foundMessage = (pageResult?.messages || []).some(
          (message) => Number(message.id) === numericMessageId,
        );

        if (pageResult?.error || !foundMessage) {
          setPendingReplyScrollId(null);
          setRoomMessage(
            "Original message is no longer available in this chat.",
          );
        }
      } finally {
        isOlderMessagesLoadingRef.current = false;
        setIsOlderMessagesLoading(false);
        setIsReplyTargetLoading(false);
      }
    },
    [
      loadRoomMessages,
      messagesById,
      scrollToMessageElement,
      selectedRoom?.id,
    ],
  );

  const handleReplyDragStart = useCallback(
    (event, message) => {
      if (
        !["touch", "pen"].includes(event.pointerType) ||
        supportsFineHoverPointer() ||
        event.button !== 0 ||
        event.target.closest("a, button, input, select, textarea")
      ) {
        return;
      }

      clearMessageActionLongPress();
      const dragState = {
        pointerId: event.pointerId,
        message,
        startX: event.clientX,
        startY: event.clientY,
        activated: false,
        longPressActivated: false,
      };
      replyDragStateRef.current = dragState;

      if (event.pointerType === "touch" || event.pointerType === "pen") {
        const timeoutId = globalThis.setTimeout(() => {
          if (replyDragStateRef.current?.pointerId !== event.pointerId) {
            return;
          }

          replyDragStateRef.current.longPressActivated = true;
          setActiveMessageActionsId(message.id);
          setReactionPickerMessageId(message.id);
          setReplyDrag({ messageId: null, offsetX: 0 });
        }, MESSAGE_ACTION_LONG_PRESS_MS);

        messageActionLongPressRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          timeoutId,
        };
      }

      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [clearMessageActionLongPress],
  );

  const handleReplyDragMove = useCallback((event) => {
    const dragState = replyDragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const longPressState = messageActionLongPressRef.current;
    if (longPressState?.pointerId === event.pointerId) {
      const movedDistance = Math.hypot(
        event.clientX - longPressState.startX,
        event.clientY - longPressState.startY,
      );

      if (movedDistance > MESSAGE_ACTION_LONG_PRESS_MOVE_TOLERANCE) {
        clearMessageActionLongPress();
      }
    }

    if (dragState.longPressActivated) {
      event.preventDefault();
      return;
    }

    const rawDelta = event.clientX - dragState.startX;
    const clampedDelta = Math.min(
      Math.abs(rawDelta),
      MESSAGE_REPLY_DRAG_LIMIT,
    );

    if (clampedDelta <= 2) {
      setReplyDrag({ messageId: null, offsetX: 0 });
      return;
    }

    event.preventDefault();
    dragState.activated = clampedDelta >= MESSAGE_REPLY_DRAG_THRESHOLD;
    setReplyDrag({
      messageId: dragState.message.id,
      offsetX: clampedDelta * (rawDelta < 0 ? -1 : 1),
    });
  }, []);

  const handleReplyDragEnd = useCallback(
    (event) => {
      clearMessageActionLongPress();
      const dragState = replyDragStateRef.current;

      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      if (dragState.activated) {
        handleSelectReplyTarget(dragState.message);
      }

      if (
        (dragState.activated || dragState.longPressActivated) &&
        (event.pointerType === "touch" || event.pointerType === "pen")
      ) {
        ignoreNextMessageBubbleClickRef.current = {
          messageId: Number(dragState.message?.id || 0),
          until: Date.now() + 450,
        };
      }

      replyDragStateRef.current = null;
      setReplyDrag({ messageId: null, offsetX: 0 });
    },
    [clearMessageActionLongPress, handleSelectReplyTarget],
  );

  const handleLoadOlderMessages = async () => {
    if (
      !selectedRoom?.id ||
      !messagePagination.hasMore ||
      !messagePagination.nextBeforeMessageId ||
      isOlderMessagesLoadingRef.current
    ) {
      return;
    }

    const messagesList = messagesListRef.current;
    olderMessagesScrollRef.current = messagesList
      ? {
          scrollHeight: messagesList.scrollHeight,
          scrollTop: messagesList.scrollTop,
        }
      : null;
    skipNextAutoScrollRef.current = true;
    isOlderMessagesLoadingRef.current = true;
    setIsOlderMessagesLoading(true);

    try {
      await loadRoomMessages(selectedRoom.id, {
        beforeMessageId: messagePagination.nextBeforeMessageId,
        markRead: false,
        mode: "prepend",
        silent: true,
      });
    } finally {
      isOlderMessagesLoadingRef.current = false;
      setIsOlderMessagesLoading(false);
    }
  };

  const handleMessagesScroll = (event) => {
    if (event.currentTarget.scrollTop > OLDER_MESSAGES_SCROLL_THRESHOLD) {
      return;
    }

    handleLoadOlderMessages();
  };

  const resizeMessageDraft = useCallback(() => {
    const textarea = messageDraftRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resizeMessageDraft();
  }, [messageDraft, resizeMessageDraft, selectedPeerAccountNumber]);

  const isQueuedMessageForActiveConversation = useCallback((queuedMessage) => {
    return (
      activeConversationRef.current.peerAccountNumber ===
      queuedMessage.recipientAccountNumber
    );
  }, []);

  const processSendQueue = useCallback(async () => {
    if (isProcessingSendQueueRef.current) {
      return;
    }

    isProcessingSendQueueRef.current = true;
    setIsSendingMessage(true);

    try {
      while (sendQueueRef.current.length > 0) {
        const queuedMessage = sendQueueRef.current[0];

        try {
          const encryptedAttachments =
            queuedMessage.filesToSend.length > 0
              ? await encryptSelectedFilesForMessage(queuedMessage.filesToSend, {
                  clientMessageId: queuedMessage.clientMessageId,
                  recipientAccountNumber: queuedMessage.recipientAccountNumber,
                })
              : [];
          const encryptedText = await encryptMessageText({
            attachments: encryptedAttachments,
            recipientAccountNumber: queuedMessage.recipientAccountNumber,
            text: queuedMessage.text,
            user,
          });

          const sendPayload = {
            recipient_account_number: queuedMessage.recipientAccountNumber,
            text: encryptedText,
            ...(queuedMessage.replyTargetId
              ? { reply_to_message_id: queuedMessage.replyTargetId }
              : {}),
            client_message_id: queuedMessage.clientMessageId,
            encrypted_upload_intent_ids: encryptedAttachments
              .map((attachment) => attachment.upload_intent_id)
              .filter(Boolean),
          };

          const response = await sendMessengerMessage(sendPayload);
          const messageResult = response.data?.result || response.data;
          const sentMessage = messageResult?.message
            ? await decryptMessageForUser(messageResult.message, user)
            : null;
          const isActiveConversation =
            isQueuedMessageForActiveConversation(queuedMessage);

          if (sentMessage && isActiveConversation) {
            setRoomMessages((currentMessages) =>
              upsertMessage(currentMessages, sentMessage),
            );
          }
          if (sentMessage) {
            queuedMessage.releaseOptimisticPreviews();
          }

          if (messageResult?.room || sentMessage) {
            onRoomMessage(messageResult?.room, sentMessage, {
              selectRoom: isActiveConversation,
            });
          }
        } catch (error) {
          if (isQueuedMessageForActiveConversation(queuedMessage)) {
            setRoomMessages((currentMessages) =>
              currentMessages.filter(
                (message) =>
                  message.client_message_id !== queuedMessage.clientMessageId,
              ),
            );
            setMessageDraft((currentDraft) =>
              currentDraft || queuedMessage.text,
            );
            setReplyTarget((currentReplyTarget) =>
              currentReplyTarget || queuedMessage.replyTargetSnapshot,
            );
            setSelectedFiles((currentFiles) =>
              currentFiles.length > 0
                ? currentFiles
                : queuedMessage.filesToSend,
            );
            setRoomMessage(
              error?.response
                ? getMessengerErrorMessage(error, "Unable to send message.")
                : error?.message || "Unable to send message.",
            );
          }
          queuedMessage.releaseOptimisticPreviews();
        } finally {
          if (sendQueueRef.current[0] === queuedMessage) {
            sendQueueRef.current.shift();
          } else {
            sendQueueRef.current = sendQueueRef.current.filter(
              (currentQueuedMessage) => currentQueuedMessage !== queuedMessage,
            );
          }
        }
      }
    } finally {
      isProcessingSendQueueRef.current = false;
      setIsSendingMessage(false);
      globalThis.requestAnimationFrame(focusMessageDraftUnlessTextEntryIsActive);
    }
  }, [
    focusMessageDraftUnlessTextEntryIsActive,
    isQueuedMessageForActiveConversation,
    onRoomMessage,
    user,
  ]);

  const queueOutgoingMessage = useCallback(
    ({ filesToSend = [], replyTargetSnapshot = null, text = "" }) => {
      const normalizedText = String(text || "").trim();
      const safeFilesToSend = Array.isArray(filesToSend) ? filesToSend : [];

      if (
        (!normalizedText && safeFilesToSend.length === 0) ||
        !selectedPeerAccountNumber
      ) {
        return false;
      }

      const replyTargetId = replyTargetSnapshot?.id;
      const clientMessageId = createMessengerClientMessageId();
      optimisticMessageSequenceRef.current =
        (optimisticMessageSequenceRef.current + 1) % 1000;
      const optimisticMessageId = -(
        Date.now() * 1000 +
        optimisticMessageSequenceRef.current
      );
      const optimisticAttachments =
        safeFilesToSend.length > 0
          ? createOptimisticAttachmentPreviews(safeFilesToSend)
          : [];
      const optimisticMessage = {
        id: optimisticMessageId,
        room_id: selectedRoom?.id || null,
        reply_to_message_id: replyTargetId || null,
        reply_to: replyTargetSnapshot || null,
        sender_user_id: currentUserId,
        recipient_user_id: null,
        text: "",
        decrypted_text: normalizedText,
        decrypted_attachments: optimisticAttachments,
        decryption_status: "ok",
        is_encrypted: true,
        client_message_id: clientMessageId,
        status: "sending",
        attachments: [],
        reactions: [],
        my_reaction: null,
        created_at: new Date().toISOString(),
        is_pending: true,
      };
      let didReleaseOptimisticAttachments = false;
      const releaseOptimisticPreviews = () => {
        if (didReleaseOptimisticAttachments) {
          return;
        }

        didReleaseOptimisticAttachments = true;
        releaseOptimisticAttachmentPreviews(optimisticAttachments);
      };

      setRoomMessage("");
      sendTypingStopped();
      setRoomMessages((currentMessages) =>
        upsertMessage(currentMessages, optimisticMessage),
      );
      setMessageDraft("");
      setReplyTarget(null);
      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      focusMessageDraft();

      sendQueueRef.current.push({
        clientMessageId,
        filesToSend: safeFilesToSend,
        recipientAccountNumber: selectedPeerAccountNumber,
        releaseOptimisticPreviews,
        replyTargetId,
        replyTargetSnapshot,
        text: normalizedText,
      });
      void processSendQueue();
      return true;
    },
    [
      currentUserId,
      focusMessageDraft,
      processSendQueue,
      selectedPeerAccountNumber,
      selectedRoom?.id,
      sendTypingStopped,
    ],
  );

  const handleSendVoiceRecording = useCallback(async () => {
    try {
      const recording = await finishVoiceRecording();

      if (!recording?.blob) {
        return;
      }

      const waveform = await createVoiceNoteWaveform(recording.blob);
      const extension = getVoiceNoteFileExtension(recording.mimeType);
      const file = new File(
        [recording.blob],
        `voice-note-${Date.now()}.${extension}`,
        {
          type: recording.mimeType || recording.blob.type || "audio/webm",
        },
      );
      const voiceNoteFile = {
        id: createSelectedFileId(file),
        attachmentKind: VOICE_NOTE_ATTACHMENT_KIND,
        durationSeconds: recording.durationSeconds,
        file,
        fileType: "audio",
        waveform,
      };

      queueOutgoingMessage({
        filesToSend: [voiceNoteFile],
        replyTargetSnapshot: replyTarget,
        text: "",
      });
    } catch (error) {
      setRoomMessage(error?.message || "Unable to send voice note.");
      resetVoiceRecordingState();
    }
  }, [
    finishVoiceRecording,
    queueOutgoingMessage,
    replyTarget,
    resetVoiceRecordingState,
  ]);

  useEffect(() => {
    if (
      voiceRecording.status === "recording" &&
      voiceRecording.durationSeconds >= VOICE_NOTE_MAX_DURATION_SECONDS
    ) {
      void handleSendVoiceRecording();
    }
  }, [
    handleSendVoiceRecording,
    voiceRecording.durationSeconds,
    voiceRecording.status,
  ]);

  const handleSendMessage = (event) => {
    event?.preventDefault();

    queueOutgoingMessage({
      filesToSend: selectedFiles,
      replyTargetSnapshot: replyTarget,
      text: messageDraft,
    });
  };

  const handleMessageDraftChange = (event) => {
    const nextMessageDraft = event.target.value;
    setMessageDraft(nextMessageDraft);

    if (nextMessageDraft.trim()) {
      sendTypingStarted();
    } else {
      sendTypingStopped();
    }
  };

  const handleMessageDraftKeyDown = (event) => {
    if (isVoiceRecording) {
      return;
    }

    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent?.isComposing) {
      return;
    }

    handleSendMessage(event);
  };

  const hasComposedMessage = Boolean(
    messageDraft.trim() || selectedFiles.length > 0,
  );

  if (!hasActiveConversation) {
    return (
      <div className="parent-layout-page__room-placeholder parent-layout-page__room-placeholder--chat">
        <MessageCircle size={32} aria-hidden="true" />
        <div className="parent-layout-page__room-placeholder-copy">
          <h3>Private contact chat</h3>
          <p>
            Message saved contacts, see live delivery updates, and keep control
            with block, unblock, and contact-saving tools.
          </p>
        </div>
        <ul className="parent-layout-page__room-feature-list" aria-label="Chat features">
          <li>Real-time conversations</li>
          <li>Sent, delivered, and read status</li>
          <li>Saved-contact and block controls</li>
        </ul>
      </div>
    );
  }

  return (
    <section className="parent-layout-page__conversation">
      {roomMessage ? (
        <p className="parent-layout-page__conversation-message" role="alert">
          {roomMessage}
        </p>
      ) : null}

      <div
        className="parent-layout-page__messages"
        ref={messagesListRef}
        onScroll={handleMessagesScroll}
        aria-live="polite"
      >
        {isRoomMessagesLoading ? (
          <div className="parent-layout-page__messages-loading">
            <span />
            <span />
            <span />
          </div>
        ) : roomMessages.length === 0 ? (
          <div className="parent-layout-page__messages-empty">
            <MessageCircle size={30} aria-hidden="true" />
            <p>No messages yet.</p>
          </div>
        ) : (
          <>
            {isOlderMessagesLoading ? (
              <div
                className="parent-layout-page__messages-pagination"
                role="status"
                aria-live="polite"
              >
                <LoaderCircle size={16} aria-hidden="true" />
                <span>Loading more messages...</span>
              </div>
            ) : null}

            {groupedMessages.map(
              ({ dateLabel, message, shouldShowDateDivider }) => {
            const isMine = Number(message.sender_user_id) === currentUserId;
            const messageStatus = getMessageStatusLabel(message.status);
            const sentWhileBlocked = Boolean(message.sent_while_blocked);
            const replyPreview = getReplyPreview(message);
            const replyPreviewClassName = replyPreview
              ? `parent-layout-page__message-reply-preview ${
                  Number(replyPreview.sender_user_id) === currentUserId
                    ? "is-replying-to-mine"
                    : "is-replying-to-theirs"
                }`
              : "parent-layout-page__message-reply-preview";
            const isReplyDragging = replyDrag.messageId === message.id;
            const hasMessageReactions =
              normalizeReactionGroups(message.reactions, message.my_reaction)
                .length > 0;
            const isReactionPickerOpen =
              Number(reactionPickerMessageId) === Number(message.id);
            const areMessageActionsOpen =
              isReactionPickerOpen ||
              Number(activeMessageActionsId) === Number(message.id);
            const messageText = getRenderableMessageText(message);
            const messageAttachments = getMessageAttachments(message);
            const attachmentCountClass =
              messageAttachments.length > 0
                ? ` has-attachments is-attachment-count-${Math.min(
                    messageAttachments.length,
                    4,
                  )}`
                : "";
            const hasInlineMediaAttachment =
              messageAttachments.length === 1 &&
              !isVoiceNoteAttachment(messageAttachments[0]) &&
              ["audio", "video"].includes(
                getAttachmentKind(messageAttachments[0]),
              );
            const bubbleClassName = `parent-layout-page__message-bubble${attachmentCountClass}${
              hasInlineMediaAttachment ? " has-inline-media" : ""
            }`;
            const messageStyle = isReplyDragging
              ? { "--message-reply-drag-x": `${replyDrag.offsetX}px` }
              : undefined;

            return (
              <Fragment key={message.id}>
                {shouldShowDateDivider ? (
                  <div className="parent-layout-page__message-date-divider">
                    <span>{dateLabel}</span>
                  </div>
                ) : null}
                <article
                  className={`parent-layout-page__message${
                    isMine ? " is-mine" : " is-theirs"
                  }${isReplyDragging ? " is-reply-dragging" : ""}${
                    hasMessageReactions ? " has-reactions" : ""
                  }${
                    isReactionPickerOpen ? " is-reaction-picker-open" : ""
                  }${areMessageActionsOpen ? " is-actions-open" : ""}`}
                  data-message-id={message.id}
                  style={messageStyle}
                  onPointerDown={(event) =>
                    handleReplyDragStart(event, message)
                  }
                  onPointerMove={handleReplyDragMove}
                  onPointerUp={handleReplyDragEnd}
                  onPointerCancel={handleReplyDragEnd}
                  onMouseLeave={() => handleMessageMouseLeave(message)}
                  onContextMenu={(event) => {
                    if (areMessageActionsOpen) {
                      event.preventDefault();
                    }
                  }}
                >
                  <div
                    className={bubbleClassName}
                    onMouseEnter={() => handleMessageBubbleMouseEnter(message)}
                    onClick={(event) => handleMessageBubbleClick(event, message)}
                  >
                    {replyPreview ? (
                      <button
                        type="button"
                        className={replyPreviewClassName}
                        onClick={() => handleScrollToReplyTarget(replyPreview.id)}
                        disabled={isReplyTargetLoading}
                        aria-label="Show replied message"
                        title="Show replied message"
                      >
                        <span>
                          {getReplyAuthorLabel(
                            replyPreview,
                            currentUserId,
                            participantNamesByUserId,
                          )}
                        </span>
                        <p>{getMessagePreviewText(replyPreview)}</p>
                      </button>
                    ) : message.reply_to_message_id ? (
                      <div className="parent-layout-page__message-reply-preview is-unavailable">
                        <span>Original message</span>
                        <p>Message unavailable</p>
                      </div>
                    ) : null}

                    {messageAttachments.length > 0 ? (
                      <MessageAttachments
                        attachments={messageAttachments}
                        onOpen={handleOpenAttachmentViewer}
                      />
                    ) : null}

                    {messageText ? (
                      <p className="parent-layout-page__message-text">
                        {messageText}
                      </p>
                    ) : null}

                    <footer>
                      <time dateTime={message.created_at}>
                        {formatRoomTime(message.created_at)}
                      </time>
                      {sentWhileBlocked ? (
                        <span
                          className="parent-layout-page__message-blocked-marker"
                          aria-label="Sent while blocked"
                          title="Sent while blocked"
                        >
                          <Ban size={13} aria-hidden="true" />
                        </span>
                      ) : null}
                      {isMine ? (
                        <span
                          className={`parent-layout-page__message-status is-${
                            message.status || "sent"
                          }`}
                          aria-label={messageStatus}
                          title={messageStatus}
                        >
                          {message.status === "read" ||
                          message.status === "delivered" ? (
                            <CheckCheck size={14} aria-hidden="true" />
                          ) : (
                            <Check size={14} aria-hidden="true" />
                          )}
                        </span>
                      ) : null}
                    </footer>
                    <MessageReactionSummary
                      message={message}
                      onSelect={handleSelectMessageReaction}
                    />
                  </div>
                  <div
                    className="parent-layout-page__message-actions"
                    data-reaction-picker-root="true"
                  >
                    <button
                      type="button"
                      className="parent-layout-page__message-reply-action"
                      onClick={() => handleSelectReplyTarget(message)}
                      aria-label="Reply to message"
                      title="Reply"
                    >
                      <Reply size={15} aria-hidden="true" />
                    </button>
                    <MessageReactionPicker
                      message={message}
                      onSelect={handleSelectMessageReaction}
                    />
                  </div>
                </article>
              </Fragment>
            );
              },
            )}
          </>
        )}
        <div
          className="parent-layout-page__messages-end"
          ref={messagesEndRef}
          aria-hidden="true"
        />
      </div>

      {typingIndicatorText ? (
        <div
          className="parent-layout-page__typing-indicator"
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <p>{typingIndicatorText}</p>
        </div>
      ) : null}

      <form
        className={`parent-layout-page__message-form${
          isVoiceRecording ? " is-recording" : ""
        }`}
        onSubmit={handleSendMessage}
      >
        {replyTarget ? (
          <div
            className={`parent-layout-page__message-reply-composer ${
              Number(replyTarget.sender_user_id) === currentUserId
                ? "is-replying-to-mine"
                : "is-replying-to-theirs"
            }`}
          >
            <div>
              <span>
                {getReplyAuthorLabel(
                  replyTarget,
                  currentUserId,
                  participantNamesByUserId,
                )}
              </span>
              <p>{getMessagePreviewText(replyTarget)}</p>
            </div>
            <button
              type="button"
              onClick={handleClearReplyTarget}
              aria-label="Cancel reply"
              title="Cancel reply"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {selectedFiles.length > 0 && !isVoiceRecording ? (
          <div className="parent-layout-page__message-file-list">
            {selectedFiles.map((selectedFile) => (
              <span
                className={`parent-layout-page__message-file-chip${
                  isVoiceNoteSelectedFile(selectedFile) ? " is-voice-note" : ""
                }`}
                key={selectedFile.id}
              >
                <AttachmentIcon fileType={selectedFile.fileType} />
                <span>
                  {isVoiceNoteSelectedFile(selectedFile)
                    ? `Voice note ${formatMediaTime(
                        selectedFile.durationSeconds,
                      )}`
                    : selectedFile.file.name}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveSelectedFile(selectedFile.id)}
                  aria-label={`Remove ${selectedFile.file.name}`}
                  title="Remove file"
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {isVoiceRecording ? (
          <>
            <button
              type="button"
              className="parent-layout-page__message-attach is-recording-cancel"
              onClick={handleCancelVoiceRecording}
              aria-label="Cancel voice note"
              title="Cancel"
              disabled={isVoiceRecordingFinishing}
            >
              <X size={18} aria-hidden="true" />
            </button>
            <div
              className="parent-layout-page__voice-recording"
              role="status"
              aria-live="polite"
            >
              <span
                className="parent-layout-page__voice-recording-dot"
                aria-hidden="true"
              />
              <div className="parent-layout-page__voice-recording-wave">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
              <span className="parent-layout-page__voice-recording-time">
                {formatMediaTime(voiceRecording.durationSeconds)}
              </span>
            </div>
            <button
              type="button"
              className="parent-layout-page__message-submit is-recording-send"
              onClick={handleSendVoiceRecording}
              disabled={isVoiceRecordingFinishing}
              aria-label="Send voice note"
              title="Send voice note"
            >
              {isVoiceRecordingFinishing ? (
                <LoaderCircle size={19} aria-hidden="true" />
              ) : (
                <Send size={20} aria-hidden="true" />
              )}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="parent-layout-page__message-attach"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach files"
              title="Attach files"
            >
              <Paperclip size={18} aria-hidden="true" />
            </button>
            <input
              ref={fileInputRef}
              className="parent-layout-page__message-file-input"
              type="file"
              multiple
              onChange={handleFileInputChange}
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.md,.json"
            />
            <textarea
              ref={messageDraftRef}
              value={messageDraft}
              onChange={handleMessageDraftChange}
              onKeyDown={handleMessageDraftKeyDown}
              placeholder="Message"
              maxLength={5000}
              rows={1}
            />
            <button
              type="button"
              className="parent-layout-page__message-voice"
              onClick={handleStartVoiceRecording}
              disabled={hasComposedMessage}
              aria-label="Record voice note"
              title={
                hasComposedMessage
                  ? "Clear message to record voice note"
                  : "Record voice note"
              }
            >
              <Mic size={19} aria-hidden="true" />
            </button>
            <button
              type="submit"
              className="parent-layout-page__message-submit"
              disabled={!hasComposedMessage}
              aria-label={
                isSendingMessage ? "Queue message" : "Send message"
              }
              title="Send"
            >
              <Send size={20} aria-hidden="true" />
            </button>
          </>
        )}
      </form>
      {attachmentViewer.attachments.length > 0 ? (
        <AttachmentViewerModal
          attachments={attachmentViewer.attachments}
          initialPlayback={attachmentViewer.playback}
          selectedAttachmentId={attachmentViewer.selectedAttachmentId}
          onClose={handleCloseAttachmentViewer}
          onDownload={handleDownloadAttachment}
          onNavigate={handleNavigateAttachment}
          onOpen={handleOpenAttachment}
        />
      ) : null}
    </section>
  );
}

export default MessengerConversation;
