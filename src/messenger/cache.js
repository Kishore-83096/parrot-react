const MESSENGER_UI_CACHE_PREFIX = "parrot:messenger-ui-cache:v1";
const MAX_CACHED_CONTACTS = 500;
const MAX_CACHED_ROOMS = 250;
const MAX_CACHED_CONVERSATIONS = 80;
const MAX_CACHED_MESSAGES_PER_ROOM = 350;
const MAX_CACHED_LOGS_PER_ROOM = 200;

function getEmptyMessengerUiCache() {
  return {
    contacts: [],
    rooms: [],
    selectedContact: null,
    selectedRoom: null,
    conversations: {},
    peerProfiles: {},
    updatedAt: null,
  };
}

function getMessengerUiCacheScope(user) {
  const userId = user?.id || user?.user_id;

  if (userId) {
    return `user:${String(userId)}`;
  }

  if (user?.account_number) {
    return `account:${String(user.account_number)}`;
  }

  if (user?.username) {
    return `username:${String(user.username)}`;
  }

  return "";
}

function getMessengerUiCacheKey(user) {
  const scope = getMessengerUiCacheScope(user);

  return scope ? `${MESSENGER_UI_CACHE_PREFIX}:${scope}` : "";
}

function cloneSerializable(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallback));
  } catch {
    return fallback;
  }
}

function sanitizeAttachmentForCache(attachment) {
  if (!attachment || typeof attachment !== "object") {
    return null;
  }

  const nextAttachment = cloneSerializable(attachment, null);

  if (!nextAttachment || typeof nextAttachment !== "object") {
    return null;
  }

  const localPreviewUrl =
    typeof nextAttachment.local_preview_url === "string"
      ? nextAttachment.local_preview_url
      : "";
  const fileUrl =
    typeof nextAttachment.file_url === "string" ? nextAttachment.file_url : "";

  if (
    nextAttachment.is_local_preview ||
    localPreviewUrl.startsWith("blob:") ||
    fileUrl.startsWith("blob:")
  ) {
    return null;
  }

  delete nextAttachment.local_preview_url;
  return nextAttachment;
}

function sanitizeMessageForCache(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  if (message.is_pending || message.status === "sending") {
    return null;
  }

  const {
    decrypted_attachments: decryptedAttachments,
    reply_to: replyTo,
    ...restMessage
  } = message;
  const nextMessage = cloneSerializable(restMessage, null);

  if (!nextMessage || typeof nextMessage !== "object") {
    return null;
  }

  if (Array.isArray(nextMessage.attachments)) {
    nextMessage.attachments = nextMessage.attachments
      .map(sanitizeAttachmentForCache)
      .filter(Boolean);
  }

  if (Array.isArray(decryptedAttachments)) {
    nextMessage.decrypted_attachments = decryptedAttachments
      .map(sanitizeAttachmentForCache)
      .filter(Boolean);
  }

  if (replyTo) {
    nextMessage.reply_to = sanitizeMessageForCache(replyTo);
  }

  return nextMessage;
}

function sanitizeMessagesForCache(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map(sanitizeMessageForCache)
    .filter(Boolean)
    .sort((first, second) => {
      const firstTime = new Date(first.created_at || 0).getTime();
      const secondTime = new Date(second.created_at || 0).getTime();

      if (firstTime === secondTime) {
        return Number(first.id || 0) - Number(second.id || 0);
      }

      return firstTime - secondTime;
    })
    .slice(-MAX_CACHED_MESSAGES_PER_ROOM);
}

function sanitizeLogForCache(log) {
  if (!log || typeof log !== "object") {
    return null;
  }

  const nextLog = cloneSerializable(log, null);

  if (!nextLog || typeof nextLog !== "object" || !nextLog.id) {
    return null;
  }

  return nextLog;
}

function sanitizeLogsForCache(logs) {
  return (Array.isArray(logs) ? logs : [])
    .map(sanitizeLogForCache)
    .filter(Boolean)
    .sort((first, second) => {
      const firstTime = new Date(first.created_at || 0).getTime();
      const secondTime = new Date(second.created_at || 0).getTime();

      if (firstTime === secondTime) {
        return Number(first.id || 0) - Number(second.id || 0);
      }

      return firstTime - secondTime;
    })
    .slice(-MAX_CACHED_LOGS_PER_ROOM);
}

function sanitizePaginationForCache(pagination) {
  return {
    hasMore: Boolean(pagination?.hasMore),
    nextBeforeMessageId: pagination?.nextBeforeMessageId || null,
  };
}

export function sanitizeConversationForCache(conversation) {
  return {
    logs: sanitizeLogsForCache(conversation?.logs),
    messages: sanitizeMessagesForCache(conversation?.messages),
    pagination: sanitizePaginationForCache(conversation?.pagination),
    updatedAt: conversation?.updatedAt || new Date().toISOString(),
  };
}

function sanitizeRoomForCache(room) {
  if (!room || typeof room !== "object") {
    return null;
  }

  const nextRoom = cloneSerializable(room, null);

  if (!nextRoom || typeof nextRoom !== "object") {
    return null;
  }

  if (nextRoom.last_message) {
    nextRoom.last_message = sanitizeMessageForCache(nextRoom.last_message);
  }

  return nextRoom;
}

function sanitizeConversationMapForCache(conversations) {
  const entries = Object.entries(conversations || {})
    .map(([roomId, conversation]) => [
      String(roomId),
      sanitizeConversationForCache(conversation),
    ])
    .filter(([, conversation]) => conversation.messages.length > 0)
    .sort(
      ([, firstConversation], [, secondConversation]) =>
        new Date(secondConversation.updatedAt || 0).getTime() -
        new Date(firstConversation.updatedAt || 0).getTime(),
    )
    .slice(0, MAX_CACHED_CONVERSATIONS);

  return Object.fromEntries(entries);
}

function normalizeMessengerUiCache(cache) {
  const emptyCache = getEmptyMessengerUiCache();
  const nextCache = cache && typeof cache === "object" ? cache : emptyCache;

  return {
    contacts: (Array.isArray(nextCache.contacts) ? nextCache.contacts : [])
      .map((contact) => cloneSerializable(contact, null))
      .filter(Boolean)
      .slice(0, MAX_CACHED_CONTACTS),
    rooms: (Array.isArray(nextCache.rooms) ? nextCache.rooms : [])
      .map(sanitizeRoomForCache)
      .filter(Boolean)
      .slice(0, MAX_CACHED_ROOMS),
    selectedContact: cloneSerializable(nextCache.selectedContact, null),
    selectedRoom: sanitizeRoomForCache(nextCache.selectedRoom),
    conversations: sanitizeConversationMapForCache(nextCache.conversations),
    peerProfiles: cloneSerializable(nextCache.peerProfiles, {}) || {},
    updatedAt: nextCache.updatedAt || null,
  };
}

export function getMessengerUiCache(user) {
  const cacheKey = getMessengerUiCacheKey(user);

  if (!cacheKey || typeof globalThis.localStorage === "undefined") {
    return getEmptyMessengerUiCache();
  }

  try {
    const rawCache = globalThis.localStorage.getItem(cacheKey);

    if (!rawCache) {
      return getEmptyMessengerUiCache();
    }

    return normalizeMessengerUiCache(JSON.parse(rawCache));
  } catch {
    return getEmptyMessengerUiCache();
  }
}

export function saveMessengerUiCache(user, updater) {
  const cacheKey = getMessengerUiCacheKey(user);

  if (!cacheKey || typeof globalThis.localStorage === "undefined") {
    return getEmptyMessengerUiCache();
  }

  const currentCache = getMessengerUiCache(user);
  const nextCache =
    typeof updater === "function"
      ? updater(currentCache)
      : {
          ...currentCache,
          ...(updater || {}),
        };
  const normalizedCache = normalizeMessengerUiCache({
    ...nextCache,
    updatedAt: new Date().toISOString(),
  });

  try {
    globalThis.localStorage.setItem(cacheKey, JSON.stringify(normalizedCache));
  } catch {
    const trimmedCache = normalizeMessengerUiCache({
      ...normalizedCache,
      conversations: Object.fromEntries(
        Object.entries(normalizedCache.conversations).slice(0, 20),
      ),
    });

    try {
      globalThis.localStorage.setItem(cacheKey, JSON.stringify(trimmedCache));
    } catch {
      // Cache writes are best effort; API data remains the source of truth.
    }
  }

  return normalizedCache;
}

export function clearMessengerUiCache(user) {
  const cacheKey = getMessengerUiCacheKey(user);

  if (!cacheKey || typeof globalThis.localStorage === "undefined") {
    return;
  }

  try {
    globalThis.localStorage.removeItem(cacheKey);
  } catch {
    // Ignore storage failures during logout.
  }
}
