import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  LogOut,
  Menu,
  Pencil,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import parrotIcon from "../../../assets/favicon.svg";
import {
  changeParentPassword,
  deleteParentAccount,
  getParentProfile,
  storeParentSession,
  updateParentProfile,
} from "../../api.js";

const accountInitialForm = {
  username: "",
  email: "",
  current_password: "",
  new_password: "",
  password: "",
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

const profileInitialForm = {
  first_name: "",
  last_name: "",
  phone: "",
  card_number: "",
  card_name: "",
  card_type: "",
  dr_no: "",
  floor: "",
  street: "",
  area: "",
  city: "",
  state: "",
  country: "",
  profile_picture_file: null,
};

const profileTextFields = [
  { label: "First Name", name: "first_name", autoComplete: "given-name" },
  { label: "Last Name", name: "last_name", autoComplete: "family-name" },
  { label: "Phone", name: "phone", autoComplete: "tel" },
  { label: "Card Number", name: "card_number", inputMode: "numeric" },
  { label: "Card Name", name: "card_name", autoComplete: "cc-name" },
  { label: "Door No", name: "dr_no", autoComplete: "address-line1" },
  { label: "Floor", name: "floor" },
  { label: "Street", name: "street", autoComplete: "address-line2" },
  { label: "Area", name: "area" },
  { label: "City", name: "city", autoComplete: "address-level2" },
  { label: "State", name: "state", autoComplete: "address-level1" },
  { label: "Country", name: "country", autoComplete: "country-name" },
];

const profileDetailFields = [
  { label: "First Name", key: "first_name" },
  { label: "Last Name", key: "last_name" },
  { label: "Phone", key: "phone" },
  { label: "Card Number", key: "card_number", mask: true },
  { label: "Card Name", key: "card_name" },
  { label: "Card Type", key: "card_type" },
  { label: "Updated", key: "updated_at", date: true },
];

const profilePayloadFields = profileTextFields.map(({ name }) => name);

function getApiErrorMessage(error, fallbackMessage) {
  const errors = error.response?.data?.errors;

  if (errors) {
    return Object.entries(errors)
      .map(([field, fieldErrors]) => `${field}: ${fieldErrors.join(", ")}`)
      .join(" ");
  }

  return error.response?.data?.message || fallbackMessage;
}

function getAccountForm(account) {
  return {
    ...accountInitialForm,
    username: account?.username || "",
    email: account?.email || "",
  };
}

function getAccountToastDetails(account) {
  return [
    {
      label: "Username",
      value: account?.username,
    },
    {
      label: "Account",
      value: account?.account_number,
    },
  ];
}

function getProfileForm(profile) {
  return {
    ...profileInitialForm,
    ...profilePayloadFields.reduce(
      (formValues, fieldName) => ({
        ...formValues,
        [fieldName]: profile?.[fieldName] || "",
      }),
      {},
    ),
    card_type: profile?.card_type || "",
    profile_picture_file: null,
  };
}

function getProfileUserPatch(profile) {
  return {
    first_name: profile?.first_name || null,
    last_name: profile?.last_name || null,
    phone: profile?.phone || null,
    profile_picture: profile?.profile_picture || null,
  };
}

function getProfileName(profile, username) {
  return (
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    username
  );
}

function getMaskedCardNumber(value) {
  if (!value) {
    return "Not saved";
  }

  const visibleDigits = String(value).slice(-4);
  return visibleDigits ? `Ending ${visibleDigits}` : "Saved";
}

function getProfileValue(profile, field) {
  const value = profile?.[field.key];

  if (field.mask) {
    return getMaskedCardNumber(value);
  }

  if (field.date && value) {
    return new Date(value).toLocaleString();
  }

  return value || "Not saved";
}

function getProfileAddress(profile) {
  const address = [
    profile?.dr_no,
    profile?.floor,
    profile?.street,
    profile?.area,
    profile?.city,
    profile?.state,
    profile?.country,
  ]
    .filter(Boolean)
    .join(", ");

  return address || "Not saved";
}

function getProfileToastDetails(profile) {
  return [
    {
      label: "Name",
      value: getProfileName(profile, "Parrot user"),
    },
    {
      label: "Phone",
      value: profile?.phone || "Not saved",
    },
  ];
}

function buildProfilePayload(form) {
  return {
    ...profilePayloadFields.reduce((payload, fieldName) => {
      const value = form[fieldName]?.trim();

      return {
        ...payload,
        [fieldName]: value || null,
      };
    }, {}),
    card_type: form.card_type || null,
    ...(form.profile_picture_file
      ? { profile_picture: form.profile_picture_file }
      : {}),
  };
}

function Header({ user, onLogout, onUserUpdate, onToast }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [activeProfileTab, setActiveProfileTab] = useState("view");
  const [activeAccountTab, setActiveAccountTab] = useState("password");
  const [profile, setProfile] = useState(null);
  const [profileForm, setProfileForm] = useState(() => getProfileForm(user));
  const [accountForm, setAccountForm] = useState(() => getAccountForm(user));
  const [profileMessage, setProfileMessage] = useState(null);
  const [accountMessage, setAccountMessage] = useState(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [isPasswordChanging, setIsPasswordChanging] = useState(false);
  const [isAccountDeleting, setIsAccountDeleting] = useState(false);
  const accountDisplay = user || {};
  const displayProfile = profile || user || {};
  const username = accountDisplay?.username || user?.username || "parrot_user";
  const displayName =
    [displayProfile?.first_name, displayProfile?.last_name]
      .filter(Boolean)
      .join(" ") || username;
  const accountNumber =
    accountDisplay?.account_number || user?.account_number || "Account pending";
  const email =
    accountDisplay?.email || user?.email || (username ? `${username}@epost.com` : "");
  const profilePicture = displayProfile?.profile_picture;

  const syncProfile = useCallback(
    (nextProfile) => {
      const profilePatch = getProfileUserPatch(nextProfile);
      const nextUser = {
        ...user,
        ...profilePatch,
      };

      setProfile(nextProfile);
      setProfileForm(getProfileForm(nextProfile));
      storeParentSession({ user: nextUser });
      onUserUpdate?.(nextUser);
    },
    [onUserUpdate, user],
  );

  const loadProfile = useCallback(async () => {
    setIsProfileLoading(true);
    setProfileMessage(null);

    try {
      const response = await getParentProfile();
      syncProfile(response.data || {});
    } catch (error) {
      setProfileMessage({
        type: "error",
        text: getApiErrorMessage(error, "Unable to load your profile."),
      });
    } finally {
      setIsProfileLoading(false);
    }
  }, [syncProfile]);

  const openProfileModal = () => {
    pushLoggedInHistoryView({ modal: "profile", profileTab: "view" });
    setIsMenuOpen(false);
    setActiveProfileTab("view");
    setIsProfileModalOpen(true);
    loadProfile();
  };

  const openAccountModal = () => {
    pushLoggedInHistoryView({ modal: "account", accountTab: "password" });
    setIsMenuOpen(false);
    setActiveAccountTab("password");
    setAccountForm(getAccountForm(user));
    setAccountMessage(null);
    setIsAccountModalOpen(true);
  };

  const resetProfileModal = useCallback(() => {
    setIsProfileModalOpen(false);
    setProfileMessage(null);
    setIsProfileSaving(false);
  }, []);

  const resetAccountModal = useCallback(() => {
    setIsAccountModalOpen(false);
    setAccountMessage(null);
    setIsPasswordChanging(false);
    setIsAccountDeleting(false);
    setAccountForm(getAccountForm(user));
  }, [user]);

  const closeProfileModal = useCallback(() => {
    if (isCurrentHistoryModal("profile")) {
      window.history.back();
      return;
    }

    resetProfileModal();
  }, [resetProfileModal]);

  const closeAccountModal = useCallback(() => {
    if (isCurrentHistoryModal("account")) {
      window.history.back();
      return;
    }

    resetAccountModal();
  }, [resetAccountModal]);

  useEffect(() => {
    if (!isProfileModalOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeProfileModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeProfileModal, isProfileModalOpen]);

  useEffect(() => {
    if (!isAccountModalOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeAccountModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeAccountModal, isAccountModalOpen]);

  useEffect(() => {
    const handlePopState = (event) => {
      const historyView =
        event.state?.[LOGGED_IN_HISTORY_KEY] || getLoggedInHistoryView();

      if (historyView?.modal === "profile") {
        resetAccountModal();
        setIsProfileModalOpen(true);
        setActiveProfileTab(historyView.profileTab === "edit" ? "edit" : "view");
        setProfileMessage(null);

        if (!isProfileModalOpen) {
          loadProfile();
        }

        return;
      }

      if (historyView?.modal === "account") {
        resetProfileModal();
        setIsAccountModalOpen(true);
        setActiveAccountTab(
          historyView.accountTab === "delete" ? "delete" : "password",
        );
        setAccountForm(getAccountForm(user));
        setAccountMessage(null);
        return;
      }

      resetProfileModal();
      resetAccountModal();
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [
    isProfileModalOpen,
    loadProfile,
    resetAccountModal,
    resetProfileModal,
    user,
  ]);

  const handleAccountFormChange = (event) => {
    const { name, value } = event.target;

    setAccountForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
    setAccountMessage(null);
  };

  const handleProfileFormChange = (event) => {
    const { files, name, type, value } = event.target;

    setProfileForm((currentForm) => ({
      ...currentForm,
      [name]: type === "file" ? files?.[0] || null : value,
    }));
    setProfileMessage(null);
  };

  const openEditProfileTab = () => {
    if (activeProfileTab !== "edit") {
      pushLoggedInHistoryView({ modal: "profile", profileTab: "edit" });
    }

    setActiveProfileTab("edit");
    setProfileForm(getProfileForm(profile || user));
    setProfileMessage(null);
  };

  const openViewProfileTab = () => {
    if (activeProfileTab !== "view") {
      pushLoggedInHistoryView({ modal: "profile", profileTab: "view" });
    }

    setActiveProfileTab("view");
    setProfileMessage(null);
  };

  const openChangePasswordTab = () => {
    if (activeAccountTab !== "password") {
      pushLoggedInHistoryView({ modal: "account", accountTab: "password" });
    }

    setActiveAccountTab("password");
    setAccountForm(getAccountForm(user));
    setAccountMessage(null);
  };

  const openDeleteAccountTab = () => {
    if (activeAccountTab !== "delete") {
      pushLoggedInHistoryView({ modal: "account", accountTab: "delete" });
    }

    setActiveAccountTab("delete");
    setAccountForm(getAccountForm(user));
    setAccountMessage(null);
  };

  const handleChangePasswordSubmit = async (event) => {
    event.preventDefault();

    setIsPasswordChanging(true);
    setAccountMessage(null);

    try {
      const response = await changeParentPassword({
        username: accountForm.username.trim(),
        email: accountForm.email.trim(),
        current_password: accountForm.current_password,
        new_password: accountForm.new_password,
      });

      setAccountForm((currentForm) => ({
        ...currentForm,
        current_password: "",
        new_password: "",
      }));
      setAccountMessage({
        type: "success",
        text: response.data?.message || "Password changed successfully.",
      });
      onToast?.({
        type: "success",
        title: "Password changed",
        message: "Your account password was updated.",
      });
    } catch (error) {
      const errorMessage = getApiErrorMessage(
        error,
        "Unable to change your password.",
      );

      setAccountMessage({
        type: "error",
        text: errorMessage,
      });
      onToast?.({
        type: "error",
        title: "Password change failed",
        message: errorMessage,
      });
    } finally {
      setIsPasswordChanging(false);
    }
  };

  const handleDeleteAccountSubmit = async (event) => {
    event.preventDefault();

    setIsAccountDeleting(true);
    setAccountMessage(null);

    try {
      const response = await deleteParentAccount({
        username: accountForm.username.trim(),
        email: accountForm.email.trim(),
        password: accountForm.password,
      });

      closeAccountModal();
      onToast?.({
        type: "success",
        title: "Account deleted",
        message: response.data?.message || "Account deleted successfully.",
        details: getAccountToastDetails(accountDisplay),
      });
      window.setTimeout(() => {
        onLogout?.();
      }, 900);
    } catch (error) {
      const errorMessage = getApiErrorMessage(
        error,
        "Unable to delete your account.",
      );

      setAccountMessage({
        type: "error",
        text: errorMessage,
      });
      onToast?.({
        type: "error",
        title: "Account deletion failed",
        message: errorMessage,
      });
    } finally {
      setIsAccountDeleting(false);
    }
  };

  const handleProfileSubmit = async (event) => {
    event.preventDefault();

    setIsProfileSaving(true);
    setProfileMessage(null);

    try {
      const response = await updateParentProfile(buildProfilePayload(profileForm));
      const updatedProfile = response.data || {};

      syncProfile(updatedProfile);
      setActiveProfileTab("view");
      setProfileMessage({
        type: "success",
        text: "Profile updated successfully.",
      });
      onToast?.({
        type: "success",
        title: "Profile updated",
        message: "Your profile changes were saved.",
        details: getProfileToastDetails(updatedProfile),
      });
    } catch (error) {
      const errorMessage = getApiErrorMessage(
        error,
        "Unable to update your profile.",
      );

      setProfileMessage({
        type: "error",
        text: errorMessage,
      });
      onToast?.({
        type: "error",
        title: "Profile update failed",
        message: errorMessage,
      });
    } finally {
      setIsProfileSaving(false);
    }
  };

  const profileModal = isProfileModalOpen ? (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal parent-layout-page__modal--profile"
        aria-modal="true"
        aria-labelledby="parent-profile-title"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close"
          type="button"
          onClick={closeProfileModal}
          aria-label="Close profile"
          title="Close"
        >
          <X size={28} strokeWidth={3} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header">
          <img src={parrotIcon} alt="" aria-hidden="true" />
          <div>
            <h2 id="parent-profile-title">Profile</h2>
          </div>
        </div>

        <nav
          className="parent-layout-page__profile-tabs"
          aria-label="Profile tabs"
          role="tablist"
        >
          <button
            className={activeProfileTab === "view" ? "is-active" : ""}
            type="button"
            onClick={openViewProfileTab}
            role="tab"
            aria-controls="parent-profile-view"
            aria-selected={activeProfileTab === "view"}
          >
            <UserRound size={16} aria-hidden="true" />
            <span>Get Profile</span>
          </button>
          <button
            className={activeProfileTab === "edit" ? "is-active" : ""}
            type="button"
            onClick={openEditProfileTab}
            role="tab"
            aria-controls="parent-profile-edit"
            aria-selected={activeProfileTab === "edit"}
          >
            <Pencil size={16} aria-hidden="true" />
            <span>Edit Profile</span>
          </button>
        </nav>

        <div className="parent-layout-page__profile-content">
          {profileMessage ? (
            <p
              className={`parent-layout-page__form-message parent-layout-page__form-message--${profileMessage.type}`}
              role="alert"
            >
              {profileMessage.type === "success" ? (
                <CheckCircle2 size={18} aria-hidden="true" />
              ) : (
                <AlertCircle size={18} aria-hidden="true" />
              )}
              <span>{profileMessage.text}</span>
            </p>
          ) : null}

          {activeProfileTab === "view" ? (
            <div
              className="parent-layout-page__profile-view"
              id="parent-profile-view"
              role="tabpanel"
            >
              {isProfileLoading ? (
                <div
                  className="parent-layout-page__profile-loading"
                  aria-live="polite"
                >
                  <span />
                  <span />
                  <span />
                </div>
              ) : (
                <>
                  <div className="parent-layout-page__profile-identity">
                    <span
                      className="parent-layout-page__profile-picture"
                      aria-hidden="true"
                    >
                      {profilePicture ? (
                        <img src={profilePicture} alt="" />
                      ) : (
                        <UserRound size={24} />
                      )}
                    </span>
                    <div>
                      <strong>{getProfileName(displayProfile, username)}</strong>
                      <small>
                        {username} / {accountNumber}
                      </small>
                    </div>
                  </div>

                  <dl className="parent-layout-page__profile-details">
                    {profileDetailFields.map((field) => (
                      <div key={field.key}>
                        <dt>{field.label}</dt>
                        <dd>{getProfileValue(displayProfile, field)}</dd>
                      </div>
                    ))}
                    <div>
                      <dt>Address</dt>
                      <dd>{getProfileAddress(displayProfile)}</dd>
                    </div>
                  </dl>
                </>
              )}
            </div>
          ) : (
            <form
              className="parent-layout-page__profile-form"
              id="parent-profile-edit"
              role="tabpanel"
              onSubmit={handleProfileSubmit}
            >
              <div className="parent-layout-page__profile-form-grid">
                {profileTextFields.map((field) => (
                  <label
                    className="parent-layout-page__profile-field"
                    key={field.name}
                  >
                    <span className="parent-layout-page__field-label">
                      {field.label}
                    </span>
                    <input
                      name={field.name}
                      type="text"
                      value={profileForm[field.name]}
                      onChange={handleProfileFormChange}
                      autoComplete={field.autoComplete || "off"}
                      inputMode={field.inputMode || "text"}
                      maxLength={field.name === "card_number" ? 32 : 120}
                    />
                  </label>
                ))}

                <label className="parent-layout-page__profile-field">
                  <span className="parent-layout-page__field-label">
                    Card Type
                  </span>
                  <select
                    name="card_type"
                    value={profileForm.card_type}
                    onChange={handleProfileFormChange}
                  >
                    <option value="">Not saved</option>
                    <option value="credit">Credit</option>
                    <option value="debit">Debit</option>
                  </select>
                </label>

                <label className="parent-layout-page__profile-field parent-layout-page__profile-field--wide">
                  <span className="parent-layout-page__field-label">
                    Profile Picture
                  </span>
                  <input
                    name="profile_picture_file"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleProfileFormChange}
                  />
                </label>
              </div>

              <button
                className="parent-layout-page__modal-submit"
                type="submit"
                disabled={isProfileSaving}
              >
                <Save size={18} aria-hidden="true" />
                <span>{isProfileSaving ? "Saving..." : "Save Profile"}</span>
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  ) : null;

  const accountModal = isAccountModalOpen ? (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal parent-layout-page__modal--account"
        aria-modal="true"
        aria-labelledby="parent-account-title"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close"
          type="button"
          onClick={closeAccountModal}
          aria-label="Close account"
          title="Close"
        >
          <X size={28} strokeWidth={3} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header">
          <img src={parrotIcon} alt="" aria-hidden="true" />
          <div>
            <h2 id="parent-account-title">Account</h2>
          </div>
        </div>

        <nav
          className="parent-layout-page__profile-tabs"
          aria-label="Account tabs"
          role="tablist"
        >
          <button
            className={activeAccountTab === "password" ? "is-active" : ""}
            type="button"
            onClick={openChangePasswordTab}
            role="tab"
            aria-controls="parent-account-password"
            aria-selected={activeAccountTab === "password"}
          >
            <KeyRound size={16} aria-hidden="true" />
            <span>Password</span>
          </button>
          <button
            className={activeAccountTab === "delete" ? "is-active" : ""}
            type="button"
            onClick={openDeleteAccountTab}
            role="tab"
            aria-controls="parent-account-delete"
            aria-selected={activeAccountTab === "delete"}
          >
            <Trash2 size={16} aria-hidden="true" />
            <span>Delete</span>
          </button>
        </nav>

        <div className="parent-layout-page__profile-content">
          {accountMessage ? (
            <p
              className={`parent-layout-page__form-message parent-layout-page__form-message--${accountMessage.type}`}
              role="alert"
            >
              {accountMessage.type === "success" ? (
                <CheckCircle2 size={18} aria-hidden="true" />
              ) : (
                <AlertCircle size={18} aria-hidden="true" />
              )}
              <span>{accountMessage.text}</span>
            </p>
          ) : null}

          {activeAccountTab === "password" ? (
            <form
              className="parent-layout-page__profile-form"
              id="parent-account-password"
              role="tabpanel"
              onSubmit={handleChangePasswordSubmit}
            >
              <div className="parent-layout-page__profile-form-grid">
                <label className="parent-layout-page__profile-field">
                  <span className="parent-layout-page__field-label">
                    Username
                    <em className="is-required">Required</em>
                  </span>
                  <input
                    name="username"
                    type="text"
                    value={accountForm.username}
                    onChange={handleAccountFormChange}
                    autoComplete="username"
                    required
                  />
                </label>

                <label className="parent-layout-page__profile-field">
                  <span className="parent-layout-page__field-label">
                    Email
                    <em className="is-required">Required</em>
                  </span>
                  <input
                    name="email"
                    type="email"
                    value={accountForm.email}
                    onChange={handleAccountFormChange}
                    autoComplete="email"
                    required
                  />
                </label>

                <label className="parent-layout-page__profile-field">
                  <span className="parent-layout-page__field-label">
                    Current Password
                    <em className="is-required">Required</em>
                  </span>
                  <input
                    name="current_password"
                    type="password"
                    value={accountForm.current_password}
                    onChange={handleAccountFormChange}
                    autoComplete="current-password"
                    required
                  />
                </label>

                <label className="parent-layout-page__profile-field">
                  <span className="parent-layout-page__field-label">
                    New Password
                    <em className="is-required">Required</em>
                  </span>
                  <input
                    name="new_password"
                    type="password"
                    value={accountForm.new_password}
                    onChange={handleAccountFormChange}
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>
              </div>

              <button
                className="parent-layout-page__modal-submit"
                type="submit"
                disabled={isPasswordChanging}
              >
                <KeyRound size={18} aria-hidden="true" />
                <span>
                  {isPasswordChanging ? "Changing..." : "Change Password"}
                </span>
              </button>
            </form>
          ) : null}

          {activeAccountTab === "delete" ? (
            <form
              className="parent-layout-page__profile-form"
              id="parent-account-delete"
              role="tabpanel"
              onSubmit={handleDeleteAccountSubmit}
            >
              <p className="parent-layout-page__account-danger">
                Account deletion is permanent.
              </p>

              <div className="parent-layout-page__profile-form-grid">
                <label className="parent-layout-page__profile-field">
                  <span className="parent-layout-page__field-label">
                    Username
                    <em className="is-required">Required</em>
                  </span>
                  <input
                    name="username"
                    type="text"
                    value={accountForm.username}
                    onChange={handleAccountFormChange}
                    autoComplete="username"
                    required
                  />
                </label>

                <label className="parent-layout-page__profile-field">
                  <span className="parent-layout-page__field-label">
                    Email
                    <em className="is-required">Required</em>
                  </span>
                  <input
                    name="email"
                    type="email"
                    value={accountForm.email}
                    onChange={handleAccountFormChange}
                    autoComplete="email"
                    required
                  />
                </label>

                <label className="parent-layout-page__profile-field parent-layout-page__profile-field--wide">
                  <span className="parent-layout-page__field-label">
                    Password
                    <em className="is-required">Required</em>
                  </span>
                  <input
                    name="password"
                    type="password"
                    value={accountForm.password}
                    onChange={handleAccountFormChange}
                    autoComplete="current-password"
                    required
                  />
                </label>
              </div>

              <button
                className="parent-layout-page__modal-submit parent-layout-page__modal-submit--danger"
                type="submit"
                disabled={isAccountDeleting}
              >
                <Trash2 size={18} aria-hidden="true" />
                <span>
                  {isAccountDeleting ? "Deleting..." : "Delete Account"}
                </span>
              </button>
            </form>
          ) : null}
        </div>
      </section>
    </div>
  ) : null;

  return (
    <div className="parent-header">
      <div className="parent-header__brand">
        <img src={parrotIcon} alt="" aria-hidden="true" />
        <span>Parrot</span>
      </div>

      <button
        className="parent-header__menu-button"
        type="button"
        onClick={() => setIsMenuOpen((currentValue) => !currentValue)}
        aria-expanded={isMenuOpen}
        aria-label="Account menu"
        title="Account menu"
      >
        <Menu size={22} aria-hidden="true" />
      </button>

      {isMenuOpen ? (
        <div className="parent-header__menu" role="menu">
          <div className="parent-header__menu-title">
            <span className="parent-header__avatar" aria-hidden="true">
              {profilePicture ? (
                <img src={profilePicture} alt="" />
              ) : (
                <UserRound size={20} />
              )}
            </span>
            <div>
              <h1>{displayName}</h1>
            </div>
          </div>

          <table className="parent-header__account-table">
            <tbody>
              <tr>
                <th scope="row">Username</th>
                <td>{username}</td>
              </tr>
              <tr>
                <th scope="row">Account</th>
                <td>{accountNumber}</td>
              </tr>
              <tr>
                <th scope="row">Email</th>
                <td>{email}</td>
              </tr>
            </tbody>
          </table>

          <div className="parent-header__menu-actions">
            <button
              className="parent-header__profile-button"
              type="button"
              onClick={openProfileModal}
              role="menuitem"
            >
              <UserRound size={16} aria-hidden="true" />
              <span>Profile</span>
            </button>

            <button
              className="parent-header__account-button"
              type="button"
              onClick={openAccountModal}
              role="menuitem"
            >
              <ShieldCheck size={16} aria-hidden="true" />
              <span>Account</span>
            </button>

            {onLogout ? (
              <button
                className="parent-header__logout"
                type="button"
                onClick={onLogout}
                role="menuitem"
              >
                <LogOut size={16} aria-hidden="true" />
                <span>Logout</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {profileModal ? createPortal(profileModal, document.body) : null}
      {accountModal ? createPortal(accountModal, document.body) : null}
    </div>
  );
}

export default Header;
