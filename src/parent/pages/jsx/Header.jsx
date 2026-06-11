import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Menu,
  Pencil,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Unlock,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import parrotIcon from "../../../assets/favicon.svg";
import SmartAvatar from "../../../components/SmartAvatar.jsx";
import {
  getMessengerErrorMessage,
  getMessengerUserCryptoDevices,
  refreshMessengerPresenceVisibility,
} from "../../../messenger/api.js";
import {
  getStoredMessengerDeviceIdentity,
  revokeMessengerDevice,
  setDefaultMessengerDevice,
  updateDefaultMessengerDevicePassword,
} from "../../../messenger/e2ee/devices/index.js";
import {
  clearStoredRecoveryKey,
  getStoredRecoveryKey,
  saveRecoveryKeyBackup,
} from "../../../messenger/e2ee/recovery.js";
import {
  blockParentContact,
  changeParentPassword,
  deleteParentAccount,
  ghostParentContact,
  getParentContacts,
  getParentProfile,
  storeParentSession,
  unghostParentContact,
  unblockParentContact,
  updateParentProfile,
} from "../../api.js";
import {
  getContactInitials,
  getContactName,
  getParentApiErrorMessage,
} from "./contactHelpers.js";

const accountInitialForm = {
  username: "",
  email: "",
  current_password: "",
  new_password: "",
  password: "",
};

const DEFAULT_DEVICE_PASSWORD_MIN_LENGTH = 8;

const defaultDevicePasswordInitialForm = {
  password: "",
  confirm_password: "",
};

const defaultDevicePasswordUpdateInitialForm = {
  current_password: "",
  new_password: "",
  confirm_new_password: "",
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

function replaceLoggedInHistoryView(nextView) {
  const currentState = window.history.state || {};
  const currentView = currentState[LOGGED_IN_HISTORY_KEY] || {};

  window.history.replaceState(
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

function clearLoggedInHistoryModal() {
  const currentState = window.history.state || {};
  const currentView = currentState[LOGGED_IN_HISTORY_KEY] || {};
  const nextView = { ...currentView };

  delete nextView.accountTab;
  delete nextView.modal;
  delete nextView.profileTab;

  window.history.replaceState(
    {
      ...currentState,
      [LOGGED_IN_HISTORY_KEY]: nextView,
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

function getEmptyAccountForm() {
  return { ...accountInitialForm };
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

function formatDeviceTime(value) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
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

function getHeaderProfileHydrationKey(user) {
  return (
    user?.id ||
    user?.user_id ||
    user?.account_number ||
    user?.username ||
    ""
  );
}

function Header({
  contacts = [],
  user,
  defaultDevicePromptVersion = 0,
  onContactsChange,
  onDefaultDeviceChanged,
  onContactUpdated,
  onRecoveryKeyRequested,
  onLogout,
  onUserUpdate,
  onToast,
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [isLinkedDevicesModalOpen, setIsLinkedDevicesModalOpen] = useState(false);
  const [isBlockManagementModalOpen, setIsBlockManagementModalOpen] =
    useState(false);
  const [isGhostManagementModalOpen, setIsGhostManagementModalOpen] =
    useState(false);
  const [isDefaultDeviceSelectionRequired, setIsDefaultDeviceSelectionRequired] =
    useState(false);
  const [activeProfileTab, setActiveProfileTab] = useState("view");
  const [activeAccountTab, setActiveAccountTab] = useState("password");
  const [activeLinkedDevicesTab, setActiveLinkedDevicesTab] = useState("devices");
  const [profile, setProfile] = useState(null);
  const [profileForm, setProfileForm] = useState(() => getProfileForm(user));
  const [profilePicturePreviewUrl, setProfilePicturePreviewUrl] = useState("");
  const [accountForm, setAccountForm] = useState(() => getEmptyAccountForm());
  const [blockManagementContacts, setBlockManagementContacts] = useState(
    () => contacts,
  );
  const [blockManagementSearch, setBlockManagementSearch] = useState("");
  const [ghostManagementContacts, setGhostManagementContacts] = useState(
    () => contacts,
  );
  const [ghostManagementSearch, setGhostManagementSearch] = useState("");
  const [recoveryKeyForm, setRecoveryKeyForm] = useState({
    recovery_key: "",
    confirm_recovery_key: "",
  });
  const [defaultDevicePasswordForm, setDefaultDevicePasswordForm] = useState(
    () => ({ ...defaultDevicePasswordInitialForm }),
  );
  const [
    defaultDevicePasswordUpdateForm,
    setDefaultDevicePasswordUpdateForm,
  ] = useState(() => ({ ...defaultDevicePasswordUpdateInitialForm }));
  const [profileMessage, setProfileMessage] = useState(null);
  const [accountMessage, setAccountMessage] = useState(null);
  const [linkedDevicesMessage, setLinkedDevicesMessage] = useState(null);
  const [blockManagementMessage, setBlockManagementMessage] = useState(null);
  const [ghostManagementMessage, setGhostManagementMessage] = useState(null);
  const [recoveryKeyMessage, setRecoveryKeyMessage] = useState(null);
  const [defaultDevicePasswordMessage, setDefaultDevicePasswordMessage] =
    useState(null);
  const [
    defaultDevicePasswordUpdateMessage,
    setDefaultDevicePasswordUpdateMessage,
  ] = useState(null);
  const [storedRecoveryKey, setStoredRecoveryKey] = useState("");
  const [cryptoDevices, setCryptoDevices] = useState([]);
  const [blockActionAccountNumber, setBlockActionAccountNumber] = useState("");
  const [ghostActionAccountNumber, setGhostActionAccountNumber] = useState("");
  const [hasDefaultCryptoDevice, setHasDefaultCryptoDevice] = useState(false);
  const [isDefaultPasswordConfigured, setIsDefaultPasswordConfigured] =
    useState(false);
  const [currentCryptoDeviceId, setCurrentCryptoDeviceId] = useState("");
  const [defaultPasswordTargetDevice, setDefaultPasswordTargetDevice] =
    useState(null);
  const [
    isDefaultPasswordUpdateModalOpen,
    setIsDefaultPasswordUpdateModalOpen,
  ] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [isPasswordChanging, setIsPasswordChanging] = useState(false);
  const [isAccountDeleting, setIsAccountDeleting] = useState(false);
  const [isDevicesLoading, setIsDevicesLoading] = useState(false);
  const [isBlockManagementLoading, setIsBlockManagementLoading] =
    useState(false);
  const [isGhostManagementLoading, setIsGhostManagementLoading] =
    useState(false);
  const [isRecoveryKeySaving, setIsRecoveryKeySaving] = useState(false);
  const [isDefaultDevicePasswordSaving, setIsDefaultDevicePasswordSaving] =
    useState(false);
  const [isDefaultDevicePasswordUpdating, setIsDefaultDevicePasswordUpdating] =
    useState(false);
  const [revokingDeviceId, setRevokingDeviceId] = useState("");
  const [defaultingDeviceId, setDefaultingDeviceId] = useState("");
  const [isStoredRecoveryKeyVisible, setIsStoredRecoveryKeyVisible] =
    useState(false);
  const [isRecoveryKeyVisible, setIsRecoveryKeyVisible] = useState(false);
  const [isConfirmRecoveryKeyVisible, setIsConfirmRecoveryKeyVisible] =
    useState(false);
  const [isDefaultDevicePasswordVisible, setIsDefaultDevicePasswordVisible] =
    useState(false);
  const [
    isConfirmDefaultDevicePasswordVisible,
    setIsConfirmDefaultDevicePasswordVisible,
  ] = useState(false);
  const [
    isCurrentDefaultDevicePasswordVisible,
    setIsCurrentDefaultDevicePasswordVisible,
  ] = useState(false);
  const [
    isNewDefaultDevicePasswordVisible,
    setIsNewDefaultDevicePasswordVisible,
  ] = useState(false);
  const [
    isConfirmNewDefaultDevicePasswordVisible,
    setIsConfirmNewDefaultDevicePasswordVisible,
  ] = useState(false);
  const hydratedProfileUserKeyRef = useRef("");
  const handledDefaultDevicePromptVersionRef = useRef(0);
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
  useEffect(() => {
    const file = profileForm.profile_picture_file;
    if (!file || typeof URL === "undefined") {
      setProfilePicturePreviewUrl("");
      return undefined;
    }

    const previewUrl = URL.createObjectURL(file);
    setProfilePicturePreviewUrl(previewUrl);

    return () => URL.revokeObjectURL(previewUrl);
  }, [profileForm.profile_picture_file]);
  const currentCryptoDevice = cryptoDevices.find(
    (device) => device.device_id === currentCryptoDeviceId,
  );
  const defaultCryptoDevice = cryptoDevices.find((device) => device.is_default);
  const activeCryptoDevices = cryptoDevices.filter(
    (device) => !device.is_default,
  );
  const canManageCryptoDevices = Boolean(currentCryptoDevice?.is_default);
  const canUpdateDefaultDevicePassword =
    canManageCryptoDevices && isDefaultPasswordConfigured;
  const blockManagementQuery = blockManagementSearch.trim().toLowerCase();
  const filteredBlockManagementContacts = useMemo(() => {
    const sourceContacts = Array.isArray(blockManagementContacts)
      ? blockManagementContacts
      : [];

    if (!blockManagementQuery) {
      return sourceContacts;
    }

    return sourceContacts.filter((contact) => {
      const name = getContactName(contact).toLowerCase();
      const account = String(contact.account_number || "").toLowerCase();

      return name.includes(blockManagementQuery) || account.includes(blockManagementQuery);
    });
  }, [blockManagementContacts, blockManagementQuery]);
  const blockedContactsCount = blockManagementContacts.filter(
    (contact) => contact.blocked,
  ).length;
  const unblockedContactsCount =
    blockManagementContacts.length - blockedContactsCount;
  const ghostManagementQuery = ghostManagementSearch.trim().toLowerCase();
  const filteredGhostManagementContacts = useMemo(() => {
    const sourceContacts = Array.isArray(ghostManagementContacts)
      ? ghostManagementContacts
      : [];

    if (!ghostManagementQuery) {
      return sourceContacts;
    }

    return sourceContacts.filter((contact) => {
      const name = getContactName(contact).toLowerCase();
      const account = String(contact.account_number || "").toLowerCase();

      return name.includes(ghostManagementQuery) || account.includes(ghostManagementQuery);
    });
  }, [ghostManagementContacts, ghostManagementQuery]);
  const ghostedContactsCount = ghostManagementContacts.filter(
    (contact) => contact.ghosted,
  ).length;
  const normalGhostContactsCount =
    ghostManagementContacts.length - ghostedContactsCount;

  useEffect(() => {
    const nextContacts = Array.isArray(contacts) ? contacts : [];

    setBlockManagementContacts(nextContacts);
    setGhostManagementContacts(nextContacts);
  }, [contacts]);

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

  useEffect(() => {
    const hydrationKey = getHeaderProfileHydrationKey(user);

    if (!hydrationKey || hydratedProfileUserKeyRef.current === hydrationKey) {
      return undefined;
    }

    hydratedProfileUserKeyRef.current = hydrationKey;
    let isMounted = true;

    getParentProfile()
      .then((response) => {
        if (isMounted) {
          syncProfile(response.data || {});
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [syncProfile, user]);

  const loadCryptoDevices = useCallback(async ({ preserveMessage = false } = {}) => {
    const userId = user?.id || user?.user_id;

    if (!userId) {
      setCryptoDevices([]);
      setHasDefaultCryptoDevice(false);
      setIsDefaultPasswordConfigured(false);
      setLinkedDevicesMessage({
        type: "error",
        text: "Unable to load devices without a user id.",
      });
      return;
    }

    setIsDevicesLoading(true);
    if (!preserveMessage) {
      setLinkedDevicesMessage(null);
    }

    try {
      const [identity, response] = await Promise.all([
        getStoredMessengerDeviceIdentity(user),
        getMessengerUserCryptoDevices(userId),
      ]);
      const result = response.data?.result || response.data;
      const nextDevices = Array.isArray(result?.devices) ? result.devices : [];
      const currentDeviceId = identity?.device_id || "";
      const currentDevices = currentDeviceId
        ? nextDevices.filter((device) => device.device_id === currentDeviceId)
        : [];
      const currentDeviceIsDefault = currentDevices.some(
        (device) => device.is_default,
      );
      const visibleDevices = currentDeviceIsDefault
        ? nextDevices
        : nextDevices.filter(
            (device) =>
              device.is_default || device.device_id === currentDeviceId,
          );

      setCurrentCryptoDeviceId(currentDeviceId);
      setHasDefaultCryptoDevice(
        nextDevices.some((device) => device.is_default),
      );
      setIsDefaultPasswordConfigured(
        Boolean(result?.default_password_configured),
      );
      setCryptoDevices(visibleDevices);
      if (!currentDeviceIsDefault) {
        clearStoredRecoveryKey(user);
        setStoredRecoveryKey("");
        setIsStoredRecoveryKeyVisible(false);
      }
    } catch (error) {
      setLinkedDevicesMessage({
        type: "error",
        text: getMessengerErrorMessage(error, "Unable to load encrypted devices."),
      });
    } finally {
      setIsDevicesLoading(false);
    }
  }, [user]);

  const loadBlockManagementContacts = useCallback(async () => {
    setIsBlockManagementLoading(true);
    setBlockManagementMessage(null);

    try {
      const response = await getParentContacts();
      const nextContacts = Array.isArray(response.data?.contacts)
        ? response.data.contacts
        : [];

      setBlockManagementContacts(nextContacts);
      onContactsChange?.(nextContacts);
    } catch (error) {
      setBlockManagementMessage({
        type: "error",
        text: getParentApiErrorMessage(error, "Unable to load contacts."),
      });
    } finally {
      setIsBlockManagementLoading(false);
    }
  }, [onContactsChange]);

  const loadGhostManagementContacts = useCallback(async () => {
    setIsGhostManagementLoading(true);
    setGhostManagementMessage(null);

    try {
      const response = await getParentContacts();
      const nextContacts = Array.isArray(response.data?.contacts)
        ? response.data.contacts
        : [];

      setGhostManagementContacts(nextContacts);
      onContactsChange?.(nextContacts);
    } catch (error) {
      setGhostManagementMessage({
        type: "error",
        text: getParentApiErrorMessage(error, "Unable to load contacts."),
      });
    } finally {
      setIsGhostManagementLoading(false);
    }
  }, [onContactsChange]);

  const refreshStoredRecoveryKey = useCallback(() => {
    setStoredRecoveryKey(getStoredRecoveryKey(user));
  }, [user]);

  const openProfileModal = () => {
    pushLoggedInHistoryView({ modal: "profile", profileTab: "view" });
    setIsMenuOpen(false);
    setIsBlockManagementModalOpen(false);
    setIsGhostManagementModalOpen(false);
    setActiveProfileTab("view");
    setIsProfileModalOpen(true);
    loadProfile();
  };

  const openAccountModal = () => {
    pushLoggedInHistoryView({ modal: "account", accountTab: "password" });
    setIsMenuOpen(false);
    setIsBlockManagementModalOpen(false);
    setIsGhostManagementModalOpen(false);
    setActiveAccountTab("password");
    setAccountForm(getEmptyAccountForm());
    setAccountMessage(null);
    setIsAccountModalOpen(true);
  };

  const openLinkedDevicesModal = () => {
    pushLoggedInHistoryView({ modal: "linkedDevices" });
    setIsMenuOpen(false);
    setIsBlockManagementModalOpen(false);
    setIsGhostManagementModalOpen(false);
    setIsDefaultDeviceSelectionRequired(false);
    setActiveLinkedDevicesTab("devices");
    setLinkedDevicesMessage(null);
    setRecoveryKeyMessage(null);
    setIsLinkedDevicesModalOpen(true);
    loadCryptoDevices();
  };

  const openBlockManagementModal = () => {
    pushLoggedInHistoryView({ modal: "blockManagement" });
    setIsMenuOpen(false);
    setIsProfileModalOpen(false);
    setIsAccountModalOpen(false);
    setIsLinkedDevicesModalOpen(false);
    setIsGhostManagementModalOpen(false);
    setBlockManagementSearch("");
    setBlockManagementMessage(null);
    setIsBlockManagementModalOpen(true);
    loadBlockManagementContacts();
  };

  const openGhostManagementModal = () => {
    pushLoggedInHistoryView({ modal: "ghostManagement" });
    setIsMenuOpen(false);
    setIsProfileModalOpen(false);
    setIsAccountModalOpen(false);
    setIsLinkedDevicesModalOpen(false);
    setIsBlockManagementModalOpen(false);
    setGhostManagementSearch("");
    setGhostManagementMessage(null);
    setIsGhostManagementModalOpen(true);
    loadGhostManagementContacts();
  };

  useEffect(() => {
    if (
      !defaultDevicePromptVersion ||
      handledDefaultDevicePromptVersionRef.current ===
        defaultDevicePromptVersion
    ) {
      return;
    }

    handledDefaultDevicePromptVersionRef.current = defaultDevicePromptVersion;
    setIsMenuOpen(false);
    setIsBlockManagementModalOpen(false);
    setIsGhostManagementModalOpen(false);
    setIsDefaultDeviceSelectionRequired(true);
    setActiveLinkedDevicesTab("devices");
    setIsLinkedDevicesModalOpen(true);
    setLinkedDevicesMessage({
      type: "error",
      text: "Make this device the default to continue.",
    });
    loadCryptoDevices({ preserveMessage: true });
  }, [defaultDevicePromptVersion, loadCryptoDevices]);

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
    setAccountForm(getEmptyAccountForm());
  }, []);

  const resetLinkedDevicesModal = useCallback(() => {
    setIsLinkedDevicesModalOpen(false);
    setIsDefaultDeviceSelectionRequired(false);
    setActiveLinkedDevicesTab("devices");
    setLinkedDevicesMessage(null);
    setRecoveryKeyMessage(null);
    setStoredRecoveryKey("");
    setIsDevicesLoading(false);
    setIsRecoveryKeySaving(false);
    setRevokingDeviceId("");
    setDefaultingDeviceId("");
    setCryptoDevices([]);
    setHasDefaultCryptoDevice(false);
    setIsDefaultPasswordConfigured(false);
    setDefaultPasswordTargetDevice(null);
    setDefaultDevicePasswordForm({ ...defaultDevicePasswordInitialForm });
    setDefaultDevicePasswordMessage(null);
    setIsDefaultPasswordUpdateModalOpen(false);
    setDefaultDevicePasswordUpdateForm({
      ...defaultDevicePasswordUpdateInitialForm,
    });
    setDefaultDevicePasswordUpdateMessage(null);
    setIsDefaultDevicePasswordSaving(false);
    setIsDefaultDevicePasswordUpdating(false);
    setRecoveryKeyForm({
      recovery_key: "",
      confirm_recovery_key: "",
    });
    setIsStoredRecoveryKeyVisible(false);
    setIsRecoveryKeyVisible(false);
    setIsConfirmRecoveryKeyVisible(false);
    setIsDefaultDevicePasswordVisible(false);
    setIsConfirmDefaultDevicePasswordVisible(false);
    setIsCurrentDefaultDevicePasswordVisible(false);
    setIsNewDefaultDevicePasswordVisible(false);
    setIsConfirmNewDefaultDevicePasswordVisible(false);
  }, []);

  const resetBlockManagementModal = useCallback(() => {
    setIsBlockManagementModalOpen(false);
    setBlockManagementMessage(null);
    setBlockActionAccountNumber("");
    setIsBlockManagementLoading(false);
  }, []);

  const resetGhostManagementModal = useCallback(() => {
    setIsGhostManagementModalOpen(false);
    setGhostManagementMessage(null);
    setGhostActionAccountNumber("");
    setIsGhostManagementLoading(false);
  }, []);

  const closeBlockManagementModal = useCallback(() => {
    if (isCurrentHistoryModal("blockManagement")) {
      clearLoggedInHistoryModal();
    }

    resetBlockManagementModal();
  }, [resetBlockManagementModal]);

  const closeGhostManagementModal = useCallback(() => {
    if (isCurrentHistoryModal("ghostManagement")) {
      clearLoggedInHistoryModal();
    }

    resetGhostManagementModal();
  }, [resetGhostManagementModal]);

  const closeProfileModal = useCallback(() => {
    if (isCurrentHistoryModal("profile")) {
      clearLoggedInHistoryModal();
    }

    resetProfileModal();
  }, [resetProfileModal]);

  const closeAccountModal = useCallback(() => {
    if (isCurrentHistoryModal("account")) {
      clearLoggedInHistoryModal();
    }

    resetAccountModal();
  }, [resetAccountModal]);

  const closeLinkedDevicesModal = useCallback(() => {
    if (isDefaultDeviceSelectionRequired && !hasDefaultCryptoDevice) {
      return;
    }

    if (isCurrentHistoryModal("linkedDevices")) {
      clearLoggedInHistoryModal();
    }

    resetLinkedDevicesModal();
  }, [
    hasDefaultCryptoDevice,
    isDefaultDeviceSelectionRequired,
    resetLinkedDevicesModal,
  ]);

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
    if (!isLinkedDevicesModalOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (
        event.key === "Escape" &&
        !defaultPasswordTargetDevice &&
        !isDefaultPasswordUpdateModalOpen
      ) {
        closeLinkedDevicesModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    closeLinkedDevicesModal,
    defaultPasswordTargetDevice,
    isDefaultPasswordUpdateModalOpen,
    isLinkedDevicesModalOpen,
  ]);

  useEffect(() => {
    if (!isBlockManagementModalOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !blockActionAccountNumber) {
        closeBlockManagementModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    blockActionAccountNumber,
    closeBlockManagementModal,
    isBlockManagementModalOpen,
  ]);

  useEffect(() => {
    if (!isGhostManagementModalOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !ghostActionAccountNumber) {
        closeGhostManagementModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    closeGhostManagementModal,
    ghostActionAccountNumber,
    isGhostManagementModalOpen,
  ]);

  useEffect(() => {
    const handlePopState = (event) => {
      const historyView =
        event.state?.[LOGGED_IN_HISTORY_KEY] || getLoggedInHistoryView();

      if (historyView?.modal === "profile") {
        resetAccountModal();
        resetLinkedDevicesModal();
        resetBlockManagementModal();
        resetGhostManagementModal();
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
        resetLinkedDevicesModal();
        resetBlockManagementModal();
        resetGhostManagementModal();
        setIsAccountModalOpen(true);
        setActiveAccountTab(
          historyView.accountTab === "delete"
            ? historyView.accountTab
            : "password",
        );
        setAccountForm(getEmptyAccountForm());
        setAccountMessage(null);
        return;
      }

      if (historyView?.modal === "linkedDevices") {
        resetProfileModal();
        resetAccountModal();
        resetBlockManagementModal();
        resetGhostManagementModal();
        setIsLinkedDevicesModalOpen(true);
        setActiveLinkedDevicesTab("devices");
        setLinkedDevicesMessage(null);
        setRecoveryKeyMessage(null);
        loadCryptoDevices();
        return;
      }

      if (historyView?.modal === "blockManagement") {
        resetProfileModal();
        resetAccountModal();
        resetLinkedDevicesModal();
        resetGhostManagementModal();
        setIsBlockManagementModalOpen(true);
        setBlockManagementMessage(null);
        loadBlockManagementContacts();
        return;
      }

      if (historyView?.modal === "ghostManagement") {
        resetProfileModal();
        resetAccountModal();
        resetLinkedDevicesModal();
        resetBlockManagementModal();
        setIsGhostManagementModalOpen(true);
        setGhostManagementMessage(null);
        loadGhostManagementContacts();
        return;
      }

      resetProfileModal();
      resetAccountModal();
      resetLinkedDevicesModal();
      resetBlockManagementModal();
      resetGhostManagementModal();
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [
    isProfileModalOpen,
    loadProfile,
    loadCryptoDevices,
    loadBlockManagementContacts,
    loadGhostManagementContacts,
    resetAccountModal,
    resetBlockManagementModal,
    resetGhostManagementModal,
    resetLinkedDevicesModal,
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

  const handleToggleManagedContactBlock = async (contact) => {
    if (!contact?.account_number || blockActionAccountNumber) {
      return;
    }

    const wasBlocked = Boolean(contact.blocked);
    const nextBlocked = !wasBlocked;
    if (nextBlocked && contact.ghosted) {
      const shouldBlock = window.confirm(
        `Blocking ${getContactName(contact)} will remove ghosting for this contact. Continue?`,
      );

      if (!shouldBlock) {
        return;
      }
    }

    setBlockActionAccountNumber(contact.account_number);
    setBlockManagementMessage(null);

    try {
      const payload = {
        account_number: contact.account_number,
      };
      const response = wasBlocked
        ? await unblockParentContact(payload)
        : await blockParentContact(payload);
      const updatedContact = response.data?.contact || {
        ...contact,
        blocked: nextBlocked,
      };

      setBlockManagementContacts((currentContacts) =>
        currentContacts.map((currentContact) =>
          currentContact.account_number === updatedContact.account_number
            ? { ...currentContact, ...updatedContact }
            : currentContact,
        ),
      );
      setGhostManagementContacts((currentContacts) =>
        currentContacts.map((currentContact) =>
          currentContact.account_number === updatedContact.account_number
            ? { ...currentContact, ...updatedContact }
            : currentContact,
        ),
      );
      onContactUpdated?.(updatedContact, contact);
      if (updatedContact?.user_id || contact?.user_id) {
        refreshMessengerPresenceVisibility({
          viewer_user_id: updatedContact?.user_id || contact.user_id,
        }).catch(() => {});
      }
      onToast?.({
        type: nextBlocked ? "error" : "success",
        title: nextBlocked ? "Contact blocked" : "Contact unblocked",
        message: `${getContactName(updatedContact)} is now ${
          nextBlocked ? "blocked" : "unblocked"
        }.`,
      });
    } catch (error) {
      const errorMessage = getParentApiErrorMessage(
        error,
        "Unable to update block state.",
      );

      setBlockManagementMessage({
        type: "error",
        text: errorMessage,
      });
      onToast?.({
        type: "error",
        title: "Block status not updated",
        message: errorMessage,
      });
    } finally {
      setBlockActionAccountNumber("");
    }
  };

  const handleToggleManagedContactGhost = async (contact) => {
    if (!contact?.account_number || ghostActionAccountNumber) {
      return;
    }

    const wasGhosted = Boolean(contact.ghosted);
    const nextGhosted = !wasGhosted;
    if (nextGhosted && contact.blocked) {
      const shouldGhost = window.confirm(
        `Ghosting ${getContactName(contact)} will remove blocking for this contact. Continue?`,
      );

      if (!shouldGhost) {
        return;
      }
    }

    setGhostActionAccountNumber(contact.account_number);
    setGhostManagementMessage(null);

    try {
      const payload = {
        account_number: contact.account_number,
      };
      const response = wasGhosted
        ? await unghostParentContact(payload)
        : await ghostParentContact(payload);
      const updatedContact = response.data?.contact || {
        ...contact,
        ghosted: nextGhosted,
      };

      setGhostManagementContacts((currentContacts) =>
        currentContacts.map((currentContact) =>
          currentContact.account_number === updatedContact.account_number
            ? { ...currentContact, ...updatedContact }
            : currentContact,
        ),
      );
      setBlockManagementContacts((currentContacts) =>
        currentContacts.map((currentContact) =>
          currentContact.account_number === updatedContact.account_number
            ? { ...currentContact, ...updatedContact }
            : currentContact,
        ),
      );
      onContactUpdated?.(updatedContact, contact);
      if (updatedContact?.user_id || contact?.user_id) {
        refreshMessengerPresenceVisibility({
          viewer_user_id: updatedContact?.user_id || contact.user_id,
        }).catch(() => {});
      }
      onToast?.({
        type: "success",
        title: nextGhosted ? "Contact ghosted" : "Ghosting removed",
        message: `${getContactName(updatedContact)} is now ${
          nextGhosted ? "ghosted" : "not ghosted"
        }.`,
      });
    } catch (error) {
      const errorMessage = getParentApiErrorMessage(
        error,
        "Unable to update ghosting.",
      );

      setGhostManagementMessage({
        type: "error",
        text: errorMessage,
      });
      onToast?.({
        type: "error",
        title: "Ghosting not updated",
        message: errorMessage,
      });
    } finally {
      setGhostActionAccountNumber("");
    }
  };

  const handleRecoveryKeyFormChange = (event) => {
    const { name, value } = event.target;

    setRecoveryKeyForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
    setRecoveryKeyMessage(null);
  };

  const handleDefaultDevicePasswordFormChange = (event) => {
    const { name, value } = event.target;

    setDefaultDevicePasswordForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
    setDefaultDevicePasswordMessage(null);
  };

  const handleDefaultDevicePasswordUpdateFormChange = (event) => {
    const { name, value } = event.target;

    setDefaultDevicePasswordUpdateForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
    setDefaultDevicePasswordUpdateMessage(null);
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
      replaceLoggedInHistoryView({ modal: "profile", profileTab: "edit" });
    }

    setActiveProfileTab("edit");
    setProfileForm(getProfileForm(profile || user));
    setProfileMessage(null);
  };

  const openViewProfileTab = () => {
    if (activeProfileTab !== "view") {
      replaceLoggedInHistoryView({ modal: "profile", profileTab: "view" });
    }

    setActiveProfileTab("view");
    setProfileMessage(null);
  };

  const openChangePasswordTab = () => {
    if (activeAccountTab !== "password") {
      replaceLoggedInHistoryView({ modal: "account", accountTab: "password" });
    }

    setActiveAccountTab("password");
    setAccountForm(getEmptyAccountForm());
    setAccountMessage(null);
  };

  const openDeleteAccountTab = () => {
    if (activeAccountTab !== "delete") {
      replaceLoggedInHistoryView({ modal: "account", accountTab: "delete" });
    }

    setActiveAccountTab("delete");
    setAccountForm(getEmptyAccountForm());
    setAccountMessage(null);
  };

  const openLinkedDevicesTab = () => {
    setActiveLinkedDevicesTab("devices");
    setLinkedDevicesMessage(null);
  };

  const openRecoveryKeyTab = () => {
    setActiveLinkedDevicesTab("recovery");
    setRecoveryKeyMessage(null);
    setIsStoredRecoveryKeyVisible(false);
    if (!canManageCryptoDevices) {
      clearStoredRecoveryKey(user);
      setStoredRecoveryKey("");
      return;
    }

    refreshStoredRecoveryKey();
  };

  const handleRecoveryKeyVerificationRequest = () => {
    if (isCurrentHistoryModal("linkedDevices")) {
      clearLoggedInHistoryModal();
    }

    resetLinkedDevicesModal();
    onRecoveryKeyRequested?.();
  };

  const handleRevokeCryptoDevice = async (device) => {
    const deviceId = device?.device_id;
    const isCurrent = deviceId === currentCryptoDeviceId;

    if (
      !deviceId ||
      !currentCryptoDeviceId ||
      (!isCurrent && (device?.is_default || !canManageCryptoDevices))
    ) {
      return;
    }

    setRevokingDeviceId(deviceId);
    setLinkedDevicesMessage(null);

    try {
      if (isCurrent) {
        onLogout?.();
        return;
      }

      await revokeMessengerDevice(user, deviceId);
      setCryptoDevices((currentDevices) =>
        currentDevices.filter(
          (currentDevice) => currentDevice.device_id !== deviceId,
        ),
      );
      onToast?.({
        type: "success",
        title: "Device revoked",
        message: "That device was logged out and cannot receive new encrypted messages.",
      });
    } catch (error) {
      setLinkedDevicesMessage({
        type: "error",
        text: getMessengerErrorMessage(error, "Unable to revoke this device."),
      });
    } finally {
      setRevokingDeviceId("");
    }
  };

  const canMakeCryptoDeviceDefault = (device) => {
    const deviceId = device?.device_id;
    const isCurrent = deviceId === currentCryptoDeviceId;

    if (!deviceId || !currentCryptoDeviceId) {
      return false;
    }

    if (device?.is_default) {
      return isCurrent && canManageCryptoDevices && !isDefaultPasswordConfigured;
    }

    if (!hasDefaultCryptoDevice) {
      return isCurrent;
    }

    if (isCurrent) {
      return true;
    }

    return canManageCryptoDevices;
  };

  const closeDefaultDevicePasswordPrompt = ({ force = false } = {}) => {
    if (isDefaultDevicePasswordSaving && !force) {
      return;
    }

    setDefaultPasswordTargetDevice(null);
    setDefaultDevicePasswordForm({ ...defaultDevicePasswordInitialForm });
    setDefaultDevicePasswordMessage(null);
    setIsDefaultDevicePasswordVisible(false);
    setIsConfirmDefaultDevicePasswordVisible(false);
  };

  const handleSetDefaultCryptoDevice = (device) => {
    if (!canMakeCryptoDeviceDefault(device)) {
      return;
    }

    setDefaultPasswordTargetDevice(device);
    setDefaultDevicePasswordForm({ ...defaultDevicePasswordInitialForm });
    setDefaultDevicePasswordMessage(null);
    setIsDefaultDevicePasswordVisible(false);
    setIsConfirmDefaultDevicePasswordVisible(false);
    setLinkedDevicesMessage(null);
  };

  const handleDefaultDevicePasswordSubmit = async (event) => {
    event.preventDefault();

    const device = defaultPasswordTargetDevice;
    const deviceId = device?.device_id;

    if (!canMakeCryptoDeviceDefault(device)) {
      setDefaultDevicePasswordMessage({
        type: "error",
        text: "This device cannot perform that default-device change.",
      });
      return;
    }

    if (
      defaultDevicePasswordForm.password.length <
      DEFAULT_DEVICE_PASSWORD_MIN_LENGTH
    ) {
      setDefaultDevicePasswordMessage({
        type: "error",
        text: `Default device password must be at least ${DEFAULT_DEVICE_PASSWORD_MIN_LENGTH} characters.`,
      });
      return;
    }

    if (
      isCreatingDefaultDevicePassword &&
      defaultDevicePasswordForm.password !==
        defaultDevicePasswordForm.confirm_password
    ) {
      setDefaultDevicePasswordMessage({
        type: "error",
        text: "Default device passwords do not match.",
      });
      return;
    }

    setDefaultingDeviceId(deviceId);
    setDefaultDevicePasswordMessage(null);
    setIsDefaultDevicePasswordSaving(true);

    try {
      const shouldCloseRequiredPrompt =
        isDefaultDeviceSelectionRequired &&
        deviceId === currentCryptoDeviceId &&
        !hasDefaultCryptoDevice;

      await setDefaultMessengerDevice(user, deviceId, {
        defaultPassword: defaultDevicePasswordForm.password,
      });
      setCryptoDevices((currentDevices) =>
        currentDevices.map((currentDevice) => ({
          ...currentDevice,
          is_default: currentDevice.device_id === deviceId,
        })),
      );
      setHasDefaultCryptoDevice(true);
      setIsDefaultPasswordConfigured(true);
      if (deviceId !== currentCryptoDeviceId) {
        clearStoredRecoveryKey(user);
        setStoredRecoveryKey("");
        setIsStoredRecoveryKeyVisible(false);
      }
      onToast?.({
        type: "success",
        title: "Default device updated",
        message: "Only the selected device can manage linked devices now.",
      });
      setIsDefaultDeviceSelectionRequired(false);
      if (shouldCloseRequiredPrompt) {
        resetLinkedDevicesModal();
      } else {
        closeDefaultDevicePasswordPrompt({ force: true });
      }
      onDefaultDeviceChanged?.({
        ...device,
        is_default: true,
      });
    } catch (error) {
      setDefaultDevicePasswordMessage({
        type: "error",
        text: getMessengerErrorMessage(error, "Unable to update the default device."),
      });
    } finally {
      setDefaultingDeviceId("");
      setIsDefaultDevicePasswordSaving(false);
    }
  };

  const openDefaultDevicePasswordUpdateModal = () => {
    if (!canUpdateDefaultDevicePassword) {
      return;
    }

    setDefaultDevicePasswordUpdateForm({
      ...defaultDevicePasswordUpdateInitialForm,
    });
    setDefaultDevicePasswordUpdateMessage(null);
    setIsCurrentDefaultDevicePasswordVisible(false);
    setIsNewDefaultDevicePasswordVisible(false);
    setIsConfirmNewDefaultDevicePasswordVisible(false);
    setIsDefaultPasswordUpdateModalOpen(true);
  };

  const closeDefaultDevicePasswordUpdateModal = () => {
    if (isDefaultDevicePasswordUpdating) {
      return;
    }

    setIsDefaultPasswordUpdateModalOpen(false);
    setDefaultDevicePasswordUpdateForm({
      ...defaultDevicePasswordUpdateInitialForm,
    });
    setDefaultDevicePasswordUpdateMessage(null);
    setIsCurrentDefaultDevicePasswordVisible(false);
    setIsNewDefaultDevicePasswordVisible(false);
    setIsConfirmNewDefaultDevicePasswordVisible(false);
  };

  const handleDefaultDevicePasswordUpdateSubmit = async (event) => {
    event.preventDefault();

    if (!canUpdateDefaultDevicePassword) {
      setDefaultDevicePasswordUpdateMessage({
        type: "error",
        text: "Only the current default device can update this password.",
      });
      return;
    }

    if (
      defaultDevicePasswordUpdateForm.current_password.length <
        DEFAULT_DEVICE_PASSWORD_MIN_LENGTH ||
      defaultDevicePasswordUpdateForm.new_password.length <
        DEFAULT_DEVICE_PASSWORD_MIN_LENGTH
    ) {
      setDefaultDevicePasswordUpdateMessage({
        type: "error",
        text: `Default device passwords must be at least ${DEFAULT_DEVICE_PASSWORD_MIN_LENGTH} characters.`,
      });
      return;
    }

    if (
      defaultDevicePasswordUpdateForm.new_password !==
      defaultDevicePasswordUpdateForm.confirm_new_password
    ) {
      setDefaultDevicePasswordUpdateMessage({
        type: "error",
        text: "New default device passwords do not match.",
      });
      return;
    }

    if (
      defaultDevicePasswordUpdateForm.current_password ===
      defaultDevicePasswordUpdateForm.new_password
    ) {
      setDefaultDevicePasswordUpdateMessage({
        type: "error",
        text: "New default device password must be different.",
      });
      return;
    }

    setIsDefaultDevicePasswordUpdating(true);
    setDefaultDevicePasswordUpdateMessage(null);

    try {
      await updateDefaultMessengerDevicePassword(user, {
        currentPassword: defaultDevicePasswordUpdateForm.current_password,
        newPassword: defaultDevicePasswordUpdateForm.new_password,
      });
      setDefaultDevicePasswordUpdateForm({
        ...defaultDevicePasswordUpdateInitialForm,
      });
      setIsDefaultPasswordUpdateModalOpen(false);
      onToast?.({
        type: "success",
        title: "Default password updated",
        message: "Use the new password for future default-device changes.",
      });
    } catch (error) {
      setDefaultDevicePasswordUpdateMessage({
        type: "error",
        text: getMessengerErrorMessage(
          error,
          "Unable to update the default device password.",
        ),
      });
    } finally {
      setIsDefaultDevicePasswordUpdating(false);
    }
  };

  const handleRecoveryKeyUpdateSubmit = async (event) => {
    event.preventDefault();

    if (!canManageCryptoDevices) {
      setRecoveryKeyMessage({
        type: "error",
        text: "Only the current default device can update the recovery key.",
      });
      return;
    }

    if (recoveryKeyForm.recovery_key !== recoveryKeyForm.confirm_recovery_key) {
      setRecoveryKeyMessage({
        type: "error",
        text: "Recovery keys do not match.",
      });
      return;
    }

    setIsRecoveryKeySaving(true);
    setRecoveryKeyMessage(null);

    try {
      await saveRecoveryKeyBackup(user, recoveryKeyForm.recovery_key);
      setStoredRecoveryKey(recoveryKeyForm.recovery_key);
      setIsStoredRecoveryKeyVisible(false);
      setRecoveryKeyForm({
        recovery_key: "",
        confirm_recovery_key: "",
      });
      setRecoveryKeyMessage({
        type: "success",
        text: "Recovery key updated.",
      });
      onToast?.({
        type: "success",
        title: "Recovery key updated",
        message: "This key can recover old encrypted messages on another device.",
      });
    } catch (error) {
      setRecoveryKeyMessage({
        type: "error",
        text: error?.message || "Unable to update recovery key.",
      });
    } finally {
      setIsRecoveryKeySaving(false);
    }
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

  const renderCryptoDeviceCard = (device, { isPrimaryDefault = false } = {}) => {
    const isCurrent = device.device_id === currentCryptoDeviceId;
    const isDefault = Boolean(device.is_default);
    const isRevoking = revokingDeviceId === device.device_id;
    const isDefaulting = defaultingDeviceId === device.device_id;
    const isCreatingDefaultPasswordForCurrentDefault =
      isDefault && isCurrent && !isDefaultPasswordConfigured;
    const deviceName =
      device.device_name || (isCurrent ? "This device" : "Linked device");
    const canSetDefault = canMakeCryptoDeviceDefault(device);
    const canRevoke = isCurrent || (canManageCryptoDevices && !isDefault);
    const showDefaultAction = canSetDefault || isDefaulting;
    const showRevokeAction = canRevoke || isRevoking;
    const hasActions = showDefaultAction || showRevokeAction;

    return (
      <article
        className={`parent-layout-page__crypto-device${
          isPrimaryDefault
            ? " parent-layout-page__crypto-device--default"
            : ""
        }`}
        key={device.device_id}
      >
        <div>
          <div className="parent-layout-page__crypto-device-title">
            <strong>{deviceName}</strong>
            {isCurrent ? (
              <span className="parent-layout-page__crypto-device-badge parent-layout-page__crypto-device-badge--current">
                This device
              </span>
            ) : null}
            {isDefault ? (
              <span className="parent-layout-page__crypto-device-badge">
                Default
              </span>
            ) : null}
          </div>
          <small>Last seen {formatDeviceTime(device.last_seen_at)}</small>
        </div>

        {hasActions ? (
          <div className="parent-layout-page__crypto-device-actions">
            {showDefaultAction ? (
              <button
                type="button"
                className="parent-layout-page__crypto-device-default"
                onClick={() => handleSetDefaultCryptoDevice(device)}
                disabled={isDefaulting}
                title={
                  isCreatingDefaultPasswordForCurrentDefault
                    ? "Set default password"
                    : "Make default"
                }
              >
                <ShieldCheck size={15} aria-hidden="true" />
                <span>
                  {isDefaulting
                    ? "Saving"
                    : isCreatingDefaultPasswordForCurrentDefault
                      ? "Set password"
                      : "Make default"}
                </span>
              </button>
            ) : null}

            {showRevokeAction ? (
              <button
                type="button"
                className="parent-layout-page__crypto-device-revoke"
                onClick={() => handleRevokeCryptoDevice(device)}
                disabled={isRevoking}
                title={isCurrent ? "Log out this browser" : "Revoke device"}
              >
                <Trash2 size={15} aria-hidden="true" />
                <span>
                  {isRevoking
                    ? isCurrent
                      ? "Logging out"
                      : "Revoking"
                    : isCurrent
                      ? "Logout"
                      : "Revoke"}
                </span>
              </button>
            ) : null}
          </div>
        ) : null}
      </article>
    );
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
                    <SmartAvatar
                      className="parent-layout-page__profile-picture"
                      src={profilePicture}
                      firstName={displayProfile?.first_name}
                      lastName={displayProfile?.last_name}
                      username={username}
                      fallback="P"
                    />
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
                  <div className="parent-layout-page__profile-picture-preview">
                    <SmartAvatar
                      className="parent-layout-page__profile-picture"
                      src={profilePicturePreviewUrl || profilePicture}
                      firstName={profileForm.first_name || displayProfile?.first_name}
                      lastName={profileForm.last_name || displayProfile?.last_name}
                      username={username}
                      fallback="P"
                    />
                    <small>
                      {profilePicturePreviewUrl
                        ? "Selected image preview"
                        : "Profile picture preview"}
                    </small>
                  </div>
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

  const isDefaultPasswordTargetAlreadyDefault = Boolean(
    defaultPasswordTargetDevice?.is_default,
  );
  const isCreatingDefaultDevicePassword =
    !isDefaultPasswordConfigured &&
    (!hasDefaultCryptoDevice || canManageCryptoDevices);
  const defaultPasswordTargetName =
    defaultPasswordTargetDevice?.device_name ||
    (defaultPasswordTargetDevice?.device_id === currentCryptoDeviceId
      ? "This device"
      : "Linked device");
  const defaultDevicePasswordModal = defaultPasswordTargetDevice ? (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal"
        aria-modal="true"
        aria-labelledby="parent-default-device-password-title"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close"
          type="button"
          onClick={closeDefaultDevicePasswordPrompt}
          aria-label="Close default device password"
          title="Close"
          disabled={isDefaultDevicePasswordSaving}
        >
          <X size={28} strokeWidth={3} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header">
          <img src={parrotIcon} alt="" aria-hidden="true" />
          <div>
            <h2 id="parent-default-device-password-title">
              {isCreatingDefaultDevicePassword
                ? "Create default password"
                : "Verify default password"}
            </h2>
          </div>
        </div>

        <form
          className="parent-layout-page__profile-form"
          onSubmit={handleDefaultDevicePasswordSubmit}
        >
          <p className="parent-layout-page__form-note">
            {isCreatingDefaultDevicePassword
              ? "Create this password before making the first default device. You will use it later to move default permission to another trusted browser."
              : `Enter the default-device password to make ${defaultPasswordTargetName} the default.`}
          </p>

          {defaultDevicePasswordMessage ? (
            <p
              className={`parent-layout-page__form-message parent-layout-page__form-message--${defaultDevicePasswordMessage.type}`}
              role="alert"
            >
              {defaultDevicePasswordMessage.type === "success" ? (
                <CheckCircle2 size={18} aria-hidden="true" />
              ) : (
                <AlertCircle size={18} aria-hidden="true" />
              )}
              <span>{defaultDevicePasswordMessage.text}</span>
            </p>
          ) : null}

          <label className="parent-layout-page__profile-field">
            <span className="parent-layout-page__field-label">
              Default device password
              <em className="is-required">Required</em>
            </span>
            <div className="parent-layout-page__table-input-action">
              <input
                name="password"
                type={isDefaultDevicePasswordVisible ? "text" : "password"}
                value={defaultDevicePasswordForm.password}
                onChange={handleDefaultDevicePasswordFormChange}
                autoComplete={
                  isCreatingDefaultDevicePassword ? "new-password" : "current-password"
                }
                minLength={DEFAULT_DEVICE_PASSWORD_MIN_LENGTH}
                disabled={isDefaultDevicePasswordSaving}
                required
              />
              <button
                className="parent-layout-page__table-icon-button"
                type="button"
                onClick={() =>
                  setIsDefaultDevicePasswordVisible(
                    (currentValue) => !currentValue,
                  )
                }
                disabled={isDefaultDevicePasswordSaving}
                aria-label={
                  isDefaultDevicePasswordVisible
                    ? "Hide default device password"
                    : "Show default device password"
                }
                title={
                  isDefaultDevicePasswordVisible
                    ? "Hide default device password"
                    : "Show default device password"
                }
              >
                {isDefaultDevicePasswordVisible ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>
          </label>

          {isCreatingDefaultDevicePassword ? (
            <label className="parent-layout-page__profile-field">
              <span className="parent-layout-page__field-label">
                Confirm password
                <em className="is-required">Required</em>
              </span>
              <div className="parent-layout-page__table-input-action">
                <input
                  name="confirm_password"
                  type={
                    isConfirmDefaultDevicePasswordVisible ? "text" : "password"
                  }
                  value={defaultDevicePasswordForm.confirm_password}
                  onChange={handleDefaultDevicePasswordFormChange}
                  autoComplete="new-password"
                  minLength={DEFAULT_DEVICE_PASSWORD_MIN_LENGTH}
                  disabled={isDefaultDevicePasswordSaving}
                  required
                />
                <button
                  className="parent-layout-page__table-icon-button"
                  type="button"
                  onClick={() =>
                    setIsConfirmDefaultDevicePasswordVisible(
                      (currentValue) => !currentValue,
                    )
                  }
                  disabled={isDefaultDevicePasswordSaving}
                  aria-label={
                    isConfirmDefaultDevicePasswordVisible
                      ? "Hide confirmation password"
                      : "Show confirmation password"
                  }
                  title={
                    isConfirmDefaultDevicePasswordVisible
                      ? "Hide confirmation password"
                      : "Show confirmation password"
                  }
                >
                  {isConfirmDefaultDevicePasswordVisible ? (
                    <EyeOff size={18} aria-hidden="true" />
                  ) : (
                    <Eye size={18} aria-hidden="true" />
                  )}
                </button>
              </div>
            </label>
          ) : null}

          <button
            className="parent-layout-page__modal-submit"
            type="submit"
            disabled={isDefaultDevicePasswordSaving}
          >
            <ShieldCheck size={18} aria-hidden="true" />
            <span>
              {isDefaultDevicePasswordSaving
                ? "Saving..."
                : isCreatingDefaultDevicePassword
                  ? isDefaultPasswordTargetAlreadyDefault
                    ? "Create password"
                    : "Create and make default"
                  : "Verify and make default"}
            </span>
          </button>
        </form>
      </section>
    </div>
  ) : null;

  const defaultDevicePasswordUpdateModal = isDefaultPasswordUpdateModalOpen ? (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal"
        aria-modal="true"
        aria-labelledby="parent-default-device-password-update-title"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close"
          type="button"
          onClick={closeDefaultDevicePasswordUpdateModal}
          aria-label="Close default password update"
          title="Close"
          disabled={isDefaultDevicePasswordUpdating}
        >
          <X size={28} strokeWidth={3} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header">
          <img src={parrotIcon} alt="" aria-hidden="true" />
          <div>
            <h2 id="parent-default-device-password-update-title">
              Update default password
            </h2>
          </div>
        </div>

        <form
          className="parent-layout-page__profile-form"
          onSubmit={handleDefaultDevicePasswordUpdateSubmit}
        >
          <p className="parent-layout-page__form-note">
            This password controls future default-device changes. Only the
            current default device can update it.
          </p>

          {defaultDevicePasswordUpdateMessage ? (
            <p
              className={`parent-layout-page__form-message parent-layout-page__form-message--${defaultDevicePasswordUpdateMessage.type}`}
              role="alert"
            >
              {defaultDevicePasswordUpdateMessage.type === "success" ? (
                <CheckCircle2 size={18} aria-hidden="true" />
              ) : (
                <AlertCircle size={18} aria-hidden="true" />
              )}
              <span>{defaultDevicePasswordUpdateMessage.text}</span>
            </p>
          ) : null}

          <label className="parent-layout-page__profile-field">
            <span className="parent-layout-page__field-label">
              Current password
              <em className="is-required">Required</em>
            </span>
            <div className="parent-layout-page__table-input-action">
              <input
                name="current_password"
                type={isCurrentDefaultDevicePasswordVisible ? "text" : "password"}
                value={defaultDevicePasswordUpdateForm.current_password}
                onChange={handleDefaultDevicePasswordUpdateFormChange}
                autoComplete="current-password"
                minLength={DEFAULT_DEVICE_PASSWORD_MIN_LENGTH}
                disabled={isDefaultDevicePasswordUpdating}
                required
              />
              <button
                className="parent-layout-page__table-icon-button"
                type="button"
                onClick={() =>
                  setIsCurrentDefaultDevicePasswordVisible(
                    (currentValue) => !currentValue,
                  )
                }
                disabled={isDefaultDevicePasswordUpdating}
                aria-label={
                  isCurrentDefaultDevicePasswordVisible
                    ? "Hide current password"
                    : "Show current password"
                }
                title={
                  isCurrentDefaultDevicePasswordVisible
                    ? "Hide current password"
                    : "Show current password"
                }
              >
                {isCurrentDefaultDevicePasswordVisible ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>
          </label>

          <label className="parent-layout-page__profile-field">
            <span className="parent-layout-page__field-label">
              New password
              <em className="is-required">Required</em>
            </span>
            <div className="parent-layout-page__table-input-action">
              <input
                name="new_password"
                type={isNewDefaultDevicePasswordVisible ? "text" : "password"}
                value={defaultDevicePasswordUpdateForm.new_password}
                onChange={handleDefaultDevicePasswordUpdateFormChange}
                autoComplete="new-password"
                minLength={DEFAULT_DEVICE_PASSWORD_MIN_LENGTH}
                disabled={isDefaultDevicePasswordUpdating}
                required
              />
              <button
                className="parent-layout-page__table-icon-button"
                type="button"
                onClick={() =>
                  setIsNewDefaultDevicePasswordVisible(
                    (currentValue) => !currentValue,
                  )
                }
                disabled={isDefaultDevicePasswordUpdating}
                aria-label={
                  isNewDefaultDevicePasswordVisible
                    ? "Hide new password"
                    : "Show new password"
                }
                title={
                  isNewDefaultDevicePasswordVisible
                    ? "Hide new password"
                    : "Show new password"
                }
              >
                {isNewDefaultDevicePasswordVisible ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>
          </label>

          <label className="parent-layout-page__profile-field">
            <span className="parent-layout-page__field-label">
              Confirm new password
              <em className="is-required">Required</em>
            </span>
            <div className="parent-layout-page__table-input-action">
              <input
                name="confirm_new_password"
                type={
                  isConfirmNewDefaultDevicePasswordVisible ? "text" : "password"
                }
                value={defaultDevicePasswordUpdateForm.confirm_new_password}
                onChange={handleDefaultDevicePasswordUpdateFormChange}
                autoComplete="new-password"
                minLength={DEFAULT_DEVICE_PASSWORD_MIN_LENGTH}
                disabled={isDefaultDevicePasswordUpdating}
                required
              />
              <button
                className="parent-layout-page__table-icon-button"
                type="button"
                onClick={() =>
                  setIsConfirmNewDefaultDevicePasswordVisible(
                    (currentValue) => !currentValue,
                  )
                }
                disabled={isDefaultDevicePasswordUpdating}
                aria-label={
                  isConfirmNewDefaultDevicePasswordVisible
                    ? "Hide confirmation password"
                    : "Show confirmation password"
                }
                title={
                  isConfirmNewDefaultDevicePasswordVisible
                    ? "Hide confirmation password"
                    : "Show confirmation password"
                }
              >
                {isConfirmNewDefaultDevicePasswordVisible ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>
          </label>

          <button
            className="parent-layout-page__modal-submit"
            type="submit"
            disabled={isDefaultDevicePasswordUpdating}
          >
            <KeyRound size={18} aria-hidden="true" />
            <span>
              {isDefaultDevicePasswordUpdating ? "Updating..." : "Update password"}
            </span>
          </button>
        </form>
      </section>
    </div>
  ) : null;

  const blockManagementModal = isBlockManagementModalOpen ? (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal parent-layout-page__modal--account parent-layout-page__block-management-modal"
        aria-modal="true"
        aria-labelledby="parent-block-management-title"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close"
          type="button"
          onClick={closeBlockManagementModal}
          aria-label="Close block management"
          title="Close"
          disabled={Boolean(blockActionAccountNumber)}
        >
          <X size={28} strokeWidth={3} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header">
          <span
            className="parent-layout-page__block-management-icon"
            aria-hidden="true"
          >
            <Ban size={24} />
          </span>
          <div>
            <h2 id="parent-block-management-title">Block Management</h2>
          </div>
        </div>

        <div className="parent-layout-page__block-management">
          <div className="parent-layout-page__block-management-summary">
            <span>
              <strong>{blockedContactsCount}</strong>
              <small>Blocked</small>
            </span>
            <span>
              <strong>{unblockedContactsCount}</strong>
              <small>Block</small>
            </span>
          </div>

          <label className="parent-layout-page__block-management-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={blockManagementSearch}
              onChange={(event) => setBlockManagementSearch(event.target.value)}
              placeholder="Search contacts"
              aria-label="Search contacts"
            />
          </label>

          {blockManagementMessage ? (
            <p
              className={
                blockManagementMessage.type === "error"
                  ? "parent-layout-page__modal-error"
                  : "parent-layout-page__form-note"
              }
              role={blockManagementMessage.type === "error" ? "alert" : "status"}
            >
              {blockManagementMessage.text}
            </p>
          ) : null}

          {isBlockManagementLoading && blockManagementContacts.length === 0 ? (
            <div
              className="parent-layout-page__block-management-empty"
              aria-live="polite"
            >
              Loading contacts
            </div>
          ) : blockManagementContacts.length === 0 ? (
            <div className="parent-layout-page__block-management-empty">
              No contacts yet.
            </div>
          ) : filteredBlockManagementContacts.length === 0 ? (
            <div className="parent-layout-page__block-management-empty">
              No matching contacts.
            </div>
          ) : (
            <div className="parent-layout-page__block-management-list">
              {filteredBlockManagementContacts.map((contact) => {
                const isBlocked = Boolean(contact.blocked);
                const isUpdating =
                  blockActionAccountNumber === contact.account_number;

                return (
                  <div
                    className={`parent-layout-page__block-management-row${
                      isBlocked ? " is-blocked" : ""
                    }`}
                    key={contact.account_number}
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

                    <span
                      className={`parent-layout-page__block-management-status${
                        isBlocked ? " is-blocked" : ""
                      }`}
                    >
                      {isBlocked ? "Blocked" : "Block"}
                    </span>

                    <button
                      className={`parent-layout-page__block-management-action${
                        isBlocked ? " is-unblock" : " is-block"
                      }`}
                      type="button"
                      onClick={() => handleToggleManagedContactBlock(contact)}
                      disabled={Boolean(blockActionAccountNumber)}
                    >
                      {isBlocked ? (
                        <Unlock size={15} aria-hidden="true" />
                      ) : (
                        <Ban size={15} aria-hidden="true" />
                      )}
                      <span>
                        {isUpdating
                          ? "Updating"
                          : isBlocked
                          ? "Unblock"
                          : "Block"}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  ) : null;

  const ghostManagementModal = isGhostManagementModalOpen ? (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal parent-layout-page__modal--account parent-layout-page__block-management-modal parent-layout-page__ghost-management-modal"
        aria-modal="true"
        aria-labelledby="parent-ghost-management-title"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close"
          type="button"
          onClick={closeGhostManagementModal}
          aria-label="Close ghost management"
          title="Close"
          disabled={Boolean(ghostActionAccountNumber)}
        >
          <X size={28} strokeWidth={3} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header">
          <span
            className="parent-layout-page__block-management-icon parent-layout-page__ghost-management-icon"
            aria-hidden="true"
          >
            <EyeOff size={24} />
          </span>
          <div>
            <h2 id="parent-ghost-management-title">Ghost Management</h2>
          </div>
        </div>

        <div className="parent-layout-page__block-management">
          <div className="parent-layout-page__block-management-summary">
            <span>
              <strong>{ghostedContactsCount}</strong>
              <small>Ghosted</small>
            </span>
            <span>
              <strong>{normalGhostContactsCount}</strong>
              <small>Ghost</small>
            </span>
          </div>

          <label className="parent-layout-page__block-management-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={ghostManagementSearch}
              onChange={(event) => setGhostManagementSearch(event.target.value)}
              placeholder="Search contacts"
              aria-label="Search contacts"
            />
          </label>

          {ghostManagementMessage ? (
            <p
              className={
                ghostManagementMessage.type === "error"
                  ? "parent-layout-page__modal-error"
                  : "parent-layout-page__form-note"
              }
              role={ghostManagementMessage.type === "error" ? "alert" : "status"}
            >
              {ghostManagementMessage.text}
            </p>
          ) : null}

          {isGhostManagementLoading && ghostManagementContacts.length === 0 ? (
            <div
              className="parent-layout-page__block-management-empty"
              aria-live="polite"
            >
              Loading contacts
            </div>
          ) : ghostManagementContacts.length === 0 ? (
            <div className="parent-layout-page__block-management-empty">
              No contacts yet.
            </div>
          ) : filteredGhostManagementContacts.length === 0 ? (
            <div className="parent-layout-page__block-management-empty">
              No matching contacts.
            </div>
          ) : (
            <div className="parent-layout-page__block-management-list">
              {filteredGhostManagementContacts.map((contact) => {
                const isGhosted = Boolean(contact.ghosted);
                const isBlocked = Boolean(contact.blocked);
                const isUpdating =
                  ghostActionAccountNumber === contact.account_number;

                return (
                  <div
                    className={`parent-layout-page__block-management-row${
                      isGhosted ? " is-ghosted" : ""
                    }`}
                    key={contact.account_number}
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

                    <span
                      className={`parent-layout-page__block-management-status${
                        isGhosted ? " is-ghosted" : ""
                      }`}
                    >
                      {isGhosted ? "Ghosted" : "Ghost"}
                    </span>

                    <button
                      className={`parent-layout-page__block-management-action${
                        isGhosted ? " is-unblock" : " is-ghost"
                      }`}
                      type="button"
                      onClick={() => handleToggleManagedContactGhost(contact)}
                      disabled={Boolean(ghostActionAccountNumber)}
                    >
                      {isGhosted ? (
                        <Eye size={15} aria-hidden="true" />
                      ) : (
                        <EyeOff size={15} aria-hidden="true" />
                      )}
                      <span>
                        {isUpdating
                          ? "Updating"
                          : isGhosted
                          ? "Remove"
                          : "Ghost"}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  ) : null;

  const linkedDevicesModal = isLinkedDevicesModalOpen ? (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal parent-layout-page__modal--account"
        aria-modal="true"
        aria-labelledby="parent-linked-devices-title"
        role="dialog"
      >
        {isDefaultDeviceSelectionRequired && !hasDefaultCryptoDevice ? null : (
          <button
            className="parent-layout-page__modal-close"
            type="button"
            onClick={closeLinkedDevicesModal}
            aria-label="Close linked devices"
            title="Close"
          >
            <X size={28} strokeWidth={3} aria-hidden="true" />
          </button>
        )}

        <div className="parent-layout-page__modal-header">
          <img src={parrotIcon} alt="" aria-hidden="true" />
          <div>
            <h2 id="parent-linked-devices-title">Linked devices</h2>
          </div>
        </div>

        <nav
          className="parent-layout-page__profile-tabs"
          aria-label="Linked device tabs"
          role="tablist"
        >
          <button
            className={activeLinkedDevicesTab === "devices" ? "is-active" : ""}
            type="button"
            onClick={openLinkedDevicesTab}
            role="tab"
            aria-controls="parent-linked-devices-list"
            aria-selected={activeLinkedDevicesTab === "devices"}
          >
            <ShieldCheck size={16} aria-hidden="true" />
            <span>Devices</span>
          </button>
          <button
            className={activeLinkedDevicesTab === "recovery" ? "is-active" : ""}
            type="button"
            onClick={openRecoveryKeyTab}
            role="tab"
            aria-controls="parent-linked-devices-recovery"
            aria-selected={activeLinkedDevicesTab === "recovery"}
          >
            <KeyRound size={16} aria-hidden="true" />
            <span>Recovery key</span>
          </button>
        </nav>

        <div className="parent-layout-page__profile-content">
          {activeLinkedDevicesTab === "devices" && linkedDevicesMessage ? (
            <p
              className={`parent-layout-page__form-message parent-layout-page__form-message--${linkedDevicesMessage.type}`}
              role="alert"
            >
              {linkedDevicesMessage.type === "success" ? (
                <CheckCircle2 size={18} aria-hidden="true" />
              ) : (
                <AlertCircle size={18} aria-hidden="true" />
              )}
              <span>{linkedDevicesMessage.text}</span>
            </p>
          ) : null}

          {activeLinkedDevicesTab === "devices" ? (
            <section
              className="parent-layout-page__crypto-devices"
              id="parent-linked-devices-list"
              role="tabpanel"
            >
              <div className="parent-layout-page__form-note">
                <strong>Why this matters:</strong> The default browser can see
                active linked devices. A non-default browser shows itself and
                the current default browser.
                <ul>
                  <li>Choose only your own trusted device as default.</li>
                  <li>Making a device default requires the default-device password.</li>
                  <li>A non-default browser can make itself default with that password.</li>
                  <li>The default browser stays remembered after logout.</li>
                  <li>Do not make a public or borrowed browser default.</li>
                </ul>
              </div>

              {isDevicesLoading ? (
                <div className="parent-layout-page__crypto-device-loading">
                  Loading devices...
                </div>
              ) : cryptoDevices.length === 0 ? (
                <div className="parent-layout-page__crypto-device-empty">
                  No encrypted devices registered.
                </div>
              ) : (
                <div className="parent-layout-page__crypto-device-list">
                  <section className="parent-layout-page__crypto-device-section">
                    <div className="parent-layout-page__crypto-device-section-header">
                      <div>
                        <h3>Default device</h3>
                        <p>Controls recovery key and device permissions.</p>
                      </div>
                      <ShieldCheck size={18} aria-hidden="true" />
                    </div>

                    {defaultCryptoDevice ? (
                      renderCryptoDeviceCard(defaultCryptoDevice, {
                        isPrimaryDefault: true,
                      })
                    ) : (
                      <div className="parent-layout-page__crypto-device-empty parent-layout-page__crypto-device-empty--section">
                        No default device selected.
                      </div>
                    )}
                  </section>

                  <section className="parent-layout-page__crypto-device-section">
                    <div className="parent-layout-page__crypto-device-section-header">
                      <div>
                        <h3>Active devices</h3>
                        <p>
                          {canManageCryptoDevices
                            ? "Other browsers currently linked to this account."
                            : "This browser is linked but does not manage recovery."}
                        </p>
                      </div>
                      <span>{activeCryptoDevices.length}</span>
                    </div>

                    {activeCryptoDevices.length > 0 ? (
                      activeCryptoDevices.map((device) =>
                        renderCryptoDeviceCard(device),
                      )
                    ) : (
                      <div className="parent-layout-page__crypto-device-empty parent-layout-page__crypto-device-empty--section">
                        No other active devices.
                      </div>
                    )}
                  </section>
                </div>
              )}

              {canUpdateDefaultDevicePassword ? (
                <button
                  type="button"
                  className="parent-layout-page__modal-submit parent-layout-page__modal-submit--secondary"
                  onClick={openDefaultDevicePasswordUpdateModal}
                  disabled={isDefaultDevicePasswordUpdating}
                >
                  <KeyRound size={18} aria-hidden="true" />
                  <span>Update default password</span>
                </button>
              ) : null}

              <button
                type="button"
                className="parent-layout-page__modal-submit parent-layout-page__modal-submit--secondary"
                onClick={() => loadCryptoDevices()}
                disabled={isDevicesLoading}
              >
                <span>
                  {isDevicesLoading ? "Refreshing" : "Refresh devices"}
                </span>
              </button>
            </section>
          ) : null}

          {activeLinkedDevicesTab === "recovery" ? (
            <form
              className="parent-layout-page__profile-form"
              id="parent-linked-devices-recovery"
              role="tabpanel"
              onSubmit={handleRecoveryKeyUpdateSubmit}
            >
              <div className="parent-layout-page__form-note">
                <strong>Why this matters:</strong> This key helps you get old
                messages back on another device. Parrot cannot show it again
                unless this device saved it.
                <ul>
                  <li>Save it somewhere safe before clearing browser data.</li>
                  <li>Change it if someone else may know it.</li>
                  <li>Do not share it or type it on a device you do not trust.</li>
                </ul>
              </div>

              {!canManageCryptoDevices ? (
                <p className="parent-layout-page__account-danger">
                  Only the current default device can view or change the
                  recovery key. This device can confirm the current key without
                  saving it.
                </p>
              ) : null}

              {canManageCryptoDevices ? (
                <label className="parent-layout-page__profile-field">
                  <span className="parent-layout-page__field-label">
                    Current recovery key
                    <em>{storedRecoveryKey ? "Saved" : "Not saved"}</em>
                  </span>
                  <div className="parent-layout-page__table-input-action">
                    <input
                      type={
                        storedRecoveryKey
                          ? isStoredRecoveryKeyVisible
                            ? "text"
                            : "password"
                          : "text"
                      }
                      value={storedRecoveryKey || "Not saved on this device"}
                      readOnly
                    />
                    <button
                      className="parent-layout-page__table-icon-button"
                      type="button"
                      onClick={() =>
                        setIsStoredRecoveryKeyVisible(
                          (currentValue) => !currentValue,
                        )
                      }
                      disabled={!storedRecoveryKey}
                      aria-label={
                        isStoredRecoveryKeyVisible
                          ? "Hide current recovery key"
                          : "Show current recovery key"
                      }
                      title={
                        isStoredRecoveryKeyVisible
                          ? "Hide current recovery key"
                          : "Show current recovery key"
                      }
                    >
                      {isStoredRecoveryKeyVisible ? (
                        <EyeOff size={18} aria-hidden="true" />
                      ) : (
                        <Eye size={18} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </label>
              ) : null}

              {canManageCryptoDevices && !storedRecoveryKey ? (
                <p className="parent-layout-page__form-note">
                  This device can only show a key that was made, changed, or
                  used here. If you cannot see it, set a new key and save it.
                </p>
              ) : null}

              {recoveryKeyMessage ? (
                <p
                  className={`parent-layout-page__form-message parent-layout-page__form-message--${recoveryKeyMessage.type}`}
                  role="alert"
                >
                  {recoveryKeyMessage.type === "success" ? (
                    <CheckCircle2 size={18} aria-hidden="true" />
                  ) : (
                    <AlertCircle size={18} aria-hidden="true" />
                  )}
                  <span>{recoveryKeyMessage.text}</span>
                </p>
              ) : null}

              {!canManageCryptoDevices ? (
                <button
                  className="parent-layout-page__modal-submit"
                  type="button"
                  onClick={handleRecoveryKeyVerificationRequest}
                >
                  <KeyRound size={18} aria-hidden="true" />
                  <span>Enter recovery key</span>
                </button>
              ) : (
                <>
                  <label className="parent-layout-page__profile-field">
                    <span className="parent-layout-page__field-label">
                      New recovery key
                      <em className="is-required">Required</em>
                    </span>
                    <div className="parent-layout-page__table-input-action">
                      <input
                        name="recovery_key"
                        type={isRecoveryKeyVisible ? "text" : "password"}
                        value={recoveryKeyForm.recovery_key}
                        onChange={handleRecoveryKeyFormChange}
                        autoComplete="new-password"
                        minLength={12}
                        disabled={isRecoveryKeySaving}
                        required
                      />
                      <button
                        className="parent-layout-page__table-icon-button"
                        type="button"
                        onClick={() =>
                          setIsRecoveryKeyVisible((currentValue) => !currentValue)
                        }
                        disabled={isRecoveryKeySaving}
                        aria-label={
                          isRecoveryKeyVisible ? "Hide recovery key" : "Show recovery key"
                        }
                        title={
                          isRecoveryKeyVisible ? "Hide recovery key" : "Show recovery key"
                        }
                      >
                        {isRecoveryKeyVisible ? (
                          <EyeOff size={18} aria-hidden="true" />
                        ) : (
                          <Eye size={18} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </label>

                  <label className="parent-layout-page__profile-field">
                    <span className="parent-layout-page__field-label">
                      Confirm new recovery key
                      <em className="is-required">Required</em>
                    </span>
                    <div className="parent-layout-page__table-input-action">
                      <input
                        name="confirm_recovery_key"
                        type={isConfirmRecoveryKeyVisible ? "text" : "password"}
                        value={recoveryKeyForm.confirm_recovery_key}
                        onChange={handleRecoveryKeyFormChange}
                        autoComplete="new-password"
                        minLength={12}
                        disabled={isRecoveryKeySaving}
                        required
                      />
                      <button
                        className="parent-layout-page__table-icon-button"
                        type="button"
                        onClick={() =>
                          setIsConfirmRecoveryKeyVisible(
                            (currentValue) => !currentValue,
                          )
                        }
                        disabled={isRecoveryKeySaving}
                        aria-label={
                          isConfirmRecoveryKeyVisible
                            ? "Hide confirmation recovery key"
                            : "Show confirmation recovery key"
                        }
                        title={
                          isConfirmRecoveryKeyVisible
                            ? "Hide confirmation recovery key"
                            : "Show confirmation recovery key"
                        }
                      >
                        {isConfirmRecoveryKeyVisible ? (
                          <EyeOff size={18} aria-hidden="true" />
                        ) : (
                          <Eye size={18} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </label>

                  <button
                    className="parent-layout-page__modal-submit"
                    type="submit"
                    disabled={isRecoveryKeySaving}
                  >
                    <KeyRound size={18} aria-hidden="true" />
                    <span>
                      {isRecoveryKeySaving ? "Updating..." : "Update recovery key"}
                    </span>
                  </button>
                </>
              )}
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
            <SmartAvatar
              className="parent-header__avatar"
              src={profilePicture}
              firstName={displayProfile?.first_name}
              lastName={displayProfile?.last_name}
              username={username}
              fallback="P"
            />
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

            <button
              className="parent-header__account-button"
              type="button"
              onClick={openBlockManagementModal}
              role="menuitem"
            >
              <Ban size={16} aria-hidden="true" />
              <span>Block Management</span>
            </button>

            <button
              className="parent-header__account-button"
              type="button"
              onClick={openGhostManagementModal}
              role="menuitem"
            >
              <EyeOff size={16} aria-hidden="true" />
              <span>Ghost Management</span>
            </button>

            <button
              className="parent-header__account-button"
              type="button"
              onClick={openLinkedDevicesModal}
              role="menuitem"
            >
              <ShieldCheck size={16} aria-hidden="true" />
              <span>Linked devices</span>
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
      {blockManagementModal
        ? createPortal(blockManagementModal, document.body)
        : null}
      {ghostManagementModal
        ? createPortal(ghostManagementModal, document.body)
        : null}
      {linkedDevicesModal ? createPortal(linkedDevicesModal, document.body) : null}
      {defaultDevicePasswordModal
        ? createPortal(defaultDevicePasswordModal, document.body)
        : null}
      {defaultDevicePasswordUpdateModal
        ? createPortal(defaultDevicePasswordUpdateModal, document.body)
        : null}
    </div>
  );
}

export default Header;
