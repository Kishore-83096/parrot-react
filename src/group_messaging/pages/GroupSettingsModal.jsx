import {
  Camera,
  Check,
  Crown,
  LoaderCircle,
  LogOut,
  Search,
  Shield,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import SmartAvatar from "../../components/SmartAvatar.jsx";
import GroupPeopleIcon from "../../components/icons/GroupPeopleIcon.jsx";
import { getMessengerErrorMessage } from "../../messenger/api.js";
import { getInitials } from "../../messenger/pages/jsx/roomHelpers.js";
import {
  getContactInitials,
  getContactName,
} from "../../parent/pages/jsx/contactHelpers.js";
import {
  addGroupMembers,
  deleteGroupRoom,
  getGroupRoom,
  leaveGroupRoom,
  makeGroupSubAdmin,
  removeGroupMember,
  removeGroupSubAdmin,
  transferGroupAdmin,
  updateGroupRoom,
  uploadGroupRoomAvatar,
} from "../api.js";

function getCurrentUserId(user) {
  return Number(user?.id || user?.user_id || 0);
}

function getParticipantRole(participant) {
  if (!participant) {
    return "";
  }

  return participant.group_role || participant.role || "member";
}

function getRoleLabel(role) {
  if (role === "admin") {
    return "Admin";
  }

  if (role === "sub_admin") {
    return "Sub Admin";
  }

  return "Member";
}

function getSavedContactName(contactNamesByAccountNumber, accountNumber) {
  const normalizedAccountNumber = String(accountNumber || "");

  return normalizedAccountNumber
    ? contactNamesByAccountNumber?.get?.(normalizedAccountNumber) || ""
    : "";
}

function getParticipantName(participant, contactNamesByAccountNumber, currentUserId) {
  if (currentUserId && Number(participant?.user_id) === Number(currentUserId)) {
    return "You";
  }

  return (
    getSavedContactName(contactNamesByAccountNumber, participant?.account_number) ||
    participant?.account_number ||
    `User ${participant?.user_id || ""}`.trim()
  );
}

function getContactSearchText(contact) {
  return [
    getContactName(contact),
    contact?.account_number,
    contact?.username,
    contact?.first_name,
    contact?.last_name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function normalizeResult(response) {
  return response.data?.result || response.data || {};
}

function GroupSettingsModal({
  contacts,
  selectedRoom,
  user,
  onClose,
  onGroupRemoved,
  onGroupUpdated,
  onToast,
}) {
  const [room, setRoom] = useState(selectedRoom);
  const [titleDraft, setTitleDraft] = useState(selectedRoom?.title || "");
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState(() => new Set());
  const [isAddMembersOpen, setIsAddMembersOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [loadingAction, setLoadingAction] = useState("");
  const avatarInputRef = useRef(null);

  const currentUserId = getCurrentUserId(user);
  const participants = useMemo(
    () => (Array.isArray(room?.participants) ? room.participants : []),
    [room?.participants],
  );
  const currentParticipant = useMemo(
    () =>
      participants.find((participant) => Number(participant.user_id) === currentUserId) ||
      null,
    [currentUserId, participants],
  );
  const isGroupDeleted = Boolean(room?.is_deleted || room?.deleted_at);
  const currentRole = getParticipantRole(currentParticipant) || room?.my_role || "member";
  const canManageGroup =
    !isGroupDeleted && (currentRole === "admin" || currentRole === "sub_admin");
  const isAdmin = currentRole === "admin";
  const contactNamesByAccountNumber = useMemo(() => {
    const namesByAccountNumber = new Map();

    (Array.isArray(contacts) ? contacts : []).forEach((contact) => {
      const accountNumber = String(contact?.account_number || "");
      const contactName = getContactName(contact);

      if (accountNumber && contactName) {
        namesByAccountNumber.set(accountNumber, contactName);
      }
    });

    return namesByAccountNumber;
  }, [contacts]);
  const activeAccountNumbers = useMemo(
    () =>
      new Set(
        participants
          .map((participant) => String(participant.account_number || ""))
          .filter(Boolean),
      ),
    [participants],
  );
  const availableContacts = useMemo(
    () =>
      (Array.isArray(contacts) ? contacts : []).filter(
        (contact) =>
          contact?.account_number &&
          !activeAccountNumbers.has(String(contact.account_number)),
      ),
    [activeAccountNumbers, contacts],
  );
  const filteredContacts = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();

    if (!query) {
      return availableContacts;
    }

    return availableContacts.filter((contact) =>
      getContactSearchText(contact).includes(query),
    );
  }, [availableContacts, memberSearch]);
  const selectedCount = selectedAccounts.size;
  const isBusy = Boolean(loadingAction);
  const groupName = room?.title || `Group ${room?.id || ""}`.trim();

  useEffect(() => {
    setRoom(selectedRoom);
    setTitleDraft(selectedRoom?.title || "");
    setMemberSearch("");
    setSelectedAccounts(new Set());
    setIsAddMembersOpen(false);
    setMessage("");
    setLoadingAction("");
  }, [selectedRoom]);

  useEffect(() => {
    let isMounted = true;

    async function loadRoom() {
      if (!selectedRoom?.id) {
        return;
      }

      try {
        const response = await getGroupRoom(selectedRoom.id);
        const result = normalizeResult(response);
        if (!isMounted || !result.room) {
          return;
        }

        setRoom(result.room);
        setTitleDraft(result.room.title || "");
        onGroupUpdated?.(result.room);
      } catch {
        // The modal can continue with the room data already in state.
      }
    }

    loadRoom();

    return () => {
      isMounted = false;
    };
  }, [onGroupUpdated, selectedRoom?.id]);

  const applyResult = (result) => {
    if (result?.removed_room_id || result?.status === "left") {
      onGroupRemoved?.(result.removed_room_id || result.room_id || room?.id);
      onClose?.();
      return;
    }

    if (result?.room) {
      setRoom(result.room);
      setTitleDraft(result.room.title || "");
      onGroupUpdated?.(result.room);
      if (result?.status === "deleted") {
        onClose?.();
      }
    }
  };

  const runAction = async (actionName, action, successMessage = "") => {
    setLoadingAction(actionName);
    setMessage("");

    try {
      const response = await action();
      const result = normalizeResult(response);
      applyResult(result);

      if (successMessage) {
        onToast?.({
          type: "success",
          title: "Group updated",
          message: successMessage,
        });
      }
      return true;
    } catch (error) {
      const errorMessage = getMessengerErrorMessage(error, "Unable to update group.");
      setMessage(errorMessage);
      onToast?.({
        type: "error",
        title: "Group not updated",
        message: errorMessage,
      });
      return false;
    } finally {
      setLoadingAction("");
    }
  };

  const handleTitleSubmit = (event) => {
    event.preventDefault();
    const nextTitle = titleDraft.trim();

    if (!room?.id || !nextTitle || nextTitle === room.title) {
      return;
    }

    runAction(
      "title",
      () => updateGroupRoom(room.id, { title: nextTitle }),
      "Group name changed.",
    );
  };

  const handleAvatarChange = (event) => {
    const file = event.target.files?.[0] || null;

    if (!room?.id || !file) {
      return;
    }

    runAction(
      "avatar",
      () => uploadGroupRoomAvatar(room.id, file),
      "Group picture changed.",
    ).finally(() => {
      if (avatarInputRef.current) {
        avatarInputRef.current.value = "";
      }
    });
  };

  const toggleContact = (accountNumber) => {
    const normalizedAccountNumber = String(accountNumber || "");

    if (!normalizedAccountNumber) {
      return;
    }

    setSelectedAccounts((currentAccounts) => {
      const nextAccounts = new Set(currentAccounts);

      if (nextAccounts.has(normalizedAccountNumber)) {
        nextAccounts.delete(normalizedAccountNumber);
      } else {
        nextAccounts.add(normalizedAccountNumber);
      }

      return nextAccounts;
    });
  };

  const handleAddMembers = () => {
    if (!room?.id || selectedCount === 0) {
      return;
    }

    runAction(
      "add-members",
      () => addGroupMembers(room.id, Array.from(selectedAccounts)),
      "Members added.",
    ).then((didUpdate) => {
      if (didUpdate) {
        setSelectedAccounts(new Set());
        setMemberSearch("");
        setIsAddMembersOpen(false);
      }
    });
  };

  const handleRemoveMember = (participant) => {
    if (!room?.id || !participant?.user_id) {
      return;
    }

    runAction(
      `remove-${participant.user_id}`,
      () => removeGroupMember(room.id, participant.user_id),
      "Member removed.",
    );
  };

  const handleSubAdmin = (participant, enabled) => {
    if (!room?.id || !participant?.user_id) {
      return;
    }

    runAction(
      `${enabled ? "make-sub" : "remove-sub"}-${participant.user_id}`,
      () =>
        enabled
          ? makeGroupSubAdmin(room.id, participant.user_id)
          : removeGroupSubAdmin(room.id, participant.user_id),
      enabled ? "Sub admin added." : "Sub admin removed.",
    );
  };

  const handleTransferAdmin = (participant) => {
    if (!room?.id || !participant?.user_id) {
      return;
    }

    const confirmed = globalThis.confirm(
      `Make ${getParticipantName(
        participant,
        contactNamesByAccountNumber,
        currentUserId,
      )} the group admin? You will become a member.`,
    );
    if (!confirmed) {
      return;
    }

    runAction(
      `transfer-${participant.user_id}`,
      () => transferGroupAdmin(room.id, participant.user_id),
      "Admin role transferred.",
    );
  };

  const handleLeave = () => {
    if (!room?.id) {
      return;
    }

    runAction("leave", () => leaveGroupRoom(room.id));
  };

  const handleDelete = () => {
    if (!room?.id) {
      return;
    }

    const confirmed = globalThis.confirm(
      "Delete this group? Messages and logs will stay visible, but nobody can send new messages.",
    );
    if (!confirmed) {
      return;
    }

    runAction("delete", () => deleteGroupRoom(room.id));
  };

  const renderActionSpinner = (actionName) =>
    loadingAction === actionName ? <LoaderCircle size={14} aria-hidden="true" /> : null;

  return createPortal(
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal parent-layout-page__group-modal parent-layout-page__group-settings-modal"
        aria-labelledby="group-settings-title"
        role="dialog"
        aria-modal="true"
      >
        <button
          className="parent-layout-page__modal-close"
          type="button"
          onClick={onClose}
          aria-label="Close group settings"
          disabled={isBusy}
        >
          <X size={18} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header parent-layout-page__group-settings-header">
          <SmartAvatar
            className="parent-layout-page__group-settings-avatar"
            src={room?.avatar_url}
            initials={getInitials(groupName)}
            name={groupName}
            fallback="G"
          />
          <div className="parent-layout-page__group-settings-title">
            <div className="parent-layout-page__group-settings-title-row">
              <h2 id="group-settings-title">{groupName}</h2>
              <span
                className="parent-layout-page__group-room-badge"
                aria-label="Group chat"
                title="Group chat"
              >
                <GroupPeopleIcon size={12} strokeWidth={2.2} aria-hidden="true" />
              </span>
            </div>
            <p>{participants.length} member{participants.length === 1 ? "" : "s"}</p>
          </div>
        </div>

        {message ? (
          <p className="parent-layout-page__modal-error" role="alert">
            {message}
          </p>
        ) : null}

        {isGroupDeleted ? (
          <p className="parent-layout-page__modal-error" role="status">
            This group has been deleted. Messages are read-only.
          </p>
        ) : null}

        {canManageGroup ? (
          <section className="parent-layout-page__group-settings-section">
            <form className="parent-layout-page__group-settings-title-form" onSubmit={handleTitleSubmit}>
              <label>
                Group name
                <input
                  type="text"
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  maxLength={120}
                  disabled={isBusy}
                />
              </label>
              <button
                type="submit"
                disabled={isBusy || !titleDraft.trim() || titleDraft.trim() === room?.title}
              >
                {renderActionSpinner("title") || <Check size={16} aria-hidden="true" />}
              </button>
            </form>

            <button
              className="parent-layout-page__group-settings-picture"
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={isBusy}
            >
              {loadingAction === "avatar" ? (
                <LoaderCircle size={17} aria-hidden="true" />
              ) : (
                <Camera size={17} aria-hidden="true" />
              )}
              <span>Group Picture</span>
            </button>
            <input
              ref={avatarInputRef}
              className="parent-layout-page__group-avatar-file"
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              aria-hidden="true"
              tabIndex={-1}
            />
          </section>
        ) : null}

        {canManageGroup ? (
          <section className="parent-layout-page__group-settings-section">
            <button
              className="parent-layout-page__group-settings-add-toggle"
              type="button"
              onClick={() => setIsAddMembersOpen((isOpen) => !isOpen)}
              disabled={isBusy}
              aria-expanded={isAddMembersOpen}
            >
              <UserPlus size={17} aria-hidden="true" />
              <span>Add Member</span>
            </button>

            {isAddMembersOpen ? (
              <>
                <div className="parent-layout-page__group-member-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    value={memberSearch}
                    onChange={(event) => setMemberSearch(event.target.value)}
                    placeholder="Search saved contacts"
                    aria-label="Search saved contacts"
                    disabled={isBusy}
                  />
                </div>

                <div className="parent-layout-page__group-member-list parent-layout-page__group-settings-add-list">
                  {filteredContacts.length === 0 ? (
                    <p className="parent-layout-page__group-member-empty">
                      No saved contacts available.
                    </p>
                  ) : (
                    filteredContacts.map((contact) => {
                      const accountNumber = String(contact.account_number || "");
                      const isSelected = selectedAccounts.has(accountNumber);

                      return (
                        <button
                          className={`parent-layout-page__group-member-option${
                            isSelected ? " is-selected" : ""
                          }`}
                          type="button"
                          key={accountNumber}
                          onClick={() => toggleContact(accountNumber)}
                          disabled={isBusy}
                        >
                          <SmartAvatar
                            className="parent-layout-page__contact-avatar"
                            src={contact.profile_picture}
                            initials={getContactInitials(contact)}
                            firstName={contact.first_name}
                            lastName={contact.last_name}
                            name={getContactName(contact)}
                            username={contact.username}
                            fallback="P"
                          />
                          <span>
                            <strong>{getContactName(contact)}</strong>
                            <small>{accountNumber}</small>
                          </span>
                          <i aria-hidden="true">{isSelected ? <Check size={15} /> : null}</i>
                        </button>
                      );
                    })
                  )}
                </div>

                <button
                  className="parent-layout-page__modal-submit parent-layout-page__group-settings-full-button"
                  type="button"
                  onClick={handleAddMembers}
                  disabled={isBusy || selectedCount === 0}
                >
                  {loadingAction === "add-members" ? (
                    <LoaderCircle size={18} aria-hidden="true" />
                  ) : (
                    <UserPlus size={18} aria-hidden="true" />
                  )}
                  <span>Add Members{selectedCount ? ` (${selectedCount})` : ""}</span>
                </button>
              </>
            ) : null}
          </section>
        ) : null}

        <section className="parent-layout-page__group-settings-section">
          <div className="parent-layout-page__group-settings-member-list">
            {participants.map((participant) => {
              const role = getParticipantRole(participant);
              const isSelf = Number(participant.user_id) === currentUserId;
              const isTargetAdmin = role === "admin";
              const isTargetSubAdmin = role === "sub_admin";
              const canActOnMember = canManageGroup && !isSelf && !isTargetAdmin;
              const canTransfer = isAdmin && !isSelf;
              const hasActions = canActOnMember || canTransfer;
              const participantName = getParticipantName(
                participant,
                contactNamesByAccountNumber,
                currentUserId,
              );

              return (
                <div
                  className={`parent-layout-page__group-settings-member-row${
                    hasActions ? " has-actions" : ""
                  }`}
                  key={participant.user_id}
                >
                  <SmartAvatar
                    className="parent-layout-page__contact-avatar"
                    initials={getInitials(participantName)}
                    name={participantName}
                    fallback="P"
                  />
                  <span>
                    <strong>{participantName}</strong>
                    <small>{participant.account_number}</small>
                  </span>
                  <em className={`parent-layout-page__group-role-badge is-${role}`}>
                    {role === "admin" ? <Crown size={12} aria-hidden="true" /> : null}
                    {role === "sub_admin" ? <Shield size={12} aria-hidden="true" /> : null}
                    {getRoleLabel(role)}
                  </em>

                  {hasActions ? (
                    <div className="parent-layout-page__group-settings-member-actions">
                      {canActOnMember && !isTargetSubAdmin ? (
                        <button
                          type="button"
                          onClick={() => handleSubAdmin(participant, true)}
                          disabled={isBusy}
                        >
                          {renderActionSpinner(`make-sub-${participant.user_id}`) || <Shield size={14} aria-hidden="true" />}
                          <span>Sub Admin</span>
                        </button>
                      ) : null}
                      {canActOnMember && isTargetSubAdmin ? (
                        <button
                          type="button"
                          onClick={() => handleSubAdmin(participant, false)}
                          disabled={isBusy}
                        >
                          {renderActionSpinner(`remove-sub-${participant.user_id}`) || <Shield size={14} aria-hidden="true" />}
                          <span>Member</span>
                        </button>
                      ) : null}
                      {canTransfer ? (
                        <button
                          type="button"
                          onClick={() => handleTransferAdmin(participant)}
                          disabled={isBusy}
                        >
                          {renderActionSpinner(`transfer-${participant.user_id}`) || <Crown size={14} aria-hidden="true" />}
                          <span>Admin</span>
                        </button>
                      ) : null}
                      {canActOnMember ? (
                        <button
                          className="is-danger"
                          type="button"
                          onClick={() => handleRemoveMember(participant)}
                          disabled={isBusy}
                        >
                          {renderActionSpinner(`remove-${participant.user_id}`) || <UserMinus size={14} aria-hidden="true" />}
                          <span>Remove</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <section className="parent-layout-page__group-settings-danger">
          <button
            className="parent-layout-page__modal-submit parent-layout-page__modal-submit--secondary"
            type="button"
            onClick={handleLeave}
            disabled={isBusy || isAdmin || isGroupDeleted}
            title={isAdmin ? "Transfer admin before leaving" : "Leave group"}
          >
            {loadingAction === "leave" ? (
              <LoaderCircle size={18} aria-hidden="true" />
            ) : (
              <LogOut size={18} aria-hidden="true" />
            )}
            <span>Leave Group</span>
          </button>

          {isAdmin && !isGroupDeleted ? (
            <button
              className="parent-layout-page__modal-submit parent-layout-page__modal-submit--danger"
              type="button"
              onClick={handleDelete}
              disabled={isBusy}
            >
              {loadingAction === "delete" ? (
                <LoaderCircle size={18} aria-hidden="true" />
              ) : (
                <Trash2 size={18} aria-hidden="true" />
              )}
              <span>Delete Group</span>
            </button>
          ) : null}
        </section>
      </section>
    </div>,
    document.body,
  );
}

export default GroupSettingsModal;
