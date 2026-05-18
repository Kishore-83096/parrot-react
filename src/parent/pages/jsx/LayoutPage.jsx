import { MessagesSquare, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Layout from "../../../components/Layout.jsx";
import ParrotToast from "../../../components/ParrotToast.jsx";
import {
  clearMessengerSession,
  getMessengerUserCryptoDevices,
  MESSENGER_INBOX_EVENT_NAME,
} from "../../../messenger/api.js";
import {
  clearStoredMessengerDeviceIdentity,
  ensureMessengerDeviceKey,
  getStoredMessengerDeviceIdentity,
} from "../../../messenger/e2ee/device.js";
import { decryptMessageForUser } from "../../../messenger/e2ee/messages.js";
import RecoveryRestoreModal from "../../../messenger/e2ee/RecoveryRestoreModal.jsx";
import RecoverySetupModal from "../../../messenger/e2ee/RecoverySetupModal.jsx";
import { getRecoveryKeyBackupStatus } from "../../../messenger/e2ee/recovery.js";
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
  const [e2eeRecoveryVersion, setE2eeRecoveryVersion] = useState(0);
  const [defaultDevicePromptVersion, setDefaultDevicePromptVersion] = useState(0);
  const [recoveryBackup, setRecoveryBackup] = useState(null);
  const [isRecoveryRestoreOpen, setIsRecoveryRestoreOpen] = useState(false);
  const [isRecoverySetupOpen, setIsRecoverySetupOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const onlineUserTimeoutsRef = useRef(new Map());
  const currentUserId = getCurrentUserId(user);

  const loadLinkedDevices = useCallback(async () => {
    const userId = user?.id || user?.user_id;

    if (!userId) {
      return [];
    }

    const devicesResponse = await getMessengerUserCryptoDevices(userId);
    const devicesResult = devicesResponse.data?.result || devicesResponse.data;

    return Array.isArray(devicesResult?.devices) ? devicesResult.devices : [];
  }, [user]);

  const promptForMissingDefaultDevice = useCallback(
    async ({ showToast = false } = {}) => {
      const linkedDevices = await loadLinkedDevices();
      const hasDefaultDevice = linkedDevices.some((device) => device.is_default);
      const localIdentity = await getStoredMessengerDeviceIdentity(user);
      const currentLinkedDevice = linkedDevices.find(
        (device) => device.device_id === localIdentity?.device_id,
      );
      const defaultLinkedDevice = linkedDevices.find(
        (device) => device.is_default,
      );
      const canRecoverDefaultDevice = Boolean(
        currentLinkedDevice &&
          defaultLinkedDevice &&
          currentLinkedDevice.device_id !== defaultLinkedDevice.device_id &&
          currentLinkedDevice.public_key &&
          currentLinkedDevice.public_key === defaultLinkedDevice.public_key,
      );

      if (
        linkedDevices.length === 0 ||
        (hasDefaultDevice && !canRecoverDefaultDevice)
      ) {
        return false;
      }

      setDefaultDevicePromptVersion((currentVersion) => currentVersion + 1);

      if (showToast) {
        setToast({
          type: "error",
          title: "Select default device",
          message: canRecoverDefaultDevice
            ? "Make this recovered device the default to manage linked devices."
            : "Choose which linked device can manage your devices.",
        });
      }

      return true;
    },
    [loadLinkedDevices],
  );

  useEffect(() => {
    if (!user) {
      return undefined;
    }

    let isMounted = true;

    async function setupEncryptedMessaging() {
      try {
        const backupStatus = await getRecoveryKeyBackupStatus();
        let localIdentity = await getStoredMessengerDeviceIdentity(user);

        if (!isMounted) {
          return;
        }

        if (localIdentity) {
          await ensureMessengerDeviceKey(user);

          if (!isMounted) {
            return;
          }

          const linkedDevices = await loadLinkedDevices();

          if (!isMounted) {
            return;
          }

          const currentLinkedDevice = linkedDevices.find(
            (device) => device.device_id === localIdentity.device_id,
          );
          const hasDefaultDevice = linkedDevices.some(
            (device) => device.is_default,
          );

          if (linkedDevices.length > 0 && !currentLinkedDevice) {
            await clearStoredMessengerDeviceIdentity(user);
            clearMessengerSession();
            clearParentSession();
            onLogout?.();
            return;
          }

          if (linkedDevices.length > 0 && !hasDefaultDevice) {
            setDefaultDevicePromptVersion((currentVersion) => currentVersion + 1);
            setToast({
              type: "error",
              title: "Select default device",
              message: "Make this device the default before setting a recovery key.",
            });
            return;
          }

          if (currentLinkedDevice?.is_default && !backupStatus.exists) {
            setIsRecoverySetupOpen(true);
          }

          return;
        }

        if (backupStatus.exists && backupStatus.backup) {
          setRecoveryBackup(backupStatus.backup);
          setIsRecoveryRestoreOpen(true);
          return;
        }

        const createdIdentity = await ensureMessengerDeviceKey(user);

        if (!isMounted) {
          return;
        }

        localIdentity = createdIdentity || (await getStoredMessengerDeviceIdentity(user));
        const linkedDevices = await loadLinkedDevices();

        if (!isMounted) {
          return;
        }

        const currentLinkedDevice = linkedDevices.find(
          (device) => device.device_id === localIdentity?.device_id,
        );
        const hasDefaultDevice = linkedDevices.some((device) => device.is_default);

        if (linkedDevices.length > 0 && !hasDefaultDevice) {
          setDefaultDevicePromptVersion((currentVersion) => currentVersion + 1);
          setToast({
            type: "error",
            title: "Select default device",
            message: "Make this device the default before setting a recovery key.",
          });
          return;
        }

        if (currentLinkedDevice?.is_default && !backupStatus.exists) {
          setIsRecoverySetupOpen(true);
        }
      } catch {
        if (!isMounted) {
          return;
        }

        setToast({
          type: "error",
          title: "Encrypted messaging setup failed",
          message: "This device could not finish encrypted messaging setup.",
        });
      }
    }

    setupEncryptedMessaging();

    return () => {
      isMounted = false;
    };
  }, [loadLinkedDevices, onLogout, user]);

  const handleRecoverySetupComplete = useCallback(() => {
    setIsRecoverySetupOpen(false);
    setToast({
      type: "success",
      title: "Recovery backup created",
      message: "This device can now be used to recover encrypted messages later.",
    });
  }, []);

  const handleRecoveryRestoreComplete = useCallback(() => {
    setIsRecoveryRestoreOpen(false);
    setRecoveryBackup(null);
    setReleasedMessagesVersion((currentVersion) => currentVersion + 1);
    setE2eeRecoveryVersion((currentVersion) => currentVersion + 1);
    setToast({
      type: "success",
      title: "Encrypted messages recovered",
      message: "Old messages can now decrypt on this device.",
    });
    promptForMissingDefaultDevice({ showToast: true }).catch(() => {});
  }, [promptForMissingDefaultDevice]);

  const handleRecoveryRestoreFailed = useCallback(() => {
    clearMessengerSession();
    clearParentSession();
    onLogout?.();
  }, [onLogout]);

  const handleDefaultDeviceChanged = useCallback(
    async (device) => {
      const identity = await getStoredMessengerDeviceIdentity(user);

      if (identity?.device_id !== device?.device_id) {
        return;
      }

      const backupStatus = await getRecoveryKeyBackupStatus();

      if (!backupStatus.exists) {
        setIsRecoverySetupOpen(true);
      }
    },
    [user],
  );

  const handleLogout = () => {
    clearMessengerSession();
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
      const messageRoomId = Number(message?.room_id || room?.id || 0);

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
      const shouldSyncSelectedContact =
        selectRoom || Number(selectedRoom?.id) === messageRoomId;

      if (matchingContact && shouldSyncSelectedContact) {
        setSelectedContact(matchingContact);
      }
    },
    [contacts, mergeRoomMessage, selectedRoom?.id, user],
  );

  const handleMaybeEncryptedRoomMessage = useCallback(
    (room, message, options) => {
      decryptMessageForUser(message, user)
        .then((nextMessage) => {
          handleRoomMessage(room, nextMessage, options);
        })
        .catch(() => {
          handleRoomMessage(room, message, options);
        });
    },
    [handleRoomMessage, user],
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
        handleMaybeEncryptedRoomMessage(eventPayload.room, eventPayload.message);
      }

      if (eventPayload?.type === "device.revoked") {
        getStoredMessengerDeviceIdentity(user)
          .then(async (identity) => {
            if (identity?.device_id !== eventPayload.device_id) {
              return;
            }

            await clearStoredMessengerDeviceIdentity(user);
            clearMessengerSession();
            clearParentSession();
            onLogout?.();
          })
          .catch(() => {});
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
    handleMaybeEncryptedRoomMessage,
    handleRoomRead,
    markOnlineUser,
    onLogout,
    removeOnlineUser,
    replaceOnlineUsers,
    user,
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
        e2eeRecoveryVersion={e2eeRecoveryVersion}
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
            defaultDevicePromptVersion={defaultDevicePromptVersion}
            onDefaultDeviceChanged={handleDefaultDeviceChanged}
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

      {isRecoverySetupOpen ? (
        <RecoverySetupModal
          user={user}
          onComplete={handleRecoverySetupComplete}
        />
      ) : null}

      {isRecoveryRestoreOpen && recoveryBackup ? (
        <RecoveryRestoreModal
          backup={recoveryBackup}
          user={user}
          onFailedAttemptsExceeded={handleRecoveryRestoreFailed}
          onRestore={handleRecoveryRestoreComplete}
        />
      ) : null}

      <ParrotToast toast={toast} onClose={closeToast} />
    </>
  );
}

export default LayoutPage;
