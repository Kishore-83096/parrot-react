import { useEffect, useRef } from "react";

import {
  clearMessengerSession,
  getMessengerInboxWebSocketUrl,
  getMessengerToken,
  markMessengerRoomDelivered,
  MESSENGER_INBOX_EVENT_NAME,
} from "./api.js";
import { markGroupRoomDelivered } from "../group_messaging/api.js";

const SOCKET_RECONNECT_DELAY_MS = 1500;
const SOCKET_PING_INTERVAL_MS = 25000;

function emitInboxEvent(eventPayload) {
  globalThis.dispatchEvent(
    new CustomEvent(MESSENGER_INBOX_EVENT_NAME, {
      detail: eventPayload,
    }),
  );
}

function MessengerInboxListener() {
  const currentUserIdRef = useRef(null);
  const deliveredMessageIdsRef = useRef(new Set());
  const socketPingIntervalRef = useRef(null);
  const socketReconnectRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    let reconnectAttempt = 0;

    const clearSocketPingInterval = () => {
      if (socketPingIntervalRef.current) {
        globalThis.clearInterval(socketPingIntervalRef.current);
        socketPingIntervalRef.current = null;
      }
    };

    const startSocketPingInterval = (socket) => {
      clearSocketPingInterval();
      socketPingIntervalRef.current = globalThis.setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) {
          return;
        }

        socket.send(JSON.stringify({ type: "ping" }));
      }, SOCKET_PING_INTERVAL_MS);
    };

    const markIncomingMessageDelivered = (roomMessage) => {
      const currentUserId = Number(currentUserIdRef.current);
      const messageId = String(roomMessage?.id || "");

      if (
        !currentUserId ||
        !roomMessage?.room_id ||
        !messageId ||
        Number(roomMessage.sender_user_id) === currentUserId ||
        Number(roomMessage.recipient_user_id) !== currentUserId ||
        deliveredMessageIdsRef.current.has(messageId)
      ) {
        return;
      }

      if (deliveredMessageIdsRef.current.size > 500) {
        deliveredMessageIdsRef.current.clear();
      }
      deliveredMessageIdsRef.current.add(messageId);

      markMessengerRoomDelivered(roomMessage.room_id, {
        last_delivered_message_id: roomMessage.id,
      }).catch(() => {
        deliveredMessageIdsRef.current.delete(messageId);
      });
    };

    const markIncomingGroupMessageDelivered = (roomMessage) => {
      const currentUserId = Number(currentUserIdRef.current);
      const messageId = String(roomMessage?.id || "");
      const deliveredKey = `group:${messageId}`;

      if (
        !currentUserId ||
        !roomMessage?.room_id ||
        !messageId ||
        Number(roomMessage.sender_user_id) === currentUserId ||
        deliveredMessageIdsRef.current.has(deliveredKey)
      ) {
        return;
      }

      if (deliveredMessageIdsRef.current.size > 500) {
        deliveredMessageIdsRef.current.clear();
      }
      deliveredMessageIdsRef.current.add(deliveredKey);

      markGroupRoomDelivered(roomMessage.room_id, {
        last_delivered_message_id: roomMessage.id,
      }).catch(() => {
        deliveredMessageIdsRef.current.delete(deliveredKey);
      });
    };

    const connectInboxSocket = async ({ forceRefresh = false } = {}) => {
      try {
        const token = await getMessengerToken({ forceRefresh });

        if (!isMounted) {
          return;
        }

        const socket = new WebSocket(getMessengerInboxWebSocketUrl(token));
        socketRef.current = socket;

        socket.onopen = () => {
          reconnectAttempt = 0;
          startSocketPingInterval(socket);
        };

        socket.onmessage = (event) => {
          let eventPayload;

          try {
            eventPayload = JSON.parse(event.data);
          } catch {
            return;
          }

          if (eventPayload.type === "connection.accepted") {
            currentUserIdRef.current = Number(eventPayload.user_id) || null;
            emitInboxEvent(eventPayload);
            return;
          }

          if (eventPayload.type === "pong") {
            return;
          }

          emitInboxEvent(eventPayload);

          if (
            eventPayload.type === "message.sent" ||
            eventPayload.type === "message.edited"
          ) {
            markIncomingMessageDelivered(eventPayload.message);
          } else if (
            eventPayload.type === "group.message.sent" ||
            eventPayload.type === "group.message.edited"
          ) {
            markIncomingGroupMessageDelivered(eventPayload.message);
          }
        };

        socket.onclose = (event) => {
          clearSocketPingInterval();

          if (socketRef.current === socket) {
            socketRef.current = null;
          }

          if (!isMounted) {
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
          socketReconnectRef.current = globalThis.setTimeout(() => {
            connectInboxSocket({ forceRefresh: event.code === 4401 });
          }, nextDelay);
        };

        socket.onerror = () => {
          socket.close();
        };
      } catch {
        if (!isMounted) {
          return;
        }

        socketReconnectRef.current = globalThis.setTimeout(() => {
          connectInboxSocket({ forceRefresh: true });
        }, SOCKET_RECONNECT_DELAY_MS);
      }
    };

    connectInboxSocket();

    return () => {
      isMounted = false;

      if (socketReconnectRef.current) {
        globalThis.clearTimeout(socketReconnectRef.current);
        socketReconnectRef.current = null;
      }

      clearSocketPingInterval();

      if (socketRef.current) {
        socketRef.current.close(1000, "Inbox listener unmounted");
        socketRef.current = null;
      }
    };
  }, []);

  return null;
}

export default MessengerInboxListener;
