import { ImagePlus, Settings, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import {
  clearParentSession,
  changeParentPassword,
  deleteParentAccount,
  deleteParentProfilePicture,
  getParentProfile,
  getStoredParentUser,
  updateParentProfile,
} from "../../api.js";
import { clearMessengerSession } from "../../../messenger/api.js";
import MessengerInboxListener from "../../../messenger/MessengerInboxListener.jsx";
import ParrotIcon from "../../components/ParrotIcon.jsx";
import ContactsPage from "./ContactsPage.jsx";
import "../css/NavigationPage.css";
import "../tab/NavigationPage.css";
import "../mobile/NavigationPage.css";

const passwordInitialForm = {
  username: "",
  email: "",
  current_password: "",
  new_password: "",
};

const deleteInitialForm = {
  username: "",
  email: "",
  password: "",
};

const profileInitialForm = {
  first_name: "",
  last_name: "",
  phone: "",
  card_name: "",
  card_number: "",
  card_type: "",
  dr_no: "",
  floor: "",
  street: "",
  area: "",
  city: "",
  state: "",
  country: "",
};

const accountFields = [
  ["Username", "username"],
  ["Email", "email"],
  ["Account Number", "account_number"],
  ["Premium", "is_premium"],
  ["Created At", "created_at"],
];

const profileFields = [
  ["First Name", "first_name"],
  ["Last Name", "last_name"],
  ["Phone", "phone"],
];

const addressFields = [
  ["Door No", "dr_no"],
  ["Floor", "floor"],
  ["Street", "street"],
  ["Area", "area"],
  ["City", "city"],
  ["State", "state"],
  ["Country", "country"],
];

const cardFields = [
  ["Card Name", "card_name"],
  ["Card Number", "card_number"],
  ["Card Type", "card_type"],
];

const profileGroups = [
  ["Personal", profileFields],
  ["Address", addressFields],
  ["Cards", cardFields],
];

const profileGroupAccentClassNames = {
  Personal: "parent-navigation__profile-section--personal",
  Address: "parent-navigation__profile-section--address",
  Cards: "parent-navigation__profile-section--cards",
};

function getProfileGroupClassName(baseClassName, groupTitle) {
  const modifierClassName = profileGroupAccentClassNames[groupTitle];

  return modifierClassName
    ? `${baseClassName} ${modifierClassName}`
    : baseClassName;
}

function formatValue(value) {
  if (value === true) {
    return "Yes";
  }

  if (value === false) {
    return "No";
  }

  return value || "Not added";
}

function TableRow({ label, value, children, htmlFor, rowClassName = "" }) {
  return (
    <tr
      className={
        rowClassName
          ? `parent-navigation__table-row ${rowClassName}`
          : "parent-navigation__table-row"
      }
    >
      <th scope="row">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
      </th>
      <td>{children !== undefined ? children : formatValue(value)}</td>
    </tr>
  );
}

function NavigationPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const user = useMemo(() => getStoredParentUser(), []);
  const [activeModal, setActiveModal] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileMessage, setProfileMessage] = useState("");
  const [accountMessage, setAccountMessage] = useState("");
  const [notice, setNotice] = useState(null);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [accountSettingsTab, setAccountSettingsTab] = useState("password");
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [profileForm, setProfileForm] = useState(profileInitialForm);
  const [passwordForm, setPasswordForm] = useState(() => ({
    ...passwordInitialForm,
    username: user?.username || "",
    email: user?.email || "",
  }));
  const [deleteForm, setDeleteForm] = useState(() => ({
    ...deleteInitialForm,
    username: user?.username || "",
    email: user?.email || "",
  }));
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [isUploadingPicture, setIsUploadingPicture] = useState(false);
  const [isRemovingPicture, setIsRemovingPicture] = useState(false);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  useEffect(() => {
    if (!user) {
      return undefined;
    }

    let isMounted = true;

    getParentProfile()
      .then((response) => {
        if (isMounted) {
          setProfile(response.data);
          setProfileForm({ ...profileInitialForm, ...response.data });
        }
      })
      .catch(() => {
        if (isMounted) {
          setProfile(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [user]);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setNotice(null);
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [notice]);

  if (!user) {
    return <Navigate to="/" replace />;
  }

  const showNotice = (type, text) => {
    setNotice({ type, text });
  };

  const handleLogout = () => {
    clearParentSession();
    clearMessengerSession();
    navigate("/", { replace: true });
  };

  const closeModal = () => {
    setActiveModal(null);
    setProfileMessage("");
    setAccountMessage("");
    setShowAccountSettings(false);
    setAccountSettingsTab("password");
    setShowProfileSettings(false);
  };

  const openAccountModal = () => {
    setAccountMessage("");
    setShowAccountSettings(false);
    setAccountSettingsTab("password");
    setActiveModal("account");
  };

  const openProfileModal = async () => {
    setActiveModal("profile");
    setProfileMessage("");
    setShowProfileSettings(false);
    setIsProfileLoading(true);

    try {
      const response = await getParentProfile();
      setProfile(response.data);
      setProfileForm({ ...profileInitialForm, ...response.data });
    } catch (error) {
      const errorMessage =
        error.response?.data?.message || "Unable to load profile details.";
      setProfileMessage(errorMessage);
      showNotice("danger", errorMessage);
    } finally {
      setIsProfileLoading(false);
    }
  };

  const handlePictureSelect = async (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append("profile_picture", file);
    setIsUploadingPicture(true);
    setProfileMessage("");

    try {
      const response = await updateParentProfile(formData);
      setProfile(response.data);
      setProfileMessage("Profile picture updated.");
      showNotice("success", "Profile picture updated.");
    } catch (error) {
      const errorMessage =
        error.response?.data?.message || "Unable to update profile picture.";
      setProfileMessage(errorMessage);
      showNotice("danger", errorMessage);
    } finally {
      setIsUploadingPicture(false);
      event.target.value = "";
    }
  };

  const handleRemovePicture = async () => {
    setProfileMessage("");
    setIsRemovingPicture(true);

    try {
      await deleteParentProfilePicture();
      setProfile((currentProfile) => ({
        ...currentProfile,
        profile_picture: null,
      }));
      setProfileForm((currentForm) => ({
        ...currentForm,
        profile_picture: null,
      }));
      setProfileMessage("Profile picture removed.");
      showNotice("destructive", "Profile picture removed.");
    } catch (error) {
      const errorMessage =
        error.response?.data?.message || "Unable to remove profile picture.";
      setProfileMessage(errorMessage);
      showNotice("danger", errorMessage);
    } finally {
      setIsRemovingPicture(false);
    }
  };

  const handleProfileChange = (event) => {
    const { name, value } = event.target;
    setProfileForm((currentForm) => ({ ...currentForm, [name]: value }));
  };

  const handleProfileSubmit = async (event) => {
    event.preventDefault();
    setProfileMessage("");
    setIsUpdatingProfile(true);

    const payload = Object.fromEntries(
      Object.entries(profileForm).filter(([, value]) => value !== null),
    );

    try {
      const response = await updateParentProfile(payload);
      setProfile(response.data);
      setProfileForm({ ...profileInitialForm, ...response.data });
      setProfileMessage("Profile details updated.");
      showNotice("success", "Profile details updated.");
    } catch (error) {
      const errors = error.response?.data?.errors;
      const errorMessage =
        errors
          ? Object.entries(errors)
              .map(([field, fieldErrors]) => `${field}: ${fieldErrors.join(", ")}`)
              .join(" ")
          : error.response?.data?.message || "Unable to update profile details.";
      setProfileMessage(errorMessage);
      showNotice("danger", errorMessage);
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handlePasswordChange = (event) => {
    const { name, value } = event.target;
    setPasswordForm((currentForm) => ({ ...currentForm, [name]: value }));
  };

  const handleDeleteChange = (event) => {
    const { name, value } = event.target;
    setDeleteForm((currentForm) => ({ ...currentForm, [name]: value }));
  };

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();
    setAccountMessage("");
    setIsChangingPassword(true);

    try {
      const response = await changeParentPassword(passwordForm);
      const successMessage = response.data?.message || "Password changed.";
      setAccountMessage(successMessage);
      showNotice("success", successMessage);
      setPasswordForm((currentForm) => ({
        ...currentForm,
        current_password: "",
        new_password: "",
      }));
    } catch (error) {
      const errors = error.response?.data?.errors;
      const errorMessage =
        errors
          ? Object.entries(errors)
              .map(([field, fieldErrors]) => `${field}: ${fieldErrors.join(", ")}`)
              .join(" ")
          : error.response?.data?.message || "Unable to change password.";
      setAccountMessage(errorMessage);
      showNotice("danger", errorMessage);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleDeleteSubmit = async (event) => {
    event.preventDefault();
    setAccountMessage("");
    setIsDeletingAccount(true);

    try {
      await deleteParentAccount(deleteForm);
      showNotice("destructive", "Account deleted successfully.");
      clearParentSession();
      navigate("/");
    } catch (error) {
      const errors = error.response?.data?.errors;
      const errorMessage =
        errors
          ? Object.entries(errors)
              .map(([field, fieldErrors]) => `${field}: ${fieldErrors.join(", ")}`)
              .join(" ")
          : error.response?.data?.message || "Unable to delete account.";
      setAccountMessage(errorMessage);
      showNotice("danger", errorMessage);
    } finally {
      setIsDeletingAccount(false);
    }
  };

  return (
    <main className="parent-navigation">
      <MessengerInboxListener
        key={user.user_id || user.id || user.account_number || user.username}
      />

      <ContactsPage
        user={user}
        profile={profile}
        showNotice={showNotice}
        onAccountClick={openAccountModal}
        onProfileClick={openProfileModal}
        onLogout={handleLogout}
      />

      {activeModal ? (
        <div className="parent-navigation__modal-backdrop" role="presentation">
          <section
            className={`parent-navigation__modal parent-navigation__modal--${activeModal}`}
            aria-modal="true"
            role="dialog"
            aria-labelledby="parent-navigation-modal-title"
          >
            <div className="parent-navigation__modal-content">
            {activeModal === "account" ? (
              <>
                <div className="parent-navigation__modal-title-row">
                  <h1 id="parent-navigation-modal-title">Account Details</h1>
                  <div className="parent-navigation__modal-title-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAccountSettings((currentValue) => !currentValue);
                        setAccountMessage("");
                      }}
                      aria-label="Account settings"
                      title="Account settings"
                    >
                      <Settings size={20} aria-hidden="true" />
                    </button>
                    <button
                      className="parent-navigation__modal-close"
                      type="button"
                      onClick={closeModal}
                      aria-label="Close"
                      title="Close"
                    >
                      x
                    </button>
                  </div>
                </div>
                {!showAccountSettings ? (
                  <table className="parent-navigation__table">
                    <tbody>
                      {accountFields.map(([label, key]) => (
                        <TableRow key={key} label={label} value={user[key]} />
                      ))}
                    </tbody>
                  </table>
                ) : null}

                {showAccountSettings ? (
                  <div className="parent-navigation__settings-panel">
                    <div className="parent-navigation__settings-tabs">
                      <button
                        className={
                          accountSettingsTab === "password" ? "is-active" : ""
                        }
                        type="button"
                        onClick={() => {
                          setAccountSettingsTab("password");
                          setAccountMessage("");
                        }}
                      >
                        Change Password
                      </button>
                      <button
                        className={
                          accountSettingsTab === "delete" ? "is-active" : ""
                        }
                        type="button"
                        onClick={() => {
                          setAccountSettingsTab("delete");
                          setAccountMessage("");
                        }}
                      >
                        Delete Account
                      </button>
                    </div>

                    {accountSettingsTab === "password" ? (
                      <form
                        className="parent-navigation__form parent-navigation__form--table"
                        onSubmit={handlePasswordSubmit}
                      >
                        <table className="parent-navigation__table parent-navigation__table--form">
                          <tbody>
                            <TableRow
                              label="Username"
                              htmlFor="settings-password-username"
                            >
                              <input
                                id="settings-password-username"
                                name="username"
                                type="text"
                                value={passwordForm.username}
                                onChange={handlePasswordChange}
                                required
                              />
                            </TableRow>
                            <TableRow label="Email" htmlFor="settings-password-email">
                              <input
                                id="settings-password-email"
                                name="email"
                                type="email"
                                value={passwordForm.email}
                                onChange={handlePasswordChange}
                                required
                              />
                            </TableRow>
                            <TableRow
                              label="Current Password"
                              htmlFor="settings-current-password"
                            >
                              <input
                                id="settings-current-password"
                                name="current_password"
                                type="password"
                                value={passwordForm.current_password}
                                onChange={handlePasswordChange}
                                required
                              />
                            </TableRow>
                            <TableRow
                              label="New Password"
                              htmlFor="settings-new-password"
                            >
                              <input
                                id="settings-new-password"
                                name="new_password"
                                type="password"
                                value={passwordForm.new_password}
                                onChange={handlePasswordChange}
                                required
                              />
                            </TableRow>
                            <tr className="parent-navigation__table-row parent-navigation__table-row--action">
                              <td colSpan={2}>
                                <button type="submit" disabled={isChangingPassword}>
                                  {isChangingPassword
                                    ? "Updating..."
                                    : "Update Password"}
                                </button>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </form>
                    ) : (
                      <form
                        className="parent-navigation__form parent-navigation__form--danger parent-navigation__form--table"
                        onSubmit={handleDeleteSubmit}
                      >
                        <table className="parent-navigation__table parent-navigation__table--form">
                          <tbody>
                            <TableRow
                              label="Username"
                              htmlFor="settings-delete-username"
                            >
                              <input
                                id="settings-delete-username"
                                name="username"
                                type="text"
                                value={deleteForm.username}
                                onChange={handleDeleteChange}
                                required
                              />
                            </TableRow>
                            <TableRow label="Email" htmlFor="settings-delete-email">
                              <input
                                id="settings-delete-email"
                                name="email"
                                type="email"
                                value={deleteForm.email}
                                onChange={handleDeleteChange}
                                required
                              />
                            </TableRow>
                            <TableRow
                              label="Password"
                              htmlFor="settings-delete-password"
                            >
                              <input
                                id="settings-delete-password"
                                name="password"
                                type="password"
                                value={deleteForm.password}
                                onChange={handleDeleteChange}
                                required
                              />
                            </TableRow>
                            <tr className="parent-navigation__table-row parent-navigation__table-row--action">
                              <td colSpan={2}>
                                <button type="submit" disabled={isDeletingAccount}>
                                  {isDeletingAccount ? "Deleting..." : "Delete Account"}
                                </button>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </form>
                    )}
                  </div>
                ) : null}

                {accountMessage ? (
                  <p className="parent-navigation__message">{accountMessage}</p>
                ) : null}
              </>
            ) : (
              <>
                
                <div className="parent-navigation__modal-title-row">
                  <h1 id="parent-navigation-modal-title">Profile Details</h1>
                  <div className="parent-navigation__modal-title-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setShowProfileSettings((currentValue) => !currentValue);
                        setProfileMessage("");
                      }}
                      aria-label="Profile settings"
                      title="Profile settings"
                    >
                      <Settings size={20} aria-hidden="true" />
                    </button>
                    <button
                      className="parent-navigation__modal-close"
                      type="button"
                      onClick={closeModal}
                      aria-label="Close"
                      title="Close"
                    >
                      x
                    </button>
                  </div>
                </div>

                {isProfileLoading ? (
                  <p className="parent-navigation__message">Loading profile...</p>
                ) : !showProfileSettings ? (
                  <>
                    <div className="parent-navigation__profile-groups">
                      {profileGroups.map(([groupTitle, fields]) => (
                        <section
                          className={getProfileGroupClassName(
                            "parent-navigation__profile-group",
                            groupTitle,
                          )}
                          key={groupTitle}
                        >
                          <h2>{groupTitle}</h2>
                          <table className="parent-navigation__table">
                            <tbody>
                              {groupTitle === "Personal" ? (
                                <TableRow
                                  label="Profile picture"
                                  rowClassName="parent-navigation__table-row--media"
                                >
                                  <div className="parent-navigation__table-media parent-navigation__table-media--details">
                                    {profile?.profile_picture ? (
                                      <img
                                        src={profile.profile_picture}
                                        alt="Profile"
                                      />
                                    ) : (
                                      <ParrotIcon className="parent-navigation__table-media-mark" />
                                    )}
                                    <p>
                                      {profile?.profile_picture
                                        ? ""
                                        : "No profile picture added"}
                                    </p>
                                  </div>
                                </TableRow>
                              ) : null}
                              {fields.map(([label, key]) => (
                                <TableRow
                                  key={key}
                                  label={label}
                                  value={profile?.[key]}
                                />
                              ))}
                            </tbody>
                          </table>
                        </section>
                      ))}
                    </div>
                  </>
                ) : null}

                {showProfileSettings ? (
                  <div className="parent-navigation__settings-panel">
                    <form
                      className="parent-navigation__form parent-navigation__form--profile parent-navigation__form--table"
                      onSubmit={handleProfileSubmit}
                    >
                      <h2>Edit Profile</h2>

                      {profileGroups.map(([groupTitle, fields]) => (
                        <section
                          className={getProfileGroupClassName(
                            "parent-navigation__profile-edit-card",
                            groupTitle,
                          )}
                          key={groupTitle}
                        >
                          <h3>{groupTitle}</h3>
                          <table className="parent-navigation__table parent-navigation__table--form">
                            <tbody>
                              {groupTitle === "Personal" ? (
                                <TableRow
                                  label="Profile picture"
                                  rowClassName="parent-navigation__table-row--media"
                                >
                                  <div className="parent-navigation__table-media parent-navigation__table-media--edit">
                                    {profile?.profile_picture ? (
                                      <img
                                        src={profile.profile_picture}
                                        alt="Profile"
                                      />
                                    ) : (
                                      <ParrotIcon className="parent-navigation__table-media-mark" />
                                    )}
                                    <div className="parent-navigation__table-media-actions">
                                      <button
                                        className="parent-navigation__profile-picture-icon"
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={isUploadingPicture}
                                        aria-label="Add profile picture"
                                        title={
                                          isUploadingPicture
                                            ? "Uploading..."
                                            : "Add profile picture"
                                        }
                                      >
                                        <ImagePlus size={18} aria-hidden="true" />
                                      </button>
                                      <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        onChange={handlePictureSelect}
                                        hidden
                                      />
                                      <button
                                        className="parent-navigation__profile-picture-icon parent-navigation__profile-remove"
                                        type="button"
                                        onClick={handleRemovePicture}
                                        disabled={
                                          isRemovingPicture || !profile?.profile_picture
                                        }
                                        aria-label="Remove profile picture"
                                        title={
                                          isRemovingPicture
                                            ? "Removing..."
                                            : "Remove profile picture"
                                        }
                                      >
                                        <Trash2 size={18} aria-hidden="true" />
                                      </button>
                                    </div>
                                  </div>
                                </TableRow>
                              ) : null}
                              {fields.map(([label, fieldName]) => (
                                <TableRow
                                  key={fieldName}
                                  label={label}
                                  htmlFor={`profile-${fieldName}`}
                                >
                                  <input
                                    id={`profile-${fieldName}`}
                                    name={fieldName}
                                    type="text"
                                    value={profileForm[fieldName] || ""}
                                    onChange={handleProfileChange}
                                  />
                                </TableRow>
                              ))}
                            </tbody>
                          </table>
                        </section>
                      ))}

                      <div className="parent-navigation__table-actions">
                        <button type="submit" disabled={isUpdatingProfile}>
                          {isUpdatingProfile ? "Saving..." : "Save Profile"}
                        </button>
                      </div>
                    </form>
                  </div>
                ) : null}

                {profileMessage ? (
                  <p className="parent-navigation__message">{profileMessage}</p>
                ) : null}
              </>
            )}
            </div>
          </section>
        </div>
      ) : null}

      {notice ? (
        <div
          className={`parent-navigation__notice parent-navigation__notice--${notice.type}`}
          role="alertdialog"
          aria-modal="true"
          aria-label={
            notice.type === "danger" || notice.type === "warning"
              ? "Error message"
              : "Success message"
          }
        >
          <div>
            <strong>
              {notice.type === "danger" || notice.type === "warning"
                ? "Error"
                : "Success"}
            </strong>
            <p>{notice.text}</p>
          </div>
          <button type="button" onClick={() => setNotice(null)}>
            Close
          </button>
        </div>
      ) : null}
    </main>
  );
}

export default NavigationPage;
