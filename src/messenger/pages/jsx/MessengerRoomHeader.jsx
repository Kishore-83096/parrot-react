import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Eye,
  EyeOff,
  MoreVertical,
  ParrotIcon,
  Pencil,
  Save,
  Trash2,
  Unlock,
  UserPlus,
  X,
} from "@/components/icons";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import SmartAvatar from "../../../components/SmartAvatar.jsx";
import {
  markMessengerRoomRead,
  refreshMessengerPresenceVisibility,
  releaseMessengerRoomBlockedMessages,
} from "../../api.js";
import {
  blockParentContact,
  deleteParentContact,
  ghostParentContact,
  saveParentContact,
  searchParentUser,
  unghostParentContact,
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
  peerProfileCache,
  onPeerProfileCacheChange,
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
  const peerProfileCacheRef = useRef(peerProfileCache || {});

  useEffect(() => {
    peerProfileCacheRef.current = peerProfileCache || {};
  }, [peerProfileCache]);

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
  const isSelectedConversationGhosted = Boolean(
    selectedConversationContact?.ghosted,
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

    const cachedPeerProfile =
      peerProfileCacheRef.current?.[String(selectedPeerAccountNumber)] || null;

    if (cachedPeerProfile) {
      setPeerProfile(cachedPeerProfile);
    } else {
      setPeerProfile({
        account_number: selectedPeerAccountNumber,
      });
    }

    let isMounted = true;

    searchParentUser({ account_number: selectedPeerAccountNumber })
      .then((response) => {
        const nextPeerProfile = {
          ...response.data,
          account_number: selectedPeerAccountNumber,
        };

        if (!isMounted) {
          return;
        }

        setPeerProfile(nextPeerProfile);
        onPeerProfileCacheChange?.(selectedPeerAccountNumber, nextPeerProfile);
      })
      .catch(() => {
        const fallbackPeerProfile = {
          account_number: selectedPeerAccountNumber,
        };

        if (!isMounted) {
          return;
        }

        setPeerProfile(fallbackPeerProfile);
        onPeerProfileCacheChange?.(
          selectedPeerAccountNumber,
          fallbackPeerProfile,
        );
      });

    return () => {
      isMounted = false;
    };
  }, [onPeerProfileCacheChange, selectedPeerAccountNumber]);

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
    if (willBlockContact && selectedConversationContact.ghosted) {
      const shouldBlock = window.confirm(
        `Blocking ${selectedConversationName} will remove ghosting for this contact. Continue?`,
      );

      if (!shouldBlock) {
        setIsConversationMenuOpen(false);
        return;
      }
    }

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

      const peerUserId =
        updatedContact?.user_id ||
        selectedConversationContact?.user_id ||
        selectedRoomPeer?.user_id;
      if (peerUserId) {
        refreshMessengerPresenceVisibility({
          viewer_user_id: peerUserId,
        }).catch(() => {});
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

  const handleToggleSelectedContactGhost = async () => {
    if (!selectedConversationContact?.account_number) {
      return;
    }

    const willGhostContact = !selectedConversationContact.ghosted;
    if (willGhostContact && selectedConversationContact.blocked) {
      const shouldGhost = window.confirm(
        `Ghosting ${selectedConversationName} will remove blocking for this contact. Continue?`,
      );

      if (!shouldGhost) {
        setIsConversationMenuOpen(false);
        return;
      }
    }

    setIsContactActionLoading(true);
    setActionMessage("");
    setIsConversationMenuOpen(false);

    try {
      const payload = {
        account_number: selectedConversationContact.account_number,
      };
      const response = selectedConversationContact.ghosted
        ? await unghostParentContact(payload)
        : await ghostParentContact(payload);
      const updatedContact = response.data?.contact;

      if (updatedContact) {
        onContactUpdated(updatedContact);
      }

      const peerUserId =
        updatedContact?.user_id ||
        selectedConversationContact?.user_id ||
        selectedRoomPeer?.user_id;
      if (peerUserId) {
        refreshMessengerPresenceVisibility({
          viewer_user_id: peerUserId,
        }).catch(() => {});
      }

      if (!willGhostContact && selectedRoom?.id) {
        markMessengerRoomRead(selectedRoom.id, {}).catch(() => {
          setActionMessage(
            "Ghosting removed. Open the chat again if older message ticks do not update.",
          );
        });
      }

      onToast?.({
        type: "success",
        title: willGhostContact ? "Contact ghosted" : "Ghosting removed",
        message: `${selectedConversationName} is now ${
          willGhostContact ? "ghosted" : "not ghosted"
        }.`,
      });
    } catch (error) {
      const errorMessage = getParentApiErrorMessage(
        error,
        "Unable to update ghosting.",
      );

      setActionMessage(errorMessage);
      onToast?.({
        type: "error",
        title: "Ghosting not updated",
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
          <ParrotIcon />
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
        <SmartAvatar
          className="parent-layout-page__conversation-avatar"
          src={selectedConversationAvatar}
          initials={getInitials(selectedConversationName)}
          firstName={peerProfile?.first_name}
          lastName={peerProfile?.last_name}
          name={selectedConversationName}
          username={peerProfile?.username}
          fallback="P"
        />

        <div className="parent-layout-page__conversation-title">
          <div className="parent-layout-page__conversation-title-row">
            <h2 id="parrot-layout-room-title">{selectedConversationName}</h2>
            {isSelectedPeerOnline ? (
              <span className="parent-layout-page__presence-status">
                <span aria-hidden="true" />
                Online
              </span>
            ) : null}
          </div>
          {selectedConversationSubtitle ? (
            <div className="parent-layout-page__conversation-meta">
              <span className="parent-layout-page__conversation-subtitle">
                {selectedConversationSubtitle}
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
                        {isSelectedConversationBlocked ? "Blocked" : "Block"}
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
                    className={`parent-layout-page__block-toggle ${
                      isSelectedConversationGhosted ? "is-ghosted" : "is-visible"
                    }`}
                    type="button"
                    role="switch"
                    aria-checked={isSelectedConversationGhosted}
                    aria-label={
                      isSelectedConversationGhosted
                        ? "Remove ghosting"
                        : "Ghost contact"
                    }
                    title={
                      isSelectedConversationGhosted
                        ? "Remove ghosting"
                        : "Ghost contact"
                    }
                    onClick={handleToggleSelectedContactGhost}
                    disabled={isContactActionLoading}
                  >
                    <span className="parent-layout-page__block-toggle-label">
                      {isSelectedConversationGhosted ? (
                        <EyeOff size={16} aria-hidden="true" />
                      ) : (
                        <Eye size={16} aria-hidden="true" />
                      )}
                      <span>
                        {isSelectedConversationGhosted
                          ? "Ghosted"
                          : `Ghost ${selectedConversationName}`}
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
