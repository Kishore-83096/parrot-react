import { Camera, LoaderCircle, MoreVertical, Pencil, Save, UsersRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getMessengerErrorMessage } from "../../messenger/api.js";
import { getInitials } from "../../messenger/pages/jsx/roomHelpers.js";
import { updateGroupRoom, uploadGroupRoomAvatar } from "../api.js";

function getCurrentUserId(user) {
  return Number(user?.id || user?.user_id || 0);
}

function isCurrentUserGroupAdmin(room, user) {
  const currentUserId = getCurrentUserId(user);
  const participant = (Array.isArray(room?.participants) ? room.participants : [])
    .find((item) => Number(item?.user_id) === currentUserId);

  if (participant) {
    return participant.role === "admin";
  }

  return room?.my_role === "admin";
}

function GroupRoomHeader({
  selectedRoom,
  user,
  onCloseConversation,
  onGroupUpdated,
  onToast,
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const avatarInputRef = useRef(null);

  const groupName = selectedRoom?.title || `Group ${selectedRoom?.id || ""}`.trim();
  const avatarUrl = selectedRoom?.avatar_url || "";
  const memberCount = Number(selectedRoom?.member_count || selectedRoom?.participants?.length || 0);
  const canManageGroup = isCurrentUserGroupAdmin(selectedRoom, user);

  useEffect(() => {
    setIsMenuOpen(false);
    setIsEditingName(false);
    setNameDraft(selectedRoom?.title || "");
    setMessage("");
    setIsSaving(false);
  }, [selectedRoom?.id, selectedRoom?.title]);

  const handleNameSubmit = async (event) => {
    event.preventDefault();
    const nextName = nameDraft.trim();

    if (!selectedRoom?.id || !nextName || nextName === selectedRoom?.title) {
      setIsEditingName(false);
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const response = await updateGroupRoom(selectedRoom.id, { title: nextName });
      const result = response.data?.result || response.data;
      if (result?.room) {
        onGroupUpdated?.(result.room);
      }
      setIsEditingName(false);
    } catch (error) {
      const errorMessage = getMessengerErrorMessage(error, "Unable to rename group.");
      setMessage(errorMessage);
      onToast?.({
        type: "error",
        title: "Group not updated",
        message: errorMessage,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarChange = async (event) => {
    const file = event.target.files?.[0] || null;

    if (!selectedRoom?.id || !file) {
      return;
    }

    setIsSaving(true);
    setMessage("");
    setIsMenuOpen(false);

    try {
      const response = await uploadGroupRoomAvatar(selectedRoom.id, file);
      const result = response.data?.result || response.data;
      if (result?.room) {
        onGroupUpdated?.(result.room);
      }
    } catch (error) {
      const errorMessage = getMessengerErrorMessage(error, "Unable to update group picture.");
      setMessage(errorMessage);
      onToast?.({
        type: "error",
        title: "Picture not updated",
        message: errorMessage,
      });
    } finally {
      setIsSaving(false);
      if (avatarInputRef.current) {
        avatarInputRef.current.value = "";
      }
    }
  };

  const handleCloseConversation = () => {
    setIsMenuOpen(false);
    onCloseConversation?.();
  };

  if (!selectedRoom?.is_group) {
    return <h2 id="parrot-layout-room-title">Group Room</h2>;
  }

  return (
    <div className="parent-layout-page__conversation-header parent-layout-page__group-header">
      <span className="parent-layout-page__conversation-avatar" aria-hidden="true">
        {avatarUrl ? <img src={avatarUrl} alt="" /> : getInitials(groupName)}
      </span>

      <div className="parent-layout-page__conversation-title">
        {isEditingName ? (
          <form
            className="parent-layout-page__group-title-form"
            onSubmit={handleNameSubmit}
          >
            <input
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              maxLength={120}
              disabled={isSaving}
              aria-label="Group name"
            />
            <button type="submit" disabled={isSaving || !nameDraft.trim()}>
              {isSaving ? <LoaderCircle size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
            </button>
          </form>
        ) : (
          <div className="parent-layout-page__conversation-title-row">
            <h2 id="parrot-layout-room-title">{groupName}</h2>
          </div>
        )}

        <div className="parent-layout-page__conversation-meta">
          <span className="parent-layout-page__conversation-subtitle">
            {memberCount} member{memberCount === 1 ? "" : "s"}
          </span>
          {canManageGroup ? (
            <span className="parent-layout-page__conversation-subtitle">
              Admin
            </span>
          ) : null}
        </div>

        {message ? (
          <p className="parent-layout-page__conversation-action-message" role="alert">
            {message}
          </p>
        ) : null}
      </div>

      <div className="parent-layout-page__conversation-actions">
        {canManageGroup ? (
          <>
            <button
              className="parent-layout-page__conversation-menu-button"
              type="button"
              onClick={() => setIsMenuOpen((currentValue) => !currentValue)}
              aria-label="Group actions"
              aria-expanded={isMenuOpen}
              title="Group actions"
              disabled={isSaving}
            >
              <MoreVertical size={22} aria-hidden="true" />
            </button>

            {isMenuOpen ? (
              <div className="parent-layout-page__conversation-menu">
                <button
                  type="button"
                  onClick={() => {
                    setNameDraft(selectedRoom.title || "");
                    setIsEditingName(true);
                    setIsMenuOpen(false);
                  }}
                >
                  <Pencil size={16} aria-hidden="true" />
                  <span>Rename Group</span>
                </button>
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                >
                  <Camera size={16} aria-hidden="true" />
                  <span>Group Picture</span>
                </button>
              </div>
            ) : null}

            <input
              ref={avatarInputRef}
              className="parent-layout-page__group-avatar-file"
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              aria-hidden="true"
              tabIndex={-1}
            />
          </>
        ) : (
          <span className="parent-layout-page__conversation-menu-button" aria-hidden="true">
            <UsersRound size={21} />
          </span>
        )}

        <button
          className="parent-layout-page__conversation-close-button"
          type="button"
          onClick={handleCloseConversation}
          aria-label="Close group room"
          title="Close group"
        >
          <X size={21} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default GroupRoomHeader;
