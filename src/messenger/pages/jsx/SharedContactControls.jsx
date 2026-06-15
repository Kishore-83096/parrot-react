import {
  Check,
  LoaderCircle,
  MessageCircle,
  Paperclip,
  Plus,
  Send,
  UserPlus,
  UserRound,
  X,
} from "@/components/icons";
import { useEffect, useMemo, useRef, useState } from "react";

import SmartAvatar from "../../../components/SmartAvatar.jsx";
import {
  buildSharedContactSaveAlias,
  findSavedSharedContact,
  getSharedContactName,
  isOwnSharedContact,
  normalizeSharedContacts,
} from "../../sharedContacts.js";
import {
  getContactInitials,
  getContactName,
} from "../../../parent/pages/jsx/contactHelpers.js";

function getSharedContactInitials(contact) {
  return getContactInitials({
    alias_name: getSharedContactName(contact),
    account_number: contact?.account_number,
  });
}

function sortContactsByName(first, second) {
  return getContactName(first).localeCompare(getContactName(second), undefined, {
    sensitivity: "base",
  });
}

export function ComposerAddMenu({
  contacts = [],
  disabled = false,
  isSending = false,
  onAttachFiles,
  onShareContacts,
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isContactPickerOpen, setIsContactPickerOpen] = useState(false);
  const [selectedAccountNumbers, setSelectedAccountNumbers] = useState(() => new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const menuRef = useRef(null);
  const safeContacts = useMemo(
    () => (Array.isArray(contacts) ? [...contacts].sort(sortContactsByName) : []),
    [contacts],
  );
  const filteredContacts = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    if (!query) {
      return safeContacts;
    }

    return safeContacts.filter((contact) => {
      const name = getContactName(contact).toLowerCase();
      const accountNumber = String(contact?.account_number || "").toLowerCase();

      return name.includes(query) || accountNumber.includes(query);
    });
  }, [safeContacts, searchTerm]);
  const selectedContacts = useMemo(
    () =>
      safeContacts.filter((contact) =>
        selectedAccountNumbers.has(String(contact?.account_number || "")),
      ),
    [safeContacts, selectedAccountNumbers],
  );

  useEffect(() => {
    if (!isMenuOpen && !isContactPickerOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (menuRef.current?.contains(event.target)) {
        return;
      }

      setIsMenuOpen(false);
      setIsContactPickerOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key !== "Escape") {
        return;
      }

      setIsMenuOpen(false);
      setIsContactPickerOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isContactPickerOpen, isMenuOpen]);

  const toggleContact = (accountNumber) => {
    const normalizedAccountNumber = String(accountNumber || "");

    if (!normalizedAccountNumber) {
      return;
    }

    setSelectedAccountNumbers((currentNumbers) => {
      const nextNumbers = new Set(currentNumbers);

      if (nextNumbers.has(normalizedAccountNumber)) {
        nextNumbers.delete(normalizedAccountNumber);
      } else {
        nextNumbers.add(normalizedAccountNumber);
      }

      return nextNumbers;
    });
  };

  const handleShareContacts = () => {
    const contactsToShare = normalizeSharedContacts(selectedContacts);

    if (contactsToShare.length === 0) {
      return;
    }

    const didQueue = onShareContacts?.(contactsToShare);

    if (didQueue === false) {
      return;
    }

    setSelectedAccountNumbers(new Set());
    setSearchTerm("");
    setIsContactPickerOpen(false);
    setIsMenuOpen(false);
  };

  return (
    <div className="parent-layout-page__composer-add" ref={menuRef}>
      <button
        type="button"
        className={`parent-layout-page__message-attach parent-layout-page__composer-add-button${
          isMenuOpen || isContactPickerOpen ? " is-active" : ""
        }`}
        onClick={() => setIsMenuOpen((currentValue) => !currentValue)}
        disabled={disabled}
        aria-expanded={isMenuOpen || isContactPickerOpen}
        aria-label="Add to message"
        title="Add"
      >
        <Plus size={19} aria-hidden="true" />
      </button>

      {isMenuOpen ? (
        <div className="parent-layout-page__composer-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onAttachFiles?.();
              setIsMenuOpen(false);
            }}
          >
            <Paperclip size={18} aria-hidden="true" />
            <span>Files</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsMenuOpen(false);
              setIsContactPickerOpen(true);
            }}
          >
            <UserRound size={18} aria-hidden="true" />
            <span>Contact</span>
          </button>
        </div>
      ) : null}

      {isContactPickerOpen ? (
        <div
          className="parent-layout-page__contact-share-picker"
          role="dialog"
          aria-label="Share saved contacts"
        >
          <header>
            <strong>Share Contact</strong>
            <button
              type="button"
              onClick={() => setIsContactPickerOpen(false)}
              aria-label="Close contact picker"
              title="Close"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search contacts"
            aria-label="Search saved contacts"
          />
          <div className="parent-layout-page__contact-share-list">
            {filteredContacts.length > 0 ? (
              filteredContacts.map((contact) => {
                const accountNumber = String(contact?.account_number || "");
                const isSelected = selectedAccountNumbers.has(accountNumber);

                return (
                  <button
                    key={accountNumber}
                    type="button"
                    className={`parent-layout-page__contact-share-option${
                      isSelected ? " is-selected" : ""
                    }`}
                    onClick={() => toggleContact(accountNumber)}
                    aria-pressed={isSelected}
                  >
                    <SmartAvatar
                      className="parent-layout-page__shared-contact-avatar"
                      src={contact.profile_picture}
                      initials={getContactInitials(contact)}
                      name={getContactName(contact)}
                      title={getContactName(contact)}
                    />
                    <span>
                      <strong>{getContactName(contact)}</strong>
                      <small>{accountNumber}</small>
                    </span>
                    <i aria-hidden="true">
                      {isSelected ? <Check size={14} /> : null}
                    </i>
                  </button>
                );
              })
            ) : (
              <p>No saved contacts found.</p>
            )}
          </div>
          <footer>
            <span>
              {selectedContacts.length === 0
                ? "No contacts selected"
                : selectedContacts.length === 1
                  ? "1 contact selected"
                  : `${selectedContacts.length} contacts selected`}
            </span>
            <button
              type="button"
              onClick={handleShareContacts}
              disabled={selectedContacts.length === 0 || isSending}
              aria-label="Send selected contacts"
              title="Send"
            >
              {isSending ? (
                <LoaderCircle size={16} aria-hidden="true" />
              ) : (
                <Send size={16} aria-hidden="true" />
              )}
              <span>Send</span>
            </button>
          </footer>
        </div>
      ) : null}
    </div>
  );
}

export function SharedContactCards({
  contacts = [],
  messageContacts = [],
  onOpenConversation,
  onSaveContact,
  user,
}) {
  const [loadingAccountNumber, setLoadingAccountNumber] = useState("");
  const sharedContacts = normalizeSharedContacts(messageContacts);

  if (sharedContacts.length === 0) {
    return null;
  }

  const handleSaveContact = async (sharedContact) => {
    if (!onSaveContact || loadingAccountNumber) {
      return;
    }

    setLoadingAccountNumber(sharedContact.account_number);

    try {
      await onSaveContact({
        ...sharedContact,
        alias_name: buildSharedContactSaveAlias(sharedContact),
      });
    } finally {
      setLoadingAccountNumber("");
    }
  };

  return (
    <div className="parent-layout-page__shared-contact-cards">
      {sharedContacts.map((sharedContact) => {
        const savedContact = findSavedSharedContact(contacts, sharedContact);
        const isSaved = Boolean(savedContact);
        const isOwnContact = isOwnSharedContact(sharedContact, user);
        const displayName = savedContact
          ? getContactName(savedContact)
          : getSharedContactName(sharedContact);
        const isLoading =
          loadingAccountNumber === String(sharedContact.account_number || "");

        return (
          <section
            className="parent-layout-page__shared-contact-card"
            key={sharedContact.account_number}
          >
            <div className="parent-layout-page__shared-contact-card-main">
              <SmartAvatar
                className="parent-layout-page__shared-contact-avatar"
                src={savedContact?.profile_picture || sharedContact.profile_picture}
                initials={
                  savedContact
                    ? getContactInitials(savedContact)
                    : getSharedContactInitials(sharedContact)
                }
                name={displayName}
                title={displayName}
              />
              <span>
                <strong>{displayName}</strong>
                <small>{sharedContact.account_number}</small>
              </span>
            </div>
            <div className="parent-layout-page__shared-contact-card-actions">
              {isOwnContact ? (
                <span className="parent-layout-page__shared-contact-state">
                  Your account
                </span>
              ) : isSaved ? (
                <>
                  <span className="parent-layout-page__shared-contact-state is-saved">
                    <Check size={13} aria-hidden="true" />
                    Saved
                  </span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onOpenConversation?.(savedContact || sharedContact);
                    }}
                  >
                    <MessageCircle size={15} aria-hidden="true" />
                    <span>Send Message</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void handleSaveContact(sharedContact);
                  }}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <LoaderCircle size={15} aria-hidden="true" />
                  ) : (
                    <UserPlus size={15} aria-hidden="true" />
                  )}
                  <span>{isLoading ? "Saving" : "Save Contact"}</span>
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
