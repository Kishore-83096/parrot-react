import axios from "axios";

const PARENT_API_BASE_URL =
  import.meta.env.VITE_PARENT_API_BASE_URL || "http://localhost:5000/parent";

const ACCESS_TOKEN_KEY = "parent_access_token";
const REFRESH_TOKEN_KEY = "parent_refresh_token";
const USER_KEY = "parent_user";

export const parentAxios = axios.create({
  baseURL: PARENT_API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

parentAxios.interceptors.request.use((config) => {
  const token = getAccessToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

export const getAccessToken = () => localStorage.getItem(ACCESS_TOKEN_KEY);

export const getRefreshToken = () => localStorage.getItem(REFRESH_TOKEN_KEY);

export const getStoredParentUser = () => {
  const user = localStorage.getItem(USER_KEY);
  return user ? JSON.parse(user) : null;
};

export const storeParentSession = ({ access_token, refresh_token, user }) => {
  if (access_token) {
    localStorage.setItem(ACCESS_TOKEN_KEY, access_token);
  }

  if (refresh_token) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refresh_token);
  }

  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
};

export const clearParentSession = () => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

export const registerParent = (data) =>
  parentAxios.post("/auth/register", data);

export const loginParent = async (data) => {
  const response = await parentAxios.post("/auth/login", data);
  storeParentSession(response.data);
  return response;
};

export const refreshParentToken = async () => {
  const refreshToken = getRefreshToken();
  const response = await parentAxios.post(
    "/auth/refresh",
    {},
    {
      headers: {
        Authorization: `Bearer ${refreshToken}`,
      },
    },
  );

  storeParentSession({ access_token: response.data.access_token });
  return response;
};

export const changeParentPassword = (data) =>
  parentAxios.post("/auth/change-password", data);

export const getParentProfile = () => parentAxios.get("/profile/");

export const searchParentUser = (data) => parentAxios.post("/users/search", data);

export const getParentContacts = () => parentAxios.get("/contacts");

export const getParentContactDetail = (accountNumber) =>
  parentAxios.get(`/contacts/${encodeURIComponent(accountNumber)}`);

export const saveParentContact = (data) => parentAxios.post("/contacts", data);

export const updateParentContactAlias = (data) =>
  parentAxios.patch("/contacts/alias", data);

export const blockParentContact = (data) =>
  parentAxios.post("/contacts/block", data);

export const unblockParentContact = (data) =>
  parentAxios.post("/contacts/unblock", data);

export const deleteParentContact = (data) =>
  parentAxios.delete("/contacts", { data });

export const updateParentProfile = (data) => {
  const hasProfilePicture =
    data instanceof FormData || Boolean(data?.profile_picture instanceof File);

  if (data instanceof FormData) {
    return parentAxios.put("/profile/", data, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  }

  if (hasProfilePicture) {
    const formData = new FormData();

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, value);
      }
    });

    return parentAxios.put("/profile/", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  }

  return parentAxios.put("/profile/", data);
};

export const deleteParentProfilePicture = () =>
  parentAxios.delete("/profile/picture");

export const deleteParentAccount = (data) =>
  parentAxios.delete("/account", { data });
