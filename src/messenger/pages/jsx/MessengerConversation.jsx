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
  Music,
  MessageCircle,
  Paperclip,
  Reply,
  Send,
  Trash2,
  Video,
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
  sendMessengerMessage,
} from "../../api.js";
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
const ATTACHMENT_TABS = [
  { id: "all", label: "All" },
  { id: "images", label: "Images" },
  { id: "pdfs", label: "PDF" },
  { id: "other", label: "Other" },
];

function isTextEntryElement(element) {
  if (!element) {
    return false;
  }

  if (element.isContentEditable) {
    return true;
  }

  return ["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName);
}

function getMessagePreviewText(message) {
  const text = String(message?.text || "").trim();

  if (text) {
    return text;
  }

  const attachmentCount = Array.isArray(message?.attachments)
    ? message.attachments.length
    : Number(message?.attachment_count || 0);

  return attachmentCount > 0 ? "Attachment" : "Message";
}

function createSelectedFileId(file) {
  return [
    file.name,
    file.size,
    file.lastModified,
    Math.random().toString(36).slice(2),
  ].join("-");
}

function getAttachmentLabel(attachment) {
  return attachment?.file_name || attachment?.file_type || "File";
}

function getAttachmentDownloadName(attachment) {
  return getAttachmentLabel(attachment).replace(/[\\/:*?"<>|]+/g, "_");
}

function createOptimisticAttachment(selectedFile, index) {
  const { file, fileType } = selectedFile;
  const objectUrl = URL.createObjectURL(file);

  return {
    id: `pending-attachment-${selectedFile.id}`,
    file_type: fileType,
    file_url: objectUrl,
    file_name: file.name,
    mime_type: file.type,
    file_size_bytes: file.size,
    sort_order: index,
    is_pending: true,
    object_url: objectUrl,
  };
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

function getAttachmentTabId(attachment) {
  const kind = getAttachmentKind(attachment);

  if (kind === "image") {
    return "images";
  }

  if (kind === "pdf") {
    return "pdfs";
  }

  return "other";
}

function getAttachmentTabCounts(attachments) {
  return (attachments || []).reduce(
    (counts, attachment) => {
      counts.all += 1;
      counts[getAttachmentTabId(attachment)] += 1;
      return counts;
    },
    {
      all: 0,
      images: 0,
      pdfs: 0,
      other: 0,
    },
  );
}

function getVisibleAttachmentTabs(tabCounts) {
  const populatedTabs = ATTACHMENT_TABS.filter(
    (tab) => tab.id !== "all" && tabCounts[tab.id] > 0,
  );

  if (populatedTabs.length <= 1) {
    return populatedTabs;
  }

  return ATTACHMENT_TABS.filter(
    (tab) => tab.id === "all" || tabCounts[tab.id] > 0,
  );
}

function getAttachmentsForTab(attachments, activeTab) {
  if (activeTab === "all") {
    return attachments || [];
  }

  return (attachments || []).filter(
    (attachment) => getAttachmentTabId(attachment) === activeTab,
  );
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
  if (!attachment?.file_url) {
    return;
  }

  try {
    const response = await getCachedMediaResponse(attachment.file_url);
    if (!response) {
      throw new Error("Media cache unavailable.");
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");
    downloadLink.href = objectUrl;
    downloadLink.download = getAttachmentDownloadName(attachment);
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
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
  if (!attachment?.file_url) {
    return;
  }

  const openedWindow = globalThis.open?.("about:blank", "_blank");

  if (openedWindow) {
    openedWindow.opener = null;
  }

  try {
    const response = await getCachedMediaResponse(attachment.file_url);
    if (!response) {
      throw new Error("Media cache unavailable.");
    }

    const blob = await response.blob();
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
  } catch {
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
  const [cachedMedia, setCachedMedia] = useState({
    sourceUrl: "",
    objectUrl: "",
  });

  useEffect(() => {
    let objectUrl = "";
    let isMounted = true;
    setCachedMedia({
      sourceUrl: fileUrl,
      objectUrl: "",
    });

    async function loadCachedMedia() {
      if (!fileUrl || !("caches" in globalThis)) {
        return;
      }

      const cache = await globalThis.caches.open(MEDIA_CACHE_NAME);
      const cachedResponse = await cache.match(fileUrl);

      if (!cachedResponse || !isMounted) {
        return;
      }

      const blob = await cachedResponse.blob();
      objectUrl = URL.createObjectURL(blob);
      setCachedMedia({
        sourceUrl: fileUrl,
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
  }, [fileUrl]);

  return cachedMedia.sourceUrl === fileUrl && cachedMedia.objectUrl
    ? cachedMedia.objectUrl
    : fileUrl;
}

function AttachmentPreviewTile({ attachment, index, overflowCount, onOpen }) {
  const previewUrl = useCachedMediaUrl(attachment);
  const label = getAttachmentLabel(attachment);
  const kind = getAttachmentKind(attachment);
  const shouldShowMediaPreview = kind === "image" || kind === "video";

  return (
    <button
      type="button"
      className={`parent-layout-page__message-attachment-tile is-${kind}`}
      onClick={() => onOpen(attachment)}
      aria-label={`Open ${label}`}
    >
      {kind === "image" ? <img src={previewUrl} alt={label} /> : null}
      {kind === "video" ? (
        <video src={previewUrl} muted playsInline preload="metadata" />
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

function CachedVideo({ attachment, className }) {
  const sourceUrl = useCachedMediaUrl(attachment);

  return (
    <video
      controls
      src={sourceUrl}
      className={className || "parent-layout-page__message-attachment-player"}
    >
      <a href={attachment.file_url}>{getAttachmentLabel(attachment)}</a>
    </video>
  );
}

function CachedAudio({ attachment, className }) {
  const sourceUrl = useCachedMediaUrl(attachment);

  return (
    <audio
      controls
      src={sourceUrl}
      className={className || "parent-layout-page__message-attachment-audio"}
    >
      <a href={attachment.file_url}>{getAttachmentLabel(attachment)}</a>
    </audio>
  );
}

function MessageAttachments({ attachments, onOpen }) {
  const visibleAttachments = attachments.slice(0, ATTACHMENT_PREVIEW_LIMIT);
  const hiddenAttachmentCount = Math.max(
    attachments.length - ATTACHMENT_PREVIEW_LIMIT,
    0,
  );

  return (
    <div className="parent-layout-page__message-attachments">
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
            key={attachment.id || attachment.file_url}
            overflowCount={hiddenAttachmentCount}
            onOpen={() => onOpen(attachments, attachment)}
          />
        ))}
      </div>

      <button
        type="button"
        className="parent-layout-page__message-attachment-summary"
        onClick={() => onOpen(attachments)}
      >
        <Paperclip size={14} aria-hidden="true" />
        <span>{getAttachmentSummary(attachments)}</span>
      </button>
    </div>
  );
}

function AttachmentListItem({
  attachment,
  onDownload,
  onOpen,
  onPreviewImage,
}) {
  const previewUrl = useCachedMediaUrl(attachment);
  const label = getAttachmentLabel(attachment);
  const kind = getAttachmentKind(attachment);
  const isImage = kind === "image";

  return (
    <article className={`parent-layout-page__attachment-row is-${kind}`}>
      <button
        type="button"
        className="parent-layout-page__attachment-row-preview"
        onClick={() =>
          isImage ? onPreviewImage(attachment) : onOpen(attachment)
        }
        aria-label={`${isImage ? "View" : "Open"} ${label}`}
      >
        {isImage ? <img src={previewUrl} alt={label} /> : null}
        {kind === "video" ? (
          <video src={previewUrl} muted playsInline preload="metadata" />
        ) : null}
        {kind !== "image" && kind !== "video" ? (
          <AttachmentIcon fileType={kind} size={17} />
        ) : null}
      </button>

      <div className="parent-layout-page__attachment-row-meta">
        <strong>{label}</strong>
        <span>{getAttachmentKindLabel(kind, 1)}</span>
      </div>

      <div className="parent-layout-page__attachment-row-actions">
        <button
          type="button"
          className="parent-layout-page__attachment-open"
          onClick={() =>
            isImage ? onPreviewImage(attachment) : onOpen(attachment)
          }
        >
          <ExternalLink size={15} aria-hidden="true" />
          <span>{isImage ? "View" : "Open"}</span>
        </button>
        <button
          type="button"
          className="parent-layout-page__attachment-download"
          onClick={() => onDownload(attachment)}
          aria-label={`Download ${label}`}
          title="Download to device"
        >
          <Download size={16} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function AttachmentImageViewer({
  images,
  selectedAttachmentId,
  onDownload,
  onNavigate,
  onOpen,
  onSelectImage,
}) {
  const wheelLockRef = useRef(false);
  const selectedIndex = Math.max(
    images.findIndex(
      (attachment) => getAttachmentKey(attachment) === selectedAttachmentId,
    ),
    0,
  );
  const selectedImage = images[selectedIndex];
  const imageUrl = useCachedMediaUrl(selectedImage);
  const label = getAttachmentLabel(selectedImage);
  const hasManyImages = images.length > 1;

  if (!selectedImage) {
    return <p>No images in this message.</p>;
  }

  const handleWheel = (event) => {
    if (!hasManyImages || wheelLockRef.current) {
      return;
    }

    const scrollDelta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;

    if (Math.abs(scrollDelta) < 24) {
      return;
    }

    wheelLockRef.current = true;
    onNavigate(scrollDelta > 0 ? 1 : -1);
    globalThis.setTimeout(() => {
      wheelLockRef.current = false;
    }, 420);
  };

  return (
    <div className="parent-layout-page__attachment-image-viewer">
      <div
        className="parent-layout-page__attachment-image-stage"
        onWheel={handleWheel}
      >
        {hasManyImages ? (
          <button
            type="button"
            className="parent-layout-page__attachment-image-nav is-prev"
            onClick={() => onNavigate(-1)}
            aria-label="Previous image"
          >
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
        ) : null}
        <img key={getAttachmentKey(selectedImage)} src={imageUrl} alt={label} />
        {hasManyImages ? (
          <button
            type="button"
            className="parent-layout-page__attachment-image-nav is-next"
            onClick={() => onNavigate(1)}
            aria-label="Next image"
          >
            <ChevronRight size={22} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="parent-layout-page__attachment-image-footer">
        <div>
          <strong>{label}</strong>
          <span>
            {selectedIndex + 1} of {images.length}
          </span>
        </div>
        <button
          type="button"
          className="parent-layout-page__attachment-open"
          onClick={() => onOpen(selectedImage)}
        >
          <ExternalLink size={15} aria-hidden="true" />
          <span>Open</span>
        </button>
        <button
          type="button"
          className="parent-layout-page__attachment-download"
          onClick={() => onDownload(selectedImage)}
          aria-label={`Download ${label}`}
          title="Download to device"
        >
          <Download size={16} aria-hidden="true" />
        </button>
      </div>

      {hasManyImages ? (
        <div className="parent-layout-page__attachment-image-thumbs">
          {images.map((attachment, index) => (
            <button
              type="button"
              className={
                index === selectedIndex ? "is-active" : ""
              }
              key={getAttachmentKey(attachment)}
              onClick={() => onSelectImage(attachment)}
              aria-label={`View image ${index + 1}`}
            >
              <AttachmentThumbImage attachment={attachment} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AttachmentThumbImage({ attachment }) {
  const imageUrl = useCachedMediaUrl(attachment);

  return <img src={imageUrl} alt="" />;
}

function AttachmentViewerModal({
  attachments,
  activeTab,
  selectedAttachmentId,
  onChangeTab,
  onClose,
  onOpen,
  onDownload,
  onNavigateImage,
  onSelectAttachment,
}) {
  const tabCounts = getAttachmentTabCounts(attachments);
  const visibleTabs = getVisibleAttachmentTabs(tabCounts);
  const currentActiveTab = visibleTabs.some((tab) => tab.id === activeTab)
    ? activeTab
    : visibleTabs[0]?.id || "all";
  const visibleAttachments = getAttachmentsForTab(
    attachments,
    currentActiveTab,
  );
  const imageAttachments = getAttachmentsForTab(attachments, "images");

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      } else if (currentActiveTab === "images" && event.key === "ArrowLeft") {
        onNavigateImage(-1);
      } else if (currentActiveTab === "images" && event.key === "ArrowRight") {
        onNavigateImage(1);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [currentActiveTab, onClose, onNavigateImage]);

  if (!attachments.length) {
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
      <div
        className={`parent-layout-page__attachment-viewer-surface${
          visibleTabs.length <= 1 ? " has-single-tab" : ""
        }`}
      >
        <header>
          <div>
            <strong>Attachments</strong>
            <span>{getAttachmentSummary(attachments)}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close attachments"
            title="Close"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        {visibleTabs.length > 1 ? (
          <div className="parent-layout-page__attachment-tabs" role="tablist">
            {visibleTabs.map((tab) => (
              <button
                type="button"
                role="tab"
                aria-selected={currentActiveTab === tab.id}
                className={currentActiveTab === tab.id ? "is-active" : ""}
                key={tab.id}
                onClick={() => onChangeTab(tab.id)}
              >
                <span>{tab.label}</span>
                <span>{tabCounts[tab.id]}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="parent-layout-page__attachment-viewer-content">
          {currentActiveTab === "images" ? (
            <AttachmentImageViewer
              images={imageAttachments}
              selectedAttachmentId={selectedAttachmentId}
              onDownload={onDownload}
              onNavigate={onNavigateImage}
              onOpen={onOpen}
              onSelectImage={onSelectAttachment}
            />
          ) : visibleAttachments.length > 0 ? (
            <div className="parent-layout-page__attachment-list">
              {visibleAttachments.map((attachment) => (
                <AttachmentListItem
                  attachment={attachment}
                  key={getAttachmentKey(attachment)}
                  onDownload={onDownload}
                  onOpen={onOpen}
                  onPreviewImage={(imageAttachment) => {
                    onSelectAttachment(imageAttachment);
                    onChangeTab("images");
                  }}
                />
              ))}
            </div>
          ) : (
            <p>No attachments in this tab.</p>
          )}
        </div>
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

  [...pageMessages, ...currentMessages].forEach((message) => {
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

function MessengerConversation({
  selectedContact,
  selectedRoom,
  user,
  releasedMessagesVersion,
  onRoomMessage,
  onRoomRead,
}) {
  const [roomMessages, setRoomMessages] = useState([]);
  const [roomMessage, setRoomMessage] = useState("");
  const [isRoomMessagesLoading, setIsRoomMessagesLoading] = useState(false);
  const [isOlderMessagesLoading, setIsOlderMessagesLoading] = useState(false);
  const [messagePagination, setMessagePagination] = useState({
    hasMore: false,
    nextBeforeMessageId: null,
  });
  const [messageDraft, setMessageDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [pendingReplyScrollId, setPendingReplyScrollId] = useState(null);
  const [isReplyTargetLoading, setIsReplyTargetLoading] = useState(false);
  const [replyDrag, setReplyDrag] = useState({
    messageId: null,
    offsetX: 0,
  });
  const [attachmentViewer, setAttachmentViewer] = useState({
    attachments: [],
    activeTab: "all",
    selectedAttachmentId: "",
  });
  const [typingUserIds, setTypingUserIds] = useState([]);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const roomSocketRef = useRef(null);
  const messagesListRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageDraftRef = useRef(null);
  const fileInputRef = useRef(null);
  const isSendingMessageRef = useRef(false);
  const olderMessagesScrollRef = useRef(null);
  const skipNextAutoScrollRef = useRef(false);
  const isOlderMessagesLoadingRef = useRef(false);
  const replyDragStateRef = useRef(null);
  const typingStopTimeoutRef = useRef(null);
  const typingRemoteTimeoutsRef = useRef(new Map());
  const isTypingSentRef = useRef(false);
  const lastTypingStartedAtRef = useRef(0);

  const focusMessageDraft = useCallback(() => {
    const textarea = messageDraftRef.current;

    if (!textarea) {
      return;
    }

    textarea.focus({ preventScroll: true });
    const cursorPosition = textarea.value.length;
    textarea.setSelectionRange(cursorPosition, cursorPosition);
  }, []);

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
        setMessagePagination({
          hasMore: false,
          nextBeforeMessageId: null,
        });
        setRoomMessage("");
        return {
          messages: [],
          pagination: {
            hasMore: false,
            nextBeforeMessageId: null,
          },
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
        const pagination = messagesResult?.pagination || {};
        const nextPagination = {
          hasMore: Boolean(pagination.has_more),
          nextBeforeMessageId: pagination.next_before_message_id || null,
        };

        setRoomMessages((currentMessages) =>
          mode === "prepend"
            ? mergeMessagePage(currentMessages, nextMessages)
            : nextMessages,
        );
        setMessagePagination(nextPagination);

        if (markRead) {
          markRoomReadForMessages(roomId, nextMessages).catch(() => {});
        }

        return {
          messages: nextMessages,
          pagination: nextPagination,
        };
      } catch (error) {
        if (mode !== "prepend") {
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
    [markRoomReadForMessages],
  );

  useEffect(() => {
    sendTypingStopped();
    clearRemoteTypingUsers();
    setMessageDraft("");
    setReplyTarget(null);
    setSelectedFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setPendingReplyScrollId(null);
    setRoomMessage("");
    setMessagePagination({
      hasMore: false,
      nextBeforeMessageId: null,
    });

    if (!selectedRoom?.id) {
      setRoomMessages([]);
      setIsRoomMessagesLoading(false);
      return;
    }

    loadRoomMessages(selectedRoom.id);
  }, [
    clearRemoteTypingUsers,
    loadRoomMessages,
    releasedMessagesVersion,
    selectedPeerAccountNumber,
    selectedRoom?.id,
    sendTypingStopped,
  ]);

  useEffect(() => {
    if (!hasActiveConversation) {
      return undefined;
    }

    const focusFrame = globalThis.requestAnimationFrame(focusMessageDraft);

    return () => globalThis.cancelAnimationFrame(focusFrame);
  }, [focusMessageDraft, hasActiveConversation, selectedPeerAccountNumber]);

  useEffect(() => {
    if (!hasActiveConversation) {
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
  }, [focusMessageDraft, hasActiveConversation]);

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
    let socket = null;

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
        };

        socket.onmessage = (event) => {
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
            setRoomMessages((currentMessages) =>
              upsertMessage(currentMessages, eventPayload.message),
            );
            onRoomMessage(eventPayload.room, eventPayload.message, {
              selectRoom: true,
            });

            if (Number(eventPayload.message?.sender_user_id) !== currentUserId) {
              markMessengerRoomRead(roomId, {
                last_read_message_id: eventPayload.message.id,
              })
                .then(() => onRoomRead(roomId))
                .catch(() => {});
            }
            return;
          }

          if (
            (eventPayload.type === "message.read" ||
              eventPayload.type === "message.delivered") &&
            Number(eventPayload.room_id) === Number(roomId)
          ) {
            const status =
              eventPayload.type === "message.read" ? "read" : "delivered";
            const lastMessageId =
              eventPayload.last_read_message_id ||
              eventPayload.last_delivered_message_id;

            if (Number(eventPayload.user_id) !== currentUserId && lastMessageId) {
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
            }
          }
        };

        socket.onclose = (event) => {
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
    loadRoomMessages,
    onRoomMessage,
    onRoomRead,
    removeRemoteTypingUser,
    selectedRoom?.id,
    sendTypingStopped,
    setRemoteTypingUser,
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

      setReplyTarget(message);
      focusMessageDraft();
    },
    [focusMessageDraft],
  );

  const handleClearReplyTarget = useCallback(() => {
    setReplyTarget(null);
    focusMessageDraft();
  }, [focusMessageDraft]);

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
    downloadCachedAttachment(attachment);
  }, []);

  const handleOpenAttachment = useCallback((attachment) => {
    openCachedAttachment(attachment);
  }, []);

  const handleOpenAttachmentViewer = useCallback((attachments, attachment) => {
    const imageAttachments = getAttachmentsForTab(attachments, "images");
    const selectedAttachment =
      attachment ||
      (imageAttachments.length === 1 ? imageAttachments[0] : null);

    setAttachmentViewer({
      attachments,
      activeTab: attachment ? getAttachmentTabId(attachment) : "all",
      selectedAttachmentId: selectedAttachment
        ? getAttachmentKey(selectedAttachment)
        : "",
    });
  }, []);

  const handleCloseAttachmentViewer = useCallback(() => {
    setAttachmentViewer({
      attachments: [],
      activeTab: "all",
      selectedAttachmentId: "",
    });
  }, []);

  const handleChangeAttachmentTab = useCallback((activeTab) => {
    setAttachmentViewer((currentViewer) => ({
      ...currentViewer,
      activeTab,
      selectedAttachmentId:
        activeTab === "images" && !currentViewer.selectedAttachmentId
          ? getAttachmentKey(
              getAttachmentsForTab(currentViewer.attachments, "images")[0],
            )
          : currentViewer.selectedAttachmentId,
    }));
  }, []);

  const handleSelectAttachmentInViewer = useCallback((attachment) => {
    setAttachmentViewer((currentViewer) => ({
      ...currentViewer,
      selectedAttachmentId: getAttachmentKey(attachment),
    }));
  }, []);

  const handleNavigateAttachmentImage = useCallback((direction) => {
    setAttachmentViewer((currentViewer) => {
      const imageAttachments = getAttachmentsForTab(
        currentViewer.attachments,
        "images",
      );

      if (imageAttachments.length <= 1) {
        return currentViewer;
      }

      const currentIndex = Math.max(
        imageAttachments.findIndex(
          (attachment) =>
            getAttachmentKey(attachment) === currentViewer.selectedAttachmentId,
        ),
        0,
      );
      const nextIndex =
        (currentIndex + direction + imageAttachments.length) %
        imageAttachments.length;

      return {
        ...currentViewer,
        selectedAttachmentId: getAttachmentKey(imageAttachments[nextIndex]),
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

  const handleReplyDragStart = useCallback((event, message, isMine) => {
    if (
      event.button !== 0 ||
      event.target.closest("a, button, input, select, textarea")
    ) {
      return;
    }

    replyDragStateRef.current = {
      pointerId: event.pointerId,
      message,
      direction: isMine ? -1 : 1,
      startX: event.clientX,
      activated: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const handleReplyDragMove = useCallback((event) => {
    const dragState = replyDragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const directedDelta =
      (event.clientX - dragState.startX) * dragState.direction;
    const clampedDelta = Math.max(
      0,
      Math.min(directedDelta, MESSAGE_REPLY_DRAG_LIMIT),
    );

    if (clampedDelta <= 2) {
      setReplyDrag({ messageId: null, offsetX: 0 });
      return;
    }

    event.preventDefault();
    dragState.activated = clampedDelta >= MESSAGE_REPLY_DRAG_THRESHOLD;
    setReplyDrag({
      messageId: dragState.message.id,
      offsetX: clampedDelta * dragState.direction,
    });
  }, []);

  const handleReplyDragEnd = useCallback(
    (event) => {
      const dragState = replyDragStateRef.current;

      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      if (dragState.activated) {
        handleSelectReplyTarget(dragState.message);
      }

      replyDragStateRef.current = null;
      setReplyDrag({ messageId: null, offsetX: 0 });
    },
    [handleSelectReplyTarget],
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

  const handleSendMessage = async (event) => {
    event?.preventDefault();

    const text = messageDraft.trim();
    const filesToSend = selectedFiles.map((selectedFile) => selectedFile.file);

    if (
      (!text && filesToSend.length === 0) ||
      !selectedPeerAccountNumber ||
      isSendingMessage ||
      isSendingMessageRef.current
    ) {
      return;
    }

    const replyTargetId = replyTarget?.id;
    const clientMessageId = createMessengerClientMessageId();
    const optimisticAttachments = selectedFiles.map(createOptimisticAttachment);
    const optimisticMessage = {
      id: -Date.now(),
      room_id: selectedRoom?.id || null,
      reply_to_message_id: replyTargetId || null,
      reply_to: replyTarget || null,
      sender_user_id: currentUserId,
      recipient_user_id: null,
      text,
      client_message_id: clientMessageId,
      status: "sending",
      attachments: optimisticAttachments,
      created_at: new Date().toISOString(),
      is_pending: true,
    };

    isSendingMessageRef.current = true;
    setIsSendingMessage(true);
    setRoomMessage("");
    setRoomMessages((currentMessages) =>
      upsertMessage(currentMessages, optimisticMessage),
    );
    setMessageDraft("");
    setReplyTarget(null);
    setSelectedFiles([]);
    sendTypingStopped();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    focusMessageDraft();

    try {
      const sendPayload =
        filesToSend.length > 0
          ? new FormData()
          : {
              recipient_account_number: selectedPeerAccountNumber,
              text,
              ...(replyTargetId ? { reply_to_message_id: replyTargetId } : {}),
              client_message_id: clientMessageId,
            };

      if (sendPayload instanceof FormData) {
        sendPayload.append("recipient_account_number", selectedPeerAccountNumber);
        sendPayload.append("text", text);
        sendPayload.append("client_message_id", clientMessageId);
        if (replyTargetId) {
          sendPayload.append("reply_to_message_id", String(replyTargetId));
        }
        filesToSend.forEach((file) => {
          sendPayload.append("attachments", file);
        });
      }

      const response = await sendMessengerMessage(sendPayload);
      const messageResult = response.data?.result || response.data;

      if (messageResult?.message) {
        setRoomMessages((currentMessages) =>
          upsertMessage(currentMessages, messageResult.message),
        );
      }

      if (messageResult?.room || messageResult?.message) {
        onRoomMessage(messageResult?.room, messageResult?.message, {
          selectRoom: true,
        });
      }
    } catch (error) {
      setRoomMessages((currentMessages) =>
        currentMessages.filter(
          (message) => message.client_message_id !== clientMessageId,
        ),
      );
      setRoomMessage(getMessengerErrorMessage(error, "Unable to send message."));
    } finally {
      optimisticAttachments.forEach((attachment) => {
        if (attachment.object_url) {
          URL.revokeObjectURL(attachment.object_url);
        }
      });
      setIsSendingMessage(false);
      isSendingMessageRef.current = false;
      globalThis.requestAnimationFrame(focusMessageDraftUnlessTextEntryIsActive);
    }
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
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent?.isComposing) {
      return;
    }

    handleSendMessage(event);
  };

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
            const isReplyDragging = replyDrag.messageId === message.id;
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
                  }${isReplyDragging ? " is-reply-dragging" : ""}`}
                  data-message-id={message.id}
                  style={messageStyle}
                  onPointerDown={(event) =>
                    handleReplyDragStart(event, message, isMine)
                  }
                  onPointerMove={handleReplyDragMove}
                  onPointerUp={handleReplyDragEnd}
                  onPointerCancel={handleReplyDragEnd}
                >
                  <div className="parent-layout-page__message-bubble">
                    {replyPreview ? (
                      <button
                        type="button"
                        className="parent-layout-page__message-reply-preview"
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

                    {Array.isArray(message.attachments) &&
                    message.attachments.length > 0 ? (
                      <MessageAttachments
                        attachments={message.attachments}
                        onOpen={handleOpenAttachmentViewer}
                      />
                    ) : null}

                    {message.text ? (
                      <p className="parent-layout-page__message-text">
                        {message.text}
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
                          {message.status === "sending" ? (
                            <LoaderCircle size={13} aria-hidden="true" />
                          ) : message.status === "read" ||
                          message.status === "delivered" ? (
                            <CheckCheck size={14} aria-hidden="true" />
                          ) : (
                            <Check size={14} aria-hidden="true" />
                          )}
                        </span>
                      ) : null}
                    </footer>
                  </div>
                  <button
                    type="button"
                    className="parent-layout-page__message-reply-action"
                    onClick={() => handleSelectReplyTarget(message)}
                    aria-label="Reply to message"
                    title="Reply"
                  >
                    <Reply size={15} aria-hidden="true" />
                  </button>
                </article>
              </Fragment>
            );
              },
            )}
          </>
        )}
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
        <div
          className="parent-layout-page__messages-end"
          ref={messagesEndRef}
          aria-hidden="true"
        />
      </div>

      <form
        className="parent-layout-page__message-form"
        onSubmit={handleSendMessage}
      >
        {replyTarget ? (
          <div className="parent-layout-page__message-reply-composer">
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
        {selectedFiles.length > 0 ? (
          <div className="parent-layout-page__message-file-list">
            {selectedFiles.map((selectedFile) => (
              <span
                className="parent-layout-page__message-file-chip"
                key={selectedFile.id}
              >
                <AttachmentIcon fileType={selectedFile.fileType} />
                <span>{selectedFile.file.name}</span>
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
        <button
          type="button"
          className="parent-layout-page__message-attach"
          onClick={() => fileInputRef.current?.click()}
          disabled={isSendingMessage}
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
          type="submit"
          className="parent-layout-page__message-submit"
          disabled={
            (!messageDraft.trim() && selectedFiles.length === 0) ||
            isSendingMessage
          }
          aria-label={isSendingMessage ? "Sending message" : "Send message"}
          title="Send"
        >
          {isSendingMessage ? (
            <span
              className="parent-layout-page__send-buffer"
              aria-hidden="true"
            />
          ) : (
            <Send size={20} aria-hidden="true" />
          )}
        </button>
      </form>
      {attachmentViewer.attachments.length > 0 ? (
        <AttachmentViewerModal
          attachments={attachmentViewer.attachments}
          activeTab={attachmentViewer.activeTab}
          selectedAttachmentId={attachmentViewer.selectedAttachmentId}
          onChangeTab={handleChangeAttachmentTab}
          onClose={handleCloseAttachmentViewer}
          onDownload={handleDownloadAttachment}
          onNavigateImage={handleNavigateAttachmentImage}
          onOpen={handleOpenAttachment}
          onSelectAttachment={handleSelectAttachmentInViewer}
        />
      ) : null}
    </section>
  );
}

export default MessengerConversation;
