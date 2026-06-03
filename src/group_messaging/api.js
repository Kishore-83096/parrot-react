import { messengerAxios } from "../messenger/api.js";

export const createGroupRoom = (data) => messengerAxios.post("/groups/", data);

export const updateGroupRoom = (roomId, data) =>
  messengerAxios.patch(`/groups/${encodeURIComponent(roomId)}/`, data);

export const uploadGroupRoomAvatar = (roomId, file) => {
  const formData = new FormData();
  formData.append("avatar", file);

  return messengerAxios.post(
    `/groups/${encodeURIComponent(roomId)}/avatar/`,
    formData,
  );
};
