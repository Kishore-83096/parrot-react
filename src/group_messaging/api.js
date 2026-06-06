import { messengerAxios } from "../messenger/api.js";

export const createGroupRoom = (data) => messengerAxios.post("/groups/", data);

export const getGroupRoom = (roomId) =>
  messengerAxios.get(`/groups/${encodeURIComponent(roomId)}/`);

export const updateGroupRoom = (roomId, data) =>
  messengerAxios.patch(`/groups/${encodeURIComponent(roomId)}/`, data);

export const deleteGroupRoom = (roomId) =>
  messengerAxios.delete(`/groups/${encodeURIComponent(roomId)}/`);

export const uploadGroupRoomAvatar = (roomId, file) => {
  const formData = new FormData();
  formData.append("avatar", file);

  return messengerAxios.post(
    `/groups/${encodeURIComponent(roomId)}/avatar/`,
    formData,
  );
};

export const addGroupMembers = (roomId, memberAccountNumbers) =>
  messengerAxios.post(`/groups/${encodeURIComponent(roomId)}/members/`, {
    member_account_numbers: memberAccountNumbers,
  });

export const removeGroupMember = (roomId, userId) =>
  messengerAxios.delete(
    `/groups/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}/`,
  );

export const makeGroupSubAdmin = (roomId, userId) =>
  messengerAxios.post(
    `/groups/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}/sub-admin/`,
  );

export const removeGroupSubAdmin = (roomId, userId) =>
  messengerAxios.delete(
    `/groups/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}/sub-admin/`,
  );

export const transferGroupAdmin = (roomId, userId) =>
  messengerAxios.post(`/groups/${encodeURIComponent(roomId)}/admin-transfer/`, {
    user_id: userId,
  });

export const leaveGroupRoom = (roomId) =>
  messengerAxios.post(`/groups/${encodeURIComponent(roomId)}/leave/`);

export const getGroupCryptoDevices = (roomId) =>
  messengerAxios.get(`/groups/${encodeURIComponent(roomId)}/crypto/devices/`);

export const createGroupEncryptedFileUploadIntents = (roomId, data) =>
  messengerAxios.post(
    `/groups/${encodeURIComponent(roomId)}/crypto/files/upload-intents/`,
    data,
  );

export const completeGroupEncryptedFileUploadIntent = (
  roomId,
  uploadIntentId,
  data,
) =>
  messengerAxios.post(
    `/groups/${encodeURIComponent(roomId)}/crypto/files/upload-intents/${encodeURIComponent(uploadIntentId)}/complete/`,
    data,
  );

export const getGroupRoomMessages = (
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
    `/groups/${encodeURIComponent(roomId)}/messages/`,
    { params },
  );
};

export const sendGroupMessage = (roomId, data) =>
  messengerAxios.post(`/groups/${encodeURIComponent(roomId)}/messages/send/`, data);

export const reactToGroupMessage = (roomId, messageId, reaction) =>
  messengerAxios.post(
    `/groups/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/reaction/`,
    { reaction },
  );

export const editGroupMessage = (roomId, messageId, data) =>
  messengerAxios.post(
    `/groups/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/edit/`,
    data,
  );

export const deleteGroupMessage = (roomId, messageId) =>
  messengerAxios.post(
    `/groups/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/delete/`,
    {},
  );

export const markGroupRoomDelivered = (roomId, data = {}) =>
  messengerAxios.post(
    `/groups/${encodeURIComponent(roomId)}/messages/delivered/`,
    data,
  );

export const markGroupRoomRead = (roomId, data = {}) =>
  messengerAxios.post(
    `/groups/${encodeURIComponent(roomId)}/messages/read/`,
    data,
  );

export const prewarmGroupReceiptVisibility = (roomId) =>
  messengerAxios.post(
    `/groups/${encodeURIComponent(roomId)}/receipts/visibility/prewarm/`,
    {},
  );
