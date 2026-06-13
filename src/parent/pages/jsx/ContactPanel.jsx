import {
  AlertCircle,
  CheckCircle2,
  GroupPeopleIcon,
  LoaderCircle,
  ParrotIcon,
  Save,
  Search,
  ShieldAlert,
  UserPlus,
  UsersRound,
  X,
} from "@/components/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import SmartAvatar from "../../../components/SmartAvatar.jsx";
import CreateGroupModal from "../../../group_messaging/pages/CreateGroupModal.jsx";
import {
  getParentContacts,
  saveParentContact,
  searchParentUser,
} from "../../api.js";
import {
  getContactInitials,
  getContactName,
  getParentApiErrorMessage,
} from "./contactHelpers.js";

const addContactInitialForm = {
  account_number: "",
  alias_name: "",
};

const LOGGED_IN_HISTORY_KEY = "parrotLoggedInView";

function getLoggedInHistoryView() {
  return window.history.state?.[LOGGED_IN_HISTORY_KEY] || null;
}

function pushLoggedInHistoryView(nextView) {
  const currentState = window.history.state || {};
  const currentView = currentState[LOGGED_IN_HISTORY_KEY] || {};

  window.history.pushState(
    {
      ...currentState,
      [LOGGED_IN_HISTORY_KEY]: {
        ...currentView,
        ...nextView,
      },
    },
    "",
    window.location.href,
  );
}

function isCurrentHistoryModal(modalName) {
  return getLoggedInHistoryView()?.modal === modalName;
}

function ContactPanel({
  contacts,
  selectedContact,
  onContactsChange,
  onGroupCreated,
  onSelectContact,
}) {
  const [contactsMessage, setContactsMessage] = useState("");
  const [isContactsLoading, setIsContactsLoading] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [isAddContactModalOpen, setIsAddContactModalOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [addContactForm, setAddContactForm] = useState(addContactInitialForm);
  const [searchedContact, setSearchedContact] = useState(null);
  const [addContactMessage, setAddContactMessage] = useState(null);
  const [isSearchingContact, setIsSearchingContact] = useState(false);
  const [isSavingContact, setIsSavingContact] = useState(false);
  const contactsRef = useRef(contacts);

  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  const loadContacts = useCallback(async () => {
    setIsContactsLoading(true);
    setContactsMessage("");

    try {
      const response = await getParentContacts();
      const nextContacts = Array.isArray(response.data?.contacts)
        ? response.data.contacts
        : [];

      onContactsChange(nextContacts);
    } catch (error) {
      if (contactsRef.current.length === 0) {
        onContactsChange([]);
      }
      setContactsMessage(
        getParentApiErrorMessage(error, "Unable to load contacts."),
      );
    } finally {
      setIsContactsLoading(false);
    }
  }, [onContactsChange]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const resetAddContactModal = useCallback(() => {
    setIsAddContactModalOpen(false);
    setAddContactForm(addContactInitialForm);
    setSearchedContact(null);
    setAddContactMessage(null);
    setIsSearchingContact(false);
    setIsSavingContact(false);
  }, []);

  const closeAddContactModal = useCallback(() => {
    if (isCurrentHistoryModal("add-contact")) {
      window.history.back();
      return;
    }

    resetAddContactModal();
  }, [resetAddContactModal]);

  useEffect(() => {
    if (!isAddContactModalOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeAddContactModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeAddContactModal, isAddContactModalOpen]);

  useEffect(() => {
    const handlePopState = (event) => {
      const historyView =
        event.state?.[LOGGED_IN_HISTORY_KEY] || getLoggedInHistoryView();

      if (historyView?.modal === "add-contact") {
        setIsAddContactModalOpen(true);
        setAddContactMessage(null);
        return;
      }

      resetAddContactModal();
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [resetAddContactModal]);

  const filteredContacts = useMemo(() => {
    const query = contactSearch.trim().toLowerCase();

    if (!query) {
      return contacts;
    }

    return contacts.filter((contact) => {
      const name = getContactName(contact).toLowerCase();
      const accountNumber = String(contact.account_number || "").toLowerCase();

      return name.includes(query) || accountNumber.includes(query);
    });
  }, [contactSearch, contacts]);

  const openAddContactModal = () => {
    pushLoggedInHistoryView({ modal: "add-contact" });
    setIsAddContactModalOpen(true);
    setAddContactMessage(null);
  };

  const handleAddContactChange = (event) => {
    const { name, value } = event.target;

    setAddContactForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));

    if (name === "account_number") {
      setSearchedContact(null);
    }

    setAddContactMessage(null);
  };

  const handleSearchContact = async (event) => {
    event?.preventDefault();

    const accountNumber = addContactForm.account_number.trim();

    setSearchedContact(null);
    setAddContactMessage(null);
    setIsSearchingContact(true);

    try {
      const response = await searchParentUser({
        account_number: accountNumber,
      });
      const foundContact = {
        ...response.data,
        account_number: accountNumber,
      };

      setSearchedContact(foundContact);
      setAddContactForm((currentForm) => ({
        ...currentForm,
        account_number: accountNumber,
        alias_name: currentForm.alias_name.trim() || foundContact.username || "",
      }));
    } catch (error) {
      setAddContactMessage({
        type: "error",
        text: getParentApiErrorMessage(error, "Unable to find this contact."),
      });
    } finally {
      setIsSearchingContact(false);
    }
  };

  const handleSaveContact = async (event) => {
    event?.preventDefault();

    const accountNumber = addContactForm.account_number.trim();
    const aliasName = addContactForm.alias_name.trim();

    if (!searchedContact || searchedContact.account_number !== accountNumber) {
      setAddContactMessage({
        type: "error",
        text: "Search the account number before saving this contact.",
      });
      return;
    }

    if (!aliasName) {
      setAddContactMessage({
        type: "error",
        text: "Save As is required to save a contact.",
      });
      return;
    }

    setAddContactMessage(null);
    setIsSavingContact(true);

    try {
      const response = await saveParentContact({
        account_number: accountNumber,
        alias_name: aliasName,
      });
      const savedContact = response.data?.contact;

      if (savedContact) {
        onContactsChange([
          savedContact,
          ...contacts.filter(
            (contact) => contact.account_number !== savedContact.account_number,
          ),
        ]);
        onSelectContact(savedContact);
      }

      closeAddContactModal();
      loadContacts();
    } catch (error) {
      setAddContactMessage({
        type: "error",
        text: getParentApiErrorMessage(error, "Unable to save this contact."),
      });
    } finally {
      setIsSavingContact(false);
    }
  };

  const addContactModal = isAddContactModalOpen ? (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal"
        aria-modal="true"
        aria-labelledby="parent-add-contact-title"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close"
          type="button"
          onClick={closeAddContactModal}
          aria-label="Close add contact"
          title="Close"
        >
          <X size={28} strokeWidth={3} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header">
          <ParrotIcon />
          <div>
            <h2 id="parent-add-contact-title">Add Contact</h2>
          </div>
        </div>

        <form
          className="parent-layout-page__contact-table-form"
          onSubmit={searchedContact ? handleSaveContact : handleSearchContact}
        >
          <div className="parent-layout-page__contact-fields">
            <div className="parent-layout-page__contact-row">
              <label
                className="parent-layout-page__field-label"
                htmlFor="parent-add-contact-account"
              >
                Account Number
                <em className="is-required">Required</em>
              </label>
              <div className="parent-layout-page__table-input-action">
                <input
                  id="parent-add-contact-account"
                  name="account_number"
                  type="text"
                  value={addContactForm.account_number}
                  onChange={handleAddContactChange}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={10}
                  pattern="7[0-9]{9}"
                  required
                />
                <button
                  className="parent-layout-page__table-icon-button"
                  type="button"
                  onClick={handleSearchContact}
                  disabled={isSearchingContact || isSavingContact}
                  aria-busy={isSearchingContact}
                  aria-label={
                    isSearchingContact ? "Searching contact" : "Search contact"
                  }
                  title="Search contact"
                >
                  {isSearchingContact ? (
                    <LoaderCircle className="app-button-spinner" aria-hidden="true" />
                  ) : (
                    <Search size={19} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {searchedContact ? (
              <p className="parent-layout-page__found-contact">
                Found @{searchedContact.username} -{" "}
                {searchedContact.account_number}
              </p>
            ) : null}

            {searchedContact ? (
              <div className="parent-layout-page__contact-row">
                <label
                  className="parent-layout-page__field-label"
                  htmlFor="parent-add-contact-save-as"
                >
                  Save As
                  <em className="is-required">Required</em>
                </label>
                <input
                  id="parent-add-contact-save-as"
                  name="alias_name"
                  type="text"
                  value={addContactForm.alias_name}
                  onChange={handleAddContactChange}
                  autoComplete="off"
                  maxLength={120}
                  required
                />
              </div>
            ) : null}

            {addContactMessage ? (
              <p
                className={`parent-layout-page__form-message parent-layout-page__form-message--${addContactMessage.type}`}
                role="alert"
              >
                {addContactMessage.type === "success" ? (
                  <CheckCircle2 size={18} aria-hidden="true" />
                ) : (
                  <AlertCircle size={18} aria-hidden="true" />
                )}
                <span>{addContactMessage.text}</span>
              </p>
            ) : null}

            {searchedContact ? (
              <button
                className="parent-layout-page__modal-submit"
                type="submit"
                disabled={isSearchingContact || isSavingContact}
                aria-busy={isSavingContact}
              >
                {isSavingContact ? (
                  <LoaderCircle className="app-button-spinner" aria-hidden="true" />
                ) : (
                  <Save size={18} aria-hidden="true" />
                )}
                <span>{isSavingContact ? "Saving..." : "Save Contact"}</span>
              </button>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  ) : null;

  return (
    <>
      <div className="parent-layout-page__contacts">
        <div className="parent-layout-page__contacts-toolbar">
          <input
            className="parent-layout-page__contacts-search"
            type="search"
            value={contactSearch}
            onChange={(event) => setContactSearch(event.target.value)}
            placeholder="Search contacts"
            aria-label="Search contacts"
          />
        </div>

        <div className="parent-layout-page__contacts-actions">
          <button
            className="parent-layout-page__add-contact-button"
            type="button"
            onClick={openAddContactModal}
          >
            <UserPlus size={18} aria-hidden="true" />
            <span>Add Contact</span>
          </button>

          <button
            className="parent-layout-page__create-group-button"
            type="button"
            onClick={() => setIsCreateGroupOpen(true)}
          >
            <GroupPeopleIcon size={18} aria-hidden="true" />
            <span>Create Group</span>
          </button>
        </div>

        {contactsMessage ? (
          <p className="parent-layout-page__contacts-message" role="alert">
            {contactsMessage}
          </p>
        ) : null}

        {isContactsLoading && contacts.length === 0 ? (
          <div className="parent-layout-page__contacts-loading" aria-live="polite">
            <span />
            <span />
            <span />
          </div>
        ) : contacts.length === 0 ? (
          <div className="parent-layout-page__contacts-placeholder">
            <UsersRound size={28} aria-hidden="true" />
            <p>No contacts yet.</p>
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="parent-layout-page__contacts-placeholder">
            <Search size={28} aria-hidden="true" />
            <p>No matching contacts.</p>
          </div>
        ) : (
          <div className="parent-layout-page__contacts-list">
            {filteredContacts.map((contact) => {
              const isSelected =
                selectedContact?.account_number === contact.account_number;

              return (
                <button
                  className={`parent-layout-page__contact-card${
                    isSelected ? " is-selected" : ""
                  }${contact.blocked ? " is-blocked" : ""}`}
                  type="button"
                  key={contact.account_number}
                  onClick={() => onSelectContact(contact)}
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

                  <span className="parent-layout-page__contact-text">
                    <strong>{getContactName(contact)}</strong>
                    <small>{contact.account_number}</small>
                  </span>

                  {contact.blocked ? (
                    <span className="parent-layout-page__contact-status">
                      <ShieldAlert size={14} aria-hidden="true" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {addContactModal ? createPortal(addContactModal, document.body) : null}
      {isCreateGroupOpen ? (
        <CreateGroupModal
          contacts={contacts}
          onClose={() => setIsCreateGroupOpen(false)}
          onGroupCreated={(room) => {
            onGroupCreated?.(room);
          }}
        />
      ) : null}
    </>
  );
}

export default ContactPanel;
