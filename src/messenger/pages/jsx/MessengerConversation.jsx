import {
  Check,
  CheckCheck,
  LoaderCircle,
  MessageCircle,
  Send,
} from "lucide-react";
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
  getConversationContact,
  getConversationPeerAccount,
  getCurrentUserId,
  getMessageDateDividerLabel,
  getMessageDateKey,
  getMessageStatusLabel,
  upsertMessage,
} from "./roomHelpers.js";

const MESSAGE_PAGE_SIZE = 20;
const OLDER_MESSAGES_SCROLL_THRESHOLD = 8;

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
  contacts,
  selectedContact,
  selectedRoom,
  user,
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
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const messagesListRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageDraftRef = useRef(null);
  const olderMessagesScrollRef = useRef(null);
  const skipNextAutoScrollRef = useRef(false);
  const isOlderMessagesLoadingRef = useRef(false);

  const currentUserId = getCurrentUserId(user);
  const selectedPeerAccountNumber = getConversationPeerAccount({
    selectedContact,
    selectedRoom,
    user,
  });
  const selectedConversationContact = getConversationContact({
    selectedContact,
    selectedRoom,
    contacts,
    user,
  });
  const hasActiveConversation = Boolean(selectedPeerAccountNumber);

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
        return;
      }

      if (!silent) {
        setIsRoomMessagesLoading(true);
      }
      setRoomMessage("");

      try {
        const response = await getMessengerRoomMessages(roomId, {
          limit: MESSAGE_PAGE_SIZE,
          before_message_id: beforeMessageId,
        });
        const messagesResult = response.data?.result || response.data;
        const nextMessages = Array.isArray(messagesResult?.messages)
          ? messagesResult.messages
          : [];
        const pagination = messagesResult?.pagination || {};

        setRoomMessages((currentMessages) =>
          mode === "prepend"
            ? mergeMessagePage(currentMessages, nextMessages)
            : nextMessages,
        );
        setMessagePagination({
          hasMore: Boolean(pagination.has_more),
          nextBeforeMessageId: pagination.next_before_message_id || null,
        });

        if (markRead) {
          markRoomReadForMessages(roomId, nextMessages).catch(() => {});
        }
      } catch (error) {
        if (mode !== "prepend") {
          setRoomMessages([]);
        }
        setRoomMessage(
          getMessengerErrorMessage(error, "Unable to load messages."),
        );
      } finally {
        if (!silent) {
          setIsRoomMessagesLoading(false);
        }
      }
    },
    [markRoomReadForMessages],
  );

  useEffect(() => {
    setMessageDraft("");
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
  }, [loadRoomMessages, selectedPeerAccountNumber, selectedRoom?.id]);

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
        socket.close(1000, "Conversation changed");
      }
    };
  }, [
    currentUserId,
    loadRoomMessages,
    onRoomMessage,
    onRoomRead,
    selectedRoom?.id,
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

    if (!text || !selectedPeerAccountNumber || isSendingMessage) {
      return;
    }

    setIsSendingMessage(true);
    setRoomMessage("");

    try {
      const response = await sendMessengerMessage({
        recipient_account_number: selectedPeerAccountNumber,
        text,
        client_message_id: createMessengerClientMessageId(),
      });
      const messageResult = response.data?.result || response.data;

      setMessageDraft("");

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
      setRoomMessage(getMessengerErrorMessage(error, "Unable to send message."));
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleMessageDraftChange = (event) => {
    setMessageDraft(event.target.value);
  };

  const handleMessageDraftKeyDown = (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent?.isComposing) {
      return;
    }

    handleSendMessage(event);
  };

  if (!hasActiveConversation) {
    return (
      <div className="parent-layout-page__room-placeholder">
        <MessageCircle size={32} aria-hidden="true" />
        <p>Select a contact or chat room to open messages here.</p>
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
                  }`}
                >
                  <div className="parent-layout-page__message-bubble">
                    {message.text ? <p>{message.text}</p> : null}

                    {Array.isArray(message.attachments) &&
                    message.attachments.length > 0 ? (
                      <div className="parent-layout-page__message-attachments">
                        {message.attachments.map((attachment) => (
                          <a
                            href={attachment.file_url}
                            target="_blank"
                            rel="noreferrer"
                            key={attachment.id}
                          >
                            {attachment.file_name || attachment.file_type || "File"}
                          </a>
                        ))}
                      </div>
                    ) : null}

                    <footer>
                      <time dateTime={message.created_at}>
                        {formatRoomTime(message.created_at)}
                      </time>
                      {isMine ? (
                        <span
                          className={`parent-layout-page__message-status is-${
                            message.status || "sent"
                          }`}
                          aria-label={messageStatus}
                          title={messageStatus}
                        >
                          {message.status === "read" ||
                          message.status === "delivered" ? (
                            <CheckCheck size={14} aria-hidden="true" />
                          ) : (
                            <Check size={14} aria-hidden="true" />
                          )}
                        </span>
                      ) : null}
                    </footer>
                  </div>
                </article>
              </Fragment>
            );
              },
            )}
          </>
        )}
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
        <textarea
          ref={messageDraftRef}
          value={messageDraft}
          onChange={handleMessageDraftChange}
          onKeyDown={handleMessageDraftKeyDown}
          placeholder={
            selectedConversationContact?.blocked
              ? "Unblock to send a message"
              : "Message"
          }
          disabled={isSendingMessage || selectedConversationContact?.blocked}
          maxLength={5000}
          rows={1}
        />
        <button
          type="submit"
          disabled={
            !messageDraft.trim() ||
            isSendingMessage ||
            selectedConversationContact?.blocked
          }
          aria-label={isSendingMessage ? "Sending message" : "Send message"}
          title="Send"
        >
          <Send size={20} aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}

export default MessengerConversation;
