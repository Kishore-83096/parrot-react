import {
  ArrowLeft,
  MessageCircle,
  Pencil,
  Plus,
  Save,
  Search,
  ShieldAlert,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  blockParentContact,
  deleteParentContact,
  getParentContactDetail,
  getParentContacts,
  saveParentContact,
  searchParentUser,
  unblockParentContact,
  updateParentContactAlias,
} from "../../api.js";
import { getMessengerRooms } from "../../../messenger/api.js";
import RoomListPage from "../../../messenger/pages/jsx/RoomListPage.jsx";
import RoomMessagesPage from "../../../messenger/pages/jsx/RoomMessagesPage.jsx";
import "../css/ContactsPage.css";

const addContactInitialForm = {
  account_number: "",
  alias_name: "",
};

function getContactName(contact) {
  return contact.alias_name || "Saved contact";
}

function getSearchedContactName(contact) {
  return (
    [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") ||
    contact?.username ||
    "Parrot user"
  );
}

function getContactInitials(contact) {
  const name = getContactName(contact);
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return initials.toUpperCase() || "P";
}

function getSearchedContactInitials(contact) {
  const name = getSearchedContactName(contact);
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return initials.toUpperCase() || "P";
}

function getApiErrorMessage(error, fallbackMessage) {
  const errors = error.response?.data?.errors;

  if (errors) {
    return Object.entries(errors)
      .map(([field, fieldErrors]) => `${field}: ${fieldErrors.join(", ")}`)
      .join(" ");
  }

  return error.response?.data?.message || fallbackMessage;
}

function ContactCard({ contact, isSelected, onSelect }) {
  const contactName = getContactName(contact);

  return (
    <button
      className={`parent-navigation__contact-card${
        contact.blocked ? " is-blocked" : ""
      }${isSelected ? " is-selected" : ""}`}
      type="button"
      onClick={() => onSelect(contact)}
    >
      <div className="parent-navigation__contact-avatar" aria-hidden="true">
        {contact.profile_picture ? (
          <img src={contact.profile_picture} alt="" />
        ) : (
          getContactInitials(contact)
        )}
      </div>
      <div className="parent-navigation__contact-main">
        <div className="parent-navigation__contact-title-row">
          <div>
            <h2>{contactName}</h2>
          </div>
          {contact.blocked ? (
            <span className="parent-navigation__contact-status is-blocked">
              <ShieldAlert size={15} aria-hidden="true" />
              Blocked
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function getSavedContactName(participant, contacts) {
  if (!participant?.account_number) {
    return "";
  }

  const savedContact = contacts.find(
    (contact) => contact.account_number === participant.account_number,
  );

  return savedContact?.alias_name || "";
}

function getParticipantName(participant, contacts) {
  return (
    getSavedContactName(participant, contacts) ||
    participant?.display_name ||
    participant?.account_number ||
    ""
  );
}

function getRoomTitle(room, contacts = []) {
  const participants =
    room?.other_participants?.length > 0
      ? room.other_participants
      : room?.participants || [];
  const names = participants
    .map((participant) => getParticipantName(participant, contacts))
    .filter(Boolean);

  return names.join(", ") || (room ? `Room ${room.id}` : "Chat");
}

function getRoomParticipantsForMatch(room) {
  return room?.other_participants?.length > 0
    ? room.other_participants
    : room?.participants || [];
}

function getRoomPrimaryParticipant(room) {
  return getRoomParticipantsForMatch(room)[0] || null;
}

function getRoomFallbackContact(room, contacts = []) {
  const participant = getRoomPrimaryParticipant(room);

  if (!participant?.account_number) {
    return null;
  }

  const savedContact = contacts.find(
    (contact) => contact.account_number === participant.account_number,
  );

  return {
    account_number: participant.account_number,
    alias_name:
      savedContact?.alias_name ||
      participant.display_name ||
      participant.account_number,
    blocked: savedContact?.blocked,
    profile_picture: savedContact?.profile_picture || "",
  };
}

function findRoomByAccountNumber(rooms, accountNumber) {
  if (!accountNumber) {
    return null;
  }

  return (
    rooms.find(
      (room) =>
        !room.is_group &&
        getRoomParticipantsForMatch(room).some(
          (participant) => participant.account_number === accountNumber,
        ),
    ) || null
  );
}

function mergeRoomById(rooms, nextRoom) {
  if (!nextRoom?.id) {
    return rooms;
  }

  const hasRoom = rooms.some((room) => Number(room.id) === Number(nextRoom.id));

  if (!hasRoom) {
    return [nextRoom, ...rooms];
  }

  return rooms.map((room) =>
    Number(room.id) === Number(nextRoom.id) ? { ...room, ...nextRoom } : room,
  );
}

function ContactsPage({ showNotice }) {
  const [contacts, setContacts] = useState([]);
  const [contactsMessage, setContactsMessage] = useState("");
  const [activeSectionTab, setActiveSectionTab] = useState("contacts");
  const [contactsTab, setContactsTab] = useState("list");
  const [compactView, setCompactView] = useState("list");
  const [addContactForm, setAddContactForm] = useState(addContactInitialForm);
  const [searchedContact, setSearchedContact] = useState(null);
  const [addContactMessage, setAddContactMessage] = useState("");
  const [selectedContactAccountNumber, setSelectedContactAccountNumber] =
    useState("");
  const [selectedContactDetail, setSelectedContactDetail] = useState(null);
  const [aliasFormValue, setAliasFormValue] = useState("");
  const [contactDetailMessage, setContactDetailMessage] = useState("");
  const [contactActionMessage, setContactActionMessage] = useState("");
  const [messengerRooms, setMessengerRooms] = useState([]);
  const [selectedContactRoom, setSelectedContactRoom] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [isEditingAlias, setIsEditingAlias] = useState(false);
  const [isContactsLoading, setIsContactsLoading] = useState(false);
  const [isSearchingContact, setIsSearchingContact] = useState(false);
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [isContactDetailLoading, setIsContactDetailLoading] = useState(false);
  const [isUpdatingAlias, setIsUpdatingAlias] = useState(false);
  const [isUpdatingBlock, setIsUpdatingBlock] = useState(false);
  const [isDeletingContact, setIsDeletingContact] = useState(false);
  const isChatDetailActive =
    activeSectionTab === "chats" && compactView === "detail";
  const isContactDetailActive =
    activeSectionTab === "contacts" &&
    compactView === "detail" &&
    Boolean(selectedContactDetail?.account_number);
  const hasConversationDetail =
    (activeSectionTab === "chats" && selectedRoom) ||
    (activeSectionTab === "contacts" && selectedContactDetail);
  const selectedRoomFallbackContact = getRoomFallbackContact(
    selectedRoom,
    contacts,
  );
  const activeConversationContact =
    activeSectionTab === "chats"
      ? selectedContactDetail || selectedRoomFallbackContact
      : selectedContactDetail;
  const activeConversationRoom =
    activeSectionTab === "chats" ? selectedRoom : selectedContactRoom;
  const activeConversationAccountNumber =
    activeConversationContact?.account_number || "";

  useEffect(() => {
    let isMounted = true;

    setIsContactsLoading(true);
    setContactsMessage("");

    getParentContacts()
      .then((response) => {
        if (isMounted) {
          setContacts(
            Array.isArray(response.data?.contacts) ? response.data.contacts : [],
          );
        }
      })
      .catch((error) => {
        if (isMounted) {
          setContacts([]);
          setContactsMessage(
            getApiErrorMessage(error, "Unable to load saved contacts."),
          );
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsContactsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const openContactsSection = () => {
    setActiveSectionTab("contacts");
    setCompactView("list");
  };

  const openChatsSection = () => {
    setActiveSectionTab("chats");
    setContactsTab("list");
    setCompactView("list");
  };

  const openAddContactTab = () => {
    setContactsTab("add");
    setCompactView("list");
    setContactsMessage("");
    setAddContactMessage("");
  };

  const openContactListTab = () => {
    setContactsTab("list");
    setCompactView("list");
    setAddContactMessage("");
  };

  const showContactList = () => {
    setCompactView("list");
  };

  const loadContactRoom = async (accountNumber) => {
    const existingRoom = findRoomByAccountNumber(messengerRooms, accountNumber);

    if (existingRoom) {
      setSelectedContactRoom(existingRoom);
      return;
    }

    try {
      const response = await getMessengerRooms();
      const result = response.data?.result || {};
      const nextRooms = Array.isArray(result.rooms) ? result.rooms : [];

      setMessengerRooms(nextRooms);
      setSelectedContactRoom(findRoomByAccountNumber(nextRooms, accountNumber));
    } catch {
      setSelectedContactRoom(null);
    }
  };

  const loadConversationContactDetail = async (accountNumber) => {
    if (!accountNumber) {
      setSelectedContactDetail(null);
      setAliasFormValue("");
      return;
    }

    try {
      const response = await getParentContactDetail(accountNumber);
      const nextContactDetail = response.data?.contact || null;

      setSelectedContactDetail(nextContactDetail);
      setAliasFormValue(nextContactDetail?.alias_name || "");
    } catch {
      setSelectedContactDetail(null);
      setAliasFormValue("");
    }
  };

  const handleRoomSelect = (room) => {
    const participant = getRoomPrimaryParticipant(room);
    const accountNumber = participant?.account_number || "";

    setSelectedRoom(room);
    setSelectedContactRoom(room);
    setSelectedContactAccountNumber(accountNumber);
    setSelectedContactDetail(null);
    setContactDetailMessage("");
    setContactActionMessage("");
    setIsEditingAlias(false);
    setCompactView("detail");
    loadConversationContactDetail(accountNumber);
  };

  const handleContactRoomResolved = (room) => {
    if (!room?.id) {
      return;
    }

    setSelectedContactRoom(room);
    setMessengerRooms((currentRooms) => mergeRoomById(currentRooms, room));
  };

  const handleSelectedRoomResolved = (room) => {
    if (!room?.id) {
      return;
    }

    setSelectedRoom(room);
    setMessengerRooms((currentRooms) => mergeRoomById(currentRooms, room));
  };

  const mergeContactUpdate = (updatedContact) => {
    if (!updatedContact?.account_number) {
      return;
    }

    setContacts((currentContacts) =>
      currentContacts.map((contact) =>
        contact.account_number === updatedContact.account_number
          ? { ...contact, ...updatedContact }
          : contact,
      ),
    );

    setSelectedContactDetail((currentDetail) =>
      currentDetail?.account_number === updatedContact.account_number
        ? { ...currentDetail, ...updatedContact }
        : currentDetail,
    );
  };

  const handleAddContactChange = (event) => {
    const { name, value } = event.target;

    setAddContactForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));

    if (name === "account_number") {
      setSearchedContact(null);
      setAddContactMessage("");
    }
  };

  const handleContactSearchSubmit = async (event) => {
    event.preventDefault();
    setAddContactMessage("");
    setSearchedContact(null);
    setIsSearchingContact(true);

    try {
      const accountNumber = addContactForm.account_number.trim();
      const response = await searchParentUser({ account_number: accountNumber });
      const result = response.data;
      const suggestedAlias = getSearchedContactName(result);

      setSearchedContact(result);
      setAddContactForm((currentForm) => ({
        ...currentForm,
        account_number: accountNumber,
        alias_name: currentForm.alias_name.trim() || suggestedAlias,
      }));
    } catch (error) {
      setAddContactMessage(
        getApiErrorMessage(error, "Unable to find this contact."),
      );
    } finally {
      setIsSearchingContact(false);
    }
  };

  const handleSaveContactSubmit = async (event) => {
    event.preventDefault();
    setAddContactMessage("");
    setIsSavingContact(true);

    try {
      const payload = {
        account_number: addContactForm.account_number.trim(),
        alias_name: addContactForm.alias_name.trim(),
      };
      const response = await saveParentContact(payload);
      const savedContact = response.data?.contact || null;
      const contactsResponse = await getParentContacts();
      const nextContacts = Array.isArray(contactsResponse.data?.contacts)
        ? contactsResponse.data.contacts
        : [];

      setContacts(nextContacts);
      setContactsTab("list");
      setCompactView("list");
      setAddContactForm(addContactInitialForm);
      setSearchedContact(null);
      setSelectedContactAccountNumber(
        savedContact?.account_number || payload.account_number,
      );
      setSelectedContactDetail(savedContact);
      setAliasFormValue(savedContact?.alias_name || payload.alias_name);
      setIsEditingAlias(false);
      setContactDetailMessage("");
      setContactActionMessage("");
      showNotice(
        "success",
        response.data?.message || "Contact saved successfully.",
      );
    } catch (error) {
      setAddContactMessage(
        getApiErrorMessage(error, "Unable to save this contact."),
      );
    } finally {
      setIsSavingContact(false);
    }
  };

  const handleContactSelect = async (contact) => {
    if (!contact.account_number) {
      setContactDetailMessage("This contact is missing an account number.");
      setSelectedContactDetail(null);
      return;
    }

    setSelectedContactAccountNumber(contact.account_number);
    setSelectedContactDetail(null);
    setSelectedContactRoom(null);
    setContactDetailMessage("");
    setContactActionMessage("");
    setIsEditingAlias(false);
    setCompactView("detail");
    setIsContactDetailLoading(true);

    try {
      const response = await getParentContactDetail(contact.account_number);
      const nextContactDetail = response.data?.contact || null;
      setSelectedContactDetail(nextContactDetail);
      setAliasFormValue(nextContactDetail?.alias_name || "");
      loadContactRoom(contact.account_number);
    } catch (error) {
      const errorMessage = getApiErrorMessage(
        error,
        "Unable to load contact details.",
      );
      setContactDetailMessage(errorMessage);
      showNotice("danger", errorMessage);
    } finally {
      setIsContactDetailLoading(false);
    }
  };

  const handleAliasEditStart = () => {
    setAliasFormValue(selectedContactDetail?.alias_name || "");
    setContactActionMessage("");
    setIsEditingAlias(true);
  };

  const handleAliasEditCancel = () => {
    setAliasFormValue(selectedContactDetail?.alias_name || "");
    setContactActionMessage("");
    setIsEditingAlias(false);
  };

  const handleAliasSubmit = async (event) => {
    event.preventDefault();

    if (!selectedContactDetail?.account_number) {
      return;
    }

    const aliasName = aliasFormValue.trim();

    if (!aliasName) {
      setContactActionMessage("Alias name is required.");
      return;
    }

    setIsUpdatingAlias(true);
    setContactActionMessage("");

    try {
      const response = await updateParentContactAlias({
        account_number: selectedContactDetail.account_number,
        alias_name: aliasName,
      });
      const updatedContact = response.data?.contact || {
        ...selectedContactDetail,
        alias_name: aliasName,
      };

      mergeContactUpdate(updatedContact);
      setAliasFormValue(updatedContact.alias_name || aliasName);
      setIsEditingAlias(false);
      showNotice(
        "success",
        response.data?.message || "Contact alias updated successfully.",
      );
    } catch (error) {
      const errorMessage = getApiErrorMessage(
        error,
        "Unable to update contact alias.",
      );
      setContactActionMessage(errorMessage);
      showNotice("danger", errorMessage);
    } finally {
      setIsUpdatingAlias(false);
    }
  };

  const handleBlockToggle = async (event) => {
    if (!selectedContactDetail?.account_number) {
      return;
    }

    const shouldBlock = event.target.checked;
    setIsUpdatingBlock(true);
    setContactActionMessage("");

    try {
      const payload = { account_number: selectedContactDetail.account_number };
      const response = shouldBlock
        ? await blockParentContact(payload)
        : await unblockParentContact(payload);
      const updatedContact = response.data?.contact || {
        ...selectedContactDetail,
        blocked: shouldBlock,
      };

      mergeContactUpdate(updatedContact);
      showNotice(
        shouldBlock ? "destructive" : "success",
        response.data?.message ||
          (shouldBlock
            ? "Contact blocked successfully."
            : "Contact unblocked successfully."),
      );
    } catch (error) {
      const errorMessage = getApiErrorMessage(
        error,
        shouldBlock ? "Unable to block contact." : "Unable to unblock contact.",
      );
      setContactActionMessage(errorMessage);
      showNotice("danger", errorMessage);
    } finally {
      setIsUpdatingBlock(false);
    }
  };

  const handleDeleteContact = async () => {
    if (!selectedContactDetail?.account_number) {
      return;
    }

    const contactName = selectedContactDetail.alias_name || "this contact";
    const shouldDelete = window.confirm(
      `Delete ${contactName}? This contact will be removed from your saved contacts.`,
    );

    if (!shouldDelete) {
      return;
    }

    setIsDeletingContact(true);
    setContactActionMessage("");

    try {
      const response = await deleteParentContact({
        account_number: selectedContactDetail.account_number,
      });

      setContacts((currentContacts) =>
        currentContacts.filter(
          (contact) =>
            contact.account_number !== selectedContactDetail.account_number,
        ),
      );
      setSelectedContactAccountNumber("");
      setSelectedContactDetail(null);
      setSelectedContactRoom(null);
      setAliasFormValue("");
      setIsEditingAlias(false);
      setContactDetailMessage("");
      setContactActionMessage("");
      setContactsTab("list");
      setCompactView("list");
      showNotice(
        "destructive",
        response.data?.message || "Contact deleted successfully.",
      );
    } catch (error) {
      const errorMessage = getApiErrorMessage(
        error,
        "Unable to delete this contact.",
      );
      setContactActionMessage(errorMessage);
      showNotice("danger", errorMessage);
    } finally {
      setIsDeletingContact(false);
    }
  };

  return (
    <section
      className={`parent-navigation__contacts-shell is-${compactView}-open`}
      aria-labelledby="parent-contacts-title"
    >
      <aside className="parent-navigation__contacts-sidebar">
        <div className="parent-navigation__contacts-heading">
          <div className="parent-navigation__contacts-heading-icon">
            {activeSectionTab === "chats" ? (
              <MessageCircle size={20} aria-hidden="true" />
            ) : (
              <Users size={20} aria-hidden="true" />
            )}
          </div>
          <div>
            
            <h1 id="parent-contacts-title">
              {activeSectionTab === "chats"
                ? "Chats"
                : contactsTab === "add"
                  ? "Add Contact"
                  : "Contacts"}
            </h1>
          </div>
          {activeSectionTab === "contacts" ? (
            <button
              className="parent-navigation__contacts-heading-action"
              type="button"
              onClick={
                contactsTab === "add" ? openContactListTab : openAddContactTab
              }
              aria-label={
                contactsTab === "add" ? "Back to contacts" : "Add contact"
              }
              title={contactsTab === "add" ? "Back to contacts" : "Add contact"}
            >
              {contactsTab === "add" ? (
                <ArrowLeft size={16} aria-hidden="true" />
              ) : (
                <Plus size={16} aria-hidden="true" />
              )}
            </button>
          ) : (
            <span className="parent-navigation__contacts-heading-spacer" />
          )}
        </div>

        <div className="parent-navigation__section-tabs" role="tablist">
          <button
            className={activeSectionTab === "chats" ? "is-active" : ""}
            type="button"
            onClick={openChatsSection}
            role="tab"
            aria-selected={activeSectionTab === "chats"}
          >
            <MessageCircle size={15} aria-hidden="true" />
            <span>Chats</span>
          </button>
          <button
            className={activeSectionTab === "contacts" ? "is-active" : ""}
            type="button"
            onClick={openContactsSection}
            role="tab"
            aria-selected={activeSectionTab === "contacts"}
          >
            <Users size={15} aria-hidden="true" />
            <span>Contacts</span>
          </button>
        </div>

        {activeSectionTab === "chats" ? (
          <RoomListPage
            contacts={contacts}
            onRoomsChange={setMessengerRooms}
            selectedRoomId={selectedRoom?.id}
            onRoomSelect={handleRoomSelect}
          />
        ) : contactsTab === "list" ? (
          <>
            {contactsMessage ? (
              <p className="parent-navigation__message" role="alert">
                {contactsMessage}
              </p>
            ) : null}

            {isContactsLoading ? (
              <div
                className="parent-navigation__contacts-loading"
                aria-live="polite"
              >
                <span />
                <span />
                <span />
              </div>
            ) : contacts.length === 0 ? (
              <div className="parent-navigation__contacts-empty">
                <Users size={34} aria-hidden="true" />
                <h2>No Contacts Yet</h2>
                <p>Your saved Parrot contacts will appear here.</p>
              </div>
            ) : (
              <div className="parent-navigation__contacts-list">
                {contacts.map((contact, index) => (
                  <ContactCard
                    contact={contact}
                    isSelected={
                      contact.account_number === selectedContactAccountNumber
                    }
                    key={
                      contact.account_number || `${contact.alias_name}-${index}`
                    }
                    onSelect={handleContactSelect}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="parent-navigation__contact-add">
            <form
              className="parent-navigation__contact-add-form"
              onSubmit={handleContactSearchSubmit}
            >
              <label htmlFor="parent-contact-account-number">
                Account Number
              </label>
              <input
                id="parent-contact-account-number"
                name="account_number"
                type="text"
                inputMode="numeric"
                value={addContactForm.account_number}
                onChange={handleAddContactChange}
                required
              />
              <button type="submit" disabled={isSearchingContact}>
                <Search size={17} aria-hidden="true" />
                <span>{isSearchingContact ? "Searching..." : "Search"}</span>
              </button>
            </form>

            {searchedContact ? (
              <>
                <div className="parent-navigation__contact-search-result">
                  <div
                    className="parent-navigation__contact-avatar"
                    aria-hidden="true"
                  >
                    {searchedContact.profile_picture ? (
                      <img src={searchedContact.profile_picture} alt="" />
                    ) : (
                      getSearchedContactInitials(searchedContact)
                    )}
                  </div>
                  <div>
                    <h2>{getSearchedContactName(searchedContact)}</h2>
                    <p>{searchedContact.username || "Not added"}</p>
                  </div>
                </div>

                <form
                  className="parent-navigation__contact-add-form"
                  onSubmit={handleSaveContactSubmit}
                >
                  <label htmlFor="parent-contact-alias">
                    Save Contact As
                  </label>
                  <input
                    id="parent-contact-alias"
                    name="alias_name"
                    type="text"
                    value={addContactForm.alias_name}
                    onChange={handleAddContactChange}
                    required
                  />
                  <button type="submit" disabled={isSavingContact}>
                    <Save size={17} aria-hidden="true" />
                    <span>{isSavingContact ? "Saving..." : "Save Contact"}</span>
                  </button>
                </form>
              </>
            ) : null}

            {addContactMessage ? (
              <p className="parent-navigation__message" role="alert">
                {addContactMessage}
              </p>
            ) : null}
          </div>
        )}
      </aside>

      <section
        className={`parent-navigation__contact-detail-panel${
          (activeSectionTab === "contacts" && selectedContactAccountNumber) ||
          (activeSectionTab === "chats" && selectedRoom)
            ? " has-contact-detail"
            : ""
        }${
          hasConversationDetail ? " is-conversation-detail" : ""
        }`}
        aria-live="polite"
      >
        <button
          className="parent-navigation__contact-detail-back"
          type="button"
          onClick={showContactList}
          aria-label={activeSectionTab === "chats" ? "Back to chats" : "Back to contacts"}
          title={activeSectionTab === "chats" ? "Back to chats" : "Back to contacts"}
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>

        {activeSectionTab === "chats" ? (
          selectedRoom ? (
            <>
              <div className="parent-navigation__contact-chat-header">
                <div className="parent-navigation__contact-chat-identity">
                  <div className="parent-navigation__contact-detail-avatar">
                    {activeConversationContact?.profile_picture ? (
                      <img
                        src={activeConversationContact.profile_picture}
                        alt=""
                        aria-hidden="true"
                      />
                    ) : activeConversationContact ? (
                      getContactInitials(activeConversationContact)
                    ) : (
                      <MessageCircle size={20} aria-hidden="true" />
                    )}
                  </div>

                  <div className="parent-navigation__contact-chat-name">
                    {selectedContactDetail && isEditingAlias ? (
                      <form
                        className="parent-navigation__contact-alias-form"
                        onSubmit={handleAliasSubmit}
                      >
                        <input
                          aria-label="Alias name"
                          type="text"
                          value={aliasFormValue}
                          onChange={(event) =>
                            setAliasFormValue(event.target.value)
                          }
                          disabled={isUpdatingAlias}
                          autoFocus
                          required
                        />
                        <button
                          type="submit"
                          disabled={isUpdatingAlias}
                          aria-label="Save alias"
                          title="Save alias"
                        >
                          <Save size={14} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={handleAliasEditCancel}
                          disabled={isUpdatingAlias}
                          aria-label="Cancel alias edit"
                          title="Cancel"
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      </form>
                    ) : (
                      <>
                        <h2>
                          {activeConversationContact?.alias_name ||
                            getRoomTitle(selectedRoom, contacts)}
                        </h2>
                        <p>
                          {activeConversationContact?.account_number ||
                            `Room ${selectedRoom.id}`}
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {selectedContactDetail ? (
                  <div className="parent-navigation__contact-chat-actions">
                    {!isEditingAlias ? (
                      <button
                        className="parent-navigation__contact-icon-action"
                        type="button"
                        onClick={handleAliasEditStart}
                        disabled={isDeletingContact}
                        aria-label="Edit alias"
                        title="Edit alias"
                      >
                        <Pencil size={16} aria-hidden="true" />
                      </button>
                    ) : null}

                    <label
                      className={`parent-navigation__contact-block-switch${
                        selectedContactDetail.blocked ? " is-blocked" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(selectedContactDetail.blocked)}
                        onChange={handleBlockToggle}
                        disabled={isUpdatingBlock || isDeletingContact}
                      />
                      <span aria-hidden="true" />
                      <strong>
                        {selectedContactDetail.blocked ? "Blocked" : "Block"}
                      </strong>
                    </label>

                    <button
                      className="parent-navigation__contact-icon-action parent-navigation__contact-icon-action--danger"
                      type="button"
                      onClick={handleDeleteContact}
                      disabled={isDeletingContact}
                      aria-label="Delete contact"
                      title={isDeletingContact ? "Deleting..." : "Delete contact"}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                ) : selectedRoom.unread_count > 0 ? (
                  <span className="parent-navigation__chat-unread-badge">
                    {selectedRoom.unread_count}
                  </span>
                ) : null}
              </div>

              {contactActionMessage ? (
                <p className="parent-navigation__message" role="alert">
                  {contactActionMessage}
                </p>
              ) : null}

              <RoomMessagesPage
                contacts={contacts}
                isActive={isChatDetailActive}
                onRoomResolved={handleSelectedRoomResolved}
                recipientAccountNumber={activeConversationAccountNumber}
                room={selectedRoom}
              />
            </>
          ) : (
            <div className="parent-navigation__contact-detail-empty">
              <MessageCircle size={38} aria-hidden="true" />
              <h2>No Chat Selected</h2>
              <p>Choose a chat to see its room details.</p>
            </div>
          )
        ) : !selectedContactAccountNumber ? (
          <div className="parent-navigation__contact-detail-empty">
            <Users size={38} aria-hidden="true" />
            <h2>No Contact Selected</h2>
            <p>Saved contact details will appear here.</p>
          </div>
        ) : isContactDetailLoading ? (
          <div className="parent-navigation__contacts-loading" aria-live="polite">
            <span />
            <span />
            <span />
          </div>
        ) : contactDetailMessage ? (
          <p className="parent-navigation__message" role="alert">
            {contactDetailMessage}
          </p>
        ) : selectedContactDetail ? (
          <>
            <div className="parent-navigation__contact-chat-header">
              <div className="parent-navigation__contact-chat-identity">
                <div className="parent-navigation__contact-detail-avatar">
                  {selectedContactDetail.profile_picture ? (
                    <img
                      src={selectedContactDetail.profile_picture}
                      alt=""
                      aria-hidden="true"
                    />
                  ) : (
                    getContactInitials(selectedContactDetail)
                  )}
                </div>

                <div className="parent-navigation__contact-chat-name">
                  {isEditingAlias ? (
                    <form
                      className="parent-navigation__contact-alias-form"
                      onSubmit={handleAliasSubmit}
                    >
                      <input
                        aria-label="Alias name"
                        type="text"
                        value={aliasFormValue}
                        onChange={(event) =>
                          setAliasFormValue(event.target.value)
                        }
                        disabled={isUpdatingAlias}
                        autoFocus
                        required
                      />
                      <button
                        type="submit"
                        disabled={isUpdatingAlias}
                        aria-label="Save alias"
                        title="Save alias"
                      >
                        <Save size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={handleAliasEditCancel}
                        disabled={isUpdatingAlias}
                        aria-label="Cancel alias edit"
                        title="Cancel"
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </form>
                  ) : (
                    <>
                      <h2>
                        {selectedContactDetail.alias_name || "Saved contact"}
                      </h2>
                      <p>{selectedContactDetail.account_number}</p>
                    </>
                  )}
                </div>
              </div>

              <div className="parent-navigation__contact-chat-actions">
                {!isEditingAlias ? (
                  <button
                    className="parent-navigation__contact-icon-action"
                    type="button"
                    onClick={handleAliasEditStart}
                    disabled={isDeletingContact}
                    aria-label="Edit alias"
                    title="Edit alias"
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                ) : null}

                <label
                  className={`parent-navigation__contact-block-switch${
                    selectedContactDetail.blocked ? " is-blocked" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(selectedContactDetail.blocked)}
                    onChange={handleBlockToggle}
                    disabled={isUpdatingBlock || isDeletingContact}
                  />
                  <span aria-hidden="true" />
                  <strong>
                    {selectedContactDetail.blocked ? "Blocked" : "Block"}
                  </strong>
                </label>

                <button
                  className="parent-navigation__contact-icon-action parent-navigation__contact-icon-action--danger"
                  type="button"
                  onClick={handleDeleteContact}
                  disabled={isDeletingContact}
                  aria-label="Delete contact"
                  title={isDeletingContact ? "Deleting..." : "Delete contact"}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </div>

            {contactActionMessage ? (
              <p className="parent-navigation__message" role="alert">
                {contactActionMessage}
              </p>
            ) : null}

            <RoomMessagesPage
              contacts={contacts}
              isActive={isContactDetailActive}
              onRoomResolved={handleContactRoomResolved}
              recipientAccountNumber={selectedContactDetail.account_number}
              room={selectedContactRoom}
            />
          </>
        ) : null}
      </section>
    </section>
  );
}

export default ContactsPage;
