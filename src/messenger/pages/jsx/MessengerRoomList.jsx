import {
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  MessagesSquare,
  Mic,
  Music,
  Paperclip,
  Search,
  UserRound,
  Video,
} from "@/components/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getMessengerErrorMessage,
  getMessengerRooms,
} from "../../api.js";
import SmartAvatar from "../../../components/SmartAvatar.jsx";
import { GroupPeopleIcon } from "@/components/icons";
import { decryptGroupRoomsForUser } from "../../../group_messaging/e2ee/messages.js";
import { decryptRoomsForUser } from "../../e2ee/messages.js";
import { getParentContacts } from "../../../parent/api.js";
import {
  formatRoomTime,
  getContactName,
  getLastMessagePreview,
  getLastMessagePreviewDetails,
  getRoomInitials,
  getRoomPeer,
  isGroupRoom,
} from "./roomHelpers.js";

const ROOM_PREVIEW_ICONS = {
  attachment: Paperclip,
  audio: Music,
  file: FileIcon,
  image: ImageIcon,
  contact: UserRound,
  pdf: FileText,
  video: Video,
  voice_note: Mic,
};

async function decryptDirectRoomSummaries(rawRooms, user) {
  const directRooms = rawRooms.filter((room) => !isGroupRoom(room));
  const groupRooms = rawRooms.filter((room) => isGroupRoom(room));

  if (directRooms.length === 0 && groupRooms.length === 0) {
    return rawRooms;
  }

  const decryptedDirectRooms = await decryptRoomsForUser(directRooms, user);
  const decryptedGroupRooms = await decryptGroupRoomsForUser(groupRooms, user);
  const decryptedDirectRoomsById = new Map(
    decryptedDirectRooms.map((room) => [Number(room.id), room]),
  );
  const decryptedGroupRoomsById = new Map(
    decryptedGroupRooms.map((room) => [Number(room.id), room]),
  );

  return rawRooms.map((room) =>
    isGroupRoom(room)
      ? decryptedGroupRoomsById.get(Number(room.id)) || room
      : decryptedDirectRoomsById.get(Number(room.id)) || room,
  );
}

function MessengerRoomList({
  contacts,
  rooms,
  selectedRoom,
  user,
  onlineUserIds,
  e2eeRecoveryVersion,
  onContactsChange,
  onRoomsChange,
  onSelectRoom,
}) {
  const [roomsMessage, setRoomsMessage] = useState("");
  const [isRoomsLoading, setIsRoomsLoading] = useState(false);
  const [roomSearch, setRoomSearch] = useState("");
  const [hasLoadedContactMap, setHasLoadedContactMap] = useState(false);
  const roomsRef = useRef(rooms);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  const contactsByAccountNumber = useMemo(
    () =>
      new Map(
        contacts
          .filter((contact) => contact?.account_number)
          .map((contact) => [String(contact.account_number), contact]),
      ),
    [contacts],
  );

  const loadRooms = useCallback(async () => {
    setIsRoomsLoading(true);
    setRoomsMessage("");

    try {
      const response = await getMessengerRooms();
      const roomsResult = response.data?.result || response.data;
      const rawRooms = Array.isArray(roomsResult?.rooms)
        ? roomsResult.rooms
        : [];
      const nextRooms = await decryptDirectRoomSummaries(rawRooms, user);

      onRoomsChange(nextRooms);
    } catch (error) {
      if (roomsRef.current.length === 0) {
        onRoomsChange([]);
      }
      setRoomsMessage(
        getMessengerErrorMessage(error, "Unable to load chat rooms."),
      );
    } finally {
      setIsRoomsLoading(false);
    }
  }, [onRoomsChange, user]);

  const loadContactMap = useCallback(async () => {
    if (hasLoadedContactMap) {
      return;
    }

    setHasLoadedContactMap(true);

    try {
      const response = await getParentContacts();
      const nextContacts = Array.isArray(response.data?.contacts)
        ? response.data.contacts
        : [];

      onContactsChange(nextContacts);
    } catch {
      // The room list can still render account numbers without saved contacts.
    }
  }, [hasLoadedContactMap, onContactsChange]);

  useEffect(() => {
    loadRooms();
  }, [e2eeRecoveryVersion, loadRooms]);

  useEffect(() => {
    loadContactMap();
  }, [loadContactMap]);

  const filteredRooms = useMemo(() => {
    const query = roomSearch.trim().toLowerCase();

    if (!query) {
      return rooms;
    }

    return rooms.filter((room) => {
      const isGroup = isGroupRoom(room);
      const peer = getRoomPeer(room, user);
      const peerAccountNumber = String(peer?.account_number || "");
      const contact = contactsByAccountNumber.get(peerAccountNumber) || null;
      const roomName =
        isGroup
          ? room.title || `Group ${room.id}`
          : (contact ? getContactName(contact) : "") ||
            peer?.display_name ||
            peerAccountNumber ||
            `Room ${room.id}`;
      const lastMessagePreview = getLastMessagePreview(
        room,
        user,
        contactsByAccountNumber,
      );
      const searchText = [
        roomName,
        isGroup ? "" : peerAccountNumber,
        isGroup ? "" : peer?.username,
        lastMessagePreview,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchText.includes(query);
    });
  }, [contactsByAccountNumber, roomSearch, rooms, user]);

  return (
    <div className="parent-layout-page__contacts">
      <div className="parent-layout-page__contacts-toolbar">
        <input
          className="parent-layout-page__contacts-search"
          type="search"
          value={roomSearch}
          onChange={(event) => setRoomSearch(event.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
        />
      </div>

      {roomsMessage ? (
        <p className="parent-layout-page__contacts-message" role="alert">
          {roomsMessage}
        </p>
      ) : null}

      {isRoomsLoading && rooms.length === 0 ? (
        <div className="parent-layout-page__contacts-loading" aria-live="polite">
          <span />
          <span />
          <span />
        </div>
      ) : rooms.length === 0 ? (
        <div className="parent-layout-page__contacts-placeholder">
          <MessagesSquare size={28} aria-hidden="true" />
          <p>No chat rooms yet.</p>
        </div>
      ) : filteredRooms.length === 0 ? (
        <div className="parent-layout-page__contacts-placeholder">
          <Search size={28} aria-hidden="true" />
          <p>No matching chats.</p>
        </div>
      ) : (
        <div className="parent-layout-page__contacts-list">
          {filteredRooms.map((room) => {
            const isGroup = isGroupRoom(room);
            const peer = getRoomPeer(room, user);
            const peerAccountNumber = String(peer?.account_number || "");
            const contact = contactsByAccountNumber.get(peerAccountNumber) || null;
            const isSelected = selectedRoom?.id === room.id;
            const isPeerOnline =
              !isGroup && onlineUserIds?.has(Number(peer?.user_id));
            const unreadCount = Number(room.unread_count || 0);
            const roomName =
              isGroup
                ? room.title || `Group ${room.id}`
                : (contact ? getContactName(contact) : "") ||
                  peer?.display_name ||
                  peerAccountNumber ||
                  `Room ${room.id}`;
            const lastMessageTime = formatRoomTime(
              room.last_message?.created_at || room.updated_at,
            );
            const lastMessagePreview = getLastMessagePreviewDetails(
              room,
              user,
              contactsByAccountNumber,
            );
            const LastMessagePreviewIcon =
              ROOM_PREVIEW_ICONS[lastMessagePreview.icon] || null;

            return (
              <button
                className={`parent-layout-page__contact-card parent-layout-page__chat-card${
                  isSelected ? " is-selected" : ""
                }${unreadCount > 0 ? " is-unread" : ""}`}
                type="button"
                key={room.id}
                onClick={() => onSelectRoom(room, contact)}
              >
                <SmartAvatar
                  className={`parent-layout-page__contact-avatar${
                    isPeerOnline ? " is-online" : ""
                  }`}
                  src={isGroup ? room.avatar_url : contact?.profile_picture}
                  initials={getRoomInitials(room, contact, peer)}
                  firstName={contact?.first_name || peer?.first_name}
                  lastName={contact?.last_name || peer?.last_name}
                  name={isGroup ? room.title : getContactName(contact || peer)}
                  username={contact?.username || peer?.username}
                  fallback={isGroup ? "G" : "P"}
                >
                  {isPeerOnline ? (
                    <span className="parent-layout-page__presence-dot" />
                  ) : null}
                </SmartAvatar>

                <span className="parent-layout-page__contact-text">
                  <strong
                    className={
                      isGroup
                        ? "parent-layout-page__group-room-name"
                        : undefined
                    }
                  >
                    <span className="parent-layout-page__group-room-name-text">
                      {roomName}
                    </span>
                    {isGroup ? (
                      <span
                        className="parent-layout-page__group-room-badge"
                        aria-label="Group chat"
                        title="Group chat"
                      >
                        <GroupPeopleIcon size={12} strokeWidth={2.2} aria-hidden="true" />
                      </span>
                    ) : null}
                  </strong>
                  {!isGroup && !contact ? (
                    <small>
                      {peerAccountNumber || "Account number unavailable"}
                    </small>
                  ) : null}
                  <small
                    className={`parent-layout-page__chat-preview${
                      LastMessagePreviewIcon ? " has-icon" : ""
                    }`}
                  >
                    {LastMessagePreviewIcon ? (
                      <LastMessagePreviewIcon size={13} aria-hidden="true" />
                    ) : null}
                    <span>{lastMessagePreview.text}</span>
                  </small>
                </span>

                <span className="parent-layout-page__chat-meta">
                  {lastMessageTime ? (
                    <small className="parent-layout-page__chat-time">
                      {lastMessageTime}
                    </small>
                  ) : null}
                  {unreadCount > 0 ? (
                    <span className="parent-layout-page__chat-unread">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      )}

    </div>
  );
}

export default MessengerRoomList;
