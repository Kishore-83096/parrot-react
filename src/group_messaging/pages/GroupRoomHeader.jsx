import { Crown, MoreVertical, Shield, X } from "lucide-react";
import { useState } from "react";

import { getInitials } from "../../messenger/pages/jsx/roomHelpers.js";
import GroupSettingsModal from "./GroupSettingsModal.jsx";

function getCurrentUserId(user) {
  return Number(user?.id || user?.user_id || 0);
}

function getCurrentUserGroupRole(room, user) {
  const currentUserId = getCurrentUserId(user);
  const participant = (Array.isArray(room?.participants) ? room.participants : [])
    .find((item) => Number(item?.user_id) === currentUserId);

  return participant?.group_role || participant?.role || room?.my_role || "member";
}

function GroupRoomHeader({
  contacts,
  selectedRoom,
  user,
  onCloseConversation,
  onGroupRemoved,
  onGroupUpdated,
  onToast,
}) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const groupName = selectedRoom?.title || `Group ${selectedRoom?.id || ""}`.trim();
  const avatarUrl = selectedRoom?.avatar_url || "";
  const memberCount = Number(selectedRoom?.member_count || selectedRoom?.participants?.length || 0);
  const groupRole = getCurrentUserGroupRole(selectedRoom, user);

  const handleCloseConversation = () => {
    setIsSettingsOpen(false);
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
        <div className="parent-layout-page__conversation-title-row">
          <h2 id="parrot-layout-room-title">{groupName}</h2>
        </div>

        <div className="parent-layout-page__conversation-meta">
          <span className="parent-layout-page__conversation-subtitle">
            {memberCount} member{memberCount === 1 ? "" : "s"}
          </span>
          {groupRole === "admin" ? (
            <span className="parent-layout-page__conversation-subtitle">
              <Crown size={13} aria-hidden="true" />
              Admin
            </span>
          ) : null}
          {groupRole === "sub_admin" ? (
            <span className="parent-layout-page__conversation-subtitle">
              <Shield size={13} aria-hidden="true" />
              Sub Admin
            </span>
          ) : null}
        </div>
      </div>

      <div className="parent-layout-page__conversation-actions">
        <button
          className="parent-layout-page__conversation-menu-button"
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          aria-label="Group settings"
          aria-expanded={isSettingsOpen}
          title="Group settings"
        >
          <MoreVertical size={22} aria-hidden="true" />
        </button>

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

      {isSettingsOpen ? (
        <GroupSettingsModal
          contacts={contacts}
          selectedRoom={selectedRoom}
          user={user}
          onClose={() => setIsSettingsOpen(false)}
          onGroupRemoved={onGroupRemoved}
          onGroupUpdated={onGroupUpdated}
          onToast={onToast}
        />
      ) : null}
    </div>
  );
}

export default GroupRoomHeader;
