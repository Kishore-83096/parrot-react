import { MessagesSquare, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Layout from "../../../components/Layout.jsx";
import ParrotToast from "../../../components/ParrotToast.jsx";
import { MESSENGER_INBOX_EVENT_NAME } from "../../../messenger/api.js";
import MessengerInboxListener from "../../../messenger/MessengerInboxListener.jsx";
import MessengerConversation from "../../../messenger/pages/jsx/MessengerConversation.jsx";
import MessengerRoomHeader from "../../../messenger/pages/jsx/MessengerRoomHeader.jsx";
import MessengerRoomList from "../../../messenger/pages/jsx/MessengerRoomList.jsx";
import {
  findRoomByAccountNumber,
  getCurrentUserId,
  getRoomContact,
} from "../../../messenger/pages/jsx/roomHelpers.js";
import { clearParentSession } from "../../api.js";
import ContactPanel from "./ContactPanel.jsx";
import Header from "./Header.jsx";

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

function LayoutPage({ user, onLogout, onUserUpdate }) {
  const [activePanelTab, setActivePanelTab] = useState(() => {
    const historyView = getLoggedInHistoryView();
    return historyView?.panelTab === "contacts" ? "contacts" : "chats";
  });
  const [contacts, setContacts] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [selectedContact, setSelectedContact] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [onlineUserIds, setOnlineUserIds] = useState(() => new Set());
  const [releasedMessagesVersion, setReleasedMessagesVersion] = useState(0);
  const [toast, setToast] = useState(null);
  const onlineUserTimeoutsRef = useRef(new Map());
  const currentUserId = getCurrentUserId(user);

  const handleLogout = () => {
    clearParentSession();
    onLogout?.();
  };

  const closeToast = useCallback(() => {
    setToast(null);
  }, []);

  const changePanelTab = (nextTab) => {
    if (activePanelTab === nextTab) {
      return;
    }

    setActivePanelTab(nextTab);
    pushLoggedInHistoryView({ panelTab: nextTab });
  };

  const handleContactsChange = useCallback((nextContacts) => {
    setContacts(nextContacts);
    setSelectedContact((currentContact) => {
      if (!currentContact) {
        return null;
      }

      return (
        nextContacts.find(
          (contact) =>
            contact.account_number === currentContact.account_number,
        ) || null
      );
    });
  }, []);

  const handleRoomsChange = useCallback((nextRooms) => {
    setRooms(nextRooms);
    setSelectedRoom((currentRoom) => {
      if (!currentRoom) {
        return null;
      }

      return nextRooms.find((room) => room.id === currentRoom.id) || currentRoom;
    });
  }, []);

  const handleSelectContact = useCallback(
    (contact) => {
      const matchingRoom = findRoomByAccountNumber(
        rooms,
        contact.account_number,
        user,
      );

      setSelectedContact(contact);
      setSelectedRoom(matchingRoom);
    },
    [rooms, user],
  );

  const handleSelectRoom = useCallback((room, contact) => {
    setSelectedRoom(room);
    setSelectedContact(contact || null);
  }, []);

  const handleCloseConversation = useCallback(() => {
    setSelectedRoom(null);
    setSelectedContact(null);
  }, []);

  const handleContactUpdated = useCallback((updatedContact) => {
    setContacts((currentContacts) => [
      updatedContact,
      ...currentContacts.filter(
        (contact) => contact.account_number !== updatedContact.account_number,
      ),
    ]);
    setSelectedContact((currentContact) => {
      if (currentContact?.account_number !== updatedContact.account_number) {
        return currentContact;
      }

      return {
        ...currentContact,
        ...updatedContact,
      };
    });
  }, []);

  const handleContactDeleted = useCallback((accountNumber) => {
    setContacts((currentContacts) =>
      currentContacts.filter(
        (contact) => contact.account_number !== accountNumber,
      ),
    );
    setSelectedContact((currentContact) =>
      currentContact?.account_number === accountNumber ? null : currentContact,
    );
  }, []);

  const mergeRoomMessage = useCallback(
    (currentRooms, room, message) => {
      if (!message?.room_id) {
        return currentRooms;
      }

      const roomId = Number(message.room_id);
      const existingRoom = currentRooms.find(
        (currentRoom) => Number(currentRoom.id) === roomId,
      );
      const isSelectedRoom = Number(selectedRoom?.id) === roomId;
      const isIncoming = Number(message.sender_user_id) !== currentUserId;
      const baseRoom = existingRoom || room || { id: roomId };
      const unreadCount = isSelectedRoom || !isIncoming
        ? 0
        : Number(baseRoom.unread_count || 0) + 1;
      const nextRoom = {
        ...baseRoom,
        ...(room || {}),
        id: baseRoom.id || roomId,
        updated_at: message.created_at || room?.updated_at || baseRoom.updated_at,
        last_message: message,
        unread_count: unreadCount,
        has_unread: unreadCount > 0,
      };
      const nextRooms = [
        nextRoom,
        ...currentRooms.filter((currentRoom) => Number(currentRoom.id) !== roomId),
      ];

      return nextRooms.sort(
        (first, second) =>
          new Date(second.updated_at || 0).getTime() -
          new Date(first.updated_at || 0).getTime(),
      );
    },
    [currentUserId, selectedRoom?.id],
  );

  const handleRoomMessage = useCallback(
    (room, message, { selectRoom = false } = {}) => {
      if (!message?.room_id) {
        if (room?.id && selectRoom) {
          setSelectedRoom(room);
          setRooms((currentRooms) => [
            room,
            ...currentRooms.filter((currentRoom) => currentRoom.id !== room.id),
          ]);
        }
        return;
      }

      setRooms((currentRooms) => mergeRoomMessage(currentRooms, room, message));
      setSelectedRoom((currentRoom) => {
        if (!currentRoom && selectRoom) {
          return mergeRoomMessage([], room, message)[0];
        }

        if (!currentRoom || Number(currentRoom.id) !== Number(message.room_id)) {
          return currentRoom;
        }

        return mergeRoomMessage([currentRoom], room, message)[0];
      });

      const matchingContact = getRoomContact(room, contacts, user);
      if (matchingContact) {
        setSelectedContact(matchingContact);
      }
    },
    [contacts, mergeRoomMessage, user],
  );

  const handleRoomRead = useCallback((roomId) => {
    const markRoomRead = (room) =>
      Number(room.id) === Number(roomId)
        ? {
            ...room,
            unread_count: 0,
            has_unread: false,
          }
        : room;

    setRooms((currentRooms) => currentRooms.map(markRoomRead));
    setSelectedRoom((currentRoom) =>
      currentRoom ? markRoomRead(currentRoom) : currentRoom,
    );
  }, []);

  const removeOnlineUser = useCallback((userId) => {
    const numericUserId = Number(userId);

    if (!numericUserId) {
      return;
    }

    const timeout = onlineUserTimeoutsRef.current.get(numericUserId);
    if (timeout) {
      globalThis.clearTimeout(timeout);
      onlineUserTimeoutsRef.current.delete(numericUserId);
    }

    setOnlineUserIds((currentOnlineUserIds) => {
      if (!currentOnlineUserIds.has(numericUserId)) {
        return currentOnlineUserIds;
      }

      const nextOnlineUserIds = new Set(currentOnlineUserIds);
      nextOnlineUserIds.delete(numericUserId);
      return nextOnlineUserIds;
    });
  }, []);

  const markOnlineUser = useCallback(
    (userId, expiresInSeconds) => {
      const numericUserId = Number(userId);

      if (!numericUserId || numericUserId === Number(currentUserId)) {
        return;
      }

      setOnlineUserIds((currentOnlineUserIds) => {
        if (currentOnlineUserIds.has(numericUserId)) {
          return currentOnlineUserIds;
        }

        const nextOnlineUserIds = new Set(currentOnlineUserIds);
        nextOnlineUserIds.add(numericUserId);
        return nextOnlineUserIds;
      });

      const previousTimeout =
        onlineUserTimeoutsRef.current.get(numericUserId);
      if (previousTimeout) {
        globalThis.clearTimeout(previousTimeout);
      }

      const timeoutMs =
        Math.max(Number(expiresInSeconds) || 60, 5) * 1000 + 5000;
      const timeout = globalThis.setTimeout(
        () => removeOnlineUser(numericUserId),
        timeoutMs,
      );
      onlineUserTimeoutsRef.current.set(numericUserId, timeout);
    },
    [currentUserId, removeOnlineUser],
  );

  const replaceOnlineUsers = useCallback(
    (userIds, expiresInSeconds) => {
      onlineUserTimeoutsRef.current.forEach((timeout) => {
        globalThis.clearTimeout(timeout);
      });
      onlineUserTimeoutsRef.current.clear();
      setOnlineUserIds(new Set());
      (userIds || []).forEach((userId) => markOnlineUser(userId, expiresInSeconds));
    },
    [markOnlineUser],
  );

  const handleBlockedMessagesReleased = useCallback((releaseResult) => {
    if (!releaseResult?.room_id) {
      return;
    }

    setReleasedMessagesVersion((currentVersion) => currentVersion + 1);
  }, []);

  useEffect(() => {
    return () => {
      onlineUserTimeoutsRef.current.forEach((timeout) => {
        globalThis.clearTimeout(timeout);
      });
      onlineUserTimeoutsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const handleInboxEvent = (event) => {
      const eventPayload = event.detail;

      if (eventPayload?.type === "message.sent") {
        handleRoomMessage(eventPayload.room, eventPayload.message);
      }

      if (eventPayload?.type === "presence.snapshot") {
        replaceOnlineUsers(
          eventPayload.online_user_ids || [],
          eventPayload.expires_in,
        );
      }

      if (eventPayload?.type === "presence.online") {
        markOnlineUser(eventPayload.user_id, eventPayload.expires_in);
      }

      if (eventPayload?.type === "presence.offline") {
        removeOnlineUser(eventPayload.user_id);
      }

      if (
        eventPayload?.type === "message.read" &&
        Number(eventPayload.user_id) === currentUserId
      ) {
        handleRoomRead(eventPayload.room_id);
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
    currentUserId,
    handleRoomMessage,
    handleRoomRead,
    markOnlineUser,
    removeOnlineUser,
    replaceOnlineUsers,
  ]);


  const totalUnreadCount = useMemo(
    () => rooms.reduce((total, room) => total + Number(room.unread_count || 0), 0),
    [rooms],
  );

  const contactPanelContent =
    activePanelTab === "contacts" ? (
      <ContactPanel
        contacts={contacts}
        selectedContact={selectedContact}
        onContactsChange={handleContactsChange}
        onSelectContact={handleSelectContact}
      />
    ) : (
      <MessengerRoomList
        contacts={contacts}
        rooms={rooms}
        selectedRoom={selectedRoom}
        user={user}
        onlineUserIds={onlineUserIds}
        onContactsChange={handleContactsChange}
        onRoomsChange={handleRoomsChange}
        onSelectRoom={handleSelectRoom}
      />
    );

  const contactTabs = (
    <nav className="parent-layout-page__tabs" aria-label="Contact panel tabs">
      <button
        className={activePanelTab === "chats" ? "is-active" : ""}
        type="button"
        onClick={() => changePanelTab("chats")}
        aria-label="Chats"
        title="Chats"
      >
        <MessagesSquare size={22} aria-hidden="true" />
        {totalUnreadCount > 0 ? (
          <span className="parent-layout-page__tab-badge">
            {totalUnreadCount > 99 ? "99+" : totalUnreadCount}
          </span>
        ) : null}
      </button>
      <button
        className={activePanelTab === "contacts" ? "is-active" : ""}
        type="button"
        onClick={() => changePanelTab("contacts")}
        aria-label="Contacts"
        title="Contacts"
      >
        <UsersRound size={22} aria-hidden="true" />
      </button>
    </nav>
  );

  return (
    <>
      <MessengerInboxListener />

      <Layout
        contactHeader={
          <Header
            user={user}
            onLogout={handleLogout}
            onUserUpdate={onUserUpdate}
            onToast={setToast}
          />
        }
        contacts={contactPanelContent}
        contactFooter={contactTabs}
        roomHeader={
          <MessengerRoomHeader
            contacts={contacts}
            selectedContact={selectedContact}
            selectedRoom={selectedRoom}
            user={user}
            onlineUserIds={onlineUserIds}
            onContactDeleted={handleContactDeleted}
            onContactUpdated={handleContactUpdated}
            onBlockedMessagesReleased={handleBlockedMessagesReleased}
            onCloseConversation={handleCloseConversation}
            onToast={setToast}
          />
        }
        room={
          <MessengerConversation
            contacts={contacts}
            selectedContact={selectedContact}
            selectedRoom={selectedRoom}
            user={user}
            releasedMessagesVersion={releasedMessagesVersion}
            onRoomMessage={handleRoomMessage}
            onRoomRead={handleRoomRead}
          />
        }
        contactsLabel="Contacts and chats"
        roomLabel="Message Room"
      />

      <ParrotToast toast={toast} onClose={closeToast} />
    </>
  );
}

export default LayoutPage;
