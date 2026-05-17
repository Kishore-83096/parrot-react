import {
  AlertCircle,
  Ban,
  CheckCircle2,
  MoreVertical,
  Pencil,
  Save,
  Trash2,
  Unlock,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import parrotIcon from "../../../assets/favicon.svg";
import { releaseMessengerRoomBlockedMessages } from "../../api.js";
import {
  blockParentContact,
  deleteParentContact,
  saveParentContact,
  searchParentUser,
  unblockParentContact,
  updateParentContactAlias,
} from "../../../parent/api.js";
import {
  getConversationContact,
  getConversationName,
  getConversationPeerAccount,
  getInitials,
  getParentApiErrorMessage,
  getRoomPeer,
} from "./roomHelpers.js";

function MessengerRoomHeader({
  contacts,
  selectedContact,
  selectedRoom,
  user,
  onlineUserIds,
  onContactDeleted,
  onContactUpdated,
  onBlockedMessagesReleased,
  onCloseConversation,
  onToast,
}) {
  const [peerProfile, setPeerProfile] = useState(null);
  const [isConversationMenuOpen, setIsConversationMenuOpen] = useState(false);
  const [isEditContactModalOpen, setIsEditContactModalOpen] = useState(false);
  const [editContactForm, setEditContactForm] = useState({
    account_number: "",
    alias_name: "",
  });
  const [editContactMessage, setEditContactMessage] = useState(null);
  const [actionMessage, setActionMessage] = useState("");
  const [isContactActionLoading, setIsContactActionLoading] = useState(false);

  const selectedRoomPeer = selectedRoom ? getRoomPeer(selectedRoom, user) : null;
  const selectedConversationContact = getConversationContact({
    selectedContact,
    selectedRoom,
    contacts,
    user,
  });
  const selectedPeerAccountNumber = getConversationPeerAccount({
    selectedContact,
    selectedRoom,
    user,
  });
  const selectedConversationName = getConversationName({
    contact: selectedConversationContact,
    peer: selectedRoomPeer,
    profile: peerProfile,
    room: selectedRoom,
  });
  const selectedConversationAvatar =
    selectedConversationContact?.profile_picture ||
    peerProfile?.profile_picture ||
    "";
  const selectedConversationSubtitle = [
    peerProfile?.username ? `@${peerProfile.username}` : "",
    selectedPeerAccountNumber,
  ]
    .filter(Boolean)
    .join(" - ");
  const isSelectedConversationBlocked = Boolean(
    selectedConversationContact?.blocked,
  );
  const isSelectedPeerOnline = onlineUserIds?.has(
    Number(selectedRoomPeer?.user_id),
  );

  useEffect(() => {
    setIsConversationMenuOpen(false);
    setEditContactMessage(null);
    setActionMessage("");
  }, [selectedPeerAccountNumber, selectedRoom?.id]);

  useEffect(() => {
    if (!selectedPeerAccountNumber) {
      setPeerProfile(null);
      return undefined;
    }

    let isMounted = true;

    searchParentUser({ account_number: selectedPeerAccountNumber })
      .then((response) => {
        if (!isMounted) {
          return;
        }

        setPeerProfile({
          ...response.data,
          account_number: selectedPeerAccountNumber,
        });
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }

        setPeerProfile({
          account_number: selectedPeerAccountNumber,
        });
      });

    return () => {
      isMounted = false;
    };
  }, [selectedPeerAccountNumber]);

  if (!selectedPeerAccountNumber) {
    return <h2 id="parrot-layout-room-title">Message Room</h2>;
  }

  const openEditContactModal = () => {
    if (!selectedConversationContact) {
      return;
    }

    setEditContactForm({
      account_number: selectedConversationContact.account_number,
      alias_name:
        selectedConversationContact.alias_name ||
        selectedConversationContact.account_number ||
        "",
    });
    setEditContactMessage(null);
    setIsConversationMenuOpen(false);
    setIsEditContactModalOpen(true);
  };

  const closeEditContactModal = () => {
    setIsEditContactModalOpen(false);
    setEditContactMessage(null);
    setIsContactActionLoading(false);
  };

  const getUnsavedContactAlias = () => {
    const peerFullName = [peerProfile?.first_name, peerProfile?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();

    return (
      peerProfile?.username ||
      peerFullName ||
      selectedRoomPeer?.display_name ||
      selectedConversationName ||
      selectedPeerAccountNumber
    ).trim();
  };

  const handleSaveSelectedPeer = async () => {
    const aliasName = getUnsavedContactAlias();

    if (!selectedPeerAccountNumber || selectedConversationContact || !aliasName) {
      return;
    }

    setIsContactActionLoading(true);
    setActionMessage("");

    try {
      const response = await saveParentContact({
        account_number: selectedPeerAccountNumber,
        alias_name: aliasName,
      });
      const savedContact = response.data?.contact;

      if (savedContact) {
        onContactUpdated(savedContact);
      }

      onToast?.({
        type: "success",
        title: "Contact saved",
        message: `${aliasName} was added to your contacts.`,
      });
    } catch (error) {
      const errorMessage = getParentApiErrorMessage(
        error,
        "Unable to save this contact.",
      );

      setActionMessage(errorMessage);
      onToast?.({
        type: "error",
        title: "Contact not saved",
        message: errorMessage,
      });
    } finally {
      setIsContactActionLoading(false);
    }
  };

  const handleCloseConversation = () => {
    setIsConversationMenuOpen(false);
    onCloseConversation?.();
  };

  const handleEditContactChange = (event) => {
    const { name, value } = event.target;

    setEditContactForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
    setEditContactMessage(null);
  };

  const handleUpdateContactAlias = async (event) => {
    event?.preventDefault();

    const accountNumber = editContactForm.account_number;
    const aliasName = editContactForm.alias_name.trim();

    if (!accountNumber || !aliasName) {
      setEditContactMessage({
        type: "error",
        text: "Alias name is required.",
      });
      return;
    }

    setIsContactActionLoading(true);
    setEditContactMessage(null);

    try {
      const response = await updateParentContactAlias({
        account_number: accountNumber,
        alias_name: aliasName,
      });
      const updatedContact = response.data?.contact;

      if (updatedContact) {
        onContactUpdated(updatedContact);
      }

      closeEditContactModal();
    } catch (error) {
      setEditContactMessage({
        type: "error",
        text: getParentApiErrorMessage(error, "Unable to update this contact."),
      });
    } finally {
      setIsContactActionLoading(false);
    }
  };

  const handleToggleSelectedContactBlock = async () => {
    if (!selectedConversationContact?.account_number) {
      return;
    }

    const willBlockContact = !selectedConversationContact.blocked;

    setIsContactActionLoading(true);
    setActionMessage("");
    setIsConversationMenuOpen(false);

    try {
      const payload = {
        account_number: selectedConversationContact.account_number,
      };
      const response = selectedConversationContact.blocked
        ? await unblockParentContact(payload)
        : await blockParentContact(payload);
      const updatedContact = response.data?.contact;

      if (updatedContact) {
        onContactUpdated(updatedContact);
      }

      if (!willBlockContact && selectedRoom?.id) {
        releaseMessengerRoomBlockedMessages(selectedRoom.id)
          .then((releaseResponse) => {
            onBlockedMessagesReleased?.(releaseResponse.data?.result);
          })
          .catch(() => {
            setActionMessage(
              "Contact unblocked. Refresh the chat if older sent messages do not appear.",
            );
          });
      }

      onToast?.({
        type: willBlockContact ? "error" : "success",
        title: willBlockContact ? "Contact blocked" : "Contact unblocked",
        message: `${selectedConversationName} is now ${
          willBlockContact ? "blocked" : "unblocked"
        }.`,
      });
    } catch (error) {
      const errorMessage = getParentApiErrorMessage(
        error,
        "Unable to update block state.",
      );

      setActionMessage(errorMessage);
      onToast?.({
        type: "error",
        title: "Block status not updated",
        message: errorMessage,
      });
    } finally {
      setIsContactActionLoading(false);
    }
  };

  const handleDeleteSelectedContact = async () => {
    if (!selectedConversationContact?.account_number) {
      return;
    }

    const shouldDelete = window.confirm(
      `Delete ${selectedConversationName} from contacts?`,
    );

    if (!shouldDelete) {
      return;
    }

    setIsContactActionLoading(true);
    setActionMessage("");
    setIsConversationMenuOpen(false);

    try {
      await deleteParentContact({
        account_number: selectedConversationContact.account_number,
      });
      onContactDeleted(selectedConversationContact.account_number);
    } catch (error) {
      setActionMessage(
        getParentApiErrorMessage(error, "Unable to delete this contact."),
      );
    } finally {
      setIsContactActionLoading(false);
    }
  };

  const editContactModal = isEditContactModalOpen ? (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal"
        aria-modal="true"
        aria-labelledby="parent-edit-contact-title"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close"
          type="button"
          onClick={closeEditContactModal}
          aria-label="Close edit contact"
          title="Close"
        >
          <X size={28} strokeWidth={3} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header">
          <img src={parrotIcon} alt="" aria-hidden="true" />
          <div>
            <h2 id="parent-edit-contact-title">Edit Contact</h2>
          </div>
        </div>

        <form
          className="parent-layout-page__contact-table-form"
          onSubmit={handleUpdateContactAlias}
        >
          <div className="parent-layout-page__contact-fields">
            <div className="parent-layout-page__contact-row">
              <label
                className="parent-layout-page__field-label"
                htmlFor="parent-edit-contact-alias"
              >
                Save As
                <em className="is-required">Required</em>
              </label>
              <input
                id="parent-edit-contact-alias"
                name="alias_name"
                type="text"
                value={editContactForm.alias_name}
                onChange={handleEditContactChange}
                autoComplete="off"
                maxLength={120}
                required
              />
            </div>

            {editContactMessage ? (
              <p
                className={`parent-layout-page__form-message parent-layout-page__form-message--${editContactMessage.type}`}
                role="alert"
              >
                {editContactMessage.type === "success" ? (
                  <CheckCircle2 size={18} aria-hidden="true" />
                ) : (
                  <AlertCircle size={18} aria-hidden="true" />
                )}
                <span>{editContactMessage.text}</span>
              </p>
            ) : null}

            <button
              className="parent-layout-page__modal-submit"
              type="submit"
              disabled={isContactActionLoading}
            >
              <Save size={18} aria-hidden="true" />
              <span>{isContactActionLoading ? "Saving..." : "Save Contact"}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  ) : null;

  return (
    <>
      <div className="parent-layout-page__conversation-header">
        <span
          className="parent-layout-page__conversation-avatar"
          aria-hidden="true"
        >
          {selectedConversationAvatar ? (
            <img src={selectedConversationAvatar} alt="" />
          ) : (
            getInitials(selectedConversationName)
          )}
        </span>

        <div className="parent-layout-page__conversation-title">
          <h2 id="parrot-layout-room-title">{selectedConversationName}</h2>
          {selectedConversationSubtitle ? (
            <div className="parent-layout-page__conversation-meta">
              {isSelectedPeerOnline ? (
                <span className="parent-layout-page__presence-status">
                  <span aria-hidden="true" />
                  Online
                </span>
              ) : null}
              <span className="parent-layout-page__conversation-subtitle">
                {selectedConversationSubtitle}
              </span>
            </div>
          ) : isSelectedPeerOnline ? (
            <div className="parent-layout-page__conversation-meta">
              <span className="parent-layout-page__presence-status">
                <span aria-hidden="true" />
                Online
              </span>
            </div>
          ) : null}
          {actionMessage ? (
            <p
              className="parent-layout-page__conversation-action-message"
              role="alert"
            >
              {actionMessage}
            </p>
          ) : null}
        </div>

        <div className="parent-layout-page__conversation-actions">
          {selectedConversationContact ? (
            <>
              <button
                className="parent-layout-page__conversation-menu-button"
                type="button"
                onClick={() =>
                  setIsConversationMenuOpen((currentValue) => !currentValue)
                }
                aria-label="Contact actions"
                aria-expanded={isConversationMenuOpen}
                title="Contact actions"
                disabled={isContactActionLoading}
              >
                <MoreVertical size={22} aria-hidden="true" />
              </button>

              {isConversationMenuOpen ? (
                <div className="parent-layout-page__conversation-menu">
                  <button type="button" onClick={openEditContactModal}>
                    <Pencil size={16} aria-hidden="true" />
                    <span>Edit Name</span>
                  </button>
                  <button
                    className={`parent-layout-page__block-toggle ${
                      isSelectedConversationBlocked ? "is-blocked" : "is-unblocked"
                    }`}
                    type="button"
                    role="switch"
                    aria-checked={isSelectedConversationBlocked}
                    aria-label={
                      isSelectedConversationBlocked
                        ? "Unblock contact"
                        : "Block contact"
                    }
                    title={
                      isSelectedConversationBlocked
                        ? "Unblock contact"
                        : "Block contact"
                    }
                    onClick={handleToggleSelectedContactBlock}
                    disabled={isContactActionLoading}
                  >
                    <span className="parent-layout-page__block-toggle-label">
                      {isSelectedConversationBlocked ? (
                        <Ban size={16} aria-hidden="true" />
                      ) : (
                        <Unlock size={16} aria-hidden="true" />
                      )}
                      <span>
                        {isSelectedConversationBlocked ? "Blocked" : "Unblocked"}
                      </span>
                    </span>
                    <span
                      className="parent-layout-page__block-toggle-switch"
                      aria-hidden="true"
                    >
                      <span />
                    </span>
                  </button>
                  <button
                    className="is-danger"
                    type="button"
                    onClick={handleDeleteSelectedContact}
                    disabled={isContactActionLoading}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    <span>Delete</span>
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <button
              className="parent-layout-page__conversation-save-button"
              type="button"
              onClick={handleSaveSelectedPeer}
              disabled={isContactActionLoading}
              aria-label={`Save ${selectedConversationName} as contact`}
              title="Save contact"
            >
              <UserPlus size={18} aria-hidden="true" />
              <span>{isContactActionLoading ? "Saving..." : "Save Contact"}</span>
            </button>
          )}

          <button
            className="parent-layout-page__conversation-close-button"
            type="button"
            onClick={handleCloseConversation}
            aria-label="Close message room"
            title="Close chat"
          >
            <X size={21} aria-hidden="true" />
          </button>
        </div>
      </div>

      {editContactModal ? createPortal(editContactModal, document.body) : null}
    </>
  );
}

export default MessengerRoomHeader;
