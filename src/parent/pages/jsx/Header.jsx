import {
  AlertCircle,
  Ban,
  Camera,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Download,
  ExternalLink,
  File as FileIcon,
  FileText,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  LoaderCircle,
  LogOut,
  Menu,
  MoreVertical,
  ParrotIcon,
  Pencil,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "@/components/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import ImageCropper from "../../../components/ImageCropper.jsx";
import SmartAvatar from "../../../components/SmartAvatar.jsx";
import ThemeToggleButton from "../../../theme css/ThemeToggleButton.jsx";
import {
  getMessengerErrorMessage,
  getMessengerSavedMessages,
  getMessengerUserCryptoDevices,
  refreshMessengerPresenceVisibility,
  saveMessengerMessage,
} from "../../../messenger/api.js";
import { saveGroupMessage } from "../../../group_messaging/api.js";
import {
  decryptGroupMessageForUser,
  getRenderableMessageText as getGroupRenderableMessageText,
} from "../../../group_messaging/e2ee/messages.js";
import {
  getStoredMessengerDeviceIdentity,
  revokeMessengerDevice,
  setDefaultMessengerDevice,
  updateDefaultMessengerDevicePassword,
} from "../../../messenger/e2ee/devices/index.js";
import {
  decryptMessageForUser,
  getRenderableMessageText as getDirectRenderableMessageText,
} from "../../../messenger/e2ee/messages.js";
import {
  decryptEncryptedAttachmentBlob,
  isEncryptedAttachment as isMessengerEncryptedAttachment,
} from "../../../messenger/e2ee/files.js";
import {
  decryptEncryptedAttachmentBlob as decryptGroupEncryptedAttachmentBlob,
  isEncryptedAttachment as isGroupEncryptedAttachment,
} from "../../../group_messaging/e2ee/files.js";
import {
  clearStoredRecoveryKey,
  getStoredRecoveryKey,
  saveRecoveryKeyBackup,
} from "../../../messenger/e2ee/recovery.js";
import { getReactionConfig } from "../../../messenger/reactions.js";
import {
  blockParentContact,
  changeParentPassword,
  deleteParentAccount,
  ghostParentContact,
  getParentContacts,
  getParentProfile,
  storeParentSession,
  unghostParentContact,
  unblockParentContact,
  updateParentProfile,
} from "../../api.js";
import {
  getContactInitials,
  getContactName,
  getParentApiErrorMessage,
} from "./contactHelpers.js";

const accountInitialForm = {
  username: "",
  email: "",
  current_password: "",
  new_password: "",
  password: "",
};

const DEFAULT_DEVICE_PASSWORD_MIN_LENGTH = 8;

const defaultDevicePasswordInitialForm = {
  password: "",
  confirm_password: "",
};

const defaultDevicePasswordUpdateInitialForm = {
  current_password: "",
  new_password: "",
  confirm_new_password: "",
};

const LOGGED_IN_HISTORY_KEY = "parrotLoggedInView";

function getLoggedInHistoryView() {
  return window.history.state?.[LOGGED_IN_HISTORY_KEY] || null;
}

function pushLoggedInHistoryView(nextView) {
  const currentState = window.history.state || {};
  const currentView = currentState[LOGGED_IN_HISTORY_KEY] || {};

  window.history.pushState(
    {
      ...currentState,
      [LOGGED_IN_HISTORY_KEY]: {
        ...currentView,
        ...nextView,
      },
    },
    "",
    window.location.href,
  );
}

function replaceLoggedInHistoryView(nextView) {
  const currentState = window.history.state || {};
  const currentView = currentState[LOGGED_IN_HISTORY_KEY] || {};

  window.history.replaceState(
    {
      ...currentState,
      [LOGGED_IN_HISTORY_KEY]: {
        ...currentView,
        ...nextView,
      },
    },
    "",
    window.location.href,
  );
}

function clearLoggedInHistoryModal() {
  const currentState = window.history.state || {};
  const currentView = currentState[LOGGED_IN_HISTORY_KEY] || {};
  const nextView = { ...currentView };

  delete nextView.accountTab;
  delete nextView.modal;
  delete nextView.profileTab;

  window.history.replaceState(
    {
      ...currentState,
      [LOGGED_IN_HISTORY_KEY]: nextView,
    },
    "",
    window.location.href,
  );
}

function isCurrentHistoryModal(modalName) {
  return getLoggedInHistoryView()?.modal === modalName;
}

const profileInitialForm = {
  first_name: "",
  last_name: "",
  phone: "",
  card_number: "",
  card_name: "",
  card_type: "",
  dr_no: "",
  floor: "",
  street: "",
  area: "",
  city: "",
  state: "",
  country: "",
  profile_picture_file: null,
};

const profileTextFields = [
  { label: "First Name", name: "first_name", autoComplete: "given-name" },
  { label: "Last Name", name: "last_name", autoComplete: "family-name" },
  { label: "Phone", name: "phone", autoComplete: "tel" },
  { label: "Card Number", name: "card_number", inputMode: "numeric" },
  { label: "Card Name", name: "card_name", autoComplete: "cc-name" },
  { label: "Door No", name: "dr_no", autoComplete: "address-line1" },
  { label: "Floor", name: "floor" },
  { label: "Street", name: "street", autoComplete: "address-line2" },
  { label: "Area", name: "area" },
  { label: "City", name: "city", autoComplete: "address-level2" },
  { label: "State", name: "state", autoComplete: "address-level1" },
  { label: "Country", name: "country", autoComplete: "country-name" },
];

const profileDetailFields = [
  { label: "First Name", key: "first_name" },
  { label: "Last Name", key: "last_name" },
  { label: "Phone", key: "phone" },
  { label: "Card Number", key: "card_number", mask: true },
  { label: "Card Name", key: "card_name" },
  { label: "Card Type", key: "card_type" },
  { label: "Updated", key: "updated_at", date: true },
];

const profilePayloadFields = profileTextFields.map(({ name }) => name);

function getApiErrorMessage(error, fallbackMessage) {
  const errors = error.response?.data?.errors;

  if (errors) {
    return Object.entries(errors)
      .map(([field, fieldErrors]) => `${field}: ${fieldErrors.join(", ")}`)
      .join(" ");
  }

  return error.response?.data?.message || fallbackMessage;
}

function formatSavedDateTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getSavedMessageAttachments(message, messageKind = "direct") {
  const attachments =
    Array.isArray(message?.decrypted_attachments) &&
    message.decrypted_attachments.length > 0
      ? message.decrypted_attachments
      : Array.isArray(message?.attachments)
        ? message.attachments
        : [];

  return attachments.map((attachment) => ({
    ...attachment,
    saved_message_kind:
      attachment?.saved_message_kind ||
      (attachment?.type === "e2ee.group_file" ? "group" : messageKind),
  }));
}

function getSavedAttachmentMessageKind(attachment) {
  if (
    attachment?.saved_message_kind === "group" ||
    attachment?.message_kind === "group" ||
    attachment?.room_type === "group" ||
    attachment?.type === "e2ee.group_file"
  ) {
    return "group";
  }

  return "direct";
}

function isSavedEncryptedAttachment(attachment) {
  return getSavedAttachmentMessageKind(attachment) === "group"
    ? isGroupEncryptedAttachment(attachment)
    : isMessengerEncryptedAttachment(attachment);
}

function getSavedAttachmentLabel(attachment, index) {
  return (
    attachment?.file_name ||
    attachment?.original_file_name ||
    attachment?.name ||
    `${attachment?.file_type || "Attachment"} ${index + 1}`
  );
}

function getSavedAttachmentKey(attachment, index = 0) {
  return String(
    attachment?.id ||
      attachment?.upload_intent_id ||
      attachment?.file_url ||
      attachment?.encrypted_file_url ||
      attachment?.thumbnail_url ||
      attachment?.preview_url ||
      attachment?.url ||
      attachment?.secure_url ||
      `${attachment?.file_name || "attachment"}-${index}`,
  );
}

function getSavedAttachmentSourceUrl(attachment) {
  return (
    attachment?.file_url ||
    attachment?.url ||
    attachment?.secure_url ||
    attachment?.download_url ||
    attachment?.encrypted_file_url ||
    attachment?.thumbnail_url ||
    attachment?.preview_url ||
    attachment?.local_preview_url ||
    ""
  );
}

function getSavedAttachmentPreviewUrl(attachment) {
  if (!attachment) {
    return "";
  }

  if (isSavedEncryptedAttachment(attachment)) {
    return "";
  }

  return (
    attachment.local_preview_url ||
    attachment.thumbnail_url ||
    attachment.preview_url ||
    attachment.file_url ||
    attachment.url ||
    attachment.secure_url ||
    attachment.download_url ||
    ""
  );
}

function getSavedAttachmentMimeType(attachment) {
  return String(
    attachment?.mime_type ||
      attachment?.content_type ||
      attachment?.type ||
      "",
  ).toLowerCase();
}

function getSavedAttachmentFileName(attachment) {
  return String(
    attachment?.file_name ||
      attachment?.original_file_name ||
      attachment?.name ||
      "",
  ).toLowerCase();
}

function isSavedPdfAttachment(attachment) {
  const mimeType = getSavedAttachmentMimeType(attachment);
  const fileName = getSavedAttachmentFileName(attachment);

  return mimeType === "application/pdf" || fileName.endsWith(".pdf");
}

function getSavedAttachmentKind(attachment) {
  const fileType = String(attachment?.file_type || "").toLowerCase();
  const mimeType = getSavedAttachmentMimeType(attachment);
  const fileName = getSavedAttachmentFileName(attachment);

  if (
    fileType === "image" ||
    mimeType.startsWith("image/") ||
    /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(fileName)
  ) {
    return "image";
  }

  if (isSavedPdfAttachment(attachment)) {
    return "pdf";
  }

  if (
    fileType === "video" ||
    mimeType.startsWith("video/") ||
    /\.(m4v|mov|mp4|mpeg|mpg|ogv|webm)$/i.test(fileName)
  ) {
    return "video";
  }

  if (
    fileType === "audio" ||
    mimeType.startsWith("audio/") ||
    /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav|weba)$/i.test(fileName)
  ) {
    return "audio";
  }

  return "file";
}

function getSavedAttachmentKindLabel(kind) {
  const labels = {
    image: "Image",
    pdf: "PDF",
    video: "Video",
    audio: "Audio",
    file: "File",
  };

  return labels[kind] || labels.file;
}

function getSavedAttachmentIcon(kind, size = 24) {
  if (kind === "image") {
    return <ImageIcon size={size} aria-hidden="true" />;
  }

  if (kind === "file") {
    return <FileIcon size={size} aria-hidden="true" />;
  }

  return <FileText size={size} aria-hidden="true" />;
}

function getSavedAttachmentDownloadName(attachment, index = 0) {
  return (
    attachment?.file_name ||
    attachment?.original_file_name ||
    attachment?.name ||
    `saved-attachment-${index + 1}`
  );
}

async function createSavedAttachmentObjectUrl(attachment) {
  if (isSavedEncryptedAttachment(attachment)) {
    const blob =
      getSavedAttachmentMessageKind(attachment) === "group"
        ? await decryptGroupEncryptedAttachmentBlob(attachment)
        : await decryptEncryptedAttachmentBlob(attachment);
    return {
      url: URL.createObjectURL(blob),
      revoke: true,
    };
  }

  return {
    url: getSavedAttachmentSourceUrl(attachment),
    revoke: false,
  };
}

function useSavedAttachmentPreviewUrl(attachment, enabled = true) {
  const attachmentKey = getSavedAttachmentKey(attachment);
  const [previewState, setPreviewState] = useState({
    status: "idle",
    url: "",
  });

  useEffect(() => {
    let isMounted = true;
    let objectUrl = "";

    if (!attachment || !enabled) {
      setPreviewState({ status: "idle", url: "" });
      return undefined;
    }

    const sourceUrl = getSavedAttachmentSourceUrl(attachment);
    const previewUrl = getSavedAttachmentPreviewUrl(attachment);
    if (!sourceUrl) {
      setPreviewState({ status: "empty", url: "" });
      return undefined;
    }

    if (!isSavedEncryptedAttachment(attachment)) {
      setPreviewState({
        status: "ready",
        url: previewUrl || sourceUrl,
      });
      return undefined;
    }

    setPreviewState({ status: "loading", url: "" });
    createSavedAttachmentObjectUrl(attachment)
      .then((result) => {
        objectUrl = result.revoke ? result.url : "";
        if (isMounted) {
          setPreviewState({ status: "ready", url: result.url });
        } else if (result.revoke) {
          URL.revokeObjectURL(result.url);
        }
      })
      .catch(() => {
        if (isMounted) {
          setPreviewState({ status: "error", url: "" });
        }
      });

    return () => {
      isMounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [attachment, attachmentKey, enabled]);

  return previewState;
}

function SavedAttachmentTile({ attachment, index, overflowCount, onOpen }) {
  const kind = getSavedAttachmentKind(attachment);
  const label = getSavedAttachmentLabel(attachment, index);
  const shouldLoadPreview = kind === "image" || kind === "video";
  const previewState = useSavedAttachmentPreviewUrl(
    attachment,
    shouldLoadPreview,
  );
  const hasPreview = previewState.status === "ready" && previewState.url;

  return (
    <button
      className={`parent-layout-page__my-save-attachment-tile is-${kind}`}
      type="button"
      onClick={() => onOpen(attachment)}
      aria-label={`Open ${label}`}
      title={label}
    >
      {kind === "image" && hasPreview ? (
        <img src={previewState.url} alt={label} />
      ) : null}
      {kind === "video" && hasPreview ? (
        <video src={previewState.url} muted playsInline preload="metadata" />
      ) : null}
      {!hasPreview ? (
        <span className="parent-layout-page__my-save-attachment-fallback">
          {getSavedAttachmentIcon(kind, 26)}
        </span>
      ) : null}
      <span className="parent-layout-page__my-save-attachment-shade" />
      {index === 3 && overflowCount > 0 ? (
        <span className="parent-layout-page__my-save-attachment-more">
          +{overflowCount}
        </span>
      ) : null}
      <span className="parent-layout-page__my-save-attachment-type">
        {getSavedAttachmentKindLabel(kind)}
      </span>
    </button>
  );
}

function SavedAttachmentPreviewGrid({ attachments, onOpen }) {
  const safeAttachments = Array.isArray(attachments) ? attachments : [];
  const visibleAttachments = safeAttachments.slice(0, 4);
  const visibleCount = visibleAttachments.length;

  if (visibleCount === 0) {
    return null;
  }

  return (
    <div
      className={`parent-layout-page__my-save-attachment-grid is-count-${visibleCount}`}
      aria-label="Saved message attachments"
    >
      {visibleAttachments.map((attachment, index) => (
        <SavedAttachmentTile
          attachment={attachment}
          index={index}
          key={getSavedAttachmentKey(attachment, index)}
          overflowCount={safeAttachments.length - visibleAttachments.length}
          onOpen={(selectedAttachment) =>
            onOpen(safeAttachments, selectedAttachment)
          }
        />
      ))}
    </div>
  );
}

function SavedAttachmentViewerContent({ attachment }) {
  const kind = getSavedAttachmentKind(attachment);
  const label = getSavedAttachmentLabel(attachment, 0);
  const canPreview = ["image", "video", "audio", "pdf"].includes(kind);
  const previewState = useSavedAttachmentPreviewUrl(attachment, canPreview);
  const hasPreview = previewState.status === "ready" && previewState.url;

  if (kind === "image" && hasPreview) {
    return (
      <img
        className="parent-layout-page__my-save-viewer-media"
        src={previewState.url}
        alt={label}
      />
    );
  }

  if (kind === "video" && hasPreview) {
    return (
      <video
        className="parent-layout-page__my-save-viewer-media"
        src={previewState.url}
        controls
      />
    );
  }

  if (kind === "audio" && hasPreview) {
    return (
      <div className="parent-layout-page__my-save-viewer-file">
        {getSavedAttachmentIcon(kind, 38)}
        <strong>{label}</strong>
        <audio src={previewState.url} controls />
      </div>
    );
  }

  if (kind === "pdf" && hasPreview) {
    return (
      <iframe
        className="parent-layout-page__my-save-viewer-frame"
        src={previewState.url}
        title={label}
      />
    );
  }

  return (
    <div className="parent-layout-page__my-save-viewer-file">
      {previewState.status === "loading" ? (
        <LoaderCircle className="app-button-spinner" aria-hidden="true" />
      ) : (
        getSavedAttachmentIcon(kind, 42)
      )}
      <strong>{label}</strong>
      <span>
        {previewState.status === "error"
          ? "Preview unavailable"
          : getSavedAttachmentKindLabel(kind)}
      </span>
    </div>
  );
}

function SavedAttachmentViewerModal({
  attachments,
  selectedAttachmentId,
  onClose,
  onDownload,
  onNavigate,
  onOpen,
}) {
  const safeAttachments = Array.isArray(attachments) ? attachments : [];
  const selectedIndex = Math.max(
    safeAttachments.findIndex(
      (attachment, index) =>
        getSavedAttachmentKey(attachment, index) === selectedAttachmentId,
    ),
    0,
  );
  const selectedAttachment =
    safeAttachments[selectedIndex] || safeAttachments[0] || null;
  const hasManyAttachments = safeAttachments.length > 1;

  useEffect(() => {
    const handleKeyDown = (event) => {
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

  const selectedLabel = getSavedAttachmentLabel(selectedAttachment, selectedIndex);
  const selectedKind = getSavedAttachmentKind(selectedAttachment);

  return createPortal(
    <div
      className="parent-layout-page__attachment-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Saved attachments"
    >
      <button
        className="parent-layout-page__attachment-viewer-backdrop"
        type="button"
        onClick={onClose}
        aria-label="Close attachments"
      />
      <div className="parent-layout-page__attachment-viewer-surface is-minimal">
        <button
          className="parent-layout-page__attachment-viewer-close"
          type="button"
          onClick={onClose}
          aria-label="Close attachments"
          title="Close"
        >
          <X size={20} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__attachment-viewer-content">
          {hasManyAttachments ? (
            <button
              className="parent-layout-page__attachment-viewer-nav is-prev"
              type="button"
              onClick={() => onNavigate(-1)}
              aria-label="Previous attachment"
              title="Previous"
            >
              <ChevronLeft size={24} aria-hidden="true" />
            </button>
          ) : null}

          <SavedAttachmentViewerContent attachment={selectedAttachment} />

          {hasManyAttachments ? (
            <button
              className="parent-layout-page__attachment-viewer-nav is-next"
              type="button"
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
            <span>{getSavedAttachmentIcon(selectedKind, 17)}</span>
            <strong>{selectedLabel}</strong>
          </div>
          <div className="parent-layout-page__attachment-viewer-count">
            {selectedIndex + 1}/{safeAttachments.length} files
          </div>
          <div className="parent-layout-page__attachment-viewer-actions">
            <button
              type="button"
              onClick={() => onOpen(selectedAttachment)}
              aria-label={`Open ${selectedLabel} in a new tab`}
              title="Open in new tab"
            >
              <ExternalLink size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onDownload(selectedAttachment, selectedIndex)}
              aria-label={`Download ${selectedLabel}`}
              title="Download"
            >
              <Download size={16} aria-hidden="true" />
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function getSavedMessageText(save) {
  const message = save?.message;
  const text =
    save?.message_kind === "group"
      ? getGroupRenderableMessageText(message)
      : getDirectRenderableMessageText(message);

  return String(text || "").trim();
}

function getSavedMessageSenderLabel(save, currentUserId) {
  const sender = save?.sender || {};

  if (sender.user_id && Number(sender.user_id) === Number(currentUserId)) {
    return "You";
  }

  return sender.display_name || sender.account_number || "Unknown sender";
}

function getSavedReactionLabel(reactionItem) {
  const reactionConfig = getReactionConfig(reactionItem?.reaction);
  const count = Math.max(Number(reactionItem?.count || 0), 0);

  if (!reactionConfig || count <= 0) {
    return "";
  }

  return `${reactionConfig.emoji} ${count}`;
}

async function decryptSavedItemForUser(save, user) {
  const message = save?.message;

  if (!message) {
    return save;
  }

  const decryptedMessage =
    save.message_kind === "group"
      ? await decryptGroupMessageForUser(message, user)
      : await decryptMessageForUser(message, user);

  return {
    ...save,
    message: decryptedMessage,
  };
}

function getEmptyAccountForm() {
  return { ...accountInitialForm };
}

function getAccountToastDetails(account) {
  return [
    {
      label: "Username",
      value: account?.username,
    },
    {
      label: "Account",
      value: account?.account_number,
    },
  ];
}

function getProfileForm(profile) {
  return {
    ...profileInitialForm,
    ...profilePayloadFields.reduce(
      (formValues, fieldName) => ({
        ...formValues,
        [fieldName]: profile?.[fieldName] || "",
      }),
      {},
    ),
    card_type: profile?.card_type || "",
    profile_picture_file: null,
  };
}

function getProfileUserPatch(profile) {
  return {
    first_name: profile?.first_name || null,
    last_name: profile?.last_name || null,
    phone: profile?.phone || null,
    profile_picture: profile?.profile_picture || null,
  };
}

function getProfileName(profile, username) {
  return (
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    username
  );
}

function getMaskedCardNumber(value) {
  if (!value) {
    return "Not saved";
  }

  const visibleDigits = String(value).slice(-4);
  return visibleDigits ? `Ending ${visibleDigits}` : "Saved";
}

function getProfileValue(profile, field) {
  const value = profile?.[field.key];

  if (field.mask) {
    return getMaskedCardNumber(value);
  }

  if (field.date && value) {
    return new Date(value).toLocaleString();
  }

  return value || "Not saved";
}

function formatDeviceTime(value) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function getProfileAddress(profile) {
  const address = [
    profile?.dr_no,
    profile?.floor,
    profile?.street,
    profile?.area,
    profile?.city,
    profile?.state,
    profile?.country,
  ]
    .filter(Boolean)
    .join(", ");

  return address || "Not saved";
}

function getProfileToastDetails(profile) {
  return [
    {
      label: "Name",
      value: getProfileName(profile, "Parrot user"),
    },
    {
      label: "Phone",
      value: profile?.phone || "Not saved",
    },
  ];
}

function buildProfilePayload(form) {
  return {
    ...profilePayloadFields.reduce((payload, fieldName) => {
      const value = form[fieldName]?.trim();

      return {
        ...payload,
        [fieldName]: value || null,
      };
    }, {}),
    card_type: form.card_type || null,
  };
}

function getHeaderProfileHydrationKey(user) {
  return (
    user?.id ||
    user?.user_id ||
    user?.account_number ||
    user?.username ||
    ""
  );
}

function Header({
  accountPanelHost = null,
  contacts = [],
  user,
  defaultDevicePromptVersion = 0,
  isAccountPanelActive = false,
  isContactsPanelActive = false,
  onContactsChange,
  onDefaultDeviceChanged,
  onContactUpdated,
  onOpenContactsPanel,
  onToggleAccountPanel,
  onRecoveryKeyRequested,
  onLogout,
  onUserUpdate,
  onToast,
}) {
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [isLinkedDevicesModalOpen, setIsLinkedDevicesModalOpen] = useState(false);
  const [isBlockManagementModalOpen, setIsBlockManagementModalOpen] =
    useState(false);
  const [isGhostManagementModalOpen, setIsGhostManagementModalOpen] =
    useState(false);
  const [isMySavesModalOpen, setIsMySavesModalOpen] = useState(false);
  const [isDefaultDeviceSelectionRequired, setIsDefaultDeviceSelectionRequired] =
    useState(false);
  const [activeProfileTab, setActiveProfileTab] = useState("view");
  const [activeAccountTab, setActiveAccountTab] = useState("password");
  const [activeLinkedDevicesTab, setActiveLinkedDevicesTab] = useState("devices");
  const [profile, setProfile] = useState(null);
  const [profileForm, setProfileForm] = useState(() => getProfileForm(user));
  const [profilePicturePreviewUrl, setProfilePicturePreviewUrl] = useState("");
  const [accountForm, setAccountForm] = useState(() => getEmptyAccountForm());
  const [blockManagementContacts, setBlockManagementContacts] = useState(
    () => contacts,
  );
  const [blockManagementSearch, setBlockManagementSearch] = useState("");
  const [ghostManagementContacts, setGhostManagementContacts] = useState(
    () => contacts,
  );
  const [ghostManagementSearch, setGhostManagementSearch] = useState("");
  const [recoveryKeyForm, setRecoveryKeyForm] = useState({
    recovery_key: "",
    confirm_recovery_key: "",
  });
  const [defaultDevicePasswordForm, setDefaultDevicePasswordForm] = useState(
    () => ({ ...defaultDevicePasswordInitialForm }),
  );
  const [
    defaultDevicePasswordUpdateForm,
    setDefaultDevicePasswordUpdateForm,
  ] = useState(() => ({ ...defaultDevicePasswordUpdateInitialForm }));
  const [profileMessage, setProfileMessage] = useState(null);
  const [accountMessage, setAccountMessage] = useState(null);
  const [linkedDevicesMessage, setLinkedDevicesMessage] = useState(null);
  const [blockManagementMessage, setBlockManagementMessage] = useState(null);
  const [ghostManagementMessage, setGhostManagementMessage] = useState(null);
  const [mySavesMessage, setMySavesMessage] = useState(null);
  const [recoveryKeyMessage, setRecoveryKeyMessage] = useState(null);
  const [defaultDevicePasswordMessage, setDefaultDevicePasswordMessage] =
    useState(null);
  const [
    defaultDevicePasswordUpdateMessage,
    setDefaultDevicePasswordUpdateMessage,
  ] = useState(null);
  const [storedRecoveryKey, setStoredRecoveryKey] = useState("");
  const [cryptoDevices, setCryptoDevices] = useState([]);
  const [blockActionAccountNumber, setBlockActionAccountNumber] = useState("");
  const [ghostActionAccountNumber, setGhostActionAccountNumber] = useState("");
  const [hasDefaultCryptoDevice, setHasDefaultCryptoDevice] = useState(false);
  const [isDefaultPasswordConfigured, setIsDefaultPasswordConfigured] =
    useState(false);
  const [currentCryptoDeviceId, setCurrentCryptoDeviceId] = useState("");
  const [defaultPasswordTargetDevice, setDefaultPasswordTargetDevice] =
    useState(null);
  const [
    isDefaultPasswordUpdateModalOpen,
    setIsDefaultPasswordUpdateModalOpen,
  ] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [isPasswordChanging, setIsPasswordChanging] = useState(false);
  const [isAccountDeleting, setIsAccountDeleting] = useState(false);
  const [isDevicesLoading, setIsDevicesLoading] = useState(false);
  const [isBlockManagementLoading, setIsBlockManagementLoading] =
    useState(false);
  const [isGhostManagementLoading, setIsGhostManagementLoading] =
    useState(false);
  const [isMySavesLoading, setIsMySavesLoading] = useState(false);
  const [isRecoveryKeySaving, setIsRecoveryKeySaving] = useState(false);
  const [isDefaultDevicePasswordSaving, setIsDefaultDevicePasswordSaving] =
    useState(false);
  const [isDefaultDevicePasswordUpdating, setIsDefaultDevicePasswordUpdating] =
    useState(false);
  const [isLogoutPending, setIsLogoutPending] = useState(false);
  const [mySaves, setMySaves] = useState([]);
  const [mySavesActionId, setMySavesActionId] = useState("");
  const [activeMySaveMetaId, setActiveMySaveMetaId] = useState(null);
  const [savedAttachmentViewer, setSavedAttachmentViewer] = useState({
    attachments: [],
    selectedAttachmentId: "",
  });
  const [revokingDeviceId, setRevokingDeviceId] = useState("");
  const [defaultingDeviceId, setDefaultingDeviceId] = useState("");
  const [isStoredRecoveryKeyVisible, setIsStoredRecoveryKeyVisible] =
    useState(false);
  const [isRecoveryKeyVisible, setIsRecoveryKeyVisible] = useState(false);
  const [isConfirmRecoveryKeyVisible, setIsConfirmRecoveryKeyVisible] =
    useState(false);
  const [isDefaultDevicePasswordVisible, setIsDefaultDevicePasswordVisible] =
    useState(false);
  const [
    isConfirmDefaultDevicePasswordVisible,
    setIsConfirmDefaultDevicePasswordVisible,
  ] = useState(false);
  const [
    isCurrentDefaultDevicePasswordVisible,
    setIsCurrentDefaultDevicePasswordVisible,
  ] = useState(false);
  const [
    isNewDefaultDevicePasswordVisible,
    setIsNewDefaultDevicePasswordVisible,
  ] = useState(false);
  const [
    isConfirmNewDefaultDevicePasswordVisible,
    setIsConfirmNewDefaultDevicePasswordVisible,
  ] = useState(false);
  const [profilePictureCropFile, setProfilePictureCropFile] = useState(null);
  const hydratedProfileUserKeyRef = useRef("");
  const handledDefaultDevicePromptVersionRef = useRef(0);
  const profilePictureInputRef = useRef(null);
  const accountDisplay = user || {};
  const displayProfile = profile || user || {};
  const username = accountDisplay?.username || user?.username || "parrot_user";
  const savedProfileName = [displayProfile?.first_name, displayProfile?.last_name]
    .filter(Boolean)
    .join(" ");
  const accountNumber =
    accountDisplay?.account_number || user?.account_number || "Account pending";
  const email =
    accountDisplay?.email || user?.email || (username ? `${username}@epost.com` : "");
  const profilePicture = displayProfile?.profile_picture;
  const currentUserId = Number(user?.id || user?.user_id || 0);
  useEffect(() => {
    const file = profileForm.profile_picture_file;
    if (!file || typeof URL === "undefined") {
      setProfilePicturePreviewUrl("");
      return undefined;
    }

    const previewUrl = URL.createObjectURL(file);
    setProfilePicturePreviewUrl(previewUrl);

    return () => URL.revokeObjectURL(previewUrl);
  }, [profileForm.profile_picture_file]);
  const currentCryptoDevice = cryptoDevices.find(
    (device) => device.device_id === currentCryptoDeviceId,
  );
  const defaultCryptoDevice = cryptoDevices.find((device) => device.is_default);
  const activeCryptoDevices = cryptoDevices.filter(
    (device) => !device.is_default,
  );
  const canManageCryptoDevices = Boolean(currentCryptoDevice?.is_default);
  const canUpdateDefaultDevicePassword =
    canManageCryptoDevices && isDefaultPasswordConfigured;
  const blockManagementQuery = blockManagementSearch.trim().toLowerCase();
  const filteredBlockManagementContacts = useMemo(() => {
    const sourceContacts = Array.isArray(blockManagementContacts)
      ? blockManagementContacts
      : [];

    if (!blockManagementQuery) {
      return sourceContacts;
    }

    return sourceContacts.filter((contact) => {
      const name = getContactName(contact).toLowerCase();
      const account = String(contact.account_number || "").toLowerCase();

      return name.includes(blockManagementQuery) || account.includes(blockManagementQuery);
    });
  }, [blockManagementContacts, blockManagementQuery]);
  const blockedContactsCount = blockManagementContacts.filter(
    (contact) => contact.blocked,
  ).length;
  const ghostManagementQuery = ghostManagementSearch.trim().toLowerCase();
  const filteredGhostManagementContacts = useMemo(() => {
    const sourceContacts = Array.isArray(ghostManagementContacts)
      ? ghostManagementContacts
      : [];

    if (!ghostManagementQuery) {
      return sourceContacts;
    }

    return sourceContacts.filter((contact) => {
      const name = getContactName(contact).toLowerCase();
      const account = String(contact.account_number || "").toLowerCase();

      return name.includes(ghostManagementQuery) || account.includes(ghostManagementQuery);
    });
  }, [ghostManagementContacts, ghostManagementQuery]);
  const ghostedContactsCount = ghostManagementContacts.filter(
    (contact) => contact.ghosted,
  ).length;

  useEffect(() => {
    const nextContacts = Array.isArray(contacts) ? contacts : [];

    setBlockManagementContacts(nextContacts);
    setGhostManagementContacts(nextContacts);
  }, [contacts]);

  const syncProfile = useCallback(
    (nextProfile) => {
      const profilePatch = getProfileUserPatch(nextProfile);
      const nextUser = {
        ...user,
        ...profilePatch,
      };

      setProfile(nextProfile);
      setProfileForm(getProfileForm(nextProfile));
      storeParentSession({ user: nextUser });
      onUserUpdate?.(nextUser);
    },
    [onUserUpdate, user],
  );

  const loadProfile = useCallback(async () => {
    setIsProfileLoading(true);
    setProfileMessage(null);

    try {
      const response = await getParentProfile();
      syncProfile(response.data || {});
    } catch (error) {
      setProfileMessage({
        type: "error",
        text: getApiErrorMessage(error, "Unable to load your profile."),
      });
    } finally {
      setIsProfileLoading(false);
    }
  }, [syncProfile]);

  useEffect(() => {
    const hydrationKey = getHeaderProfileHydrationKey(user);

    if (!hydrationKey || hydratedProfileUserKeyRef.current === hydrationKey) {
      return undefined;
    }

    hydratedProfileUserKeyRef.current = hydrationKey;
    let isMounted = true;

    getParentProfile()
      .then((response) => {
        if (isMounted) {
          syncProfile(response.data || {});
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [syncProfile, user]);

  const loadCryptoDevices = useCallback(async ({ preserveMessage = false } = {}) => {
    const userId = user?.id || user?.user_id;

    if (!userId) {
      setCryptoDevices([]);
      setHasDefaultCryptoDevice(false);
      setIsDefaultPasswordConfigured(false);
      setLinkedDevicesMessage({
        type: "error",
        text: "Unable to load devices without a user id.",
      });
      return;
    }

    setIsDevicesLoading(true);
    if (!preserveMessage) {
      setLinkedDevicesMessage(null);
    }

    try {
      const [identity, response] = await Promise.all([
        getStoredMessengerDeviceIdentity(user),
        getMessengerUserCryptoDevices(userId),
      ]);
      const result = response.data?.result || response.data;
      const nextDevices = Array.isArray(result?.devices) ? result.devices : [];
      const currentDeviceId = identity?.device_id || "";
      const currentDevices = currentDeviceId
        ? nextDevices.filter((device) => device.device_id === currentDeviceId)
        : [];
      const currentDeviceIsDefault = currentDevices.some(
        (device) => device.is_default,
      );
      const visibleDevices = currentDeviceIsDefault
        ? nextDevices
        : nextDevices.filter(
            (device) =>
              device.is_default || device.device_id === currentDeviceId,
          );

      setCurrentCryptoDeviceId(currentDeviceId);
      setHasDefaultCryptoDevice(
        nextDevices.some((device) => device.is_default),
      );
      setIsDefaultPasswordConfigured(
        Boolean(result?.default_password_configured),
      );
      setCryptoDevices(visibleDevices);
      if (!currentDeviceIsDefault) {
        clearStoredRecoveryKey(user);
        setStoredRecoveryKey("");
        setIsStoredRecoveryKeyVisible(false);
      }
    } catch (error) {
      setLinkedDevicesMessage({
        type: "error",
        text: getMessengerErrorMessage(error, "Unable to load encrypted devices."),
      });
    } finally {
      setIsDevicesLoading(false);
    }
  }, [user]);

  const loadBlockManagementContacts = useCallback(async () => {
    setIsBlockManagementLoading(true);
    setBlockManagementMessage(null);

    try {
      const response = await getParentContacts();
      const nextContacts = Array.isArray(response.data?.contacts)
        ? response.data.contacts
        : [];

      setBlockManagementContacts(nextContacts);
      onContactsChange?.(nextContacts);
    } catch (error) {
      setBlockManagementMessage({
        type: "error",
        text: getParentApiErrorMessage(error, "Unable to load contacts."),
      });
    } finally {
      setIsBlockManagementLoading(false);
    }
  }, [onContactsChange]);

  const loadGhostManagementContacts = useCallback(async () => {
    setIsGhostManagementLoading(true);
    setGhostManagementMessage(null);

    try {
      const response = await getParentContacts();
      const nextContacts = Array.isArray(response.data?.contacts)
        ? response.data.contacts
        : [];

      setGhostManagementContacts(nextContacts);
      onContactsChange?.(nextContacts);
    } catch (error) {
      setGhostManagementMessage({
        type: "error",
        text: getParentApiErrorMessage(error, "Unable to load contacts."),
      });
    } finally {
      setIsGhostManagementLoading(false);
    }
  }, [onContactsChange]);

  const loadMySaves = useCallback(async () => {
    setIsMySavesLoading(true);
    setMySavesMessage(null);

    try {
      const response = await getMessengerSavedMessages({ limit: 100 });
      const result = response.data?.result || response.data;
      const rawSaves = Array.isArray(result?.saves) ? result.saves : [];
      const decryptedSaves = await Promise.all(
        rawSaves.map((save) => decryptSavedItemForUser(save, user)),
      );

      setMySaves(decryptedSaves);
    } catch (error) {
      setMySavesMessage({
        type: "error",
        text: getMessengerErrorMessage(error, "Unable to load saved messages."),
      });
    } finally {
      setIsMySavesLoading(false);
    }
  }, [user]);

  const refreshStoredRecoveryKey = useCallback(() => {
    setStoredRecoveryKey(getStoredRecoveryKey(user));
  }, [user]);

  const openProfileModal = () => {
    pushLoggedInHistoryView({ modal: "profile", profileTab: "view" });
    setIsBlockManagementModalOpen(false);
    setIsGhostManagementModalOpen(false);
    setIsMySavesModalOpen(false);
    setActiveProfileTab("view");
    setIsProfileModalOpen(true);
    loadProfile();
  };

  const openAccountModal = () => {
    pushLoggedInHistoryView({ modal: "account", accountTab: "password" });
    setIsBlockManagementModalOpen(false);
    setIsGhostManagementModalOpen(false);
    setIsMySavesModalOpen(false);
    setActiveAccountTab("password");
    setAccountForm(getEmptyAccountForm());
    setAccountMessage(null);
    setIsAccountModalOpen(true);
  };

  const openLinkedDevicesModal = () => {
    pushLoggedInHistoryView({ modal: "linkedDevices" });
    setIsBlockManagementModalOpen(false);
    setIsGhostManagementModalOpen(false);
    setIsMySavesModalOpen(false);
    setIsDefaultDeviceSelectionRequired(false);
    setActiveLinkedDevicesTab("devices");
    setLinkedDevicesMessage(null);
    setRecoveryKeyMessage(null);
    setIsLinkedDevicesModalOpen(true);
    loadCryptoDevices();
  };

  const handleHeaderLogout = useCallback(async () => {
    if (!onLogout || isLogoutPending) {
      return;
    }

    setIsLogoutPending(true);

    try {
      await onLogout();
    } catch {
      setIsLogoutPending(false);
    }
  }, [isLogoutPending, onLogout]);

  const handleRemoveSavedMessage = useCallback(
    async (save) => {
      const messageId = Number(save?.message?.id || 0);
      const roomId = Number(save?.room?.id || save?.group?.id || 0);
      const actionId = `${save?.message_kind || "message"}:${messageId}`;

      if (!messageId) {
        return;
      }

      setMySavesActionId(actionId);
      setMySavesMessage(null);

      try {
        if (save?.message_kind === "group") {
          await saveGroupMessage(roomId, messageId, false);
        } else {
          await saveMessengerMessage(messageId, false);
        }

        setMySaves((currentSaves) =>
          currentSaves.filter((currentSave) => currentSave.id !== save.id),
        );
        onToast?.({
          type: "success",
          title: "Removed from My Saves",
          message: "The message was removed from your saved messages.",
        });
      } catch (error) {
        setMySavesMessage({
          type: "error",
          text: getMessengerErrorMessage(
            error,
            "Unable to remove this saved message.",
          ),
        });
      } finally {
        setMySavesActionId("");
      }
    },
    [onToast],
  );

  const handleOpenSavedAttachmentViewer = useCallback(
    (attachments, attachment) => {
      const safeAttachments = Array.isArray(attachments) ? attachments : [];
      const selectedIndex = Math.max(safeAttachments.indexOf(attachment), 0);

      setActiveMySaveMetaId(null);
      setSavedAttachmentViewer({
        attachments: safeAttachments,
        selectedAttachmentId: getSavedAttachmentKey(
          safeAttachments[selectedIndex] || attachment,
          selectedIndex,
        ),
      });
    },
    [],
  );

  const handleCloseSavedAttachmentViewer = useCallback(() => {
    setSavedAttachmentViewer({
      attachments: [],
      selectedAttachmentId: "",
    });
  }, []);

  const handleNavigateSavedAttachment = useCallback((direction) => {
    setSavedAttachmentViewer((currentViewer) => {
      const attachments = Array.isArray(currentViewer.attachments)
        ? currentViewer.attachments
        : [];

      if (attachments.length <= 1) {
        return currentViewer;
      }

      const currentIndex = Math.max(
        attachments.findIndex(
          (attachment, index) =>
            getSavedAttachmentKey(attachment, index) ===
            currentViewer.selectedAttachmentId,
        ),
        0,
      );
      const nextIndex =
        (currentIndex + direction + attachments.length) % attachments.length;

      return {
        ...currentViewer,
        selectedAttachmentId: getSavedAttachmentKey(
          attachments[nextIndex],
          nextIndex,
        ),
      };
    });
  }, []);

  const handleOpenSavedAttachment = useCallback(async (attachment) => {
    try {
      const result = await createSavedAttachmentObjectUrl(attachment);

      if (!result.url) {
        return;
      }

      globalThis.open?.(result.url, "_blank", "noopener,noreferrer");
      if (result.revoke) {
        globalThis.setTimeout(() => URL.revokeObjectURL(result.url), 60000);
      }
    } catch (error) {
      setMySavesMessage({
        type: "error",
        text: "Unable to open this attachment.",
      });
    }
  }, []);

  const handleDownloadSavedAttachment = useCallback(
    async (attachment, index = 0) => {
      try {
        const result = await createSavedAttachmentObjectUrl(attachment);

        if (!result.url) {
          return;
        }

        const downloadLink = document.createElement("a");
        downloadLink.href = result.url;
        downloadLink.download = getSavedAttachmentDownloadName(
          attachment,
          index,
        );
        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();

        if (result.revoke) {
          globalThis.setTimeout(() => URL.revokeObjectURL(result.url), 1000);
        }
      } catch (error) {
        setMySavesMessage({
          type: "error",
          text: "Unable to download this attachment.",
        });
      }
    },
    [],
  );

  const openBlockManagementModal = () => {
    pushLoggedInHistoryView({ modal: "blockManagement" });
    setIsProfileModalOpen(false);
    setIsAccountModalOpen(false);
    setIsLinkedDevicesModalOpen(false);
    setIsGhostManagementModalOpen(false);
    setIsMySavesModalOpen(false);
    setBlockManagementSearch("");
    setBlockManagementMessage(null);
    setIsBlockManagementModalOpen(true);
    loadBlockManagementContacts();
  };

  const openGhostManagementModal = () => {
    pushLoggedInHistoryView({ modal: "ghostManagement" });
    setIsProfileModalOpen(false);
    setIsAccountModalOpen(false);
    setIsLinkedDevicesModalOpen(false);
    setIsBlockManagementModalOpen(false);
    setIsMySavesModalOpen(false);
    setGhostManagementSearch("");
    setGhostManagementMessage(null);
    setIsGhostManagementModalOpen(true);
    loadGhostManagementContacts();
  };

  const openMySavesModal = () => {
    pushLoggedInHistoryView({ modal: "mySaves" });
    setIsProfileModalOpen(false);
    setIsAccountModalOpen(false);
    setIsLinkedDevicesModalOpen(false);
    setIsBlockManagementModalOpen(false);
    setIsGhostManagementModalOpen(false);
    setMySavesMessage(null);
    setIsMySavesModalOpen(true);
    loadMySaves();
  };

  useEffect(() => {
    if (
      !defaultDevicePromptVersion ||
      handledDefaultDevicePromptVersionRef.current ===
        defaultDevicePromptVersion
    ) {
      return;
    }

    handledDefaultDevicePromptVersionRef.current = defaultDevicePromptVersion;
    setIsBlockManagementModalOpen(false);
    setIsGhostManagementModalOpen(false);
    setIsMySavesModalOpen(false);
    setIsDefaultDeviceSelectionRequired(true);
    setActiveLinkedDevicesTab("devices");
    setIsLinkedDevicesModalOpen(true);
    setLinkedDevicesMessage({
      type: "error",
      text: "Make this device the default to continue.",
    });
    loadCryptoDevices({ preserveMessage: true });
  }, [defaultDevicePromptVersion, loadCryptoDevices]);

  const resetProfileModal = useCallback(() => {
    setIsProfileModalOpen(false);
    setProfileMessage(null);
    setIsProfileSaving(false);
    setProfilePictureCropFile(null);
  }, []);

  const resetAccountModal = useCallback(() => {
    setIsAccountModalOpen(false);
    setAccountMessage(null);
    setIsPasswordChanging(false);
    setIsAccountDeleting(false);
    setAccountForm(getEmptyAccountForm());
  }, []);

  const resetLinkedDevicesModal = useCallback(() => {
    setIsLinkedDevicesModalOpen(false);
    setIsDefaultDeviceSelectionRequired(false);
    setActiveLinkedDevicesTab("devices");
    setLinkedDevicesMessage(null);
    setRecoveryKeyMessage(null);
    setStoredRecoveryKey("");
    setIsDevicesLoading(false);
    setIsRecoveryKeySaving(false);
    setRevokingDeviceId("");
    setDefaultingDeviceId("");
    setCryptoDevices([]);
    setHasDefaultCryptoDevice(false);
    setIsDefaultPasswordConfigured(false);
    setDefaultPasswordTargetDevice(null);
    setDefaultDevicePasswordForm({ ...defaultDevicePasswordInitialForm });
    setDefaultDevicePasswordMessage(null);
    setIsDefaultPasswordUpdateModalOpen(false);
    setDefaultDevicePasswordUpdateForm({
      ...defaultDevicePasswordUpdateInitialForm,
    });
    setDefaultDevicePasswordUpdateMessage(null);
    setIsDefaultDevicePasswordSaving(false);
    setIsDefaultDevicePasswordUpdating(false);
    setRecoveryKeyForm({
      recovery_key: "",
      confirm_recovery_key: "",
    });
    setIsStoredRecoveryKeyVisible(false);
    setIsRecoveryKeyVisible(false);
    setIsConfirmRecoveryKeyVisible(false);
    setIsDefaultDevicePasswordVisible(false);
    setIsConfirmDefaultDevicePasswordVisible(false);
    setIsCurrentDefaultDevicePasswordVisible(false);
    setIsNewDefaultDevicePasswordVisible(false);
    setIsConfirmNewDefaultDevicePasswordVisible(false);
  }, []);

  const resetBlockManagementModal = useCallback(() => {
    setIsBlockManagementModalOpen(false);
    setBlockManagementMessage(null);
    setBlockActionAccountNumber("");
    setIsBlockManagementLoading(false);
  }, []);

  const resetGhostManagementModal = useCallback(() => {
    setIsGhostManagementModalOpen(false);
    setGhostManagementMessage(null);
    setGhostActionAccountNumber("");
    setIsGhostManagementLoading(false);
  }, []);

  const resetMySavesModal = useCallback(() => {
    setIsMySavesModalOpen(false);
    setMySavesMessage(null);
    setMySavesActionId("");
    setActiveMySaveMetaId(null);
    setSavedAttachmentViewer({
      attachments: [],
      selectedAttachmentId: "",
    });
    setIsMySavesLoading(false);
  }, []);

  const closeBlockManagementModal = useCallback(() => {
    if (isCurrentHistoryModal("blockManagement")) {
      clearLoggedInHistoryModal();
    }

    resetBlockManagementModal();
  }, [resetBlockManagementModal]);

  const closeGhostManagementModal = useCallback(() => {
    if (isCurrentHistoryModal("ghostManagement")) {
      clearLoggedInHistoryModal();
    }

    resetGhostManagementModal();
  }, [resetGhostManagementModal]);

  const closeMySavesModal = useCallback(() => {
    if (mySavesActionId) {
      return;
    }

    if (isCurrentHistoryModal("mySaves")) {
      clearLoggedInHistoryModal();
    }

    resetMySavesModal();
  }, [mySavesActionId, resetMySavesModal]);

  const closeProfileModal = useCallback(() => {
    if (isCurrentHistoryModal("profile")) {
      clearLoggedInHistoryModal();
    }

    resetProfileModal();
  }, [resetProfileModal]);

  const closeAccountModal = useCallback(() => {
    if (isCurrentHistoryModal("account")) {
      clearLoggedInHistoryModal();
    }

    resetAccountModal();
  }, [resetAccountModal]);

  const closeLinkedDevicesModal = useCallback(() => {
    if (isDefaultDeviceSelectionRequired && !hasDefaultCryptoDevice) {
      return;
    }

    if (isCurrentHistoryModal("linkedDevices")) {
      clearLoggedInHistoryModal();
    }

    resetLinkedDevicesModal();
  }, [
    hasDefaultCryptoDevice,
    isDefaultDeviceSelectionRequired,
    resetLinkedDevicesModal,
  ]);

  useEffect(() => {
    if (!isProfileModalOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeProfileModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeProfileModal, isProfileModalOpen]);

  useEffect(() => {
    if (!isAccountModalOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeAccountModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeAccountModal, isAccountModalOpen]);

  useEffect(() => {
    if (!isLinkedDevicesModalOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (
        event.key === "Escape" &&
        !defaultPasswordTargetDevice &&
        !isDefaultPasswordUpdateModalOpen
      ) {
        closeLinkedDevicesModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    closeLinkedDevicesModal,
    defaultPasswordTargetDevice,
    isDefaultPasswordUpdateModalOpen,
    isLinkedDevicesModalOpen,
  ]);

  useEffect(() => {
    if (!isBlockManagementModalOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !blockActionAccountNumber) {
        closeBlockManagementModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    blockActionAccountNumber,
    closeBlockManagementModal,
    isBlockManagementModalOpen,
  ]);

  useEffect(() => {
    if (!isGhostManagementModalOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !ghostActionAccountNumber) {
        closeGhostManagementModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    closeGhostManagementModal,
    ghostActionAccountNumber,
    isGhostManagementModalOpen,
  ]);

  useEffect(() => {
    if (!isMySavesModalOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !mySavesActionId) {
        if (activeMySaveMetaId) {
          setActiveMySaveMetaId(null);
        } else {
          closeMySavesModal();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    activeMySaveMetaId,
    closeMySavesModal,
    isMySavesModalOpen,
    mySavesActionId,
  ]);

  useEffect(() => {
    if (!activeMySaveMetaId) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (event.target?.closest?.("[data-my-save-menu]")) {
        return;
      }

      setActiveMySaveMetaId(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [activeMySaveMetaId]);

  useEffect(() => {
    const handlePopState = (event) => {
      const historyView =
        event.state?.[LOGGED_IN_HISTORY_KEY] || getLoggedInHistoryView();

      if (historyView?.modal === "profile") {
        resetAccountModal();
        resetLinkedDevicesModal();
        resetBlockManagementModal();
        resetGhostManagementModal();
        resetMySavesModal();
        setIsProfileModalOpen(true);
        setActiveProfileTab(historyView.profileTab === "edit" ? "edit" : "view");
        setProfileMessage(null);

        if (!isProfileModalOpen) {
          loadProfile();
        }

        return;
      }

      if (historyView?.modal === "account") {
        resetProfileModal();
        resetLinkedDevicesModal();
        resetBlockManagementModal();
        resetGhostManagementModal();
        resetMySavesModal();
        setIsAccountModalOpen(true);
        setActiveAccountTab(
          historyView.accountTab === "delete"
            ? historyView.accountTab
            : "password",
        );
        setAccountForm(getEmptyAccountForm());
        setAccountMessage(null);
        return;
      }

      if (historyView?.modal === "linkedDevices") {
        resetProfileModal();
        resetAccountModal();
        resetBlockManagementModal();
        resetGhostManagementModal();
        resetMySavesModal();
        setIsLinkedDevicesModalOpen(true);
        setActiveLinkedDevicesTab("devices");
        setLinkedDevicesMessage(null);
        setRecoveryKeyMessage(null);
        loadCryptoDevices();
        return;
      }

      if (historyView?.modal === "blockManagement") {
        resetProfileModal();
        resetAccountModal();
        resetLinkedDevicesModal();
        resetGhostManagementModal();
        resetMySavesModal();
        setIsBlockManagementModalOpen(true);
        setBlockManagementMessage(null);
        loadBlockManagementContacts();
        return;
      }

      if (historyView?.modal === "ghostManagement") {
        resetProfileModal();
        resetAccountModal();
        resetLinkedDevicesModal();
        resetBlockManagementModal();
        resetMySavesModal();
        setIsGhostManagementModalOpen(true);
        setGhostManagementMessage(null);
        loadGhostManagementContacts();
        return;
      }

      if (historyView?.modal === "mySaves") {
        resetProfileModal();
        resetAccountModal();
        resetLinkedDevicesModal();
        resetBlockManagementModal();
        resetGhostManagementModal();
        setIsMySavesModalOpen(true);
        setMySavesMessage(null);
        loadMySaves();
        return;
      }

      resetProfileModal();
      resetAccountModal();
      resetLinkedDevicesModal();
      resetBlockManagementModal();
      resetGhostManagementModal();
      resetMySavesModal();
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [
    isProfileModalOpen,
    loadProfile,
    loadCryptoDevices,
    loadBlockManagementContacts,
    loadGhostManagementContacts,
    loadMySaves,
    resetAccountModal,
    resetBlockManagementModal,
    resetGhostManagementModal,
    resetLinkedDevicesModal,
    resetMySavesModal,
    resetProfileModal,
    user,
  ]);

  const handleAccountFormChange = (event) => {
    const { name, value } = event.target;

    setAccountForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
    setAccountMessage(null);
  };

  const handleToggleManagedContactBlock = async (contact) => {
    if (!contact?.account_number || blockActionAccountNumber) {
      return;
    }

    const wasBlocked = Boolean(contact.blocked);
    const nextBlocked = !wasBlocked;
    if (nextBlocked && contact.ghosted) {
      const shouldBlock = window.confirm(
        `Blocking ${getContactName(contact)} will remove ghosting for this contact. Continue?`,
      );

      if (!shouldBlock) {
        return;
      }
    }

    setBlockActionAccountNumber(contact.account_number);
    setBlockManagementMessage(null);

    try {
      const payload = {
        account_number: contact.account_number,
      };
      const response = wasBlocked
        ? await unblockParentContact(payload)
        : await blockParentContact(payload);
      const updatedContact = response.data?.contact || {
        ...contact,
        blocked: nextBlocked,
      };

      setBlockManagementContacts((currentContacts) =>
        currentContacts.map((currentContact) =>
          currentContact.account_number === updatedContact.account_number
            ? { ...currentContact, ...updatedContact }
            : currentContact,
        ),
      );
      setGhostManagementContacts((currentContacts) =>
        currentContacts.map((currentContact) =>
          currentContact.account_number === updatedContact.account_number
            ? { ...currentContact, ...updatedContact }
            : currentContact,
        ),
      );
      onContactUpdated?.(updatedContact, contact);
      if (updatedContact?.user_id || contact?.user_id) {
        refreshMessengerPresenceVisibility({
          viewer_user_id: updatedContact?.user_id || contact.user_id,
        }).catch(() => {});
      }
      onToast?.({
        type: nextBlocked ? "error" : "success",
        title: nextBlocked ? "Contact blocked" : "Contact unblocked",
        message: `${getContactName(updatedContact)} is now ${
          nextBlocked ? "blocked" : "unblocked"
        }.`,
      });
    } catch (error) {
      const errorMessage = getParentApiErrorMessage(
        error,
        "Unable to update block state.",
      );

      setBlockManagementMessage({
        type: "error",
        text: errorMessage,
      });
      onToast?.({
        type: "error",
        title: "Block status not updated",
        message: errorMessage,
      });
    } finally {
      setBlockActionAccountNumber("");
    }
  };

  const handleToggleManagedContactGhost = async (contact) => {
    if (!contact?.account_number || ghostActionAccountNumber) {
      return;
    }

    const wasGhosted = Boolean(contact.ghosted);
    const nextGhosted = !wasGhosted;
    if (nextGhosted && contact.blocked) {
      const shouldGhost = window.confirm(
        `Ghosting ${getContactName(contact)} will remove blocking for this contact. Continue?`,
      );

      if (!shouldGhost) {
        return;
      }
    }

    setGhostActionAccountNumber(contact.account_number);
    setGhostManagementMessage(null);

    try {
      const payload = {
        account_number: contact.account_number,
      };
      const response = wasGhosted
        ? await unghostParentContact(payload)
        : await ghostParentContact(payload);
      const updatedContact = response.data?.contact || {
        ...contact,
        ghosted: nextGhosted,
      };

      setGhostManagementContacts((currentContacts) =>
        currentContacts.map((currentContact) =>
          currentContact.account_number === updatedContact.account_number
            ? { ...currentContact, ...updatedContact }
            : currentContact,
        ),
      );
      setBlockManagementContacts((currentContacts) =>
        currentContacts.map((currentContact) =>
          currentContact.account_number === updatedContact.account_number
            ? { ...currentContact, ...updatedContact }
            : currentContact,
        ),
      );
      onContactUpdated?.(updatedContact, contact);
      if (updatedContact?.user_id || contact?.user_id) {
        refreshMessengerPresenceVisibility({
          viewer_user_id: updatedContact?.user_id || contact.user_id,
        }).catch(() => {});
      }
      onToast?.({
        type: "success",
        title: nextGhosted ? "Contact ghosted" : "Ghosting removed",
        message: `${getContactName(updatedContact)} is now ${
          nextGhosted ? "ghosted" : "not ghosted"
        }.`,
      });
    } catch (error) {
      const errorMessage = getParentApiErrorMessage(
        error,
        "Unable to update ghosting.",
      );

      setGhostManagementMessage({
        type: "error",
        text: errorMessage,
      });
      onToast?.({
        type: "error",
        title: "Ghosting not updated",
        message: errorMessage,
      });
    } finally {
      setGhostActionAccountNumber("");
    }
  };

  const handleRecoveryKeyFormChange = (event) => {
    const { name, value } = event.target;

    setRecoveryKeyForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
    setRecoveryKeyMessage(null);
  };

  const handleDefaultDevicePasswordFormChange = (event) => {
    const { name, value } = event.target;

    setDefaultDevicePasswordForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
    setDefaultDevicePasswordMessage(null);
  };

  const handleDefaultDevicePasswordUpdateFormChange = (event) => {
    const { name, value } = event.target;

    setDefaultDevicePasswordUpdateForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
    setDefaultDevicePasswordUpdateMessage(null);
  };

  const handleProfileFormChange = (event) => {
    const { files, name, type, value } = event.target;

    if (type === "file") {
      const selectedFile = files?.[0] || null;

      if (selectedFile) {
        setProfilePictureCropFile(selectedFile);
        setProfileMessage(null);
      }

      event.target.value = "";
      return;
    }

    setProfileForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
    setProfileMessage(null);
  };

  const handleProfilePictureCrop = (croppedFile) => {
    setProfileForm((currentForm) => ({
      ...currentForm,
      profile_picture_file: croppedFile,
    }));
    setProfilePictureCropFile(null);
    setProfileMessage(null);
  };

  const handleProfilePictureCropCancel = () => {
    setProfilePictureCropFile(null);
    if (profilePictureInputRef.current) {
      profilePictureInputRef.current.value = "";
    }
  };

  const openEditProfileTab = () => {
    if (activeProfileTab !== "edit") {
      replaceLoggedInHistoryView({ modal: "profile", profileTab: "edit" });
    }

    setActiveProfileTab("edit");
    setProfileForm(getProfileForm(profile || user));
    setProfileMessage(null);
  };

  const openViewProfileTab = () => {
    if (activeProfileTab !== "view") {
      replaceLoggedInHistoryView({ modal: "profile", profileTab: "view" });
    }

    setActiveProfileTab("view");
    setProfileMessage(null);
  };

  const openChangePasswordTab = () => {
    if (activeAccountTab !== "password") {
      replaceLoggedInHistoryView({ modal: "account", accountTab: "password" });
    }

    setActiveAccountTab("password");
    setAccountForm(getEmptyAccountForm());
    setAccountMessage(null);
  };

  const openDeleteAccountTab = () => {
    if (activeAccountTab !== "delete") {
      replaceLoggedInHistoryView({ modal: "account", accountTab: "delete" });
    }

    setActiveAccountTab("delete");
    setAccountForm(getEmptyAccountForm());
    setAccountMessage(null);
  };

  const openLinkedDevicesTab = () => {
    setActiveLinkedDevicesTab("devices");
    setLinkedDevicesMessage(null);
  };

  const openRecoveryKeyTab = () => {
    setActiveLinkedDevicesTab("recovery");
    setRecoveryKeyMessage(null);
    setIsStoredRecoveryKeyVisible(false);
    if (!canManageCryptoDevices) {
      clearStoredRecoveryKey(user);
      setStoredRecoveryKey("");
      return;
    }

    refreshStoredRecoveryKey();
  };

  const handleRecoveryKeyVerificationRequest = () => {
    if (isCurrentHistoryModal("linkedDevices")) {
      clearLoggedInHistoryModal();
    }

    resetLinkedDevicesModal();
    onRecoveryKeyRequested?.();
  };

  const handleRevokeCryptoDevice = async (device) => {
    const deviceId = device?.device_id;
    const isCurrent = deviceId === currentCryptoDeviceId;

    if (
      !deviceId ||
      !currentCryptoDeviceId ||
      (!isCurrent && (device?.is_default || !canManageCryptoDevices))
    ) {
      return;
    }

    setRevokingDeviceId(deviceId);
    setLinkedDevicesMessage(null);

    try {
      if (isCurrent) {
        onLogout?.();
        return;
      }

      await revokeMessengerDevice(user, deviceId);
      setCryptoDevices((currentDevices) =>
        currentDevices.filter(
          (currentDevice) => currentDevice.device_id !== deviceId,
        ),
      );
      onToast?.({
        type: "success",
        title: "Device revoked",
        message: "That device was logged out and cannot receive new encrypted messages.",
      });
    } catch (error) {
      setLinkedDevicesMessage({
        type: "error",
        text: getMessengerErrorMessage(error, "Unable to revoke this device."),
      });
    } finally {
      setRevokingDeviceId("");
    }
  };

  const canMakeCryptoDeviceDefault = (device) => {
    const deviceId = device?.device_id;
    const isCurrent = deviceId === currentCryptoDeviceId;

    if (!deviceId || !currentCryptoDeviceId) {
      return false;
    }

    if (device?.is_default) {
      return isCurrent && canManageCryptoDevices && !isDefaultPasswordConfigured;
    }

    if (!hasDefaultCryptoDevice) {
      return isCurrent;
    }

    if (isCurrent) {
      return true;
    }

    return canManageCryptoDevices;
  };

  const closeDefaultDevicePasswordPrompt = ({ force = false } = {}) => {
    if (isDefaultDevicePasswordSaving && !force) {
      return;
    }

    setDefaultPasswordTargetDevice(null);
    setDefaultDevicePasswordForm({ ...defaultDevicePasswordInitialForm });
    setDefaultDevicePasswordMessage(null);
    setIsDefaultDevicePasswordVisible(false);
    setIsConfirmDefaultDevicePasswordVisible(false);
  };

  const handleSetDefaultCryptoDevice = (device) => {
    if (!canMakeCryptoDeviceDefault(device)) {
      return;
    }

    setDefaultPasswordTargetDevice(device);
    setDefaultDevicePasswordForm({ ...defaultDevicePasswordInitialForm });
    setDefaultDevicePasswordMessage(null);
    setIsDefaultDevicePasswordVisible(false);
    setIsConfirmDefaultDevicePasswordVisible(false);
    setLinkedDevicesMessage(null);
  };

  const handleDefaultDevicePasswordSubmit = async (event) => {
    event.preventDefault();

    const device = defaultPasswordTargetDevice;
    const deviceId = device?.device_id;

    if (!canMakeCryptoDeviceDefault(device)) {
      setDefaultDevicePasswordMessage({
        type: "error",
        text: "This device cannot perform that default-device change.",
      });
      return;
    }

    if (
      defaultDevicePasswordForm.password.length <
      DEFAULT_DEVICE_PASSWORD_MIN_LENGTH
    ) {
      setDefaultDevicePasswordMessage({
        type: "error",
        text: `Default device password must be at least ${DEFAULT_DEVICE_PASSWORD_MIN_LENGTH} characters.`,
      });
      return;
    }

    if (
      isCreatingDefaultDevicePassword &&
      defaultDevicePasswordForm.password !==
        defaultDevicePasswordForm.confirm_password
    ) {
      setDefaultDevicePasswordMessage({
        type: "error",
        text: "Default device passwords do not match.",
      });
      return;
    }

    setDefaultingDeviceId(deviceId);
    setDefaultDevicePasswordMessage(null);
    setIsDefaultDevicePasswordSaving(true);

    try {
      const shouldCloseRequiredPrompt =
        isDefaultDeviceSelectionRequired &&
        deviceId === currentCryptoDeviceId &&
        !hasDefaultCryptoDevice;

      await setDefaultMessengerDevice(user, deviceId, {
        defaultPassword: defaultDevicePasswordForm.password,
      });
      setCryptoDevices((currentDevices) =>
        currentDevices.map((currentDevice) => ({
          ...currentDevice,
          is_default: currentDevice.device_id === deviceId,
        })),
      );
      setHasDefaultCryptoDevice(true);
      setIsDefaultPasswordConfigured(true);
      if (deviceId !== currentCryptoDeviceId) {
        clearStoredRecoveryKey(user);
        setStoredRecoveryKey("");
        setIsStoredRecoveryKeyVisible(false);
      }
      onToast?.({
        type: "success",
        title: "Default device updated",
        message: "Only the selected device can manage linked devices now.",
      });
      setIsDefaultDeviceSelectionRequired(false);
      if (shouldCloseRequiredPrompt) {
        resetLinkedDevicesModal();
      } else {
        closeDefaultDevicePasswordPrompt({ force: true });
      }
      onDefaultDeviceChanged?.({
        ...device,
        is_default: true,
      });
    } catch (error) {
      setDefaultDevicePasswordMessage({
        type: "error",
        text: getMessengerErrorMessage(error, "Unable to update the default device."),
      });
    } finally {
      setDefaultingDeviceId("");
      setIsDefaultDevicePasswordSaving(false);
    }
  };

  const openDefaultDevicePasswordUpdateModal = () => {
    if (!canUpdateDefaultDevicePassword) {
      return;
    }

    setDefaultDevicePasswordUpdateForm({
      ...defaultDevicePasswordUpdateInitialForm,
    });
    setDefaultDevicePasswordUpdateMessage(null);
    setIsCurrentDefaultDevicePasswordVisible(false);
    setIsNewDefaultDevicePasswordVisible(false);
    setIsConfirmNewDefaultDevicePasswordVisible(false);
    setIsDefaultPasswordUpdateModalOpen(true);
  };

  const closeDefaultDevicePasswordUpdateModal = () => {
    if (isDefaultDevicePasswordUpdating) {
      return;
    }

    setIsDefaultPasswordUpdateModalOpen(false);
    setDefaultDevicePasswordUpdateForm({
      ...defaultDevicePasswordUpdateInitialForm,
    });
    setDefaultDevicePasswordUpdateMessage(null);
    setIsCurrentDefaultDevicePasswordVisible(false);
    setIsNewDefaultDevicePasswordVisible(false);
    setIsConfirmNewDefaultDevicePasswordVisible(false);
  };

  const handleDefaultDevicePasswordUpdateSubmit = async (event) => {
    event.preventDefault();

    if (!canUpdateDefaultDevicePassword) {
      setDefaultDevicePasswordUpdateMessage({
        type: "error",
        text: "Only the current default device can update this password.",
      });
      return;
    }

    if (
      defaultDevicePasswordUpdateForm.current_password.length <
        DEFAULT_DEVICE_PASSWORD_MIN_LENGTH ||
      defaultDevicePasswordUpdateForm.new_password.length <
        DEFAULT_DEVICE_PASSWORD_MIN_LENGTH
    ) {
      setDefaultDevicePasswordUpdateMessage({
        type: "error",
        text: `Default device passwords must be at least ${DEFAULT_DEVICE_PASSWORD_MIN_LENGTH} characters.`,
      });
      return;
    }

    if (
      defaultDevicePasswordUpdateForm.new_password !==
      defaultDevicePasswordUpdateForm.confirm_new_password
    ) {
      setDefaultDevicePasswordUpdateMessage({
        type: "error",
        text: "New default device passwords do not match.",
      });
      return;
    }

    if (
      defaultDevicePasswordUpdateForm.current_password ===
      defaultDevicePasswordUpdateForm.new_password
    ) {
      setDefaultDevicePasswordUpdateMessage({
        type: "error",
        text: "New default device password must be different.",
      });
      return;
    }

    setIsDefaultDevicePasswordUpdating(true);
    setDefaultDevicePasswordUpdateMessage(null);

    try {
      await updateDefaultMessengerDevicePassword(user, {
        currentPassword: defaultDevicePasswordUpdateForm.current_password,
        newPassword: defaultDevicePasswordUpdateForm.new_password,
      });
      setDefaultDevicePasswordUpdateForm({
        ...defaultDevicePasswordUpdateInitialForm,
      });
      setIsDefaultPasswordUpdateModalOpen(false);
      onToast?.({
        type: "success",
        title: "Default password updated",
        message: "Use the new password for future default-device changes.",
      });
    } catch (error) {
      setDefaultDevicePasswordUpdateMessage({
        type: "error",
        text: getMessengerErrorMessage(
          error,
          "Unable to update the default device password.",
        ),
      });
    } finally {
      setIsDefaultDevicePasswordUpdating(false);
    }
  };

  const handleRecoveryKeyUpdateSubmit = async (event) => {
    event.preventDefault();

    if (!canManageCryptoDevices) {
      setRecoveryKeyMessage({
        type: "error",
        text: "Only the current default device can update the recovery key.",
      });
      return;
    }

    if (recoveryKeyForm.recovery_key !== recoveryKeyForm.confirm_recovery_key) {
      setRecoveryKeyMessage({
        type: "error",
        text: "Recovery keys do not match.",
      });
      return;
    }

    setIsRecoveryKeySaving(true);
    setRecoveryKeyMessage(null);

    try {
      await saveRecoveryKeyBackup(user, recoveryKeyForm.recovery_key);
      setStoredRecoveryKey(recoveryKeyForm.recovery_key);
      setIsStoredRecoveryKeyVisible(false);
      setRecoveryKeyForm({
        recovery_key: "",
        confirm_recovery_key: "",
      });
      setRecoveryKeyMessage({
        type: "success",
        text: "Recovery key updated.",
      });
      onToast?.({
        type: "success",
        title: "Recovery key updated",
        message: "This key can recover old encrypted messages on another device.",
      });
    } catch (error) {
      setRecoveryKeyMessage({
        type: "error",
        text: error?.message || "Unable to update recovery key.",
      });
    } finally {
      setIsRecoveryKeySaving(false);
    }
  };

  const handleChangePasswordSubmit = async (event) => {
    event.preventDefault();

    setIsPasswordChanging(true);
    setAccountMessage(null);

    try {
      const response = await changeParentPassword({
        username: accountForm.username.trim(),
        email: accountForm.email.trim(),
        current_password: accountForm.current_password,
        new_password: accountForm.new_password,
      });

      setAccountForm((currentForm) => ({
        ...currentForm,
        current_password: "",
        new_password: "",
      }));
      setAccountMessage({
        type: "success",
        text: response.data?.message || "Password changed successfully.",
      });
      onToast?.({
        type: "success",
        title: "Password changed",
        message: "Your account password was updated.",
      });
    } catch (error) {
      const errorMessage = getApiErrorMessage(
        error,
        "Unable to change your password.",
      );

      setAccountMessage({
        type: "error",
        text: errorMessage,
      });
      onToast?.({
        type: "error",
        title: "Password change failed",
        message: errorMessage,
      });
    } finally {
      setIsPasswordChanging(false);
    }
  };

  const renderCryptoDeviceCard = (device, { isPrimaryDefault = false } = {}) => {
    const isCurrent = device.device_id === currentCryptoDeviceId;
    const isDefault = Boolean(device.is_default);
    const isRevoking = revokingDeviceId === device.device_id;
    const isDefaulting = defaultingDeviceId === device.device_id;
    const isCreatingDefaultPasswordForCurrentDefault =
      isDefault && isCurrent && !isDefaultPasswordConfigured;
    const deviceName =
      device.device_name || (isCurrent ? "This device" : "Linked device");
    const canSetDefault = canMakeCryptoDeviceDefault(device);
    const canRevoke = isCurrent || (canManageCryptoDevices && !isDefault);
    const showDefaultAction = canSetDefault || isDefaulting;
    const showRevokeAction = canRevoke || isRevoking;
    const hasActions = showDefaultAction || showRevokeAction;

    return (
      <article
        className={`parent-layout-page__crypto-device${
          isPrimaryDefault
            ? " parent-layout-page__crypto-device--default"
            : ""
        }`}
        key={device.device_id}
      >
        <div>
          <div className="parent-layout-page__crypto-device-title">
            <strong>{deviceName}</strong>
            {isCurrent ? (
              <span className="parent-layout-page__crypto-device-badge parent-layout-page__crypto-device-badge--current">
                This device
              </span>
            ) : null}
            {isDefault ? (
              <span className="parent-layout-page__crypto-device-badge">
                Default
              </span>
            ) : null}
          </div>
          <small>Last seen {formatDeviceTime(device.last_seen_at)}</small>
        </div>

        {hasActions ? (
          <div className="parent-layout-page__crypto-device-actions">
            {showDefaultAction ? (
              <button
                type="button"
                className="parent-layout-page__crypto-device-default"
                onClick={() => handleSetDefaultCryptoDevice(device)}
                disabled={isDefaulting}
                title={
                  isCreatingDefaultPasswordForCurrentDefault
                    ? "Set default password"
                    : "Make default"
                }
                aria-busy={isDefaulting}
              >
                {isDefaulting ? (
                  <LoaderCircle className="app-button-spinner" aria-hidden="true" />
                ) : (
                  <ShieldCheck size={15} aria-hidden="true" />
                )}
                <span>
                  {isDefaulting
                    ? "Saving"
                    : isCreatingDefaultPasswordForCurrentDefault
                      ? "Set password"
                      : "Make default"}
                </span>
              </button>
            ) : null}

            {showRevokeAction ? (
              <button
                type="button"
                className="parent-layout-page__crypto-device-revoke"
                onClick={() => handleRevokeCryptoDevice(device)}
                disabled={isRevoking}
                title={isCurrent ? "Log out this browser" : "Revoke device"}
                aria-busy={isRevoking}
              >
                {isRevoking ? (
                  <LoaderCircle className="app-button-spinner" aria-hidden="true" />
                ) : (
                  <Trash2 size={15} aria-hidden="true" />
                )}
                <span>
                  {isRevoking
                    ? isCurrent
                      ? "Logging out"
                      : "Revoking"
                    : isCurrent
                      ? "Logout"
                      : "Revoke"}
                </span>
              </button>
            ) : null}
          </div>
        ) : null}
      </article>
    );
  };

  const handleDeleteAccountSubmit = async (event) => {
    event.preventDefault();

    setIsAccountDeleting(true);
    setAccountMessage(null);

    try {
      const response = await deleteParentAccount({
        username: accountForm.username.trim(),
        email: accountForm.email.trim(),
        password: accountForm.password,
      });

      closeAccountModal();
      onToast?.({
        type: "success",
        title: "Account deleted",
        message: response.data?.message || "Account deleted successfully.",
        details: getAccountToastDetails(accountDisplay),
      });
      window.setTimeout(() => {
        onLogout?.();
      }, 900);
    } catch (error) {
      const errorMessage = getApiErrorMessage(
        error,
        "Unable to delete your account.",
      );

      setAccountMessage({
        type: "error",
        text: errorMessage,
      });
      onToast?.({
        type: "error",
        title: "Account deletion failed",
        message: errorMessage,
      });
    } finally {
      setIsAccountDeleting(false);
    }
  };

  const handleProfileSubmit = async (event) => {
    event.preventDefault();

    const pendingProfilePictureFile = profileForm.profile_picture_file;
    setIsProfileSaving(true);
    setProfileMessage(null);

    try {
      const response = await updateParentProfile(buildProfilePayload(profileForm));
      const updatedProfile = response.data || {};

      syncProfile(updatedProfile);
      if (pendingProfilePictureFile) {
        setProfileForm((currentForm) => ({
          ...currentForm,
          profile_picture_file: pendingProfilePictureFile,
        }));
      }
      if (!pendingProfilePictureFile) {
        setActiveProfileTab("view");
      }
      setProfileMessage({
        type: "success",
        text: "Profile updated successfully.",
      });
      onToast?.({
        type: "success",
        title: "Profile updated",
        message: "Your profile changes were saved.",
        details: getProfileToastDetails(updatedProfile),
      });
    } catch (error) {
      const errorMessage = getApiErrorMessage(
        error,
        "Unable to update your profile.",
      );

      setProfileMessage({
        type: "error",
        text: errorMessage,
      });
      onToast?.({
        type: "error",
        title: "Profile update failed",
        message: errorMessage,
      });
    } finally {
      setIsProfileSaving(false);
    }
  };

  const handleProfilePictureUpload = async () => {
    const pictureFile = profileForm.profile_picture_file;

    if (!pictureFile) {
      return;
    }

    const preservedForm = profileForm;
    setIsProfileSaving(true);
    setProfileMessage(null);

    try {
      const response = await updateParentProfile({
        profile_picture: pictureFile,
      });
      const updatedProfile = response.data || {};

      syncProfile(updatedProfile);
      setProfileForm({
        ...getProfileForm(updatedProfile),
        ...profilePayloadFields.reduce(
          (formValues, fieldName) => ({
            ...formValues,
            [fieldName]: preservedForm[fieldName],
          }),
          {},
        ),
        card_type: preservedForm.card_type,
        profile_picture_file: null,
      });
      if (profilePictureInputRef.current) {
        profilePictureInputRef.current.value = "";
      }
      setProfileMessage({
        type: "success",
        text: "Profile picture uploaded successfully.",
      });
      onToast?.({
        type: "success",
        title: "Profile picture updated",
        message: "Your new profile picture was saved.",
      });
    } catch (error) {
      const errorMessage = getApiErrorMessage(
        error,
        "Unable to upload your profile picture.",
      );

      setProfileMessage({
        type: "error",
        text: errorMessage,
      });
      onToast?.({
        type: "error",
        title: "Profile picture upload failed",
        message: errorMessage,
      });
    } finally {
      setIsProfileSaving(false);
    }
  };

  const handleProfilePictureClear = () => {
    setProfileForm((currentForm) => ({
      ...currentForm,
      profile_picture_file: null,
    }));
    setProfilePictureCropFile(null);
    if (profilePictureInputRef.current) {
      profilePictureInputRef.current.value = "";
    }
    setProfileMessage(null);
  };

  const profileModal = isProfileModalOpen ? (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal parent-layout-page__modal--profile"
        aria-modal="true"
        aria-labelledby="parent-profile-title"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close"
          type="button"
          onClick={closeProfileModal}
          aria-label="Close profile"
          title="Close"
        >
          <X size={28} strokeWidth={3} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header">
          <ParrotIcon />
          <div>
            <h2 id="parent-profile-title">Profile</h2>
          </div>
        </div>

        <nav
          className="parent-layout-page__profile-tabs"
          aria-label="Profile tabs"
          role="tablist"
        >
          <button
            className={activeProfileTab === "view" ? "is-active" : ""}
            type="button"
            onClick={openViewProfileTab}
            role="tab"
            aria-controls="parent-profile-view"
            aria-selected={activeProfileTab === "view"}
          >
            <UserRound size={16} aria-hidden="true" />
            <span>Get Profile</span>
          </button>
          <button
            className={activeProfileTab === "edit" ? "is-active" : ""}
            type="button"
            onClick={openEditProfileTab}
            role="tab"
            aria-controls="parent-profile-edit"
            aria-selected={activeProfileTab === "edit"}
          >
            <Pencil size={16} aria-hidden="true" />
            <span>Edit Profile</span>
          </button>
        </nav>

        <div className="parent-layout-page__profile-content">
          {profileMessage ? (
            <p
              className={`parent-layout-page__form-message parent-layout-page__form-message--${profileMessage.type}`}
              role="alert"
            >
              {profileMessage.type === "success" ? (
                <CheckCircle2 size={18} aria-hidden="true" />
              ) : (
                <AlertCircle size={18} aria-hidden="true" />
              )}
              <span>{profileMessage.text}</span>
            </p>
          ) : null}

          {activeProfileTab === "view" ? (
            <div
              className="parent-layout-page__profile-view"
              id="parent-profile-view"
              role="tabpanel"
            >
              {isProfileLoading ? (
                <div
                  className="parent-layout-page__profile-loading"
                  aria-live="polite"
                >
                  <span />
                  <span />
                  <span />
                </div>
              ) : (
                <>
                  <div className="parent-layout-page__profile-identity">
                    <SmartAvatar
                      className="parent-layout-page__profile-picture"
                      src={profilePicture}
                      firstName={displayProfile?.first_name}
                      lastName={displayProfile?.last_name}
                      username={username}
                      fallback="P"
                    />
                    <div>
                      <strong>{getProfileName(displayProfile, username)}</strong>
                      <small>
                        {username} / {accountNumber}
                      </small>
                    </div>
                  </div>

                  <dl className="parent-layout-page__profile-details">
                    {profileDetailFields.map((field) => (
                      <div key={field.key}>
                        <dt>{field.label}</dt>
                        <dd>{getProfileValue(displayProfile, field)}</dd>
                      </div>
                    ))}
                    <div>
                      <dt>Address</dt>
                      <dd>{getProfileAddress(displayProfile)}</dd>
                    </div>
                  </dl>
                </>
              )}
            </div>
          ) : (
            <form
              className="parent-layout-page__profile-form"
              id="parent-profile-edit"
              role="tabpanel"
              onSubmit={handleProfileSubmit}
            >
              <div className="parent-layout-page__profile-form-grid">
                {profileTextFields.map((field) => (
                  <label
                    className="parent-layout-page__profile-field"
                    key={field.name}
                  >
                    <span className="parent-layout-page__field-label">
                      {field.label}
                    </span>
                    <input
                      name={field.name}
                      type="text"
                      value={profileForm[field.name]}
                      onChange={handleProfileFormChange}
                      autoComplete={field.autoComplete || "off"}
                      inputMode={field.inputMode || "text"}
                      maxLength={field.name === "card_number" ? 32 : 120}
                    />
                  </label>
                ))}

                <label className="parent-layout-page__profile-field">
                  <span className="parent-layout-page__field-label">
                    Card Type
                  </span>
                  <select
                    name="card_type"
                    value={profileForm.card_type}
                    onChange={handleProfileFormChange}
                  >
                    <option value="">Not saved</option>
                    <option value="credit">Credit</option>
                    <option value="debit">Debit</option>
                  </select>
                </label>

                <div className="parent-layout-page__profile-picture-editor parent-layout-page__profile-field--wide">
                  <SmartAvatar
                    className="parent-layout-page__profile-picture"
                    src={profilePicturePreviewUrl || profilePicture}
                    firstName={profileForm.first_name || displayProfile?.first_name}
                    lastName={profileForm.last_name || displayProfile?.last_name}
                    username={username}
                    fallback="P"
                  />
                  <div className="parent-layout-page__profile-picture-editor-copy">
                    <strong>
                      {profilePicturePreviewUrl
                        ? "Preview selected picture"
                        : "Current profile picture"}
                    </strong>
                    <small>
                      {profileForm.profile_picture_file?.name ||
                        "Choose an image, preview it here, then upload."}
                    </small>
                    <div className="parent-layout-page__picture-actions">
                      <label className="parent-layout-page__picture-action">
                        <Camera size={15} aria-hidden="true" />
                        <span>Choose</span>
                        <input
                          ref={profilePictureInputRef}
                          name="profile_picture_file"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={handleProfileFormChange}
                          disabled={isProfileSaving}
                        />
                      </label>
                      <button
                        className="parent-layout-page__picture-action is-primary"
                        type="button"
                        onClick={handleProfilePictureUpload}
                        disabled={isProfileSaving || !profileForm.profile_picture_file}
                        aria-busy={isProfileSaving}
                      >
                        {isProfileSaving ? (
                          <LoaderCircle className="app-button-spinner" aria-hidden="true" />
                        ) : (
                          <Save size={15} aria-hidden="true" />
                        )}
                        <span>{isProfileSaving ? "Uploading" : "Upload"}</span>
                      </button>
                      {profileForm.profile_picture_file ? (
                        <button
                          className="parent-layout-page__picture-action"
                          type="button"
                          onClick={handleProfilePictureClear}
                          disabled={isProfileSaving}
                        >
                          <X size={15} aria-hidden="true" />
                          <span>Cancel</span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <button
                className="parent-layout-page__modal-submit"
                type="submit"
                disabled={isProfileSaving}
                aria-busy={isProfileSaving}
              >
                {isProfileSaving ? (
                  <LoaderCircle className="app-button-spinner" aria-hidden="true" />
                ) : (
                  <Save size={18} aria-hidden="true" />
                )}
                <span>{isProfileSaving ? "Saving..." : "Save Profile"}</span>
              </button>
            </form>
          )}
        </div>
      </section>
      <ImageCropper
        file={profilePictureCropFile}
        title="Crop Profile Picture"
        onCancel={handleProfilePictureCropCancel}
        onCrop={handleProfilePictureCrop}
      />
    </div>
  ) : null;

  const accountModal = isAccountModalOpen ? (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal parent-layout-page__modal--account"
        aria-modal="true"
        aria-labelledby="parent-account-title"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close"
          type="button"
          onClick={closeAccountModal}
          aria-label="Close account"
          title="Close"
        >
          <X size={28} strokeWidth={3} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header">
          <ParrotIcon />
          <div>
            <h2 id="parent-account-title">Account</h2>
          </div>
        </div>

        <nav
          className="parent-layout-page__profile-tabs"
          aria-label="Account tabs"
          role="tablist"
        >
          <button
            className={activeAccountTab === "password" ? "is-active" : ""}
            type="button"
            onClick={openChangePasswordTab}
            role="tab"
            aria-controls="parent-account-password"
            aria-selected={activeAccountTab === "password"}
          >
            <KeyRound size={16} aria-hidden="true" />
            <span>Password</span>
          </button>
          <button
            className={activeAccountTab === "delete" ? "is-active" : ""}
            type="button"
            onClick={openDeleteAccountTab}
            role="tab"
            aria-controls="parent-account-delete"
            aria-selected={activeAccountTab === "delete"}
          >
            <Trash2 size={16} aria-hidden="true" />
            <span>Delete</span>
          </button>
        </nav>

        <div className="parent-layout-page__profile-content">
          {accountMessage ? (
            <p
              className={`parent-layout-page__form-message parent-layout-page__form-message--${accountMessage.type}`}
              role="alert"
            >
              {accountMessage.type === "success" ? (
                <CheckCircle2 size={18} aria-hidden="true" />
              ) : (
                <AlertCircle size={18} aria-hidden="true" />
              )}
              <span>{accountMessage.text}</span>
            </p>
          ) : null}

          {activeAccountTab === "password" ? (
            <form
              className="parent-layout-page__profile-form"
              id="parent-account-password"
              role="tabpanel"
              onSubmit={handleChangePasswordSubmit}
            >
              <div className="parent-layout-page__profile-form-grid">
                <label className="parent-layout-page__profile-field">
                  <span className="parent-layout-page__field-label">
                    Username
                    <em className="is-required">Required</em>
                  </span>
                  <input
                    name="username"
                    type="text"
                    value={accountForm.username}
                    onChange={handleAccountFormChange}
                    autoComplete="username"
                    required
                  />
                </label>

                <label className="parent-layout-page__profile-field">
                  <span className="parent-layout-page__field-label">
                    Email
                    <em className="is-required">Required</em>
                  </span>
                  <input
                    name="email"
                    type="email"
                    value={accountForm.email}
                    onChange={handleAccountFormChange}
                    autoComplete="email"
                    required
                  />
                </label>

                <label className="parent-layout-page__profile-field">
                  <span className="parent-layout-page__field-label">
                    Current Password
                    <em className="is-required">Required</em>
                  </span>
                  <input
                    name="current_password"
                    type="password"
                    value={accountForm.current_password}
                    onChange={handleAccountFormChange}
                    autoComplete="current-password"
                    required
                  />
                </label>

                <label className="parent-layout-page__profile-field">
                  <span className="parent-layout-page__field-label">
                    New Password
                    <em className="is-required">Required</em>
                  </span>
                  <input
                    name="new_password"
                    type="password"
                    value={accountForm.new_password}
                    onChange={handleAccountFormChange}
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>
              </div>

              <button
                className="parent-layout-page__modal-submit"
                type="submit"
                disabled={isPasswordChanging}
                aria-busy={isPasswordChanging}
              >
                {isPasswordChanging ? (
                  <LoaderCircle className="app-button-spinner" aria-hidden="true" />
                ) : (
                  <KeyRound size={18} aria-hidden="true" />
                )}
                <span>
                  {isPasswordChanging ? "Changing..." : "Change Password"}
                </span>
              </button>
            </form>
          ) : null}

          {activeAccountTab === "delete" ? (
            <form
              className="parent-layout-page__profile-form"
              id="parent-account-delete"
              role="tabpanel"
              onSubmit={handleDeleteAccountSubmit}
            >
              <p className="parent-layout-page__account-danger">
                Account deletion is permanent.
              </p>

              <div className="parent-layout-page__profile-form-grid">
                <label className="parent-layout-page__profile-field">
                  <span className="parent-layout-page__field-label">
                    Username
                    <em className="is-required">Required</em>
                  </span>
                  <input
                    name="username"
                    type="text"
                    value={accountForm.username}
                    onChange={handleAccountFormChange}
                    autoComplete="username"
                    required
                  />
                </label>

                <label className="parent-layout-page__profile-field">
                  <span className="parent-layout-page__field-label">
                    Email
                    <em className="is-required">Required</em>
                  </span>
                  <input
                    name="email"
                    type="email"
                    value={accountForm.email}
                    onChange={handleAccountFormChange}
                    autoComplete="email"
                    required
                  />
                </label>

                <label className="parent-layout-page__profile-field parent-layout-page__profile-field--wide">
                  <span className="parent-layout-page__field-label">
                    Password
                    <em className="is-required">Required</em>
                  </span>
                  <input
                    name="password"
                    type="password"
                    value={accountForm.password}
                    onChange={handleAccountFormChange}
                    autoComplete="current-password"
                    required
                  />
                </label>
              </div>

              <button
                className="parent-layout-page__modal-submit parent-layout-page__modal-submit--danger"
                type="submit"
                disabled={isAccountDeleting}
                aria-busy={isAccountDeleting}
              >
                {isAccountDeleting ? (
                  <LoaderCircle className="app-button-spinner" aria-hidden="true" />
                ) : (
                  <Trash2 size={18} aria-hidden="true" />
                )}
                <span>
                  {isAccountDeleting ? "Deleting..." : "Delete Account"}
                </span>
              </button>
            </form>
          ) : null}

        </div>
      </section>
    </div>
  ) : null;

  const isDefaultPasswordTargetAlreadyDefault = Boolean(
    defaultPasswordTargetDevice?.is_default,
  );
  const isCreatingDefaultDevicePassword =
    !isDefaultPasswordConfigured &&
    (!hasDefaultCryptoDevice || canManageCryptoDevices);
  const defaultPasswordTargetName =
    defaultPasswordTargetDevice?.device_name ||
    (defaultPasswordTargetDevice?.device_id === currentCryptoDeviceId
      ? "This device"
      : "Linked device");
  const defaultDevicePasswordModal = defaultPasswordTargetDevice ? (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal"
        aria-modal="true"
        aria-labelledby="parent-default-device-password-title"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close"
          type="button"
          onClick={closeDefaultDevicePasswordPrompt}
          aria-label="Close default device password"
          title="Close"
          disabled={isDefaultDevicePasswordSaving}
        >
          <X size={28} strokeWidth={3} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header">
          <ParrotIcon />
          <div>
            <h2 id="parent-default-device-password-title">
              {isCreatingDefaultDevicePassword
                ? "Create default password"
                : "Verify default password"}
            </h2>
          </div>
        </div>

        <form
          className="parent-layout-page__profile-form"
          onSubmit={handleDefaultDevicePasswordSubmit}
        >
          <p className="parent-layout-page__form-note">
            {isCreatingDefaultDevicePassword
              ? "Create this password before making the first default device. You will use it later to move default permission to another trusted browser."
              : `Enter the default-device password to make ${defaultPasswordTargetName} the default.`}
          </p>

          {defaultDevicePasswordMessage ? (
            <p
              className={`parent-layout-page__form-message parent-layout-page__form-message--${defaultDevicePasswordMessage.type}`}
              role="alert"
            >
              {defaultDevicePasswordMessage.type === "success" ? (
                <CheckCircle2 size={18} aria-hidden="true" />
              ) : (
                <AlertCircle size={18} aria-hidden="true" />
              )}
              <span>{defaultDevicePasswordMessage.text}</span>
            </p>
          ) : null}

          <label className="parent-layout-page__profile-field">
            <span className="parent-layout-page__field-label">
              Default device password
              <em className="is-required">Required</em>
            </span>
            <div className="parent-layout-page__table-input-action">
              <input
                name="password"
                type={isDefaultDevicePasswordVisible ? "text" : "password"}
                value={defaultDevicePasswordForm.password}
                onChange={handleDefaultDevicePasswordFormChange}
                autoComplete={
                  isCreatingDefaultDevicePassword ? "new-password" : "current-password"
                }
                minLength={DEFAULT_DEVICE_PASSWORD_MIN_LENGTH}
                disabled={isDefaultDevicePasswordSaving}
                required
              />
              <button
                className="parent-layout-page__table-icon-button"
                type="button"
                onClick={() =>
                  setIsDefaultDevicePasswordVisible(
                    (currentValue) => !currentValue,
                  )
                }
                disabled={isDefaultDevicePasswordSaving}
                aria-label={
                  isDefaultDevicePasswordVisible
                    ? "Hide default device password"
                    : "Show default device password"
                }
                title={
                  isDefaultDevicePasswordVisible
                    ? "Hide default device password"
                    : "Show default device password"
                }
              >
                {isDefaultDevicePasswordVisible ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>
          </label>

          {isCreatingDefaultDevicePassword ? (
            <label className="parent-layout-page__profile-field">
              <span className="parent-layout-page__field-label">
                Confirm password
                <em className="is-required">Required</em>
              </span>
              <div className="parent-layout-page__table-input-action">
                <input
                  name="confirm_password"
                  type={
                    isConfirmDefaultDevicePasswordVisible ? "text" : "password"
                  }
                  value={defaultDevicePasswordForm.confirm_password}
                  onChange={handleDefaultDevicePasswordFormChange}
                  autoComplete="new-password"
                  minLength={DEFAULT_DEVICE_PASSWORD_MIN_LENGTH}
                  disabled={isDefaultDevicePasswordSaving}
                  required
                />
                <button
                  className="parent-layout-page__table-icon-button"
                  type="button"
                  onClick={() =>
                    setIsConfirmDefaultDevicePasswordVisible(
                      (currentValue) => !currentValue,
                    )
                  }
                  disabled={isDefaultDevicePasswordSaving}
                  aria-label={
                    isConfirmDefaultDevicePasswordVisible
                      ? "Hide confirmation password"
                      : "Show confirmation password"
                  }
                  title={
                    isConfirmDefaultDevicePasswordVisible
                      ? "Hide confirmation password"
                      : "Show confirmation password"
                  }
                >
                  {isConfirmDefaultDevicePasswordVisible ? (
                    <EyeOff size={18} aria-hidden="true" />
                  ) : (
                    <Eye size={18} aria-hidden="true" />
                  )}
                </button>
              </div>
            </label>
          ) : null}

          <button
            className="parent-layout-page__modal-submit"
            type="submit"
            disabled={isDefaultDevicePasswordSaving}
            aria-busy={isDefaultDevicePasswordSaving}
          >
            {isDefaultDevicePasswordSaving ? (
              <LoaderCircle className="app-button-spinner" aria-hidden="true" />
            ) : (
              <ShieldCheck size={18} aria-hidden="true" />
            )}
            <span>
              {isDefaultDevicePasswordSaving
                ? "Saving..."
                : isCreatingDefaultDevicePassword
                  ? isDefaultPasswordTargetAlreadyDefault
                    ? "Create password"
                    : "Create and make default"
                  : "Verify and make default"}
            </span>
          </button>
        </form>
      </section>
    </div>
  ) : null;

  const defaultDevicePasswordUpdateModal = isDefaultPasswordUpdateModalOpen ? (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal"
        aria-modal="true"
        aria-labelledby="parent-default-device-password-update-title"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close"
          type="button"
          onClick={closeDefaultDevicePasswordUpdateModal}
          aria-label="Close default password update"
          title="Close"
          disabled={isDefaultDevicePasswordUpdating}
        >
          <X size={28} strokeWidth={3} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header">
          <ParrotIcon />
          <div>
            <h2 id="parent-default-device-password-update-title">
              Update default password
            </h2>
          </div>
        </div>

        <form
          className="parent-layout-page__profile-form"
          onSubmit={handleDefaultDevicePasswordUpdateSubmit}
        >
          <p className="parent-layout-page__form-note">
            This password controls future default-device changes. Only the
            current default device can update it.
          </p>

          {defaultDevicePasswordUpdateMessage ? (
            <p
              className={`parent-layout-page__form-message parent-layout-page__form-message--${defaultDevicePasswordUpdateMessage.type}`}
              role="alert"
            >
              {defaultDevicePasswordUpdateMessage.type === "success" ? (
                <CheckCircle2 size={18} aria-hidden="true" />
              ) : (
                <AlertCircle size={18} aria-hidden="true" />
              )}
              <span>{defaultDevicePasswordUpdateMessage.text}</span>
            </p>
          ) : null}

          <label className="parent-layout-page__profile-field">
            <span className="parent-layout-page__field-label">
              Current password
              <em className="is-required">Required</em>
            </span>
            <div className="parent-layout-page__table-input-action">
              <input
                name="current_password"
                type={isCurrentDefaultDevicePasswordVisible ? "text" : "password"}
                value={defaultDevicePasswordUpdateForm.current_password}
                onChange={handleDefaultDevicePasswordUpdateFormChange}
                autoComplete="current-password"
                minLength={DEFAULT_DEVICE_PASSWORD_MIN_LENGTH}
                disabled={isDefaultDevicePasswordUpdating}
                required
              />
              <button
                className="parent-layout-page__table-icon-button"
                type="button"
                onClick={() =>
                  setIsCurrentDefaultDevicePasswordVisible(
                    (currentValue) => !currentValue,
                  )
                }
                disabled={isDefaultDevicePasswordUpdating}
                aria-label={
                  isCurrentDefaultDevicePasswordVisible
                    ? "Hide current password"
                    : "Show current password"
                }
                title={
                  isCurrentDefaultDevicePasswordVisible
                    ? "Hide current password"
                    : "Show current password"
                }
              >
                {isCurrentDefaultDevicePasswordVisible ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>
          </label>

          <label className="parent-layout-page__profile-field">
            <span className="parent-layout-page__field-label">
              New password
              <em className="is-required">Required</em>
            </span>
            <div className="parent-layout-page__table-input-action">
              <input
                name="new_password"
                type={isNewDefaultDevicePasswordVisible ? "text" : "password"}
                value={defaultDevicePasswordUpdateForm.new_password}
                onChange={handleDefaultDevicePasswordUpdateFormChange}
                autoComplete="new-password"
                minLength={DEFAULT_DEVICE_PASSWORD_MIN_LENGTH}
                disabled={isDefaultDevicePasswordUpdating}
                required
              />
              <button
                className="parent-layout-page__table-icon-button"
                type="button"
                onClick={() =>
                  setIsNewDefaultDevicePasswordVisible(
                    (currentValue) => !currentValue,
                  )
                }
                disabled={isDefaultDevicePasswordUpdating}
                aria-label={
                  isNewDefaultDevicePasswordVisible
                    ? "Hide new password"
                    : "Show new password"
                }
                title={
                  isNewDefaultDevicePasswordVisible
                    ? "Hide new password"
                    : "Show new password"
                }
              >
                {isNewDefaultDevicePasswordVisible ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>
          </label>

          <label className="parent-layout-page__profile-field">
            <span className="parent-layout-page__field-label">
              Confirm new password
              <em className="is-required">Required</em>
            </span>
            <div className="parent-layout-page__table-input-action">
              <input
                name="confirm_new_password"
                type={
                  isConfirmNewDefaultDevicePasswordVisible ? "text" : "password"
                }
                value={defaultDevicePasswordUpdateForm.confirm_new_password}
                onChange={handleDefaultDevicePasswordUpdateFormChange}
                autoComplete="new-password"
                minLength={DEFAULT_DEVICE_PASSWORD_MIN_LENGTH}
                disabled={isDefaultDevicePasswordUpdating}
                required
              />
              <button
                className="parent-layout-page__table-icon-button"
                type="button"
                onClick={() =>
                  setIsConfirmNewDefaultDevicePasswordVisible(
                    (currentValue) => !currentValue,
                  )
                }
                disabled={isDefaultDevicePasswordUpdating}
                aria-label={
                  isConfirmNewDefaultDevicePasswordVisible
                    ? "Hide confirmation password"
                    : "Show confirmation password"
                }
                title={
                  isConfirmNewDefaultDevicePasswordVisible
                    ? "Hide confirmation password"
                    : "Show confirmation password"
                }
              >
                {isConfirmNewDefaultDevicePasswordVisible ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>
          </label>

          <button
            className="parent-layout-page__modal-submit"
            type="submit"
            disabled={isDefaultDevicePasswordUpdating}
            aria-busy={isDefaultDevicePasswordUpdating}
          >
            {isDefaultDevicePasswordUpdating ? (
              <LoaderCircle className="app-button-spinner" aria-hidden="true" />
            ) : (
              <KeyRound size={18} aria-hidden="true" />
            )}
            <span>
              {isDefaultDevicePasswordUpdating ? "Updating..." : "Update password"}
            </span>
          </button>
        </form>
      </section>
    </div>
  ) : null;

  const blockManagementModal = isBlockManagementModalOpen ? (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal parent-layout-page__modal--account parent-layout-page__block-management-modal"
        aria-modal="true"
        aria-labelledby="parent-block-management-title"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close"
          type="button"
          onClick={closeBlockManagementModal}
          aria-label="Close block management"
          title="Close"
          disabled={Boolean(blockActionAccountNumber)}
        >
          <X size={28} strokeWidth={3} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header">
          <span
            className="parent-layout-page__block-management-icon"
            aria-hidden="true"
          >
            <Ban size={24} />
          </span>
          <div>
            <h2 id="parent-block-management-title">Block Management</h2>
          </div>
        </div>

        <div className="parent-layout-page__block-management">
          <div className="parent-layout-page__block-management-summary">
            <span>
              <strong>
                {blockedContactsCount}/{blockManagementContacts.length}
              </strong>
              <small>contacts are blocked</small>
            </span>
          </div>

          <label className="parent-layout-page__block-management-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={blockManagementSearch}
              onChange={(event) => setBlockManagementSearch(event.target.value)}
              placeholder="Search contacts"
              aria-label="Search contacts"
            />
          </label>

          {blockManagementMessage ? (
            <p
              className={
                blockManagementMessage.type === "error"
                  ? "parent-layout-page__modal-error"
                  : "parent-layout-page__form-note"
              }
              role={blockManagementMessage.type === "error" ? "alert" : "status"}
            >
              {blockManagementMessage.text}
            </p>
          ) : null}

          {isBlockManagementLoading && blockManagementContacts.length === 0 ? (
            <div
              className="parent-layout-page__block-management-empty"
              aria-live="polite"
            >
              Loading contacts
            </div>
          ) : blockManagementContacts.length === 0 ? (
            <div className="parent-layout-page__block-management-empty">
              No contacts yet.
            </div>
          ) : filteredBlockManagementContacts.length === 0 ? (
            <div className="parent-layout-page__block-management-empty">
              No matching contacts.
            </div>
          ) : (
            <div className="parent-layout-page__block-management-list">
              {filteredBlockManagementContacts.map((contact) => {
                const isBlocked = Boolean(contact.blocked);
                const isUpdating =
                  blockActionAccountNumber === contact.account_number;

                return (
                  <div
                    className={`parent-layout-page__block-management-row${
                      isBlocked ? " is-blocked" : ""
                    }`}
                    key={contact.account_number}
                  >
                    <SmartAvatar
                      className="parent-layout-page__contact-avatar"
                      src={contact.profile_picture}
                      initials={getContactInitials(contact)}
                      firstName={contact.first_name}
                      lastName={contact.last_name}
                      name={getContactName(contact)}
                      username={contact.username}
                      fallback="P"
                    />

                    <span className="parent-layout-page__contact-text">
                      <strong>{getContactName(contact)}</strong>
                      <small>{contact.account_number}</small>
                    </span>

                    <span
                      className={`parent-layout-page__block-management-status${
                        isBlocked ? " is-blocked" : ""
                      }`}
                    >
                      {isBlocked ? "Blocked" : "Block"}
                    </span>

                    <button
                      className={`parent-layout-page__block-management-switch parent-layout-page__block-toggle${
                        isBlocked ? " is-blocked" : " is-unblocked"
                      }`}
                      type="button"
                      role="switch"
                      aria-checked={isBlocked}
                      aria-label={`${isBlocked ? "Unblock" : "Block"} ${getContactName(contact)}`}
                      title={isBlocked ? "Blocked" : "Not blocked"}
                      onClick={() => handleToggleManagedContactBlock(contact)}
                      disabled={Boolean(blockActionAccountNumber)}
                      aria-busy={isUpdating}
                    >
                      {isUpdating ? (
                        <LoaderCircle className="app-button-spinner" aria-hidden="true" />
                      ) : (
                        <span
                          className="parent-layout-page__block-toggle-switch"
                          aria-hidden="true"
                        >
                          <span />
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  ) : null;

  const ghostManagementModal = isGhostManagementModalOpen ? (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal parent-layout-page__modal--account parent-layout-page__block-management-modal parent-layout-page__ghost-management-modal"
        aria-modal="true"
        aria-labelledby="parent-ghost-management-title"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close"
          type="button"
          onClick={closeGhostManagementModal}
          aria-label="Close ghost management"
          title="Close"
          disabled={Boolean(ghostActionAccountNumber)}
        >
          <X size={28} strokeWidth={3} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header">
          <span
            className="parent-layout-page__block-management-icon parent-layout-page__ghost-management-icon"
            aria-hidden="true"
          >
            <EyeOff size={24} />
          </span>
          <div>
            <h2 id="parent-ghost-management-title">Ghost Management</h2>
          </div>
        </div>

        <div className="parent-layout-page__block-management">
          <div className="parent-layout-page__block-management-summary">
            <span>
              <strong>
                {ghostedContactsCount}/{ghostManagementContacts.length}
              </strong>
              <small>contacts are ghosted</small>
            </span>
          </div>

          <label className="parent-layout-page__block-management-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={ghostManagementSearch}
              onChange={(event) => setGhostManagementSearch(event.target.value)}
              placeholder="Search contacts"
              aria-label="Search contacts"
            />
          </label>

          {ghostManagementMessage ? (
            <p
              className={
                ghostManagementMessage.type === "error"
                  ? "parent-layout-page__modal-error"
                  : "parent-layout-page__form-note"
              }
              role={ghostManagementMessage.type === "error" ? "alert" : "status"}
            >
              {ghostManagementMessage.text}
            </p>
          ) : null}

          {isGhostManagementLoading && ghostManagementContacts.length === 0 ? (
            <div
              className="parent-layout-page__block-management-empty"
              aria-live="polite"
            >
              Loading contacts
            </div>
          ) : ghostManagementContacts.length === 0 ? (
            <div className="parent-layout-page__block-management-empty">
              No contacts yet.
            </div>
          ) : filteredGhostManagementContacts.length === 0 ? (
            <div className="parent-layout-page__block-management-empty">
              No matching contacts.
            </div>
          ) : (
            <div className="parent-layout-page__block-management-list">
              {filteredGhostManagementContacts.map((contact) => {
                const isGhosted = Boolean(contact.ghosted);
                const isBlocked = Boolean(contact.blocked);
                const isUpdating =
                  ghostActionAccountNumber === contact.account_number;

                return (
                  <div
                    className={`parent-layout-page__block-management-row${
                      isGhosted ? " is-ghosted" : ""
                    }`}
                    key={contact.account_number}
                  >
                    <SmartAvatar
                      className="parent-layout-page__contact-avatar"
                      src={contact.profile_picture}
                      initials={getContactInitials(contact)}
                      firstName={contact.first_name}
                      lastName={contact.last_name}
                      name={getContactName(contact)}
                      username={contact.username}
                      fallback="P"
                    />

                    <span className="parent-layout-page__contact-text">
                      <strong>{getContactName(contact)}</strong>
                      <small>{contact.account_number}</small>
                    </span>

                    <span
                      className={`parent-layout-page__block-management-status${
                        isGhosted ? " is-ghosted" : ""
                      }`}
                    >
                      {isGhosted ? "Ghosted" : "Ghost"}
                    </span>

                    <button
                      className={`parent-layout-page__block-management-switch parent-layout-page__block-toggle${
                        isGhosted ? " is-ghosted" : " is-visible"
                      }`}
                      type="button"
                      role="switch"
                      aria-checked={isGhosted}
                      aria-label={`${isGhosted ? "Remove ghosting for" : "Ghost"} ${getContactName(contact)}`}
                      title={isGhosted ? "Ghosted" : "Not ghosted"}
                      onClick={() => handleToggleManagedContactGhost(contact)}
                      disabled={Boolean(ghostActionAccountNumber)}
                      aria-busy={isUpdating}
                    >
                      {isUpdating ? (
                        <LoaderCircle className="app-button-spinner" aria-hidden="true" />
                      ) : (
                        <span
                          className="parent-layout-page__block-toggle-switch"
                          aria-hidden="true"
                        >
                          <span />
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  ) : null;

  const mySavesModal = isMySavesModalOpen ? (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal parent-layout-page__modal--account parent-layout-page__my-saves-modal"
        aria-modal="true"
        aria-labelledby="parent-my-saves-title"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close"
          type="button"
          onClick={closeMySavesModal}
          aria-label="Close My Saves"
          title="Close"
          disabled={Boolean(mySavesActionId)}
        >
          <X size={28} strokeWidth={3} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header">
          <span
            className="parent-layout-page__block-management-icon parent-layout-page__my-saves-icon"
            aria-hidden="true"
          >
            <Save size={24} />
          </span>
          <div>
            <h2 id="parent-my-saves-title">My Saves</h2>
          </div>
        </div>

        <div className="parent-layout-page__my-saves">
          <div className="parent-layout-page__block-management-summary">
            <span>
              <strong>{mySaves.length}</strong>
              <small>saved messages</small>
            </span>
          </div>

          {mySavesMessage ? (
            <p
              className={
                mySavesMessage.type === "error"
                  ? "parent-layout-page__modal-error"
                  : "parent-layout-page__form-note"
              }
              role={mySavesMessage.type === "error" ? "alert" : "status"}
            >
              {mySavesMessage.text}
            </p>
          ) : null}

          {isMySavesLoading && mySaves.length === 0 ? (
            <div
              className="parent-layout-page__block-management-empty"
              aria-live="polite"
            >
              Loading saved messages
            </div>
          ) : mySaves.length === 0 ? (
            <div className="parent-layout-page__block-management-empty">
              No saved messages yet.
            </div>
          ) : (
            <div className="parent-layout-page__my-saves-list">
              {mySaves.map((save) => {
                const message = save.message || {};
                const isGroupSave = save.message_kind === "group";
                const text = getSavedMessageText(save);
                const attachments = getSavedMessageAttachments(
                  message,
                  save.message_kind,
                );
                const reactions = Array.isArray(message.reactions)
                  ? message.reactions
                  : [];
                const visibleReactions = reactions
                  .map(getSavedReactionLabel)
                  .filter(Boolean);
                const senderLabel = getSavedMessageSenderLabel(
                  save,
                  currentUserId,
                );
                const receivedLabel =
                  save.direction === "outgoing" ? "Sent" : "Received";
                const groupOwner = save.group?.owner || {};
                const groupOwnerLabel =
                  groupOwner.display_name ||
                  groupOwner.account_number ||
                  (save.group?.created_by_user_id
                    ? `User ${save.group.created_by_user_id}`
                    : "");
                const actionId = `${save.message_kind}:${message.id}`;
                const isRemoving = mySavesActionId === actionId;

                return (
                  <article
                    className={`parent-layout-page__my-save${
                      isGroupSave ? " is-group" : " is-direct"
                    }`}
                    key={save.id}
                  >
                    <header className="parent-layout-page__my-save-header">
                      <div>
                        <strong>{senderLabel}</strong>
                        <span>
                          {isGroupSave
                            ? save.group?.title || `Group ${save.room?.id || ""}`
                            : "Direct message"}
                        </span>
                      </div>

                      <div
                        className="parent-layout-page__my-save-menu-wrap"
                        data-my-save-menu
                      >
                        <button
                          className="parent-layout-page__my-save-menu-button"
                          type="button"
                          onClick={() =>
                            setActiveMySaveMetaId((currentId) =>
                              currentId === save.id ? null : save.id,
                            )
                          }
                          aria-expanded={activeMySaveMetaId === save.id}
                          aria-label="Saved message details"
                          title="Details"
                          disabled={Boolean(mySavesActionId)}
                        >
                          <MoreVertical size={18} aria-hidden="true" />
                        </button>

                        {activeMySaveMetaId === save.id ? (
                          <div className="parent-layout-page__my-save-menu">
                            <dl className="parent-layout-page__my-save-meta">
                              <div>
                                <dt>{receivedLabel}</dt>
                                <dd>{formatSavedDateTime(save.received_at)}</dd>
                              </div>
                              <div>
                                <dt>Saved</dt>
                                <dd>{formatSavedDateTime(save.saved_at)}</dd>
                              </div>
                              {isGroupSave && groupOwnerLabel ? (
                                <div>
                                  <dt>Owner</dt>
                                  <dd>{groupOwnerLabel}</dd>
                                </div>
                              ) : null}
                            </dl>

                            <button
                              className="parent-layout-page__my-save-remove"
                              type="button"
                              onClick={() => handleRemoveSavedMessage(save)}
                              disabled={Boolean(mySavesActionId)}
                              aria-busy={isRemoving}
                            >
                              {isRemoving ? (
                                <LoaderCircle
                                  className="app-button-spinner"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Trash2 size={15} aria-hidden="true" />
                              )}
                              <span>
                                {isRemoving ? "Removing..." : "Remove save"}
                              </span>
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </header>

                    {attachments.length > 0 ? (
                      <SavedAttachmentPreviewGrid
                        attachments={attachments}
                        onOpen={handleOpenSavedAttachmentViewer}
                      />
                    ) : null}

                    {text ? (
                      <p className="parent-layout-page__my-save-text">{text}</p>
                    ) : message.decryption_status &&
                      message.decryption_status !== "ok" ? (
                      <p className="parent-layout-page__my-save-text is-muted">
                        Encrypted message unavailable on this device.
                      </p>
                    ) : attachments.length === 0 ? (
                      <p className="parent-layout-page__my-save-text is-muted">
                        No text content.
                      </p>
                    ) : null}

                    {visibleReactions.length > 0 ? (
                      <div className="parent-layout-page__my-save-reactions">
                        {visibleReactions.map((reactionLabel) => (
                          <span key={reactionLabel}>{reactionLabel}</span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  ) : null;

  const linkedDevicesModal = isLinkedDevicesModalOpen ? (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal parent-layout-page__modal--account"
        aria-modal="true"
        aria-labelledby="parent-linked-devices-title"
        role="dialog"
      >
        {isDefaultDeviceSelectionRequired && !hasDefaultCryptoDevice ? null : (
          <button
            className="parent-layout-page__modal-close"
            type="button"
            onClick={closeLinkedDevicesModal}
            aria-label="Close linked devices"
            title="Close"
          >
            <X size={28} strokeWidth={3} aria-hidden="true" />
          </button>
        )}

        <div className="parent-layout-page__modal-header">
          <ParrotIcon />
          <div>
            <h2 id="parent-linked-devices-title">Linked devices</h2>
          </div>
        </div>

        <nav
          className="parent-layout-page__profile-tabs"
          aria-label="Linked device tabs"
          role="tablist"
        >
          <button
            className={activeLinkedDevicesTab === "devices" ? "is-active" : ""}
            type="button"
            onClick={openLinkedDevicesTab}
            role="tab"
            aria-controls="parent-linked-devices-list"
            aria-selected={activeLinkedDevicesTab === "devices"}
          >
            <ShieldCheck size={16} aria-hidden="true" />
            <span>Devices</span>
          </button>
          <button
            className={activeLinkedDevicesTab === "recovery" ? "is-active" : ""}
            type="button"
            onClick={openRecoveryKeyTab}
            role="tab"
            aria-controls="parent-linked-devices-recovery"
            aria-selected={activeLinkedDevicesTab === "recovery"}
          >
            <KeyRound size={16} aria-hidden="true" />
            <span>Recovery key</span>
          </button>
        </nav>

        <div className="parent-layout-page__profile-content">
          {activeLinkedDevicesTab === "devices" && linkedDevicesMessage ? (
            <p
              className={`parent-layout-page__form-message parent-layout-page__form-message--${linkedDevicesMessage.type}`}
              role="alert"
            >
              {linkedDevicesMessage.type === "success" ? (
                <CheckCircle2 size={18} aria-hidden="true" />
              ) : (
                <AlertCircle size={18} aria-hidden="true" />
              )}
              <span>{linkedDevicesMessage.text}</span>
            </p>
          ) : null}

          {activeLinkedDevicesTab === "devices" ? (
            <section
              className="parent-layout-page__crypto-devices"
              id="parent-linked-devices-list"
              role="tabpanel"
            >
              <div className="parent-layout-page__form-note">
                <strong>Why this matters:</strong> The default browser can see
                active linked devices. A non-default browser shows itself and
                the current default browser.
                <ul>
                  <li>Choose only your own trusted device as default.</li>
                  <li>Making a device default requires the default-device password.</li>
                  <li>A non-default browser can make itself default with that password.</li>
                  <li>The default browser stays remembered after logout.</li>
                  <li>Do not make a public or borrowed browser default.</li>
                </ul>
              </div>

              {isDevicesLoading ? (
                <div className="parent-layout-page__crypto-device-loading">
                  Loading devices...
                </div>
              ) : cryptoDevices.length === 0 ? (
                <div className="parent-layout-page__crypto-device-empty">
                  No encrypted devices registered.
                </div>
              ) : (
                <div className="parent-layout-page__crypto-device-list">
                  <section className="parent-layout-page__crypto-device-section">
                    <div className="parent-layout-page__crypto-device-section-header">
                      <div>
                        <h3>Default device</h3>
                        <p>Controls recovery key and device permissions.</p>
                      </div>
                      <ShieldCheck size={18} aria-hidden="true" />
                    </div>

                    {defaultCryptoDevice ? (
                      renderCryptoDeviceCard(defaultCryptoDevice, {
                        isPrimaryDefault: true,
                      })
                    ) : (
                      <div className="parent-layout-page__crypto-device-empty parent-layout-page__crypto-device-empty--section">
                        No default device selected.
                      </div>
                    )}
                  </section>

                  <section className="parent-layout-page__crypto-device-section">
                    <div className="parent-layout-page__crypto-device-section-header">
                      <div>
                        <h3>Active devices</h3>
                        <p>
                          {canManageCryptoDevices
                            ? "Other browsers currently linked to this account."
                            : "This browser is linked but does not manage recovery."}
                        </p>
                      </div>
                      <span>{activeCryptoDevices.length}</span>
                    </div>

                    {activeCryptoDevices.length > 0 ? (
                      activeCryptoDevices.map((device) =>
                        renderCryptoDeviceCard(device),
                      )
                    ) : (
                      <div className="parent-layout-page__crypto-device-empty parent-layout-page__crypto-device-empty--section">
                        No other active devices.
                      </div>
                    )}
                  </section>
                </div>
              )}

              {canUpdateDefaultDevicePassword ? (
                <button
                  type="button"
                  className="parent-layout-page__modal-submit parent-layout-page__modal-submit--secondary"
                  onClick={openDefaultDevicePasswordUpdateModal}
                  disabled={isDefaultDevicePasswordUpdating}
                >
                  <KeyRound size={18} aria-hidden="true" />
                  <span>Update default password</span>
                </button>
              ) : null}

              <button
                type="button"
                className="parent-layout-page__modal-submit parent-layout-page__modal-submit--secondary"
                onClick={() => loadCryptoDevices()}
                disabled={isDevicesLoading}
                aria-busy={isDevicesLoading}
              >
                {isDevicesLoading ? (
                  <LoaderCircle className="app-button-spinner" aria-hidden="true" />
                ) : null}
                <span>
                  {isDevicesLoading ? "Refreshing" : "Refresh devices"}
                </span>
              </button>
            </section>
          ) : null}

          {activeLinkedDevicesTab === "recovery" ? (
            <form
              className="parent-layout-page__profile-form"
              id="parent-linked-devices-recovery"
              role="tabpanel"
              onSubmit={handleRecoveryKeyUpdateSubmit}
            >
              <div className="parent-layout-page__form-note">
                <strong>Why this matters:</strong> This key helps you get old
                messages back on another device. Parrot cannot show it again
                unless this device saved it.
                <ul>
                  <li>Save it somewhere safe before clearing browser data.</li>
                  <li>Change it if someone else may know it.</li>
                  <li>Do not share it or type it on a device you do not trust.</li>
                </ul>
              </div>

              {!canManageCryptoDevices ? (
                <p className="parent-layout-page__account-danger">
                  Only the current default device can view or change the
                  recovery key. This device can confirm the current key without
                  saving it.
                </p>
              ) : null}

              {canManageCryptoDevices ? (
                <label className="parent-layout-page__profile-field">
                  <span className="parent-layout-page__field-label">
                    Current recovery key
                    <em>{storedRecoveryKey ? "Saved" : "Not saved"}</em>
                  </span>
                  <div className="parent-layout-page__table-input-action">
                    <input
                      type={
                        storedRecoveryKey
                          ? isStoredRecoveryKeyVisible
                            ? "text"
                            : "password"
                          : "text"
                      }
                      value={storedRecoveryKey || "Not saved on this device"}
                      readOnly
                    />
                    <button
                      className="parent-layout-page__table-icon-button"
                      type="button"
                      onClick={() =>
                        setIsStoredRecoveryKeyVisible(
                          (currentValue) => !currentValue,
                        )
                      }
                      disabled={!storedRecoveryKey}
                      aria-label={
                        isStoredRecoveryKeyVisible
                          ? "Hide current recovery key"
                          : "Show current recovery key"
                      }
                      title={
                        isStoredRecoveryKeyVisible
                          ? "Hide current recovery key"
                          : "Show current recovery key"
                      }
                    >
                      {isStoredRecoveryKeyVisible ? (
                        <EyeOff size={18} aria-hidden="true" />
                      ) : (
                        <Eye size={18} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </label>
              ) : null}

              {canManageCryptoDevices && !storedRecoveryKey ? (
                <p className="parent-layout-page__form-note">
                  This device can only show a key that was made, changed, or
                  used here. If you cannot see it, set a new key and save it.
                </p>
              ) : null}

              {recoveryKeyMessage ? (
                <p
                  className={`parent-layout-page__form-message parent-layout-page__form-message--${recoveryKeyMessage.type}`}
                  role="alert"
                >
                  {recoveryKeyMessage.type === "success" ? (
                    <CheckCircle2 size={18} aria-hidden="true" />
                  ) : (
                    <AlertCircle size={18} aria-hidden="true" />
                  )}
                  <span>{recoveryKeyMessage.text}</span>
                </p>
              ) : null}

              {!canManageCryptoDevices ? (
                <button
                  className="parent-layout-page__modal-submit"
                  type="button"
                  onClick={handleRecoveryKeyVerificationRequest}
                >
                  <KeyRound size={18} aria-hidden="true" />
                  <span>Enter recovery key</span>
                </button>
              ) : (
                <>
                  <label className="parent-layout-page__profile-field">
                    <span className="parent-layout-page__field-label">
                      New recovery key
                      <em className="is-required">Required</em>
                    </span>
                    <div className="parent-layout-page__table-input-action">
                      <input
                        name="recovery_key"
                        type={isRecoveryKeyVisible ? "text" : "password"}
                        value={recoveryKeyForm.recovery_key}
                        onChange={handleRecoveryKeyFormChange}
                        autoComplete="new-password"
                        minLength={12}
                        disabled={isRecoveryKeySaving}
                        required
                      />
                      <button
                        className="parent-layout-page__table-icon-button"
                        type="button"
                        onClick={() =>
                          setIsRecoveryKeyVisible((currentValue) => !currentValue)
                        }
                        disabled={isRecoveryKeySaving}
                        aria-label={
                          isRecoveryKeyVisible ? "Hide recovery key" : "Show recovery key"
                        }
                        title={
                          isRecoveryKeyVisible ? "Hide recovery key" : "Show recovery key"
                        }
                      >
                        {isRecoveryKeyVisible ? (
                          <EyeOff size={18} aria-hidden="true" />
                        ) : (
                          <Eye size={18} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </label>

                  <label className="parent-layout-page__profile-field">
                    <span className="parent-layout-page__field-label">
                      Confirm new recovery key
                      <em className="is-required">Required</em>
                    </span>
                    <div className="parent-layout-page__table-input-action">
                      <input
                        name="confirm_recovery_key"
                        type={isConfirmRecoveryKeyVisible ? "text" : "password"}
                        value={recoveryKeyForm.confirm_recovery_key}
                        onChange={handleRecoveryKeyFormChange}
                        autoComplete="new-password"
                        minLength={12}
                        disabled={isRecoveryKeySaving}
                        required
                      />
                      <button
                        className="parent-layout-page__table-icon-button"
                        type="button"
                        onClick={() =>
                          setIsConfirmRecoveryKeyVisible(
                            (currentValue) => !currentValue,
                          )
                        }
                        disabled={isRecoveryKeySaving}
                        aria-label={
                          isConfirmRecoveryKeyVisible
                            ? "Hide confirmation recovery key"
                            : "Show confirmation recovery key"
                        }
                        title={
                          isConfirmRecoveryKeyVisible
                            ? "Hide confirmation recovery key"
                            : "Show confirmation recovery key"
                        }
                      >
                        {isConfirmRecoveryKeyVisible ? (
                          <EyeOff size={18} aria-hidden="true" />
                        ) : (
                          <Eye size={18} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </label>

                  <button
                    className="parent-layout-page__modal-submit"
                    type="submit"
                    disabled={isRecoveryKeySaving}
                    aria-busy={isRecoveryKeySaving}
                  >
                    {isRecoveryKeySaving ? (
                      <LoaderCircle className="app-button-spinner" aria-hidden="true" />
                    ) : (
                      <KeyRound size={18} aria-hidden="true" />
                    )}
                    <span>
                      {isRecoveryKeySaving ? "Updating..." : "Update recovery key"}
                    </span>
                  </button>
                </>
              )}
            </form>
          ) : null}
        </div>
      </section>
    </div>
  ) : null;

  const accountPanel = isAccountPanelActive ? (
    <div className="parent-header__menu parent-header__menu--panel">
      <section className="parent-header__id-card" aria-label="Account identity">
        <div className="parent-header__id-card-top">
          <div className="parent-header__id-card-media">
            <SmartAvatar
              className="parent-header__avatar parent-header__avatar--id-card"
              src={profilePicture}
              firstName={displayProfile?.first_name}
              lastName={displayProfile?.last_name}
              username={username}
              fallback="P"
            />
          </div>
          <div className="parent-header__id-card-actions">
            <ThemeToggleButton
              className="parent-header__id-card-theme"
              iconMode="current"
              size={14}
            />
            <button
              className="parent-header__profile-button parent-header__profile-button--id-card"
              type="button"
              onClick={openProfileModal}
            >
              <UserRound size={13} aria-hidden="true" />
              <span>Profile</span>
            </button>
            {onLogout ? (
              <button
                className={`parent-header__logout parent-header__logout--id-card${
                  isLogoutPending ? " is-loading" : ""
                }`}
                type="button"
                onClick={handleHeaderLogout}
                disabled={isLogoutPending}
                aria-busy={isLogoutPending}
              >
                {isLogoutPending ? (
                  <LoaderCircle className="app-button-spinner" aria-hidden="true" />
                ) : (
                  <LogOut size={13} aria-hidden="true" />
                )}
                <span>{isLogoutPending ? "Logging out" : "Logout"}</span>
              </button>
            ) : null}
          </div>
        </div>
        <dl className="parent-header__id-details">
          <div className="parent-header__id-row">
            <dt>Account number</dt>
            <dd>{accountNumber}</dd>
          </div>
          {savedProfileName ? (
            <div className="parent-header__id-row parent-header__id-row--name">
              <dt>Name</dt>
              <dd>{savedProfileName}</dd>
            </div>
          ) : null}
          <div className="parent-header__id-row">
            <dt>Username</dt>
            <dd>@{username}</dd>
          </div>
          <div className="parent-header__id-row">
            <dt>Email</dt>
            <dd>{email}</dd>
          </div>
        </dl>
      </section>

      <div className="parent-header__menu-actions" aria-label="Account settings">
        <button
          className="parent-header__account-button"
          type="button"
          onClick={openAccountModal}
        >
          <ShieldCheck size={16} aria-hidden="true" />
          <span>Account</span>
        </button>

        <button
          className="parent-header__account-button"
          type="button"
          onClick={openMySavesModal}
        >
          <Save size={16} aria-hidden="true" />
          <span>My Saves</span>
        </button>

        <button
          className="parent-header__account-button"
          type="button"
          onClick={openBlockManagementModal}
        >
          <Ban size={16} aria-hidden="true" />
          <span>Block Management</span>
        </button>

        <button
          className="parent-header__account-button"
          type="button"
          onClick={openGhostManagementModal}
        >
          <EyeOff size={16} aria-hidden="true" />
          <span>Ghost Management</span>
        </button>

        <button
          className="parent-header__account-button"
          type="button"
          onClick={openLinkedDevicesModal}
        >
          <ShieldCheck size={16} aria-hidden="true" />
          <span>Linked devices</span>
        </button>

      </div>
    </div>
  ) : null;

  return (
    <div className="parent-header">
      <div className="parent-header__brand">
        <ParrotIcon />
        <span>Parrot</span>
      </div>

      <div className="parent-header__actions">
        <button
          className="parent-header__menu-button parent-header__contacts-button"
          type="button"
          onClick={onOpenContactsPanel}
          aria-expanded={isContactsPanelActive}
          aria-pressed={isContactsPanelActive}
          aria-label={isContactsPanelActive ? "Close contacts" : "Open contacts"}
          title={isContactsPanelActive ? "Close contacts" : "Open contacts"}
        >
          {isContactsPanelActive ? (
            <X size={22} aria-hidden="true" />
          ) : (
            <Plus size={22} aria-hidden="true" />
          )}
        </button>

        <button
          className="parent-header__menu-button"
          type="button"
          onClick={onToggleAccountPanel}
          aria-expanded={isAccountPanelActive}
          aria-pressed={isAccountPanelActive}
          aria-label={isAccountPanelActive ? "Close account menu" : "Account menu"}
          title={isAccountPanelActive ? "Close account menu" : "Account menu"}
        >
          {isAccountPanelActive ? (
            <X size={22} aria-hidden="true" />
          ) : (
            <Menu size={22} aria-hidden="true" />
          )}
        </button>
      </div>

      {profileModal ? createPortal(profileModal, document.body) : null}
      {accountModal ? createPortal(accountModal, document.body) : null}
      {blockManagementModal
        ? createPortal(blockManagementModal, document.body)
        : null}
      {ghostManagementModal
        ? createPortal(ghostManagementModal, document.body)
        : null}
      {mySavesModal ? createPortal(mySavesModal, document.body) : null}
      {savedAttachmentViewer.attachments.length > 0 ? (
        <SavedAttachmentViewerModal
          attachments={savedAttachmentViewer.attachments}
          selectedAttachmentId={savedAttachmentViewer.selectedAttachmentId}
          onClose={handleCloseSavedAttachmentViewer}
          onDownload={handleDownloadSavedAttachment}
          onNavigate={handleNavigateSavedAttachment}
          onOpen={handleOpenSavedAttachment}
        />
      ) : null}
      {linkedDevicesModal ? createPortal(linkedDevicesModal, document.body) : null}
      {defaultDevicePasswordModal
        ? createPortal(defaultDevicePasswordModal, document.body)
        : null}
      {defaultDevicePasswordUpdateModal
        ? createPortal(defaultDevicePasswordUpdateModal, document.body)
        : null}
      {accountPanel && accountPanelHost
        ? createPortal(accountPanel, accountPanelHost)
        : null}
    </div>
  );
}

export default Header;
