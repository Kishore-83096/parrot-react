import { MessageCircle, UsersRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  clearMessengerSession,
  getMessengerRoomWebSocketUrl,
  getMessengerToken,
} from "../../messenger/api.js";

const SOCKET_RECONNECT_DELAY_MS = 1500;
const SOCKET_PING_INTERVAL_MS = 25000;

function mergeLogs(currentLogs, nextLogs) {
  const logsById = new Map();

  [...currentLogs, ...(Array.isArray(nextLogs) ? nextLogs : [])].forEach((log) => {
    if (!log?.id) {
      return;
    }

    logsById.set(Number(log.id), log);
  });

  return Array.from(logsById.values()).sort(
    (first, second) =>
      new Date(first.created_at || 0).getTime() -
      new Date(second.created_at || 0).getTime() ||
      Number(first.id) - Number(second.id),
  );
}

function GroupConversation({ selectedRoom, onGroupEvent }) {
  const [logs, setLogs] = useState(() =>
    Array.isArray(selectedRoom?.latest_logs) ? selectedRoom.latest_logs : [],
  );
  const socketPingIntervalRef = useRef(null);
  const socketReconnectRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    setLogs(Array.isArray(selectedRoom?.latest_logs) ? selectedRoom.latest_logs : []);
  }, [selectedRoom?.id, selectedRoom?.latest_logs]);

  useEffect(() => {
    if (!selectedRoom?.id || !selectedRoom?.is_group) {
      return undefined;
    }

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

    const connectSocket = async ({ forceRefresh = false } = {}) => {
      try {
        const token = await getMessengerToken({ forceRefresh });

        if (!isMounted) {
          return;
        }

        const socket = new WebSocket(
          getMessengerRoomWebSocketUrl(selectedRoom.id, token),
        );
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

          if (eventPayload.type === "pong" || eventPayload.type === "typing.snapshot") {
            return;
          }

          if (eventPayload.type?.startsWith("group.")) {
            const nextLogs = eventPayload.log ? [eventPayload.log] : eventPayload.logs;
            setLogs((currentLogs) => mergeLogs(currentLogs, nextLogs || []));
            onGroupEvent?.(eventPayload);
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
            connectSocket({ forceRefresh: event.code === 4401 });
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
          connectSocket({ forceRefresh: true });
        }, SOCKET_RECONNECT_DELAY_MS);
      }
    };

    connectSocket();

    return () => {
      isMounted = false;

      if (socketReconnectRef.current) {
        globalThis.clearTimeout(socketReconnectRef.current);
        socketReconnectRef.current = null;
      }

      clearSocketPingInterval();

      if (socketRef.current) {
        socketRef.current.close(1000, "Group room listener unmounted");
        socketRef.current = null;
      }
    };
  }, [onGroupEvent, selectedRoom?.id, selectedRoom?.is_group]);

  const latestLogs = useMemo(() => mergeLogs([], logs), [logs]);

  if (!selectedRoom?.is_group) {
    return null;
  }

  return (
    <section className="parent-layout-page__conversation parent-layout-page__group-conversation">
      <div className="parent-layout-page__group-log-list" aria-live="polite">
        {latestLogs.length === 0 ? (
          <div className="parent-layout-page__messages-empty">
            <UsersRound size={30} aria-hidden="true" />
            <p>Group activity will appear here.</p>
          </div>
        ) : (
          latestLogs.map((log) => (
            <div className="parent-layout-page__group-log" key={log.id}>
              <MessageCircle size={15} aria-hidden="true" />
              <span>{log.text || "Group updated"}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default GroupConversation;
