import axios from "axios";

import { getStoredParentUser, parentAxios } from "../parent/api.js";

const runtimeConfig = globalThis.__PARROT_CONFIG__ || {};

const MESSENGER_API_BASE_URL =
  runtimeConfig.VITE_MESSENGER_SERVICE_URL ||
  runtimeConfig.MESSENGER_SERVICE_URL ||
  import.meta.env.VITE_MESSENGER_SERVICE_URL ||
  import.meta.env.MESSENGER_SERVICE_URL ||
  "http://localhost:8000";

const MESSENGER_TOKEN_KEY = "messenger_access_token";
const MESSENGER_TOKEN_EXPIRES_AT_KEY = "messenger_access_token_expires_at";
const TOKEN_EXPIRY_SKEW_MS = 30 * 1000;

export const MESSENGER_INBOX_EVENT_NAME = "messenger:inbox-event";

let pendingMessagingTokenRequest = null;

export const messengerAxios = axios.create({
  baseURL: MESSENGER_API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

function decodeTokenPayload(token) {
  try {
    const payload = token.split(".")[1];
    const normalizedPayload = payload
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(payload.length / 4) * 4, "=");

    return JSON.parse(window.atob(normalizedPayload));
  } catch {
    return null;
  }
}

function getCurrentParentUserId() {
  const user = getStoredParentUser();
  const userId = user?.id || user?.user_id;

  return userId ? String(userId) : "";
}

function isMessengerTokenForCurrentUser(token) {
  const currentUserId = getCurrentParentUserId();

  if (!currentUserId) {
    return true;
  }

  const payload = decodeTokenPayload(token);
  const tokenUserId = payload?.sub || payload?.user_id;

  return tokenUserId ? String(tokenUserId) === currentUserId : false;
}

export const getStoredMessengerToken = () => {
  const token = localStorage.getItem(MESSENGER_TOKEN_KEY);
  const expiresAt = Number(localStorage.getItem(MESSENGER_TOKEN_EXPIRES_AT_KEY));

  if (!token || !expiresAt || Date.now() + TOKEN_EXPIRY_SKEW_MS >= expiresAt) {
    return "";
  }

  if (!isMessengerTokenForCurrentUser(token)) {
    clearMessengerSession();
    return "";
  }

  return token;
};

export const clearMessengerSession = () => {
  pendingMessagingTokenRequest = null;
  localStorage.removeItem(MESSENGER_TOKEN_KEY);
  localStorage.removeItem(MESSENGER_TOKEN_EXPIRES_AT_KEY);
};

export const storeMessengerToken = ({ messaging_token, expires_in }) => {
  if (!messaging_token) {
    clearMessengerSession();
    return "";
  }

  const expiresAt = Date.now() + Number(expires_in || 0) * 1000;

  localStorage.setItem(MESSENGER_TOKEN_KEY, messaging_token);
  localStorage.setItem(MESSENGER_TOKEN_EXPIRES_AT_KEY, String(expiresAt));

  return messaging_token;
};

export const getMessengerToken = async ({ forceRefresh = false } = {}) => {
  const storedToken = getStoredMessengerToken();

  if (storedToken && !forceRefresh) {
    return storedToken;
  }

  if (!pendingMessagingTokenRequest) {
    pendingMessagingTokenRequest = parentAxios
      .post("/messaging/token")
      .then((response) => storeMessengerToken(response.data))
      .finally(() => {
        pendingMessagingTokenRequest = null;
      });
  }

  return pendingMessagingTokenRequest;
};

messengerAxios.interceptors.request.use(async (config) => {
  const token = await getMessengerToken();

  if (typeof FormData !== "undefined" && config.data instanceof FormData) {
    delete config.headers["Content-Type"];
    delete config.headers["content-type"];
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

messengerAxios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._messengerRetry
    ) {
      originalRequest._messengerRetry = true;
      clearMessengerSession();

      const token = await getMessengerToken({ forceRefresh: true });
      originalRequest.headers.Authorization = `Bearer ${token}`;

      return messengerAxios(originalRequest);
    }

    return Promise.reject(error);
  },
);

export const getMessengerRooms = () => messengerAxios.get("/rooms/");

export const getMessengerRoomMessages = (
  roomId,
  { limit, before_message_id, around_message_id } = {},
) => {
  const params = {};

  if (limit !== undefined && limit !== "") {
    params.limit = limit;
  }

  if (
    before_message_id !== undefined &&
    before_message_id !== null &&
    before_message_id !== ""
  ) {
    params.before_message_id = before_message_id;
  }

  if (
    around_message_id !== undefined &&
    around_message_id !== null &&
    around_message_id !== ""
  ) {
    params.around_message_id = around_message_id;
  }

  return messengerAxios.get(
    `/rooms/${encodeURIComponent(roomId)}/messages/`,
    { params },
  );
};

export const createMessengerClientMessageId = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `message-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const getMessengerWebSocketUrl = (path, token) => {
  const appOrigin = globalThis.location?.origin || "http://localhost";
  const baseUrl = new URL(MESSENGER_API_BASE_URL, appOrigin);
  const socketProtocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
  const basePath = baseUrl.pathname.replace(/\/$/, "");
  const socketPath = path.startsWith("/") ? path : `/${path}`;
  const socketUrl = new URL(
    `${basePath}${socketPath}`,
    `${socketProtocol}//${baseUrl.host}`,
  );

  if (token) {
    socketUrl.searchParams.set("token", token);
  }

  return socketUrl.toString();
};

export const getMessengerRoomWebSocketUrl = (roomId, token) =>
  getMessengerWebSocketUrl(
    `/ws/rooms/${encodeURIComponent(roomId)}/`,
    token,
  );

export const getMessengerInboxWebSocketUrl = (token) =>
  getMessengerWebSocketUrl("/ws/inbox/", token);

export const sendMessengerMessage = (data) =>
  messengerAxios.post("/messages/send/", data);

export const reactToMessengerMessage = (messageId, reaction) =>
  messengerAxios.post(
    `/messages/${encodeURIComponent(messageId)}/reaction/`,
    { reaction },
  );

export const registerMessengerCryptoDevice = (data) =>
  messengerAxios.post("/crypto/devices/", data);

export const setMessengerDefaultCryptoDevice = (deviceId, data = {}) =>
  messengerAxios.post(
    `/crypto/devices/${encodeURIComponent(deviceId)}/default/`,
    data,
  );

export const updateMessengerDefaultDevicePassword = (data = {}) =>
  messengerAxios.post("/crypto/devices/default-password/", data);

export const revokeMessengerCryptoDevice = (deviceId, data = {}) =>
  messengerAxios.post(
    `/crypto/devices/${encodeURIComponent(deviceId)}/revoke/`,
    data,
  );

export const uploadMessengerEncryptedFile = (data) =>
  messengerAxios.post("/crypto/files/", data);

export const createMessengerEncryptedFileUploadIntents = (data) =>
  messengerAxios.post("/crypto/files/upload-intents/", data);

export const completeMessengerEncryptedFileUploadIntent = (
  uploadIntentId,
  data,
) =>
  messengerAxios.post(
    `/crypto/files/upload-intents/${encodeURIComponent(uploadIntentId)}/complete/`,
    data,
  );

export const getMessengerCryptoKeyBackup = () =>
  messengerAxios.get("/crypto/key-backup/");

export const saveMessengerCryptoKeyBackup = (data) =>
  messengerAxios.post("/crypto/key-backup/", data);

export const getMessengerUserCryptoDevices = (userId) =>
  messengerAxios.get(`/crypto/users/${encodeURIComponent(userId)}/devices/`);

export const getMessengerRecipientCryptoDevices = (recipientAccountNumber) =>
  messengerAxios.get(
    `/crypto/recipients/${encodeURIComponent(recipientAccountNumber)}/devices/`,
  );

export const markMessengerRoomDelivered = (roomId, data = {}) =>
  messengerAxios.post(`/rooms/${encodeURIComponent(roomId)}/delivered/`, data);

export const markMessengerRoomRead = (roomId, data = {}) =>
  messengerAxios.post(`/rooms/${encodeURIComponent(roomId)}/read/`, data);

export const releaseMessengerRoomBlockedMessages = (roomId) =>
  messengerAxios.post(
    `/rooms/${encodeURIComponent(roomId)}/blocked-messages/release/`,
    {},
  );

export const getMessengerErrorMessage = (error, fallbackMessage) => {
  const data = error.response?.data;
  const errors = data?.errors || data?.result?.errors;

  if (errors) {
    return Object.entries(errors)
      .map(([field, fieldErrors]) => {
        const value = Array.isArray(fieldErrors)
          ? fieldErrors.join(", ")
          : String(fieldErrors);

        return `${field}: ${value}`;
      })
      .join(" ");
  }

  return data?.message || data?.result?.message || fallbackMessage;
};
