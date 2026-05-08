import { Inbox, MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  getMessengerErrorMessage,
  getMessengerRooms,
  MESSENGER_INBOX_EVENT_NAME,
} from "../../api.js";
import "../css/RoomListPage.css";
import "../tab/RoomListPage.css";
import "../mobile/RoomListPage.css";

function getSavedContactName(participant, savedContacts) {
  if (!participant?.account_number) {
    return "";
  }

  const savedContact = savedContacts.find(
    (contact) => contact.account_number === participant.account_number,
  );

  return savedContact?.alias_name || "";
}

function getParticipantName(participant, savedContacts) {
  return (
    getSavedContactName(participant, savedContacts) ||
    participant?.display_name ||
    participant?.account_number ||
    ""
  );
}

function getRoomTitle(room, savedContacts = []) {
  const participants =
    room.other_participants?.length > 0
      ? room.other_participants
      : room.participants || [];
  const names = participants
    .map((participant) => getParticipantName(participant, savedContacts))
    .filter(Boolean);

  return names.join(", ") || `Room ${room.id}`;
}

function getRoomInitials(room, savedContacts) {
  const name = getRoomTitle(room, savedContacts);
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return initials.toUpperCase() || "P";
}

function getRoomContact(room, savedContacts = []) {
  const participant =
    room.other_participants?.[0] ||
    room.participants?.find((item) => item.account_number) ||
    null;

  if (!participant?.account_number) {
    return null;
  }

  return (
    savedContacts.find(
      (contact) => contact.account_number === participant.account_number,
    ) || null
  );
}

function getLastMessageText(room) {
  if (!room.last_message) {
    return "No messages yet";
  }

  return room.last_message.text || "Attachment message";
}

function formatRoomTime(value) {
  if (!value) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function getRoomUpdatedTime(room) {
  return new Date(room.updated_at || room.last_message?.created_at || 0).getTime();
}

function sortRoomsByLatestActivity(rooms) {
  return [...rooms].sort((leftRoom, rightRoom) => {
    const timeDifference = getRoomUpdatedTime(rightRoom) - getRoomUpdatedTime(leftRoom);

    if (timeDifference !== 0) {
      return timeDifference;
    }

    return Number(rightRoom.id || 0) - Number(leftRoom.id || 0);
  });
}

function getOtherParticipants(participants, currentUserId) {
  if (!currentUserId) {
    return [];
  }

  return participants.filter(
    (participant) => Number(participant.user_id) !== Number(currentUserId),
  );
}

function isIncomingMessage(roomMessage, currentUserId) {
  return (
    Boolean(currentUserId) &&
    Number(roomMessage?.recipient_user_id) === Number(currentUserId) &&
    Number(roomMessage?.sender_user_id) !== Number(currentUserId)
  );
}

function mergeInboxMessageIntoRooms(currentRooms, eventPayload, currentUserId) {
  const roomMessage = eventPayload.message;
  const eventRoom = eventPayload.room || {};
  const roomId = eventRoom.id || roomMessage?.room_id;

  if (!roomId || !roomMessage?.id) {
    return currentRooms;
  }

  const existingRoom = currentRooms.find(
    (room) => Number(room.id) === Number(roomId),
  );
  const participants =
    eventRoom.participants || existingRoom?.participants || [];
  const previousUnreadCount = Number(existingRoom?.unread_count || 0);
  const unreadCount = isIncomingMessage(roomMessage, currentUserId)
    ? previousUnreadCount + 1
    : previousUnreadCount;
  const nextRoom = {
    ...existingRoom,
    ...eventRoom,
    id: roomId,
    participants,
    other_participants:
      eventRoom.other_participants ||
      existingRoom?.other_participants ||
      getOtherParticipants(participants, currentUserId),
    last_message: roomMessage,
    unread_count: unreadCount,
    has_unread: unreadCount > 0,
    updated_at:
      eventRoom.updated_at || roomMessage.created_at || existingRoom?.updated_at,
  };
  const remainingRooms = currentRooms.filter(
    (room) => Number(room.id) !== Number(roomId),
  );

  return sortRoomsByLatestActivity([nextRoom, ...remainingRooms]);
}

function mergeRoomUnreadIntoRooms(currentRooms, eventPayload, currentUserId) {
  if (Number(eventPayload.user_id) !== Number(currentUserId)) {
    return currentRooms;
  }

  return currentRooms.map((room) => {
    if (Number(room.id) !== Number(eventPayload.room_id)) {
      return room;
    }

    const unreadCount = Number(eventPayload.unread_count || 0);

    return {
      ...room,
      unread_count: unreadCount,
      has_unread: unreadCount > 0,
    };
  });
}

function RoomListPage({
  contacts = [],
  selectedRoomId = "",
  onRoomSelect,
  onRoomsChange,
}) {
  const currentUserIdRef = useRef(null);
  const [rooms, setRooms] = useState([]);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const loadRooms = async () => {
    setIsLoading(true);
    setMessage("");

    try {
      const response = await getMessengerRooms();
      const result = response.data?.result || {};
      currentUserIdRef.current =
        Number(response.data?.user?.user_id) || currentUserIdRef.current;

      setRooms(Array.isArray(result.rooms) ? result.rooms : []);
    } catch (error) {
      setRooms([]);
      setMessage(getMessengerErrorMessage(error, "Unable to load chats."));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRooms();
  }, []);

  useEffect(() => {
    onRoomsChange?.(rooms);
  }, [rooms, onRoomsChange]);

  useEffect(() => {
    const handleInboxEvent = (event) => {
      const eventPayload = event.detail || {};

      if (eventPayload.type === "connection.accepted") {
        currentUserIdRef.current =
          Number(eventPayload.user_id) || currentUserIdRef.current;
        return;
      }

      if (eventPayload.type === "message.sent") {
        setRooms((currentRooms) =>
          mergeInboxMessageIntoRooms(
            currentRooms,
            eventPayload,
            currentUserIdRef.current,
          ),
        );
        return;
      }

      if (eventPayload.type === "message.read") {
        setRooms((currentRooms) =>
          mergeRoomUnreadIntoRooms(
            currentRooms,
            eventPayload,
            currentUserIdRef.current,
          ),
        );
      }
    };

    globalThis.addEventListener(MESSENGER_INBOX_EVENT_NAME, handleInboxEvent);

    return () => {
      globalThis.removeEventListener(
        MESSENGER_INBOX_EVENT_NAME,
        handleInboxEvent,
      );
    };
  }, []);

  return (
    <section className="messenger-room-list" aria-label="Chats">
      {message ? (
        <p className="messenger-room-list__message" role="alert">
          {message}
        </p>
      ) : null}

      {isLoading ? (
        <div className="messenger-room-list__loading" aria-live="polite">
          <span />
          <span />
          <span />
        </div>
      ) : rooms.length === 0 ? (
        <div className="messenger-room-list__empty">
          <Inbox size={32} aria-hidden="true" />
          <h3>No Chats Yet</h3>
          <p>Started conversations will appear here.</p>
        </div>
      ) : (
        <div className="messenger-room-list__items">
          {rooms.map((room) => {
            const roomContact = getRoomContact(room, contacts);

            return (
              <button
                className={`messenger-room-list__item${
                  String(selectedRoomId) === String(room.id) ? " is-selected" : ""
                }${room.has_unread ? " has-unread" : ""}`}
                type="button"
                key={room.id}
                onClick={() => onRoomSelect?.(room)}
              >
                <span className="messenger-room-list__avatar" aria-hidden="true">
                  {roomContact?.profile_picture ? (
                    <img src={roomContact.profile_picture} alt="" />
                  ) : room.is_group ? (
                    <MessageCircle size={18} />
                  ) : (
                    getRoomInitials(room, contacts)
                  )}
                </span>
                <span className="messenger-room-list__content">
                  <span className="messenger-room-list__title-row">
                    <strong>{getRoomTitle(room, contacts)}</strong>
                    <span>{formatRoomTime(room.updated_at)}</span>
                  </span>
                  <span className="messenger-room-list__preview">
                    {getLastMessageText(room)}
                  </span>
                </span>
                {room.unread_count > 0 ? (
                  <span className="messenger-room-list__badge">
                    {room.unread_count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default RoomListPage;
