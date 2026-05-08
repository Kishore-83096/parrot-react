import { Check, CheckCheck, Inbox, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  clearMessengerSession,
  getMessengerErrorMessage,
  getMessengerRoomMessages,
  getMessengerRoomWebSocketUrl,
  getMessengerToken,
  markMessengerRoomDelivered,
  markMessengerRoomRead,
} from "../../api.js";
import SendMessagePage from "./SendMessagePage.jsx";
import "../css/RoomMessagesPage.css";
import "../tab/RoomMessagesPage.css";
import "../mobile/RoomMessagesPage.css";

const MESSAGE_LIMIT = 50;
const SOCKET_RECONNECT_DELAY_MS = 1500;
const MESSAGE_STATUS_WEIGHT = {
  sent: 1,
  delivered: 2,
  read: 3,
};

function getSavedContactNameByAccountNumber(accountNumber, contacts) {
  if (!accountNumber) {
    return "";
  }

  const savedContact = contacts.find(
    (contact) => contact.account_number === accountNumber,
  );

  return savedContact?.alias_name || "";
}

function getParticipantName(userId, room, contacts) {
  const participant = room?.participants?.find(
    (item) => Number(item.user_id) === Number(userId),
  );

  if (!participant) {
    return `User ${userId}`;
  }

  return (
    getSavedContactNameByAccountNumber(participant.account_number, contacts) ||
    participant.display_name ||
    participant.account_number ||
    `User ${userId}`
  );
}

function formatMessageTime(value) {
  if (!value) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function getLatestReceivedMessageId(messages, currentUser) {
  const currentUserId = Number(currentUser?.user_id);

  if (!currentUserId) {
    return null;
  }

  const latestReceivedMessage = [...messages]
    .reverse()
    .find(
      (roomMessage) =>
        Number(roomMessage.sender_user_id) !== currentUserId &&
        Number(roomMessage.recipient_user_id) === currentUserId,
    );

  return latestReceivedMessage?.id || null;
}

function getLatestVisibleMessageId(messages) {
  return messages[messages.length - 1]?.id || null;
}

function getMessageStatusLabel(status) {
  if (status === "read") {
    return "Read";
  }

  if (status === "delivered") {
    return "Delivered";
  }

  return "Sent";
}

function MessageStatusIcon({ status }) {
  const normalizedStatus = ["sent", "delivered", "read"].includes(status)
    ? status
    : "sent";
  const label = getMessageStatusLabel(normalizedStatus);
  const Icon = normalizedStatus === "sent" ? Check : CheckCheck;

  return (
    <span
      className={`messenger-room-messages__status is-${normalizedStatus}`}
      aria-label={label}
      title={label}
    >
      <Icon size={15} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

function compareRoomMessages(leftMessage, rightMessage) {
  const leftCreatedAt = new Date(leftMessage.created_at || 0).getTime();
  const rightCreatedAt = new Date(rightMessage.created_at || 0).getTime();

  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }

  return Number(leftMessage.id || 0) - Number(rightMessage.id || 0);
}

function mergeRoomMessages(currentMessages, nextMessages) {
  const messagesById = new Map(
    currentMessages.map((roomMessage) => [String(roomMessage.id), roomMessage]),
  );

  nextMessages.forEach((roomMessage) => {
    if (!roomMessage?.id) {
      return;
    }

    const messageKey = String(roomMessage.id);
    messagesById.set(messageKey, {
      ...messagesById.get(messageKey),
      ...roomMessage,
    });
  });

  return [...messagesById.values()].sort(compareRoomMessages);
}

function upgradeMessageStatus(roomMessage, nextStatus) {
  const currentWeight = MESSAGE_STATUS_WEIGHT[roomMessage.status] || 0;
  const nextWeight = MESSAGE_STATUS_WEIGHT[nextStatus] || 0;

  if (nextWeight <= currentWeight) {
    return roomMessage;
  }

  return {
    ...roomMessage,
    status: nextStatus,
  };
}

function updateOutgoingMessageStatuses(currentMessages, eventPayload, currentUserId) {
  const status =
    eventPayload.type === "message.read" ? "read" : "delivered";
  const recipientUserId = Number(eventPayload.user_id);
  const markerMessageId = Number(
    eventPayload.last_read_message_id ||
      eventPayload.last_delivered_message_id ||
      0,
  );

  if (!recipientUserId || recipientUserId === Number(currentUserId)) {
    return currentMessages;
  }

  return currentMessages.map((roomMessage) => {
    const belongsToRecipient =
      Number(roomMessage.sender_user_id) === Number(currentUserId) &&
      Number(roomMessage.recipient_user_id) === recipientUserId;
    const isInsideMarker =
      !markerMessageId || Number(roomMessage.id) <= markerMessageId;

    if (!belongsToRecipient || !isInsideMarker) {
      return roomMessage;
    }

    return upgradeMessageStatus(roomMessage, status);
  });
}

function RoomMessagesPage({
  contacts = [],
  isActive = true,
  onRoomResolved,
  recipientAccountNumber = "",
  room,
}) {
  const messagesEndRef = useRef(null);
  const roomSocketRef = useRef(null);
  const roomSocketReconnectRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [roomDetail, setRoomDetail] = useState(room || null);
  const [currentUser, setCurrentUser] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const activeRoom =
    room?.id && Number(roomDetail?.id) !== Number(room.id)
      ? room
      : roomDetail || room || null;
  const activeRoomId = activeRoom?.id;

  const syncRoomReadState = async (nextMessages, nextUser) => {
    if (!isActive || !activeRoomId || nextMessages.length === 0) {
      return;
    }

    const latestReceivedMessageId = getLatestReceivedMessageId(
      nextMessages,
      nextUser,
    );
    const latestVisibleMessageId = getLatestVisibleMessageId(nextMessages);

    const updates = [];

    if (latestReceivedMessageId) {
      updates.push(
        markMessengerRoomDelivered(activeRoomId, {
          last_delivered_message_id: latestReceivedMessageId,
        }),
      );
    }

    if (latestVisibleMessageId) {
      updates.push(
        markMessengerRoomRead(activeRoomId, {
          last_read_message_id: latestVisibleMessageId,
        }),
      );
    }

    const results = await Promise.allSettled(updates);
    const failedResult = results.find((result) => result.status === "rejected");

    if (failedResult) {
      const error = failedResult.reason;
      setMessage(
        getMessengerErrorMessage(error, "Unable to update message read state."),
      );
    }
  };

  const syncIncomingMessageReadState = async (roomMessage, nextUser) => {
    const currentUserId = Number(nextUser?.user_id);

    if (
      !isActive ||
      !activeRoomId ||
      !roomMessage?.id ||
      !currentUserId ||
      Number(roomMessage.sender_user_id) === currentUserId ||
      Number(roomMessage.recipient_user_id) !== currentUserId
    ) {
      return;
    }

    const results = await Promise.allSettled([
      markMessengerRoomDelivered(activeRoomId, {
        last_delivered_message_id: roomMessage.id,
      }),
      markMessengerRoomRead(activeRoomId, {
        last_read_message_id: roomMessage.id,
      }),
    ]);
    const failedResult = results.find((result) => result.status === "rejected");

    if (failedResult) {
      const error = failedResult.reason;
      setMessage(
        getMessengerErrorMessage(error, "Unable to update message read state."),
      );
    }
  };

  const loadMessages = async ({ beforeMessageId = "", appendOlder = false } = {}) => {
    if (!activeRoomId) {
      return;
    }

    if (appendOlder) {
      setIsLoadingOlder(true);
    } else {
      setIsLoading(true);
    }
    setMessage("");

    try {
      const response = await getMessengerRoomMessages(activeRoomId, {
        limit: MESSAGE_LIMIT,
        before_message_id: beforeMessageId,
      });
      const result = response.data?.result || {};
      const nextUser = response.data?.user || null;
      const nextMessages = Array.isArray(result.messages)
        ? result.messages
        : [];

      setRoomDetail(result.room || activeRoom);
      setCurrentUser(nextUser);
      setPagination(result.pagination || null);
      setMessages((currentMessages) =>
        appendOlder
          ? mergeRoomMessages(currentMessages, nextMessages)
          : nextMessages,
      );

      if (!appendOlder) {
        await syncRoomReadState(nextMessages, nextUser);
      }
    } catch (error) {
      setMessage(
        getMessengerErrorMessage(error, "Unable to load room messages."),
      );
      if (!appendOlder) {
        setMessages([]);
      }
    } finally {
      setIsLoading(false);
      setIsLoadingOlder(false);
    }
  };

  const handleSentMessageResponse = async (responseData) => {
    const result = responseData?.result || {};
    const sentMessage = result.message;
    const nextRoom = result.room || null;

    if (responseData?.sender) {
      setCurrentUser(responseData.sender);
    }

    if (nextRoom) {
      setRoomDetail(nextRoom);
      onRoomResolved?.(nextRoom);
    }

    if (
      sentMessage &&
      (!nextRoom?.id || Number(sentMessage.room_id) === Number(nextRoom.id))
    ) {
      setMessages((currentMessages) =>
        mergeRoomMessages(currentMessages, [sentMessage]),
      );
      return;
    }

    await loadMessages();
  };

  useEffect(() => {
    setMessages([]);
    setRoomDetail(room || null);
    setCurrentUser(null);
    setPagination(null);
    setMessage("");
    if (isActive && room?.id) {
      loadMessages();
    }
  }, [room?.id, recipientAccountNumber, isActive]);

  useEffect(() => {
    if (!isActive || !activeRoomId || !currentUser?.user_id) {
      return undefined;
    }

    let isSocketActive = true;
    let reconnectAttempt = 0;

    const connectRoomSocket = async ({ forceRefresh = false } = {}) => {
      try {
        const token = await getMessengerToken({ forceRefresh });

        if (!isSocketActive) {
          return;
        }

        const socket = new WebSocket(
          getMessengerRoomWebSocketUrl(activeRoomId, token),
        );
        roomSocketRef.current = socket;

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

          if (eventPayload.type === "message.sent") {
            const nextRoomMessage = eventPayload.message;

            if (Number(nextRoomMessage?.room_id) !== Number(activeRoomId)) {
              return;
            }

            if (eventPayload.room) {
              setRoomDetail(eventPayload.room);
            }

            setMessages((currentMessages) =>
              mergeRoomMessages(currentMessages, [nextRoomMessage]),
            );
            syncIncomingMessageReadState(nextRoomMessage, currentUser);
            return;
          }

          if (
            eventPayload.type === "message.delivered" ||
            eventPayload.type === "message.read"
          ) {
            if (Number(eventPayload.room_id) !== Number(activeRoomId)) {
              return;
            }

            setMessages((currentMessages) =>
              updateOutgoingMessageStatuses(
                currentMessages,
                eventPayload,
                currentUser.user_id,
              ),
            );
            return;
          }

          if (eventPayload.type === "error") {
            setMessage(eventPayload.message || "Messenger live connection error.");
          }
        };

        socket.onclose = (event) => {
          if (roomSocketRef.current === socket) {
            roomSocketRef.current = null;
          }

          if (!isSocketActive) {
            return;
          }

          if (event.code === 4401) {
            clearMessengerSession();
          }

          const nextDelay = Math.min(
            SOCKET_RECONNECT_DELAY_MS * (reconnectAttempt + 1),
            8000,
          );
          reconnectAttempt += 1;
          roomSocketReconnectRef.current = globalThis.setTimeout(() => {
            connectRoomSocket({ forceRefresh: event.code === 4401 });
          }, nextDelay);
        };

        socket.onerror = () => {
          socket.close();
        };
      } catch (error) {
        if (!isSocketActive) {
          return;
        }

        setMessage(
          getMessengerErrorMessage(error, "Unable to connect live messages."),
        );
        roomSocketReconnectRef.current = globalThis.setTimeout(() => {
          connectRoomSocket({ forceRefresh: true });
        }, SOCKET_RECONNECT_DELAY_MS);
      }
    };

    connectRoomSocket();

    return () => {
      isSocketActive = false;

      if (roomSocketReconnectRef.current) {
        globalThis.clearTimeout(roomSocketReconnectRef.current);
        roomSocketReconnectRef.current = null;
      }

      if (roomSocketRef.current) {
        roomSocketRef.current.close(1000, "Room changed");
        roomSocketRef.current = null;
      }
    };
  }, [isActive, activeRoomId, currentUser?.user_id]);

  useEffect(() => {
    if (!isLoading && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [isLoading, messages.length, activeRoomId]);

  const firstMessageId = messages[0]?.id;
  const canLoadOlder =
    Boolean(firstMessageId) && pagination?.count === MESSAGE_LIMIT;

  if (!activeRoom && !recipientAccountNumber) {
    return (
      <section className="messenger-room-messages">
        <div className="messenger-room-messages__empty">
          <Inbox size={34} aria-hidden="true" />
          <h3>No Chat Selected</h3>
          <p>Choose a chat to see its messages.</p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="messenger-room-messages"
      aria-label={activeRoomId ? `Room ${activeRoomId} messages` : "Messages"}
    >
      {message ? (
        <p className="messenger-room-messages__message" role="alert">
          {message}
        </p>
      ) : null}

      {isLoading ? (
        <div className="messenger-room-messages__loading" aria-live="polite">
          <span />
        </div>
      ) : messages.length === 0 ? (
        <div className="messenger-room-messages__empty">
          <Inbox size={34} aria-hidden="true" />
          <h3>No Messages</h3>
          <p>This room does not have messages yet.</p>
        </div>
      ) : (
        <div className="messenger-room-messages__list" aria-live="polite">
          {canLoadOlder ? (
            <button
              className="messenger-room-messages__older"
              type="button"
              onClick={() =>
                loadMessages({
                  beforeMessageId: firstMessageId,
                  appendOlder: true,
                })
              }
              disabled={isLoadingOlder}
            >
              {isLoadingOlder ? "Loading..." : "Load Older"}
            </button>
          ) : null}

          {messages.map((roomMessage) => {
            const isMine =
              Number(roomMessage.sender_user_id) === Number(currentUser?.user_id);
            const senderName = getParticipantName(
              roomMessage.sender_user_id,
              activeRoom,
              contacts,
            );

            return (
              <article
                className={`messenger-room-messages__bubble${
                  isMine ? " is-mine" : ""
                }`}
                key={roomMessage.id}
              >
                {!isMine ? <strong>{senderName}</strong> : null}
                {roomMessage.text ? <p>{roomMessage.text}</p> : null}
                {roomMessage.attachments?.length > 0 ? (
                  <span className="messenger-room-messages__attachments">
                    <Paperclip size={13} aria-hidden="true" />
                    {roomMessage.attachments.length} attachment
                    {roomMessage.attachments.length === 1 ? "" : "s"}
                  </span>
                ) : null}
                <footer>
                  <span>{formatMessageTime(roomMessage.created_at)}</span>
                  {isMine ? (
                    <MessageStatusIcon status={roomMessage.status} />
                  ) : null}
                </footer>
              </article>
            );
          })}
          <span ref={messagesEndRef} />
        </div>
      )}

      <SendMessagePage
        currentUser={currentUser}
        disabled={isLoading}
        onMessageSent={handleSentMessageResponse}
        recipientAccountNumber={recipientAccountNumber}
        room={activeRoom}
        roomDetail={roomDetail}
      />
    </section>
  );
}

export default RoomMessagesPage;
