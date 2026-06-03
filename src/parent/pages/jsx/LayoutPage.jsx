import { MessagesSquare, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Layout from "../../../components/Layout.jsx";
import ParrotToast from "../../../components/ParrotToast.jsx";
import {
  clearMessengerSession,
  getMessengerErrorMessage,
  getMessengerUserCryptoDevices,
  MESSENGER_INBOX_EVENT_NAME,
} from "../../../messenger/api.js";
import GroupConversation from "../../../group_messaging/pages/GroupConversation.jsx";
import GroupRoomHeader from "../../../group_messaging/pages/GroupRoomHeader.jsx";
import {
  clearStoredMessengerDeviceIdentity,
  ensureMessengerDeviceKey,
  getStoredMessengerDeviceIdentity,
  logoutCurrentMessengerDevice,
} from "../../../messenger/e2ee/devices/index.js";
import { decryptMessageForUser } from "../../../messenger/e2ee/messages.js";
import RecoveryRestoreModal from "../../../messenger/e2ee/RecoveryRestoreModal.jsx";
import RecoverySetupModal from "../../../messenger/e2ee/RecoverySetupModal.jsx";
import RecoveryVerifyModal from "../../../messenger/e2ee/RecoveryVerifyModal.jsx";
import {
  clearRecoveryKeyBackupAcknowledgement,
  clearStoredRecoveryKey,
  getRecoveryKeyBackupStatus,
  isRecoveryKeyBackupAcknowledged,
} from "../../../messenger/e2ee/recovery.js";
import MessengerInboxListener from "../../../messenger/MessengerInboxListener.jsx";
import MessengerConversation from "../../../messenger/pages/jsx/MessengerConversation.jsx";
import MessengerRoomHeader from "../../../messenger/pages/jsx/MessengerRoomHeader.jsx";
import MessengerRoomList from "../../../messenger/pages/jsx/MessengerRoomList.jsx";
import {
  StoriesListPanel,
  StoriesOverlayHost,
  useStoriesController,
} from "../../../messenger/pages/jsx/StoriesPanel.jsx";
import {
  findRoomByAccountNumber,
  getCurrentUserId,
  getRoomContact,
  upsertMessage,
} from "../../../messenger/pages/jsx/roomHelpers.js";
import { clearParentSession } from "../../api.js";
import ContactPanel from "./ContactPanel.jsx";
import Header from "./Header.jsx";
import {
  clearMessengerUiCache,
  getMessengerUiCache,
  saveMessengerUiCache,
  sanitizeConversationForCache,
} from "../../../messenger/cache.js";

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

function StoryTabIcon({ size = 24 }) {
  return (
    <svg
      className="parent-layout-page__story-tab-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        className="parent-layout-page__story-tab-icon-orbit"
        d="M18.9 9.1a8 8 0 1 1-5.5-4.9"
      />
      <path
        className="parent-layout-page__story-tab-icon-inner"
        d="M8.2 8.5a6.3 6.3 0 0 0-1.1 6.6M9.5 17.2a6.2 6.2 0 0 0 5 .1"
      />
      <circle className="parent-layout-page__story-tab-icon-play-ring" cx="16.7" cy="7.2" r="4.2" />
      <path className="parent-layout-page__story-tab-icon-play" d="M15.6 5.4v3.6l3-1.8-3-1.8Z" />
    </svg>
  );
}

function LayoutPage({ user, onLogout, onUserUpdate }) {
  const initialMessengerUiCacheRef = useRef(null);

  if (initialMessengerUiCacheRef.current === null) {
    initialMessengerUiCacheRef.current = getMessengerUiCache(user);
  }

  const initialMessengerUiCache = initialMessengerUiCacheRef.current;
  const [activePanelTab, setActivePanelTab] = useState(() => {
    const historyView = getLoggedInHistoryView();
    return ["chats", "contacts", "stories"].includes(historyView?.panelTab)
      ? historyView.panelTab
      : "chats";
  });
  const activePanelTabRef = useRef(activePanelTab);
  const [contacts, setContacts] = useState(
    () => initialMessengerUiCache.contacts,
  );
  const [rooms, setRooms] = useState(() => initialMessengerUiCache.rooms);
  const [selectedContact, setSelectedContact] = useState(
    () => initialMessengerUiCache.selectedContact,
  );
  const [selectedRoom, setSelectedRoom] = useState(
    () => initialMessengerUiCache.selectedRoom,
  );
  const [conversationCache, setConversationCache] = useState(
    () => initialMessengerUiCache.conversations,
  );
  const [peerProfileCache, setPeerProfileCache] = useState(
    () => initialMessengerUiCache.peerProfiles,
  );
  const [onlineUserIds, setOnlineUserIds] = useState(() => new Set());
  const [releasedMessagesVersion, setReleasedMessagesVersion] = useState(0);
  const [e2eeRecoveryVersion, setE2eeRecoveryVersion] = useState(0);
  const [defaultDevicePromptVersion, setDefaultDevicePromptVersion] = useState(0);
  const [recoveryBackup, setRecoveryBackup] = useState(null);
  const [recoveryVerifyBackup, setRecoveryVerifyBackup] = useState(null);
  const [isRecoveryRestoreOpen, setIsRecoveryRestoreOpen] = useState(false);
  const [isRecoverySetupOpen, setIsRecoverySetupOpen] = useState(false);
  const [isRecoveryVerifyOpen, setIsRecoveryVerifyOpen] = useState(false);
  const [isRecoveryVerifyRequired, setIsRecoveryVerifyRequired] = useState(false);
  const [storyUnreadCount, setStoryUnreadCount] = useState(0);
  const [toast, setToast] = useState(null);
  const onlineUserTimeoutsRef = useRef(new Map());
  const isLogoutInProgressRef = useRef(false);
  const currentUserId = getCurrentUserId(user);

  useEffect(() => {
    saveMessengerUiCache(user, {
      contacts,
      rooms,
      selectedContact,
      selectedRoom,
      conversations: conversationCache,
      peerProfiles: peerProfileCache,
    });
  }, [
    contacts,
    conversationCache,
    peerProfileCache,
    rooms,
    selectedContact,
    selectedRoom,
    user,
  ]);

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

      if (linkedDevices.length === 0 || hasDefaultDevice) {
        return false;
      }

      setDefaultDevicePromptVersion((currentVersion) => currentVersion + 1);

      if (showToast) {
        setToast({
          type: "info",
          title: "Select default device",
          message: "Choose which linked device can manage your devices.",
        });
      }

      return true;
    },
    [loadLinkedDevices],
  );

  const openRecoveryKeyVerification = useCallback(
    async ({ required = false, showToast = false } = {}) => {
      const backupStatus = await getRecoveryKeyBackupStatus();

      if (!backupStatus.exists || !backupStatus.backup) {
        if (showToast) {
          setToast({
            type: "error",
            title: "Recovery key unavailable",
            message: "No recovery backup is available for this account yet.",
          });
        }

        return false;
      }

      setRecoveryVerifyBackup(backupStatus.backup);
      setIsRecoveryVerifyRequired(required);
      setIsRecoveryVerifyOpen(true);

      if (showToast) {
        setToast({
          type: "info",
          title: "Recovery key updated",
          message: "Enter the current recovery key on this device.",
        });
      }

      return true;
    },
    [],
  );

  const maybePromptForRecoveryKeyUpdate = useCallback(
    async ({ backupStatus, linkedDevices, localIdentity, showToast = false }) => {
      if (
        !backupStatus?.exists ||
        !backupStatus?.backup ||
        !localIdentity?.device_id ||
        isRecoveryKeyBackupAcknowledged(user, backupStatus.backup)
      ) {
        return false;
      }

      const currentLinkedDevice = linkedDevices.find(
        (device) => device.device_id === localIdentity.device_id,
      );

      if (!currentLinkedDevice || currentLinkedDevice.is_default) {
        return false;
      }

      setRecoveryVerifyBackup(backupStatus.backup);
      setIsRecoveryVerifyRequired(true);
      setIsRecoveryVerifyOpen(true);

      if (showToast) {
        setToast({
          type: "info",
          title: "Recovery key updated",
          message: "Enter the current recovery key on this device.",
        });
      }

      return true;
    },
    [user],
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
              type: "info",
              title: "Select default device",
              message: "Make this device the default before setting a recovery key.",
            });
            return;
          }

          if (currentLinkedDevice?.is_default && !backupStatus.exists) {
            setIsRecoverySetupOpen(true);
          }

          await maybePromptForRecoveryKeyUpdate({
            backupStatus,
            linkedDevices,
            localIdentity,
          });

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
            type: "info",
            title: "Select default device",
            message: "Make this device the default before setting a recovery key.",
          });
          return;
        }

        if (currentLinkedDevice?.is_default && !backupStatus.exists) {
          setIsRecoverySetupOpen(true);
        }

        await maybePromptForRecoveryKeyUpdate({
          backupStatus,
          linkedDevices,
          localIdentity,
        });
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setToast({
          type: "error",
          title: "Encrypted messaging setup failed",
          message: getMessengerErrorMessage(
            error,
            "This device could not finish encrypted messaging setup.",
          ),
        });
      }
    }

    setupEncryptedMessaging();

    return () => {
      isMounted = false;
    };
  }, [loadLinkedDevices, maybePromptForRecoveryKeyUpdate, onLogout, user]);

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

  const finishLogout = useCallback(() => {
    clearMessengerUiCache(user);
    clearMessengerSession();
    clearParentSession();
    onLogout?.();
  }, [onLogout, user]);

  const clearLocalEncryptedDeviceState = useCallback(async () => {
    await clearStoredMessengerDeviceIdentity(user);
    clearStoredRecoveryKey(user);
    clearRecoveryKeyBackupAcknowledgement(user);
  }, [user]);

  const logoutAndClearLocalEncryptedDeviceState = useCallback(() => {
    logoutCurrentMessengerDevice(user)
      .catch(() => ({ local_device_should_clear: true }))
      .then(() => clearLocalEncryptedDeviceState())
      .catch(() => {})
      .finally(finishLogout);
  }, [clearLocalEncryptedDeviceState, finishLogout, user]);

  const handleRecoveryRestoreFailed = useCallback(() => {
    logoutAndClearLocalEncryptedDeviceState();
  }, [logoutAndClearLocalEncryptedDeviceState]);

  const handleRecoveryVerifyComplete = useCallback(() => {
    setIsRecoveryVerifyOpen(false);
    setIsRecoveryVerifyRequired(false);
    setRecoveryVerifyBackup(null);
    setToast({
      type: "success",
      title: "Recovery key confirmed",
      message: "This device has verified the current recovery key.",
    });
  }, []);

  const handleRecoveryVerifyClose = useCallback(() => {
    if (isRecoveryVerifyRequired) {
      return;
    }

    setIsRecoveryVerifyOpen(false);
    setRecoveryVerifyBackup(null);
  }, [isRecoveryVerifyRequired]);

  const handleRecoveryVerifyFailed = useCallback(() => {
    logoutAndClearLocalEncryptedDeviceState();
  }, [logoutAndClearLocalEncryptedDeviceState]);

  const handleRecoveryKeyRequested = useCallback(() => {
    openRecoveryKeyVerification({ required: false, showToast: true }).catch(
      (error) => {
        setToast({
          type: "error",
          title: "Recovery key unavailable",
          message: getMessengerErrorMessage(
            error,
            "Unable to open recovery key confirmation.",
          ),
        });
      },
    );
  }, [openRecoveryKeyVerification]);

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

  const handleLogout = useCallback(() => {
    if (isLogoutInProgressRef.current) {
      return;
    }

    isLogoutInProgressRef.current = true;
    logoutCurrentMessengerDevice(user)
      .then((result) => {
        if (result.local_device_should_clear) {
          return clearLocalEncryptedDeviceState();
        }

        return null;
      })
      .catch(() => {})
      .finally(finishLogout);
  }, [clearLocalEncryptedDeviceState, finishLogout, user]);

  const closeToast = useCallback(() => {
    setToast(null);
  }, []);

  useEffect(() => {
    activePanelTabRef.current = activePanelTab;

    if (activePanelTab === "stories") {
      setStoryUnreadCount(0);
    }
  }, [activePanelTab]);

  const changePanelTab = (nextTab) => {
    if (activePanelTab === nextTab) {
      return;
    }

    if (nextTab === "stories") {
      setStoryUnreadCount(0);
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

  const upsertGroupRoom = useCallback((room, { selectRoom = false } = {}) => {
    if (!room?.id) {
      return;
    }

    setRooms((currentRooms) => {
      const nextRooms = [
        room,
        ...currentRooms.filter(
          (currentRoom) => Number(currentRoom.id) !== Number(room.id),
        ),
      ];

      return nextRooms.sort(
        (first, second) =>
          new Date(second.updated_at || 0).getTime() -
          new Date(first.updated_at || 0).getTime(),
      );
    });

    setSelectedRoom((currentRoom) => {
      if (selectRoom) {
        return room;
      }

      if (!currentRoom || Number(currentRoom.id) !== Number(room.id)) {
        return currentRoom;
      }

      return {
        ...currentRoom,
        ...room,
      };
    });

    if (selectRoom) {
      setSelectedContact(null);
      setActivePanelTab("chats");
    }
  }, []);

  const removeGroupRoom = useCallback((roomId) => {
    const numericRoomId = Number(roomId || 0);

    if (!numericRoomId) {
      return;
    }

    setRooms((currentRooms) =>
      currentRooms.filter((room) => Number(room.id) !== numericRoomId),
    );
    setSelectedRoom((currentRoom) =>
      Number(currentRoom?.id || 0) === numericRoomId ? null : currentRoom,
    );
    setSelectedContact(null);
    setConversationCache((currentCache) => {
      const cacheRoomId = String(numericRoomId);
      if (!currentCache[cacheRoomId]) {
        return currentCache;
      }

      const nextCache = { ...currentCache };
      delete nextCache[cacheRoomId];
      return nextCache;
    });
  }, []);

  const handleGroupEvent = useCallback(
    (eventPayload) => {
      const eventType = eventPayload?.type || "";
      const log = eventPayload?.log || {};
      const removedRoomId =
        eventPayload?.removed_room_id ||
        (eventType === "group.deleted" ? eventPayload?.room_id : null) ||
        (
          ["group.member_removed", "group.member_left"].includes(eventType) &&
          Number(log.target_user_id || eventPayload?.target_user_id || 0) === currentUserId
            ? eventPayload?.room_id
            : null
        );

      if (removedRoomId) {
        removeGroupRoom(removedRoomId);
        return;
      }

      const room = eventPayload?.room;

      if (room?.id) {
        upsertGroupRoom(room);
      }
    },
    [currentUserId, removeGroupRoom, upsertGroupRoom],
  );

  const handleGroupCreated = useCallback(
    (room) => {
      upsertGroupRoom(room, { selectRoom: true });
    },
    [upsertGroupRoom],
  );

  const handleGroupUpdated = useCallback(
    (room) => {
      upsertGroupRoom(room);
    },
    [upsertGroupRoom],
  );

  const handleGroupRemoved = useCallback(
    (roomId) => {
      removeGroupRoom(roomId);
    },
    [removeGroupRoom],
  );

  const handleConversationCacheChange = useCallback((roomId, conversation) => {
    const cacheRoomId = String(roomId || "");

    if (!cacheRoomId) {
      return;
    }

    setConversationCache((currentCache) => {
      const nextConversation = sanitizeConversationForCache({
        ...(currentCache[cacheRoomId] || {}),
        ...(conversation || {}),
        updatedAt: new Date().toISOString(),
      });

      if (nextConversation.messages.length === 0) {
        const nextCache = { ...currentCache };
        delete nextCache[cacheRoomId];
        return nextCache;
      }

      return {
        ...currentCache,
        [cacheRoomId]: nextConversation,
      };
    });
  }, []);

  const handlePeerProfileCacheChange = useCallback((accountNumber, profile) => {
    const cacheAccountNumber = String(accountNumber || "");

    if (!cacheAccountNumber) {
      return;
    }

    setPeerProfileCache((currentCache) => ({
      ...currentCache,
      [cacheAccountNumber]: profile || {
        account_number: cacheAccountNumber,
      },
    }));
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

      if (messageRoomId) {
        setConversationCache((currentCache) => {
          const cacheRoomId = String(messageRoomId);
          const cachedConversation = currentCache[cacheRoomId];

          if (!cachedConversation?.messages?.length) {
            return currentCache;
          }

          return {
            ...currentCache,
            [cacheRoomId]: sanitizeConversationForCache({
              ...cachedConversation,
              messages: upsertMessage(cachedConversation.messages, message),
              updatedAt: new Date().toISOString(),
            }),
          };
        });
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

  const handleRoomMessageStatus = useCallback(
    (eventPayload) => {
      const status =
        eventPayload?.type === "message.read" ? "read" : "delivered";
      const roomId = Number(eventPayload?.room_id || 0);
      const lastMessageId =
        eventPayload?.last_read_message_id ||
        eventPayload?.last_delivered_message_id;

      if (
        !roomId ||
        !lastMessageId ||
        Number(eventPayload?.user_id) === currentUserId
      ) {
        return;
      }

      const updateRoomStatus = (room) => {
        const lastMessage = room?.last_message;

        if (
          Number(room?.id) !== roomId ||
          Number(lastMessage?.sender_user_id) !== currentUserId ||
          Number(lastMessage?.id) > Number(lastMessageId) ||
          (status === "delivered" && lastMessage?.status === "read")
        ) {
          return room;
        }

        return {
          ...room,
          last_message: {
            ...lastMessage,
            status,
          },
        };
      };

      setRooms((currentRooms) => currentRooms.map(updateRoomStatus));
      setSelectedRoom((currentRoom) =>
        currentRoom ? updateRoomStatus(currentRoom) : currentRoom,
      );
      setConversationCache((currentCache) => {
        const cacheRoomId = String(roomId);
        const cachedConversation = currentCache[cacheRoomId];

        if (!cachedConversation?.messages?.length) {
          return currentCache;
        }

        const nextMessages = cachedConversation.messages.map((message) => {
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
        });

        return {
          ...currentCache,
          [cacheRoomId]: sanitizeConversationForCache({
            ...cachedConversation,
            messages: nextMessages,
            updatedAt: new Date().toISOString(),
          }),
        };
      });
    },
    [currentUserId],
  );

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

      if (eventPayload?.type?.startsWith("group.")) {
        handleGroupEvent(eventPayload);
      }

      if (eventPayload?.type === "story.created") {
        if (activePanelTabRef.current !== "stories") {
          setStoryUnreadCount((currentCount) =>
            Math.min(currentCount + 1, 100),
          );
        }
      }

      if (eventPayload?.type === "device.revoked") {
        getStoredMessengerDeviceIdentity(user)
          .then(async (identity) => {
            if (identity?.device_id !== eventPayload.device_id) {
              return;
            }

            await clearLocalEncryptedDeviceState();
            finishLogout();
          })
          .catch(() => {});
      }

      if (eventPayload?.type === "device.default_changed") {
        getStoredMessengerDeviceIdentity(user)
          .then((identity) => {
            const defaultDeviceId = eventPayload.device?.device_id;
            if (!identity?.device_id || identity.device_id === defaultDeviceId) {
              return;
            }

            clearStoredRecoveryKey(user);
          })
          .catch(() => {});
      }

      if (eventPayload?.type === "recovery.key_updated") {
        getStoredMessengerDeviceIdentity(user)
          .then(async (identity) => {
            if (
              !identity?.device_id ||
              identity.device_id === eventPayload.updated_by_device_id
            ) {
              return;
            }

            const [backupStatus, linkedDevices] = await Promise.all([
              getRecoveryKeyBackupStatus(),
              loadLinkedDevices(),
            ]);

            await maybePromptForRecoveryKeyUpdate({
              backupStatus,
              linkedDevices,
              localIdentity: identity,
              showToast: true,
            });
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

      if (
        eventPayload?.type === "message.read" ||
        eventPayload?.type === "message.delivered"
      ) {
        handleRoomMessageStatus(eventPayload);
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
    clearLocalEncryptedDeviceState,
    finishLogout,
    handleGroupEvent,
    handleMaybeEncryptedRoomMessage,
    handleRoomMessageStatus,
    handleRoomRead,
    loadLinkedDevices,
    markOnlineUser,
    maybePromptForRecoveryKeyUpdate,
    removeOnlineUser,
    replaceOnlineUsers,
    user,
  ]);


  const totalUnreadCount = useMemo(
    () => rooms.reduce((total, room) => total + Number(room.unread_count || 0), 0),
    [rooms],
  );

  const storiesController = useStoriesController({
    contacts,
    enabled: activePanelTab === "stories",
    onContactsChange: handleContactsChange,
    onRoomMessage: handleRoomMessage,
    onToast: setToast,
    user,
  });

  const contactPanelContent =
    activePanelTab === "stories" ? (
      <StoriesListPanel
        contacts={contacts}
        controller={storiesController}
        user={user}
      />
    ) : activePanelTab === "contacts" ? (
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
        onGroupCreated={handleGroupCreated}
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
        className={activePanelTab === "stories" ? "is-active" : ""}
        type="button"
        onClick={() => changePanelTab("stories")}
        aria-label="Stories"
        title="Stories"
      >
        <StoryTabIcon size={24} />
        {storyUnreadCount > 0 ? (
          <span className="parent-layout-page__tab-badge">
            {storyUnreadCount > 99 ? "99+" : storyUnreadCount}
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
            onRecoveryKeyRequested={handleRecoveryKeyRequested}
            onLogout={handleLogout}
            onUserUpdate={onUserUpdate}
            onToast={setToast}
          />
        }
        contacts={contactPanelContent}
        contactFooter={contactTabs}
        roomHeader={
          selectedRoom?.is_group ? (
            <GroupRoomHeader
              contacts={contacts}
              selectedRoom={selectedRoom}
              user={user}
              onCloseConversation={handleCloseConversation}
              onGroupRemoved={handleGroupRemoved}
              onGroupUpdated={handleGroupUpdated}
              onToast={setToast}
            />
          ) : (
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
              peerProfileCache={peerProfileCache}
              onPeerProfileCacheChange={handlePeerProfileCacheChange}
              onToast={setToast}
            />
          )
        }
        room={
          selectedRoom?.is_group ? (
            <GroupConversation
              selectedRoom={selectedRoom}
              onGroupEvent={handleGroupEvent}
            />
          ) : (
            <MessengerConversation
              contacts={contacts}
              selectedContact={selectedContact}
              selectedRoom={selectedRoom}
              user={user}
              releasedMessagesVersion={releasedMessagesVersion}
              cachedConversation={
                selectedRoom?.id
                  ? conversationCache[String(selectedRoom.id)] || null
                  : null
              }
              onRoomMessage={handleRoomMessage}
              onRoomRead={handleRoomRead}
              onConversationCacheChange={handleConversationCacheChange}
              onOpenStoryReference={storiesController.openStoryReference}
            />
          )
        }
        contactsLabel="Contacts and chats"
        roomLabel="Message Room"
      />

      <StoriesOverlayHost
        contacts={contacts}
        controller={storiesController}
        user={user}
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

      {isRecoveryVerifyOpen && recoveryVerifyBackup ? (
        <RecoveryVerifyModal
          backup={recoveryVerifyBackup}
          user={user}
          onClose={
            isRecoveryVerifyRequired ? undefined : handleRecoveryVerifyClose
          }
          onFailedAttemptsExceeded={handleRecoveryVerifyFailed}
          onVerify={handleRecoveryVerifyComplete}
        />
      ) : null}

      <ParrotToast toast={toast} onClose={closeToast} />
    </>
  );
}

export default LayoutPage;
