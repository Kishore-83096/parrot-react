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
