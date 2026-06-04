export function getGroupLogUserId(user) {
  return Number(user?.id || user?.user_id || 0);
}

function getSavedContactName(contactNamesByAccountNumber, accountNumber) {
  const normalizedAccountNumber = String(accountNumber || "");
  const savedContact = normalizedAccountNumber
    ? contactNamesByAccountNumber?.get?.(normalizedAccountNumber)
    : null;

  if (!savedContact) {
    return "";
  }

  if (typeof savedContact === "string") {
    return savedContact;
  }

  return savedContact.alias_name || savedContact.account_number || "";
}

function getActorName(log, currentUserId, contactNamesByAccountNumber) {
  if (currentUserId && Number(log?.actor_user_id) === currentUserId) {
    return "You";
  }

  return (
    getSavedContactName(contactNamesByAccountNumber, log?.actor_account_number) ||
    log?.actor_account_number ||
    "Someone"
  );
}

function getTargetName(log, currentUserId, contactNamesByAccountNumber) {
  if (currentUserId && Number(log?.target_user_id) === currentUserId) {
    return "you";
  }

  return (
    getSavedContactName(contactNamesByAccountNumber, log?.target_account_number) ||
    log?.target_account_number ||
    "a member"
  );
}

export function getGroupLogDisplay(log, user, contactNamesByAccountNumber = null) {
  const currentUserId = typeof user === "number" ? user : getGroupLogUserId(user);
  const actor = getActorName(log, currentUserId, contactNamesByAccountNumber);
  const target = getTargetName(log, currentUserId, contactNamesByAccountNumber);

  switch (log?.action) {
    case "group.created":
      return {
        kind: "created",
        text: `${actor} created the group`,
      };
    case "group.member_added":
      return {
        kind: Number(log?.target_user_id) === currentUserId ? "added-you" : "member-added",
        text: `${actor} added ${target}`,
      };
    case "group.member_removed":
      return {
        kind: Number(log?.target_user_id) === currentUserId ? "removed-you" : "member-removed",
        text: `${actor} removed ${target}`,
      };
    case "group.member_left":
      return {
        kind: "member-left",
        text: currentUserId && Number(log?.actor_user_id) === currentUserId
          ? "You left the group"
          : `${actor} left the group`,
      };
    case "group.updated":
      return {
        kind: "name",
        text: log?.title
          ? `${actor} changed the group name to ${log.title}`
          : `${actor} changed the group name`,
      };
    case "group.avatar_updated":
      return {
        kind: "picture",
        text: `${actor} changed the group picture`,
      };
    case "group.sub_admin_added":
      return {
        kind: "role",
        text: `${actor} made ${target} a sub admin`,
      };
    case "group.sub_admin_removed":
      return {
        kind: "role",
        text: `${actor} removed sub admin from ${target}`,
      };
    case "group.admin_transferred":
      return {
        kind: Number(log?.target_user_id) === currentUserId ? "admin-you" : "admin",
        text: `${actor} made ${target} the admin`,
      };
    case "group.deleted":
      return {
        kind: "deleted",
        text: `${actor} deleted the group`,
      };
    default:
      return {
        kind: "updated",
        text: "Group updated",
      };
  }
}
