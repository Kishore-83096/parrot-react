import { Crown, MoreVertical, Shield, X } from "@/components/icons";

import SmartAvatar from "../../components/SmartAvatar.jsx";
import { GroupPeopleIcon } from "@/components/icons";
import { getInitials } from "../../messenger/pages/jsx/roomHelpers.js";

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
  isSettingsOpen = false,
  selectedRoom,
  user,
  onCloseConversation,
  onOpenMessages,
  onOpenSettings,
}) {
  const groupName = selectedRoom?.title || `Group ${selectedRoom?.id || ""}`.trim();
  const avatarUrl = selectedRoom?.avatar_url || "";
  const memberCount = Number(selectedRoom?.member_count || selectedRoom?.participants?.length || 0);
  const groupRole = getCurrentUserGroupRole(selectedRoom, user);
  const isGroupDeleted = Boolean(selectedRoom?.is_deleted || selectedRoom?.deleted_at);

  const handleCloseConversation = () => {
    if (isSettingsOpen) {
      onOpenMessages?.();
      return;
    }

    onCloseConversation?.();
  };

  if (!selectedRoom?.is_group) {
    return <h2 id="parrot-layout-room-title">Group Room</h2>;
  }

  return (
    <div className="parent-layout-page__conversation-header parent-layout-page__group-header">
      <SmartAvatar
        className="parent-layout-page__conversation-avatar"
        src={avatarUrl}
        initials={getInitials(groupName)}
        name={groupName}
        fallback="G"
      />

      <div className="parent-layout-page__conversation-title">
        <div className="parent-layout-page__conversation-title-row">
          <h2 id="parrot-layout-room-title">{groupName}</h2>
          <span
            className="parent-layout-page__group-room-badge parent-layout-page__group-room-badge--header"
            aria-label="Group chat"
            title="Group chat"
          >
            <GroupPeopleIcon size={12} strokeWidth={2.2} aria-hidden="true" />
          </span>
        </div>

        <div className="parent-layout-page__conversation-meta">
          <span className="parent-layout-page__conversation-subtitle">
            {isGroupDeleted
              ? "Deleted group"
              : `${memberCount} member${memberCount === 1 ? "" : "s"}`}
          </span>
          {!isGroupDeleted && groupRole === "admin" ? (
            <span className="parent-layout-page__conversation-subtitle">
              <Crown size={13} aria-hidden="true" />
              Admin
            </span>
          ) : null}
          {!isGroupDeleted && groupRole === "sub_admin" ? (
            <span className="parent-layout-page__conversation-subtitle">
              <Shield size={13} aria-hidden="true" />
              Sub Admin
            </span>
          ) : null}
        </div>
      </div>

      <div className="parent-layout-page__conversation-actions">
        {!isSettingsOpen ? (
          <button
            className="parent-layout-page__conversation-menu-button"
            type="button"
            onClick={onOpenSettings}
            aria-label="Group settings"
            title="Group settings"
          >
            <MoreVertical size={22} aria-hidden="true" />
          </button>
        ) : null}

        <button
          className="parent-layout-page__conversation-close-button"
          type="button"
          onClick={handleCloseConversation}
          aria-label={isSettingsOpen ? "Back to group chat" : "Close group room"}
          title={isSettingsOpen ? "Back to chat" : "Close group"}
        >
          <X size={21} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default GroupRoomHeader;
