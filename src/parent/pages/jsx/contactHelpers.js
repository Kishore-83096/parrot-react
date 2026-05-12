export function getParentApiErrorMessage(error, fallbackMessage) {
  const errors = error.response?.data?.errors;

  if (errors) {
    return Object.entries(errors)
      .map(([field, fieldErrors]) => `${field}: ${fieldErrors.join(", ")}`)
      .join(" ");
  }

  return error.response?.data?.message || fallbackMessage;
}

export function getContactName(contact) {
  return contact?.alias_name || contact?.account_number || "Contact";
}

export function getInitials(value) {
  const initials = String(value || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return initials.toUpperCase() || "P";
}

export function getContactInitials(contact) {
  return getInitials(getContactName(contact));
}
