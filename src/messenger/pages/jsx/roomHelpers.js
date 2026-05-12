import {
  getContactInitials,
  getContactName,
  getInitials,
  getParentApiErrorMessage,
} from "../../../parent/pages/jsx/contactHelpers.js";

export {
  getContactInitials,
  getContactName,
  getInitials,
  getParentApiErrorMessage,
};

export function getCurrentUserId(user) {
  return Number(user?.id || user?.user_id || 0);
}

export function getRoomPeer(room, currentUser) {
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

export function getLastMessagePreview(room, currentUser) {
  const message = room?.last_message;

  if (!message) {
    return "No messages yet.";
  }

  const messageText = String(message.text || "").trim();
  const attachmentCount = Array.isArray(message.attachments)
    ? message.attachments.length
    : 0;
  const preview = messageText || (attachmentCount ? "Attachment" : "Message");
  const currentUserId = getCurrentUserId(currentUser);

  if (currentUserId && Number(message.sender_user_id) === currentUserId) {
    return `You: ${preview}`;
  }

  return preview;
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

  const nextMessages = messages.filter((message) => message.id !== nextMessage.id);
  nextMessages.push(nextMessage);

  return nextMessages.sort((first, second) => {
    const firstTime = new Date(first.created_at || 0).getTime();
    const secondTime = new Date(second.created_at || 0).getTime();

    if (firstTime === secondTime) {
      return Number(first.id || 0) - Number(second.id || 0);
    }

    return firstTime - secondTime;
  });
}

export function getMessageStatusLabel(status) {
  if (status === "read") {
    return "Read";
  }

  if (status === "delivered") {
    return "Delivered";
  }

  return "Sent";
}
