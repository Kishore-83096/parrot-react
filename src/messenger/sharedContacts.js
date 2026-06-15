export const MAX_SHARED_CONTACTS_PER_MESSAGE = 20;

const ACCOUNT_NUMBER_PATTERN = /^7\d{9}$/;

function normalizeString(value, maxLength = 500) {
  const normalizedValue = String(value || "").trim();

  return normalizedValue.length > maxLength
    ? normalizedValue.slice(0, maxLength)
    : normalizedValue;
}

export function getSharedContactName(contact) {
  return (
    normalizeString(contact?.alias_name, 120) ||
    normalizeString(contact?.display_name, 120) ||
    normalizeString(contact?.name, 120) ||
    normalizeString(contact?.username, 120) ||
    normalizeString(contact?.account_number, 10) ||
    "Contact"
  );
}

export function normalizeSharedContact(contact, index = 0) {
  if (!contact || typeof contact !== "object") {
    return null;
  }

  const accountNumber = normalizeString(
    contact.account_number || contact.contact_account_number,
    10,
  );

  if (!ACCOUNT_NUMBER_PATTERN.test(accountNumber)) {
    return null;
  }

  const displayName = getSharedContactName({
    ...contact,
    account_number: accountNumber,
  });
  const userId = Number(contact.user_id || contact.id || 0);

  return {
    type: "shared_contact",
    v: 1,
    id: `shared-contact-${accountNumber}-${index}`,
    user_id: userId || null,
    account_number: accountNumber,
    alias_name: normalizeString(contact.alias_name || displayName, 120),
    display_name: displayName,
    first_name: normalizeString(contact.first_name, 80),
    last_name: normalizeString(contact.last_name, 80),
    username: normalizeString(contact.username, 80),
    profile_picture: normalizeString(contact.profile_picture, 1000),
  };
}

export function normalizeSharedContacts(contacts) {
  const seenAccountNumbers = new Set();

  return (Array.isArray(contacts) ? contacts : [])
    .map((contact, index) => normalizeSharedContact(contact, index))
    .filter(Boolean)
    .filter((contact) => {
      if (seenAccountNumbers.has(contact.account_number)) {
        return false;
      }

      seenAccountNumbers.add(contact.account_number);
      return true;
    })
    .slice(0, MAX_SHARED_CONTACTS_PER_MESSAGE);
}

export function getMessageSharedContacts(message) {
  if (
    Array.isArray(message?.decrypted_shared_contacts) &&
    message.decrypted_shared_contacts.length > 0
  ) {
    return normalizeSharedContacts(message.decrypted_shared_contacts);
  }

  if (Array.isArray(message?.shared_contacts) && message.shared_contacts.length > 0) {
    return normalizeSharedContacts(message.shared_contacts);
  }

  return [];
}

export function getSharedContactPreviewLabel(contacts) {
  const sharedContacts = normalizeSharedContacts(contacts);

  if (sharedContacts.length === 0) {
    return "";
  }

  return sharedContacts.length === 1
    ? "Contact"
    : `${sharedContacts.length} contacts`;
}

export function findSavedSharedContact(contacts, sharedContact) {
  const accountNumber = normalizeString(sharedContact?.account_number, 10);

  if (!accountNumber) {
    return null;
  }

  return (
    (Array.isArray(contacts) ? contacts : []).find(
      (contact) => String(contact?.account_number || "") === accountNumber,
    ) || null
  );
}

export function isOwnSharedContact(sharedContact, user) {
  const sharedAccountNumber = normalizeString(sharedContact?.account_number, 10);
  const currentAccountNumber = normalizeString(user?.account_number, 10);

  return Boolean(
    sharedAccountNumber &&
      currentAccountNumber &&
      sharedAccountNumber === currentAccountNumber,
  );
}

export function buildSharedContactSaveAlias(sharedContact) {
  return getSharedContactName(sharedContact).slice(0, 120) || "Contact";
}
