import { Check, ImagePlus, LoaderCircle, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import SmartAvatar from "../../components/SmartAvatar.jsx";
import GroupPeopleIcon from "../../components/icons/GroupPeopleIcon.jsx";
import { getMessengerErrorMessage } from "../../messenger/api.js";
import {
  getContactInitials,
  getContactName,
} from "../../parent/pages/jsx/contactHelpers.js";
import { createGroupRoom, uploadGroupRoomAvatar } from "../api.js";

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

function CreateGroupModal({ contacts, onClose, onGroupCreated }) {
  const [title, setTitle] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [avatarFile, setAvatarFile] = useState(null);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const savedContacts = useMemo(
    () =>
      (Array.isArray(contacts) ? contacts : []).filter(
        (contact) => contact?.account_number,
      ),
    [contacts],
  );
  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return savedContacts;
    }

    return savedContacts.filter((contact) =>
      getContactSearchText(contact).includes(query),
    );
  }, [savedContacts, search]);

  const selectedCount = selectedAccounts.size;

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

  const handleAvatarChange = (event) => {
    setAvatarFile(event.target.files?.[0] || null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      setMessage("Enter a group name.");
      return;
    }

    if (selectedCount === 0) {
      setMessage("Select at least one member.");
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await createGroupRoom({
        title: trimmedTitle,
        member_account_numbers: Array.from(selectedAccounts),
      });
      let result = response.data?.result || response.data;
      let room = result?.room;

      if (avatarFile && room?.id) {
        const avatarResponse = await uploadGroupRoomAvatar(room.id, avatarFile);
        result = avatarResponse.data?.result || avatarResponse.data;
        room = result?.room || room;
      }

      if (room) {
        onGroupCreated?.(room);
      }
      onClose?.();
    } catch (error) {
      setMessage(getMessengerErrorMessage(error, "Unable to create group."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal parent-layout-page__group-modal"
        aria-labelledby="create-group-title"
        role="dialog"
        aria-modal="true"
      >
        <button
          className="parent-layout-page__modal-close"
          type="button"
          onClick={onClose}
          aria-label="Close create group"
          disabled={isSubmitting}
        >
          <X size={18} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header">
          <span className="parent-layout-page__group-modal-icon" aria-hidden="true">
            <GroupPeopleIcon size={30} strokeWidth={1.9} />
          </span>
          <h2 id="create-group-title">Create Group</h2>
          <p>Select saved contacts to start a private group room.</p>
        </div>

        <form className="parent-layout-page__modal-form" onSubmit={handleSubmit}>
          <label>
            Group name
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder="Group name"
              disabled={isSubmitting}
            />
          </label>

          <label className="parent-layout-page__group-avatar-input">
            Group picture
            <span>
              <ImagePlus size={18} aria-hidden="true" />
              {avatarFile ? avatarFile.name : "Choose picture"}
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              disabled={isSubmitting}
            />
          </label>

          <div className="parent-layout-page__group-member-picker">
            <div className="parent-layout-page__group-member-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search saved contacts"
                aria-label="Search saved contacts"
                disabled={isSubmitting}
              />
            </div>

            <div className="parent-layout-page__group-member-list">
              {filteredContacts.length === 0 ? (
                <p className="parent-layout-page__group-member-empty">
                  No saved contacts found.
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
                      disabled={isSubmitting}
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
                      <i aria-hidden="true">
                        {isSelected ? <Check size={15} /> : null}
                      </i>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {message ? (
            <p className="parent-layout-page__modal-error" role="alert">
              {message}
            </p>
          ) : null}

          <button
            className="parent-layout-page__modal-submit"
            type="submit"
            disabled={isSubmitting || !title.trim() || selectedCount === 0}
          >
            {isSubmitting ? <LoaderCircle size={18} aria-hidden="true" /> : null}
            <span>
              {isSubmitting
                ? "Creating"
                : `Create group${selectedCount ? ` (${selectedCount})` : ""}`}
            </span>
          </button>
        </form>
      </section>
    </div>,
    document.body,
  );
}

export default CreateGroupModal;
