import {
  getContactInitials,
  getContactName,
  getInitials,
  getParentApiErrorMessage,
} from "../../../parent/pages/jsx/contactHelpers.js";
import {
  getMessagePreviewLabel,
  isEncryptedMessageText,
} from "../../e2ee/messages.js";
import {
  getMessagePreviewLabel as getGroupMessagePreviewLabel,
  isEncryptedMessageText as isGroupEncryptedMessageText,
} from "../../../group_messaging/e2ee/messages.js";
import { getGroupLogDisplay } from "../../../group_messaging/logDisplay.js";

const VOICE_NOTE_ATTACHMENT_KIND = "voice_note";
const ATTACHMENT_KIND_LABELS = {
  attachment: ["Attachment", "attachments"],
  audio: ["Audio", "audio attachments"],
  file: ["Attachment", "attachments"],
  image: ["Image", "images"],
  pdf: ["PDF", "PDFs"],
  video: ["Video", "videos"],
  voice_note: ["Voice note", "voice notes"],
};

export {
  getContactInitials,
  getContactName,
  getInitials,
  getParentApiErrorMessage,
};

export function getCurrentUserId(user) {
  return Number(user?.id || user?.user_id || 0);
}

export function isGroupRoom(room) {
  return room?.is_group || room?.room_type === "group";
}

export function getRoomPeer(room, currentUser) {
  if (isGroupRoom(room)) {
    return null;
  }

  const otherParticipants = Array.isArray(room?.other_participants)
    ? room.other_participants
    : [];

  if (otherParticipants.length > 0) {
    return otherParticipants[0];
  }

  const participants = Array.isArray(room?.participants)
    ? room.participants
    : [];
  const currentAccountNumber = String(currentUser?.account_number || "");

  return (
    participants.find(
      (participant) =>
        String(participant?.account_number || "") !== currentAccountNumber,
    ) ||
    participants[0] ||
    null
  );
}

export function getRoomContact(room, contacts, currentUser) {
  if (isGroupRoom(room)) {
    return null;
  }

  const peer = getRoomPeer(room, currentUser);
  const peerAccountNumber = String(peer?.account_number || "");

  if (!peerAccountNumber) {
    return null;
  }

  return (
    contacts.find(
      (contact) => String(contact.account_number) === peerAccountNumber,
    ) || null
  );
}

export function getRoomName(room, contact, peer) {
  if (isGroupRoom(room)) {
    return room?.title || `Group ${room?.id || ""}`.trim() || "Group";
  }

  return (
    (contact ? getContactName(contact) : "") ||
    peer?.display_name ||
    peer?.account_number ||
    `Room ${room?.id || ""}`.trim() ||
    "Chat room"
  );
}

export function getRoomInitials(room, contact, peer) {
  if (contact) {
    return getContactInitials(contact);
  }

  return getInitials(getRoomName(room, contact, peer));
}

function getSavedContactName(contactNamesByAccountNumber, accountNumber) {
  const normalizedAccountNumber = String(accountNumber || "");
  const savedContact = normalizedAccountNumber
    ? contactNamesByAccountNumber?.get?.(normalizedAccountNumber)
    : null;

  if (!savedContact) {
    return "";
  }

  if (typeof savedContact === "string") {
    return savedContact;
  }

  return getContactName(savedContact);
}

export function getLastMessagePreview(room, currentUser, contactNamesByAccountNumber = null) {
  return getLastMessagePreviewDetails(
    room,
    currentUser,
    contactNamesByAccountNumber,
  ).text;
}

export function getLastMessagePreviewDetails(
  room,
  currentUser,
  contactNamesByAccountNumber = null,
) {
  const message = room?.last_message;

  if (isGroupRoom(room)) {
    const latestLogs = Array.isArray(room?.latest_logs) ? room.latest_logs : [];
    const latestLog = latestLogs[latestLogs.length - 1];

    if (room?.is_deleted && latestLog?.action === "group.deleted") {
      return {
        icon: "",
        text: getGroupLogDisplay(
          latestLog,
          currentUser,
          contactNamesByAccountNumber,
        ).text,
      };
    }

    if (message) {
      if (message.is_deleted || message.deleted_at) {
        const currentUserId = getCurrentUserId(currentUser);
        const sender = (room?.participants || []).find(
          (participant) =>
            Number(participant?.user_id) === Number(message.sender_user_id),
        );
        const senderAccountNumber =
          message.sender_account_number || sender?.account_number || "";
        const senderName =
          getSavedContactName(contactNamesByAccountNumber, senderAccountNumber) ||
          senderAccountNumber ||
          "A member";

        return {
          icon: "",
          text:
            currentUserId && Number(message.sender_user_id) === currentUserId
              ? "You deleted this message"
              : `${senderName} deleted this message`,
        };
      }

      const messageText = getGroupMessagePreviewLabel(message);
      const attachments = Array.isArray(message.decrypted_attachments)
        ? message.decrypted_attachments
        : Array.isArray(message.attachments)
          ? message.attachments
          : [];
      const attachmentPreview = getAttachmentPreviewDetails(attachments);
      const hasEncryptedPlaceholder =
        isGroupEncryptedMessageText(message.text) ||
        messageText.toLowerCase() === "encrypted group message";
      let preview = messageText;
      let icon = "";

      if (attachmentPreview && (!preview || hasEncryptedPlaceholder)) {
        preview = attachmentPreview.text;
        icon = attachmentPreview.icon;
      }

      if (!preview && isGroupEncryptedMessageText(message.text)) {
        preview = "Encrypted group message";
      }

      if (!preview) {
        preview = attachmentPreview?.text || "Message";
        icon = attachmentPreview?.icon || "";
      }

      const currentUserId = getCurrentUserId(currentUser);
      if (currentUserId && Number(message.sender_user_id) === currentUserId) {
        return {
          icon,
          text: `You: ${preview}`,
        };
      }

      const sender = (room?.participants || []).find(
        (participant) =>
          Number(participant?.user_id) === Number(message.sender_user_id),
      );
      const senderAccountNumber =
        message.sender_account_number || sender?.account_number || "";
      const senderName =
        getSavedContactName(contactNamesByAccountNumber, senderAccountNumber) ||
        senderAccountNumber;

      return {
        icon,
        text: senderName ? `${senderName}: ${preview}` : preview,
      };
    }

    return {
      icon: "",
      text: latestLog
        ? getGroupLogDisplay(
            latestLog,
            currentUser,
            contactNamesByAccountNumber,
          ).text
        : "No messages yet.",
    };
  }

  if (!message) {
    const latestLogs = Array.isArray(room?.latest_logs) ? room.latest_logs : [];
    const latestLog = latestLogs[latestLogs.length - 1];

    return {
      icon: "",
      text: latestLog?.text || "No messages yet.",
    };
  }

  if (message.is_deleted || message.deleted_at) {
    const currentUserId = getCurrentUserId(currentUser);

    return {
      icon: "",
      text:
        currentUserId && Number(message.sender_user_id) === currentUserId
          ? "You deleted this message"
          : "This message was deleted",
    };
  }

  const messageText = getMessagePreviewLabel(message);
  const attachments = Array.isArray(message.decrypted_attachments)
    ? message.decrypted_attachments
    : Array.isArray(message.attachments)
      ? message.attachments
      : [];
  const attachmentPreview = getAttachmentPreviewDetails(attachments);
  const hasEncryptedPlaceholder =
    isEncryptedMessageText(message.text) ||
    messageText.toLowerCase() === "encrypted message";
  let preview = messageText;
  let icon = "";

  if (attachmentPreview && (!preview || hasEncryptedPlaceholder)) {
    preview = attachmentPreview.text;
    icon = attachmentPreview.icon;
  }

  if (!preview && isEncryptedMessageText(message.text)) {
    preview = "Encrypted message";
  }

  if (!preview) {
    preview = attachmentPreview?.text || "Message";
    icon = attachmentPreview?.icon || "";
  }
  const currentUserId = getCurrentUserId(currentUser);

  if (currentUserId && Number(message.sender_user_id) === currentUserId) {
    return {
      icon,
      text: `You: ${preview}`,
    };
  }

  return {
    icon,
    text: preview,
  };
}

function isVoiceNoteAttachment(attachment) {
  return (
    attachment?.attachment_kind === VOICE_NOTE_ATTACHMENT_KIND ||
    attachment?.attachmentKind === VOICE_NOTE_ATTACHMENT_KIND ||
    attachment?.kind === VOICE_NOTE_ATTACHMENT_KIND ||
    attachment?.is_voice_note === true
  );
}

function getAttachmentPreviewDetails(attachments) {
  const safeAttachments = Array.isArray(attachments) ? attachments : [];

  if (safeAttachments.length === 0) {
    return null;
  }

  const voiceNoteCount = safeAttachments.filter(isVoiceNoteAttachment).length;

  if (voiceNoteCount === safeAttachments.length) {
    return {
      icon: "voice_note",
      text: getAttachmentKindLabel("voice_note", voiceNoteCount),
    };
  }

  const regularAttachments = safeAttachments.filter(
    (attachment) => !isVoiceNoteAttachment(attachment),
  );
  const kinds = regularAttachments.map(getAttachmentKind);
  const primaryKind = kinds[0] || "attachment";
  const isSingleKind =
    kinds.length > 0 && kinds.every((kind) => kind === primaryKind);

  if (safeAttachments.length === 1) {
    return {
      icon: primaryKind,
      text: getAttachmentKindLabel(primaryKind, 1),
    };
  }

  if (isSingleKind && regularAttachments.length === safeAttachments.length) {
    return {
      icon: primaryKind,
      text: getAttachmentKindLabel(primaryKind, safeAttachments.length),
    };
  }

  return {
    icon: "attachment",
    text: getAttachmentKindLabel("attachment", safeAttachments.length),
  };
}

function getAttachmentKind(attachment) {
  const fileType = String(attachment?.file_type || "").toLowerCase();
  const mimeType = String(attachment?.mime_type || "").toLowerCase();
  const fileName = String(attachment?.file_name || "").toLowerCase();

  if (fileType === "image" || mimeType.startsWith("image/")) {
    return "image";
  }

  if (fileType === "video" || mimeType.startsWith("video/")) {
    return "video";
  }

  if (fileType === "audio" || mimeType.startsWith("audio/")) {
    return "audio";
  }

  if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) {
    return "pdf";
  }

  return "file";
}

function getAttachmentKindLabel(kind, count) {
  const [singleLabel, pluralLabel] =
    ATTACHMENT_KIND_LABELS[kind] || ATTACHMENT_KIND_LABELS.attachment;

  return count === 1 ? singleLabel : `${count} ${pluralLabel}`;
}

export function formatRoomTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
  }

  return date.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function getMessageDateKey(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function getMessageDateDividerLabel(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const daysDifference = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86400000,
  );

  if (daysDifference === 0) {
    return "Today";
  }

  if (daysDifference === 1) {
    return "Yesterday";
  }

  return date.toLocaleDateString([], {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function getProfileDisplayName(profile) {
  const fullName = [profile?.first_name, profile?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return fullName || profile?.username || "";
}

export function getConversationPeerAccount({ selectedContact, selectedRoom, user }) {
  const roomPeer = selectedRoom ? getRoomPeer(selectedRoom, user) : null;

  return selectedContact?.account_number || roomPeer?.account_number || "";
}

export function getConversationContact({
  selectedContact,
  selectedRoom,
  contacts,
  user,
}) {
  return (
    selectedContact ||
    (selectedRoom ? getRoomContact(selectedRoom, contacts, user) : null)
  );
}

export function getConversationName({ contact, peer, profile, room }) {
  return (
    (contact ? getContactName(contact) : "") ||
    getProfileDisplayName(profile) ||
    peer?.display_name ||
    peer?.account_number ||
    `Room ${room?.id || ""}`.trim() ||
    "Chat room"
  );
}

export function findRoomByAccountNumber(rooms, accountNumber, currentUser) {
  const normalizedAccountNumber = String(accountNumber || "");

  if (!normalizedAccountNumber) {
    return null;
  }

  return (
    rooms.find((room) => {
      const peer = getRoomPeer(room, currentUser);
      return String(peer?.account_number || "") === normalizedAccountNumber;
    }) || null
  );
}

export function upsertMessage(messages, nextMessage) {
  if (!nextMessage?.id) {
    return messages;
  }

  const nextClientMessageId = String(nextMessage.client_message_id || "");
  const nextMessages = messages.filter((message) => {
    if (message.id === nextMessage.id) {
      return false;
    }

    return (
      !nextClientMessageId ||
      String(message.client_message_id || "") !== nextClientMessageId
    );
  });
  nextMessages.push(nextMessage);

  return nextMessages.sort((first, second) => {
    const firstTime = new Date(first.created_at || 0).getTime() || 0;
    const secondTime = new Date(second.created_at || 0).getTime() || 0;

    if (firstTime === secondTime) {
      return (Number(first.id) || 0) - (Number(second.id) || 0);
    }

    return firstTime - secondTime;
  });
}

export function getMessageStatusLabel(status) {
  if (status === "sending") {
    return "Sending";
  }

  if (status === "read") {
    return "Read";
  }

  if (status === "delivered") {
    return "Delivered";
  }

  return "Sent";
}
