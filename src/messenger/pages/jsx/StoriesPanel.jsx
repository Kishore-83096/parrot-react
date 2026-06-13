import {
  AlertCircle,
  Clock3,
  Eye,
  Image as ImageIcon,
  Images,
  LoaderCircle,
  MoreVertical,
  Plus,
  Save,
  Scissors,
  Send,
  Settings2,
  Smile,
  Trash2,
  Type,
  UploadCloud,
  UsersRound,
  Volume2,
  VolumeX,
  X,
} from "@/components/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import SmartAvatar, {
  IMAGE_CLOUD_ERROR_MESSAGE,
} from "../../../components/SmartAvatar.jsx";
import {
  createMessengerClientMessageId,
  createMessengerStory,
  deleteMessengerStory,
  getMessengerErrorMessage,
  getMessengerMyStories,
  getMessengerStoryFeed,
  getMessengerStorySettings,
  getMessengerStoryViewers,
  MESSENGER_INBOX_EVENT_NAME,
  markMessengerStoryViewed,
  reactToMessengerStory,
  replyToMessengerStory,
  updateMessengerStorySettings,
} from "../../api.js";
import { decryptMessageForUser, encryptMessageText } from "../../e2ee/messages.js";
import {
  createStoryClientId,
  createStoryTextPayload,
  decryptStoryMediaBlob,
  encryptSelectedFilesForStory,
  getStoryMediaCaption,
  isSupportedStoryMediaFile,
  mergeStoryMediaCrypto,
  parseStoryTextPayload,
} from "../../e2ee/stories.js";
import { trimStoryVideoFile } from "../../media/videoTrim.js";
import { getParentContacts } from "../../../parent/api.js";
import {
  getContactInitials,
  getContactName,
  getInitials,
} from "../../../parent/pages/jsx/contactHelpers.js";
import { getReactionConfig, MESSAGE_REACTIONS } from "../../reactions.js";

const EXPIRY_OPTIONS = [24, 12, 6];
const IMAGE_STORY_DURATION_MS = 6000;
const MIN_STORY_VIDEO_TRIM_SECONDS = 0.5;
const STORY_HOLD_SUPPRESS_TAP_MS = 250;
const STORY_VIDEO_TRIM_EPSILON_SECONDS = 0.05;
const TEXT_STORY_MAX_LENGTH = 700;
const DEFAULT_STORY_SETTINGS = {
  audience_account_numbers: [],
  expiry_hours: 24,
  visibility: "all_contacts",
};
const VIEWED_STORY_CACHE_PREFIX = "parrot:messenger:viewed-stories";
const TEXT_STORY_THEMES = [
  {
    key: "lavender",
    label: "Lavender",
    background: "linear-gradient(135deg, #7a35f5 0%, #3f8cff 52%, #ff68d1 100%)",
    color: "#ffffff",
  },
  {
    key: "blue",
    label: "Blue",
    background: "linear-gradient(135deg, #2656f6 0%, #47c2ff 100%)",
    color: "#ffffff",
  },
  {
    key: "pink",
    label: "Pink",
    background: "linear-gradient(135deg, #ff68d1 0%, #ff8fbe 45%, #8f68ff 100%)",
    color: "#ffffff",
  },
  {
    key: "white",
    label: "Sunset",
    background: "linear-gradient(135deg, #ff6b6b 0%, #f06595 48%, #845ef7 100%)",
    color: "#ffffff",
  },
];

function getResult(response) {
  return response?.data?.result || response?.data || {};
}

function normalizeStorySettings(value) {
  const settings = value && typeof value === "object" ? value : {};
  const expiryHours = EXPIRY_OPTIONS.includes(Number(settings.expiry_hours))
    ? Number(settings.expiry_hours)
    : DEFAULT_STORY_SETTINGS.expiry_hours;
  const visibility =
    settings.visibility === "specific_contacts"
      ? "specific_contacts"
      : DEFAULT_STORY_SETTINGS.visibility;
  const audienceAccountNumbers = Array.isArray(settings.audience_account_numbers)
    ? settings.audience_account_numbers
        .map((accountNumber) => String(accountNumber || "").trim())
        .filter(Boolean)
    : [];

  return {
    audience_account_numbers:
      visibility === "specific_contacts" ? audienceAccountNumbers : [],
    expiry_hours: expiryHours,
    visibility,
  };
}

function getTextStoryTheme(themeKey) {
  return (
    TEXT_STORY_THEMES.find((theme) => theme.key === themeKey) ||
    TEXT_STORY_THEMES[0]
  );
}

function getStoryText(story) {
  if (story?.story_type !== "text") {
    return null;
  }

  return parseStoryTextPayload(story.encrypted_payload);
}

function getViewedStoryCacheKey(user) {
  const userKey = user?.id || user?.user_id || user?.account_number || "anonymous";
  return `${VIEWED_STORY_CACHE_PREFIX}:${userKey}`;
}

function readViewedStoryCache(user) {
  if (typeof localStorage === "undefined") {
    return {};
  }

  try {
    const parsed = JSON.parse(localStorage.getItem(getViewedStoryCacheKey(user)) || "{}");
    const now = Date.now();
    const nextCache = {};

    Object.entries(parsed || {}).forEach(([storyId, expiresAt]) => {
      const expiresAtMs = new Date(expiresAt).getTime();
      if (storyId && expiresAtMs > now) {
        nextCache[storyId] = expiresAt;
      }
    });

    if (Object.keys(nextCache).length !== Object.keys(parsed || {}).length) {
      localStorage.setItem(getViewedStoryCacheKey(user), JSON.stringify(nextCache));
    }

    return nextCache;
  } catch {
    return {};
  }
}

function writeViewedStoryCache(user, cache) {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(getViewedStoryCacheKey(user), JSON.stringify(cache));
  } catch {
    // Cache writes are best-effort only.
  }
}

function cacheViewedStory(user, story) {
  if (!story?.id || !story?.expires_at) {
    return;
  }

  writeViewedStoryCache(user, {
    ...readViewedStoryCache(user),
    [String(story.id)]: story.expires_at,
  });
}

function applyViewedStoryCache(groups, user) {
  const viewedCache = readViewedStoryCache(user);

  return groups.map((group) => {
    const stories = group.stories.map((story) => ({
      ...story,
      viewed: Boolean(story.viewed || viewedCache[String(story.id)]),
    }));

    return {
      ...group,
      stories,
      unviewed_count: stories.filter((story) => !story.viewed).length,
    };
  });
}

function formatStoryTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function formatExpiry(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) {
    return "Expired";
  }

  const minutes = Math.ceil(diffMs / 60000);
  if (minutes < 60) {
    return `${minutes}m left`;
  }

  return `${Math.ceil(minutes / 60)}h left`;
}

function formatVideoTrimTime(value) {
  const totalSeconds = Math.max(Number(value) || 0, 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(1).padStart(4, "0");

  return `${minutes}:${seconds}`;
}

function isStoryVideoTrimmed(videoTrim) {
  return Boolean(
    videoTrim &&
      (videoTrim.startSeconds > STORY_VIDEO_TRIM_EPSILON_SECONDS ||
        videoTrim.endSeconds <
          videoTrim.duration - STORY_VIDEO_TRIM_EPSILON_SECONDS),
  );
}

function getContactByAccount(contacts, accountNumber) {
  const normalizedAccount = String(accountNumber || "");

  return (
    contacts.find(
      (contact) => String(contact.account_number || "") === normalizedAccount,
    ) || null
  );
}

function getStoryContactName({ accountNumber, contacts, fallbackContact }) {
  const contact = fallbackContact || getContactByAccount(contacts, accountNumber);

  return contact ? getContactName(contact) : accountNumber || "Contact";
}

function getStoryContactInitials({ accountNumber, contacts, fallbackContact }) {
  const contact = fallbackContact || getContactByAccount(contacts, accountNumber);

  return contact ? getContactInitials(contact) : getInitials(accountNumber || "ST");
}

function getStoryFirstMedia(story) {
  const media = mergeStoryMediaCrypto(story);
  return media[0] || null;
}

function sortStoriesNewestFirst(stories) {
  return [...stories].sort((leftStory, rightStory) => {
    const leftCreatedAt = new Date(leftStory?.created_at || "").getTime();
    const rightCreatedAt = new Date(rightStory?.created_at || "").getTime();
    const createdAtDifference =
      (Number.isNaN(rightCreatedAt) ? 0 : rightCreatedAt) -
      (Number.isNaN(leftCreatedAt) ? 0 : leftCreatedAt);

    return (
      createdAtDifference ||
      String(rightStory?.id || "").localeCompare(String(leftStory?.id || ""))
    );
  });
}

function normalizeStoryGroup(group) {
  const stories = Array.isArray(group?.stories)
    ? sortStoriesNewestFirst(group.stories)
    : [];

  return {
    ...group,
    stories,
  };
}

function StoryAvatar({ accountNumber, contacts, contact, hasRing = false }) {
  const savedContact = getContactByAccount(contacts, accountNumber);
  const displayContact =
    (contact || savedContact)
      ? {
          ...(savedContact || {}),
          ...(contact || {}),
          profile_picture:
            contact?.profile_picture || savedContact?.profile_picture || "",
        }
      : null;

  return (
    <SmartAvatar
      className={`parent-layout-page__story-avatar${hasRing ? " has-ring" : ""}`}
      src={displayContact?.profile_picture}
      initials={getStoryContactInitials({
        accountNumber,
        contacts,
        fallbackContact: displayContact,
      })}
      firstName={displayContact?.first_name}
      lastName={displayContact?.last_name}
      name={displayContact?.alias_name || displayContact?.username}
      username={displayContact?.username}
      fallback="P"
    />
  );
}

function StoryMediaImage({ src }) {
  const [imageStatus, setImageStatus] = useState(src ? "loading" : "error");

  useEffect(() => {
    setImageStatus(src ? "loading" : "error");
  }, [src]);

  if (imageStatus === "error") {
    return (
      <div className="parent-layout-page__story-stage-message">
        <ImageIcon size={28} aria-hidden="true" />
        <span>{IMAGE_CLOUD_ERROR_MESSAGE}</span>
      </div>
    );
  }

  return (
    <img
      className={imageStatus === "ready" ? undefined : "parent-layout-page__image-loading"}
      src={src}
      alt=""
      onLoad={() => setImageStatus("ready")}
      onError={() => setImageStatus("error")}
    />
  );
}

export function useStoriesController({
  contacts,
  enabled = true,
  onContactsChange,
  onRoomMessage,
  onToast,
  user,
}) {
  const [feedGroups, setFeedGroups] = useState([]);
  const [myStories, setMyStories] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [hasSavedStorySettings, setHasSavedStorySettings] = useState(false);
  const [isStorySettingsModalOpen, setIsStorySettingsModalOpen] = useState(false);
  const [storySettings, setStorySettings] = useState(DEFAULT_STORY_SETTINGS);
  const [viewerState, setViewerState] = useState(null);
  const [viewersModal, setViewersModal] = useState(null);

  const loadStorySettings = useCallback(async () => {
    try {
      const response = await getMessengerStorySettings();
      const result = getResult(response);
      const settings = normalizeStorySettings(result.settings);

      setHasSavedStorySettings(Boolean(result.has_saved_settings));
      setStorySettings(settings);

      return settings;
    } catch (error) {
      setMessage(getMessengerErrorMessage(error, "Unable to load story settings."));
      return null;
    }
  }, []);

  const loadStories = useCallback(async ({ force = false } = {}) => {
    if (!enabled && !force) {
      return null;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const [feedResponse, myStoriesResponse] = await Promise.all([
        getMessengerStoryFeed(),
        getMessengerMyStories(),
      ]);
      const feedResult = getResult(feedResponse);
      const myStoriesResult = getResult(myStoriesResponse);
      const nextFeedGroups = Array.isArray(feedResult.contacts)
        ? applyViewedStoryCache(feedResult.contacts.map(normalizeStoryGroup), user)
        : [];
      const nextMyStories = Array.isArray(myStoriesResult.stories)
        ? sortStoriesNewestFirst(myStoriesResult.stories)
        : [];

      setFeedGroups(nextFeedGroups);
      setMyStories(nextMyStories);

      return {
        feedGroups: nextFeedGroups,
        myStories: nextMyStories,
      };
    } catch (error) {
      setMessage(getMessengerErrorMessage(error, "Unable to load stories."));
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [enabled, user]);

  useEffect(() => {
    if (enabled) {
      loadStories();
      loadStorySettings();
    }
  }, [enabled, loadStories, loadStorySettings]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const handleInboxEvent = (event) => {
      const eventType = event.detail?.type;

      if (
        eventType === "story.created" ||
        eventType === "story.deleted" ||
        eventType === "story.viewed"
      ) {
        loadStories();
      }
    };

    globalThis.addEventListener(MESSENGER_INBOX_EVENT_NAME, handleInboxEvent);

    return () => {
      globalThis.removeEventListener(
        MESSENGER_INBOX_EVENT_NAME,
        handleInboxEvent,
      );
    };
  }, [enabled, loadStories]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const openComposer = () => setIsComposerOpen(true);

    globalThis.addEventListener("parrot:open-story-composer", openComposer);

    return () => {
      globalThis.removeEventListener("parrot:open-story-composer", openComposer);
    };
  }, [enabled]);

  const recentGroups = useMemo(
    () => feedGroups.filter((group) => Number(group.unviewed_count || 0) > 0),
    [feedGroups],
  );
  const viewedGroups = useMemo(
    () => feedGroups.filter((group) => Number(group.unviewed_count || 0) <= 0),
    [feedGroups],
  );

  const openComposer = useCallback(() => {
    setIsComposerOpen(true);
  }, []);

  const closeComposer = useCallback(() => {
    setIsComposerOpen(false);
  }, []);

  const handleStorySettingsSaved = useCallback(
    (nextSettings, { showToast = false } = {}) => {
      setHasSavedStorySettings(true);
      setStorySettings(normalizeStorySettings(nextSettings));

      if (showToast) {
        onToast?.({
          type: "success",
          title: "Story settings updated",
          message: "New stories will use your updated expiry and audience.",
        });
      }
    },
    [onToast],
  );

  const openStorySettingsModal = useCallback(() => {
    setIsStorySettingsModalOpen(true);
  }, []);

  const closeStorySettingsModal = useCallback(() => {
    setIsStorySettingsModalOpen(false);
  }, []);

  const handleStoryCreated = useCallback(() => {
    setIsComposerOpen(false);
    loadStories();
    onToast?.({
      type: "success",
      title: "Story uploaded",
      message: "Your story is now visible to the selected audience.",
    });
  }, [loadStories, onToast]);

  const closeViewer = useCallback(() => {
    setViewerState(null);
    loadStories();
  }, [loadStories]);

  const openMyStories = useCallback(() => {
    if (myStories.length === 0) {
      setIsComposerOpen(true);
      return;
    }

    setViewerState({
      contact: {
        account_number: user?.account_number,
        alias_name: "My Stories",
      },
      contactName: "My Stories",
      isMine: true,
      stories: myStories,
      storyIndex: 0,
    });
  }, [myStories, user?.account_number]);

  const openGroup = useCallback((group, storyIndex = 0) => {
    setViewerState({
      contact: group.contact,
      contactName: getStoryContactName({
        accountNumber: group.account_number,
        contacts,
        fallbackContact: group.contact,
      }),
      isMine: false,
      stories: group.stories,
      storyIndex,
    });
  }, [contacts]);

  const openStoryReference = useCallback(
    async (context) => {
      const storyId = String(context?.story_id || "");

      if (!storyId) {
        return;
      }

      const storySnapshot = await loadStories({ force: true });
      const availableMyStories = storySnapshot?.myStories || [];
      const availableFeedGroups = storySnapshot?.feedGroups || [];
      const myStoryIndex = availableMyStories.findIndex(
        (story) => String(story.id) === storyId,
      );

      if (myStoryIndex >= 0) {
        setViewerState({
          contact: {
            account_number: user?.account_number,
            alias_name: "My Stories",
          },
          contactName: "My Stories",
          isMine: true,
          stories: availableMyStories,
          storyIndex: myStoryIndex,
        });
        return;
      }

      for (const group of availableFeedGroups) {
        const storyIndex = group.stories.findIndex(
          (story) => String(story.id) === storyId,
        );

        if (storyIndex < 0) {
          continue;
        }

        setViewerState({
          contact: group.contact,
          contactName: getStoryContactName({
            accountNumber: group.account_number,
            contacts,
            fallbackContact: group.contact,
          }),
          isMine: false,
          stories: group.stories,
          storyIndex,
        });
        return;
      }

      onToast?.({
        type: "error",
        title: "Story unavailable",
        message: "This story may have expired or is no longer visible.",
      });
    },
    [contacts, loadStories, onToast, user?.account_number],
  );

  const handleStoryViewed = useCallback((storyId) => {
    setFeedGroups((currentGroups) =>
      currentGroups.map((group) => {
        const stories = group.stories.map((story) =>
          String(story.id) === String(storyId) ? { ...story, viewed: true } : story,
        );
        const unviewedCount = stories.filter((story) => !story.viewed).length;
        const viewedStory = stories.find((story) => String(story.id) === String(storyId));
        if (viewedStory) {
          cacheViewedStory(user, viewedStory);
        }

        return {
          ...group,
          stories,
          unviewed_count: unviewedCount,
        };
      }),
    );
  }, [user]);

  const handleStoryDeleted = useCallback(
    (storyId) => {
      const normalizedStoryId = String(storyId || "");

      setMyStories((currentStories) =>
        currentStories.filter(
          (currentStory) => String(currentStory.id) !== normalizedStoryId,
        ),
      );
      setViewerState((currentState) => {
        if (!currentState?.isMine) {
          return currentState;
        }

        const nextStories = currentState.stories.filter(
          (currentStory) => String(currentStory.id) !== normalizedStoryId,
        );
        if (nextStories.length === 0) {
          return null;
        }

        return {
          ...currentState,
          stories: nextStories,
          storyIndex: Math.min(currentState.storyIndex, nextStories.length - 1),
        };
      });
      loadStories();
      onToast?.({
        type: "success",
        title: "Story deleted",
        message: "Your story has been removed.",
      });
    },
    [loadStories, onToast],
  );

  const openViewersModal = useCallback(async (story) => {
    setViewersModal({
      isLoading: true,
      message: "",
      story,
      viewers: [],
    });

    try {
      const response = await getMessengerStoryViewers(story.id);
      const result = getResult(response);

      setViewersModal({
        isLoading: false,
        message: "",
        story,
        viewCount: result.view_count || 0,
        viewers: Array.isArray(result.viewers) ? result.viewers : [],
      });
    } catch (error) {
      setViewersModal({
        isLoading: false,
        message: getMessengerErrorMessage(error, "Unable to load viewers."),
        story,
        viewers: [],
      });
    }
  }, []);

  return {
    closeComposer,
    closeStorySettingsModal,
    closeViewer,
    feedGroups,
    handleStorySettingsSaved,
    handleStoryCreated,
    handleStoryDeleted,
    handleStoryViewed,
    hasSavedStorySettings,
    isComposerOpen,
    isLoading,
    isStorySettingsModalOpen,
    loadStories,
    message,
    myStories,
    onContactsChange,
    onRoomMessage,
    openComposer,
    openGroup,
    openMyStories,
    openStorySettingsModal,
    openStoryReference,
    openViewersModal,
    recentGroups,
    setViewerState,
    setViewersModal,
    storySettings,
    viewedGroups,
    viewerState,
    viewersModal,
  };
}

function StoriesPanel({
  contacts,
  onContactsChange,
  onRoomMessage,
  onToast,
  user,
}) {
  const controller = useStoriesController({
    contacts,
    onContactsChange,
    onRoomMessage,
    onToast,
    user,
  });

  return (
    <StoriesRoomPanel
      contacts={contacts}
      controller={controller}
      user={user}
    />
  );
}

export function StoriesListPanel({ contacts, controller, user }) {
  return (
    <>
      <section className="parent-layout-page__stories-list-panel" aria-label="Stories">
        <div className="parent-layout-page__stories-toolbar">
          <div>
            <h2>Stories</h2>
          </div>
          {controller.hasSavedStorySettings ? (
            <div className="parent-layout-page__stories-toolbar-actions">
              <div className="parent-layout-page__story-settings-menu">
                <button
                  type="button"
                  onClick={controller.openStorySettingsModal}
                  aria-label="Story settings"
                  title="Story settings"
                >
                  <MoreVertical size={20} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {controller.message ? (
          <p className="parent-layout-page__stories-message" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{controller.message}</span>
          </p>
        ) : null}

        <div className="parent-layout-page__stories-content">
          <section className="parent-layout-page__stories-band">
            <button
              className="parent-layout-page__story-row parent-layout-page__story-row--mine"
              type="button"
              onClick={controller.openMyStories}
            >
              <span className="parent-layout-page__story-avatar-wrap">
                <StoryAvatar
                  accountNumber={user?.account_number}
                  contacts={contacts}
                  contact={user}
                  hasRing={controller.myStories.length > 0}
                />
                <span className="parent-layout-page__story-add-badge">
                  <Plus size={13} aria-hidden="true" />
                </span>
              </span>
              <span className="parent-layout-page__story-row-main">
                <strong>My Stories</strong>
                <small>
                  {controller.myStories.length
                    ? "Open your stories"
                    : "Tap to create a story"}
                </small>
              </span>
              <Images size={20} aria-hidden="true" />
            </button>
          </section>

          <StoryGroupList
            contacts={contacts}
            emptyLabel={controller.isLoading ? "Loading stories..." : "No recent stories."}
            groups={controller.recentGroups}
            onOpenGroup={controller.openGroup}
            title="Recent Stories"
          />

          <StoryGroupList
            contacts={contacts}
            emptyLabel="No seen stories."
            groups={controller.viewedGroups}
            onOpenGroup={controller.openGroup}
            title="Seen Stories"
          />
      </div>
    </section>
    </>
  );
}

export function StoriesOverlayHost({ contacts, controller, user }) {
  return (
    <>
      {controller.isComposerOpen ? (
        <StoryComposer
          contacts={contacts}
          initialHasSavedSettings={controller.hasSavedStorySettings}
          initialSettings={controller.storySettings}
          onClose={controller.closeComposer}
          onContactsChange={controller.onContactsChange}
          onCreated={controller.handleStoryCreated}
          onSettingsSaved={controller.handleStorySettingsSaved}
        />
      ) : null}

      {controller.isStorySettingsModalOpen ? (
        <StorySettingsModal
          contacts={contacts}
          initialSettings={controller.storySettings}
          onClose={controller.closeStorySettingsModal}
          onContactsChange={controller.onContactsChange}
          onSaved={(settings) => {
            controller.handleStorySettingsSaved(settings, { showToast: true });
            controller.closeStorySettingsModal();
          }}
        />
      ) : null}

      {controller.viewerState ? (
        <StoryViewer
          contacts={contacts}
          currentUser={user}
          onAddStory={controller.openComposer}
          onClose={controller.closeViewer}
          onRoomMessage={controller.onRoomMessage}
          onStoryDeleted={controller.handleStoryDeleted}
          onStoryViewed={controller.handleStoryViewed}
          onViewers={controller.openViewersModal}
          viewerState={controller.viewerState}
          setViewerState={controller.setViewerState}
        />
      ) : null}

      {controller.viewersModal ? (
        <StoryViewersModal
          contacts={contacts}
          modal={controller.viewersModal}
          onClose={() => controller.setViewersModal(null)}
        />
      ) : null}
    </>
  );
}

export function StoriesRoomPanel({ contacts, controller, user }) {
  return (
    <section className="parent-layout-page__stories-room" aria-label="Story viewer">
      {controller.viewerState ? (
        <StoryViewer
          contacts={contacts}
          currentUser={user}
          inline
          onAddStory={controller.openComposer}
          onClose={controller.closeViewer}
          onRoomMessage={controller.onRoomMessage}
          onStoryDeleted={controller.handleStoryDeleted}
          onStoryViewed={controller.handleStoryViewed}
          onViewers={controller.openViewersModal}
          viewerState={controller.viewerState}
          setViewerState={controller.setViewerState}
        />
      ) : (
        <div className="parent-layout-page__stories-room-empty">
          <span className="parent-layout-page__stories-side-icon" aria-hidden="true">
            <Images size={28} />
          </span>
          <div>
            <h2>Stories</h2>
            <p>Select a story from the list or add a new photo/video story.</p>
          </div>
          <div className="parent-layout-page__stories-room-empty-actions">
            <button type="button" onClick={controller.openComposer}>
              <Plus size={18} aria-hidden="true" />
              <span>Add Story</span>
            </button>
            {controller.myStories.length ? (
              <button type="button" onClick={controller.openMyStories}>
                <Eye size={18} aria-hidden="true" />
                <span>My Stories</span>
              </button>
            ) : null}
          </div>
        </div>
      )}

      {controller.isComposerOpen ? (
        <StoryComposer
          contacts={contacts}
          initialHasSavedSettings={controller.hasSavedStorySettings}
          initialSettings={controller.storySettings}
          onClose={controller.closeComposer}
          onContactsChange={controller.onContactsChange}
          onCreated={controller.handleStoryCreated}
          onSettingsSaved={controller.handleStorySettingsSaved}
        />
      ) : null}

      {controller.isStorySettingsModalOpen ? (
        <StorySettingsModal
          contacts={contacts}
          initialSettings={controller.storySettings}
          onClose={controller.closeStorySettingsModal}
          onContactsChange={controller.onContactsChange}
          onSaved={(settings) => {
            controller.handleStorySettingsSaved(settings, { showToast: true });
            controller.closeStorySettingsModal();
          }}
        />
      ) : null}

      {controller.viewersModal ? (
        <StoryViewersModal
          contacts={contacts}
          modal={controller.viewersModal}
          onClose={() => controller.setViewersModal(null)}
        />
      ) : null}
    </section>
  );
}
function StoryGroupList({ contacts, emptyLabel, groups, onOpenGroup, title }) {
  return (
    <section className="parent-layout-page__stories-band">
      <div className="parent-layout-page__stories-section-title">
        <strong>{title}</strong>
        <span>{groups.length}</span>
      </div>

      {groups.length === 0 ? (
        <p className="parent-layout-page__stories-empty">{emptyLabel}</p>
      ) : (
        <div className="parent-layout-page__story-list">
          {groups.map((group) => {
            const firstStory = group.stories[0];
            const accountNumber = group.account_number;
            const name = getStoryContactName({
              accountNumber,
              contacts,
              fallbackContact: group.contact,
            });

            return (
              <button
                className="parent-layout-page__story-row"
                type="button"
                key={accountNumber || group.user_id || firstStory?.id}
                onClick={() => onOpenGroup(group)}
              >
                <StoryAvatar
                  accountNumber={accountNumber}
                  contacts={contacts}
                  contact={group.contact}
                  hasRing={Number(group.unviewed_count || 0) > 0}
                />
                <span className="parent-layout-page__story-row-main">
                  <strong>{name}</strong>
                  <small>
                    {group.stories.length} stor{group.stories.length === 1 ? "y" : "ies"} -{" "}
                    {formatStoryTime(group.latest_story_at || firstStory?.created_at)}
                  </small>
                </span>
                {Number(group.unviewed_count || 0) > 0 ? (
                  <span className="parent-layout-page__story-unread">
                    {group.unviewed_count}
                  </span>
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StoryAudiencePickerModal({
  contacts,
  onApply,
  onClose,
  selectedAudience,
}) {
  const [contactSearch, setContactSearch] = useState("");
  const [draftAudience, setDraftAudience] = useState(selectedAudience);
  const availableContacts = useMemo(
    () => contacts.filter((contact) => !contact.blocked),
    [contacts],
  );
  const filteredContacts = useMemo(() => {
    const query = contactSearch.trim().toLowerCase();

    if (!query) {
      return availableContacts;
    }

    return availableContacts.filter((contact) => {
      const name = getContactName(contact).toLowerCase();
      const account = String(contact.account_number || "").toLowerCase();
      return name.includes(query) || account.includes(query);
    });
  }, [availableContacts, contactSearch]);

  const toggleAudience = (accountNumber) => {
    setDraftAudience((currentAudience) =>
      currentAudience.includes(accountNumber)
        ? currentAudience.filter((item) => item !== accountNumber)
        : [...currentAudience, accountNumber],
    );
  };

  const modal = (
    <div
      className="parent-layout-page__modal-backdrop parent-layout-page__story-modal-backdrop parent-layout-page__story-audience-backdrop"
      role="presentation"
    >
      <section
        className="parent-layout-page__modal parent-layout-page__modal--story parent-layout-page__story-audience-modal"
        aria-modal="true"
        aria-labelledby="parent-story-audience-title"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close parent-layout-page__story-modal-close"
          type="button"
          onClick={onClose}
          aria-label="Close contact selection"
          title="Close"
        >
          <X size={24} aria-hidden="true" />
        </button>
        <header className="parent-layout-page__modal-header parent-layout-page__story-modal-header">
          <div>
            <h2 id="parent-story-audience-title">Specific contacts</h2>
            <p>{draftAudience.length} selected</p>
          </div>
          <UsersRound size={24} aria-hidden="true" />
        </header>

        <div className="parent-layout-page__story-contact-picker">
          <input
            type="search"
            value={contactSearch}
            onChange={(event) => setContactSearch(event.target.value)}
            placeholder="Search contacts"
            aria-label="Search contacts"
          />
          <div>
            {filteredContacts.length === 0 ? (
              <p>No contacts available.</p>
            ) : (
              filteredContacts.map((contact) => (
                <label key={contact.account_number}>
                  <input
                    type="checkbox"
                    checked={draftAudience.includes(contact.account_number)}
                    onChange={() => toggleAudience(contact.account_number)}
                  />
                  <StoryAvatar
                    accountNumber={contact.account_number}
                    contacts={contacts}
                    contact={contact}
                  />
                  <span>{getContactName(contact)}</span>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="parent-layout-page__story-actions is-upload-only">
          <button
            className="parent-layout-page__story-submit"
            type="button"
            onClick={() => onApply(draftAudience)}
            disabled={draftAudience.length === 0}
          >
            <UsersRound size={18} aria-hidden="true" />
            <span>Use selected contacts</span>
          </button>
        </div>
      </section>
    </div>
  );

  return createPortal(modal, document.body);
}

function StorySettingsFields({
  contacts,
  disabled,
  expiryHours,
  onExpiryHoursChange,
  onSelectedAudienceChange,
  onVisibilityChange,
  selectedAudience,
  visibility,
}) {
  const [isAudiencePickerOpen, setIsAudiencePickerOpen] = useState(false);

  return (
    <>
      <fieldset
        className="parent-layout-page__story-fieldset"
        disabled={disabled}
      >
        <legend>Expiry</legend>
        <div className="parent-layout-page__story-segments">
          {EXPIRY_OPTIONS.map((hours) => (
            <button
              className={expiryHours === hours ? "is-active" : ""}
              type="button"
              key={hours}
              onClick={() => onExpiryHoursChange(hours)}
            >
              {hours}h
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset
        className="parent-layout-page__story-fieldset"
        disabled={disabled}
      >
        <legend>Audience</legend>
        <div className="parent-layout-page__story-segments parent-layout-page__story-segments--audience">
          <button
            className={visibility === "all_contacts" ? "is-active" : ""}
            type="button"
            onClick={() => onVisibilityChange("all_contacts")}
          >
            All contacts
          </button>
          <button
            className={visibility === "specific_contacts" ? "is-active" : ""}
            type="button"
            onClick={() => setIsAudiencePickerOpen(true)}
          >
            Specific contacts
          </button>
        </div>
      </fieldset>

      {visibility === "specific_contacts" ? (
        <button
          className="parent-layout-page__story-specific-contacts"
          type="button"
          onClick={() => setIsAudiencePickerOpen(true)}
          disabled={disabled}
        >
          <UsersRound size={18} aria-hidden="true" />
          <span>
            {selectedAudience.length
              ? `${selectedAudience.length} selected - Change contacts`
              : "Choose contacts"}
          </span>
        </button>
      ) : null}

      {isAudiencePickerOpen ? (
        <StoryAudiencePickerModal
          contacts={contacts}
          selectedAudience={selectedAudience}
          onApply={(nextAudience) => {
            onSelectedAudienceChange(nextAudience);
            onVisibilityChange("specific_contacts");
            setIsAudiencePickerOpen(false);
          }}
          onClose={() => setIsAudiencePickerOpen(false)}
        />
      ) : null}
    </>
  );
}

function StorySettingsModal({
  contacts,
  initialSettings,
  onClose,
  onContactsChange,
  onSaved,
}) {
  const normalizedInitialSettings = normalizeStorySettings(initialSettings);
  const [expiryHours, setExpiryHours] = useState(
    normalizedInitialSettings.expiry_hours,
  );
  const [visibility, setVisibility] = useState(
    normalizedInitialSettings.visibility,
  );
  const [selectedAudience, setSelectedAudience] = useState(
    normalizedInitialSettings.audience_account_numbers,
  );
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (contacts.length > 0) {
      return undefined;
    }

    let isMounted = true;
    getParentContacts()
      .then((response) => {
        if (!isMounted) {
          return;
        }

        const nextContacts = Array.isArray(response.data?.contacts)
          ? response.data.contacts
          : [];
        onContactsChange(nextContacts);
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [contacts.length, onContactsChange]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    if (visibility === "specific_contacts" && selectedAudience.length === 0) {
      setMessage("Select at least one contact.");
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const response = await updateMessengerStorySettings({
        audience_account_numbers:
          visibility === "specific_contacts" ? selectedAudience : [],
        expiry_hours: expiryHours,
        visibility,
      });
      onSaved(normalizeStorySettings(getResult(response).settings));
    } catch (error) {
      setMessage(getMessengerErrorMessage(error, "Unable to save story settings."));
    } finally {
      setIsSaving(false);
    }
  };

  const modal = (
    <div
      className="parent-layout-page__modal-backdrop parent-layout-page__story-modal-backdrop"
      role="presentation"
    >
      <form
        className="parent-layout-page__modal parent-layout-page__modal--story parent-layout-page__story-settings-modal"
        onSubmit={handleSubmit}
        aria-modal="true"
        aria-labelledby="parent-story-settings-title"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close parent-layout-page__story-modal-close"
          type="button"
          onClick={onClose}
          aria-label="Close story settings"
          title="Close"
        >
          <X size={24} aria-hidden="true" />
        </button>
        <header className="parent-layout-page__modal-header parent-layout-page__story-modal-header">
          <div>
            <h2 id="parent-story-settings-title">Story settings</h2>
            <p>Used automatically for your next stories</p>
          </div>
          <Settings2 size={24} aria-hidden="true" />
        </header>

        <StorySettingsFields
          contacts={contacts}
          disabled={isSaving}
          expiryHours={expiryHours}
          onExpiryHoursChange={setExpiryHours}
          onSelectedAudienceChange={setSelectedAudience}
          onVisibilityChange={setVisibility}
          selectedAudience={selectedAudience}
          visibility={visibility}
        />

        {message ? (
          <p className="parent-layout-page__stories-message" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{message}</span>
          </p>
        ) : null}

        <div className="parent-layout-page__story-actions is-upload-only">
          <button
            className="parent-layout-page__story-submit"
            type="submit"
            disabled={isSaving}
          >
            {isSaving ? (
              <LoaderCircle size={18} className="is-spinning" aria-hidden="true" />
            ) : (
              <Save size={18} aria-hidden="true" />
            )}
            <span>{isSaving ? "Saving" : "Save Settings"}</span>
          </button>
        </div>
      </form>
    </div>
  );

  return createPortal(modal, document.body);
}

function StoryComposer({
  contacts,
  initialHasSavedSettings = false,
  initialSettings = DEFAULT_STORY_SETTINGS,
  onClose,
  onContactsChange,
  onCreated,
  onSettingsSaved,
}) {
  const normalizedInitialSettings = normalizeStorySettings(initialSettings);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [storyMode, setStoryMode] = useState("media");
  const [mediaStoryText, setMediaStoryText] = useState("");
  const [textStoryText, setTextStoryText] = useState("");
  const [textStoryTheme, setTextStoryTheme] = useState(TEXT_STORY_THEMES[0].key);
  const [expiryHours, setExpiryHours] = useState(
    normalizedInitialSettings.expiry_hours,
  );
  const [visibility, setVisibility] = useState(
    normalizedInitialSettings.visibility,
  );
  const [selectedAudience, setSelectedAudience] = useState(
    normalizedInitialSettings.audience_account_numbers,
  );
  const [savedSettings, setSavedSettings] = useState(
    initialHasSavedSettings ? normalizedInitialSettings : null,
  );
  const [hasSavedSettings, setHasSavedSettings] = useState(
    Boolean(initialHasSavedSettings),
  );
  const [isSettingsEditorOpen, setIsSettingsEditorOpen] = useState(
    !initialHasSavedSettings,
  );
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFilePreviews, setSelectedFilePreviews] = useState([]);
  const [isPreviewVideoMuted, setIsPreviewVideoMuted] = useState(true);
  const [videoTrim, setVideoTrim] = useState(null);
  const fileInputRef = useRef(null);
  const selectedVideoPreviewRef = useRef(null);
  const selectedFilePreviewUrlsRef = useRef([]);

  useEffect(
    () => () => {
      selectedFilePreviewUrlsRef.current.forEach((previewUrl) => {
        URL.revokeObjectURL(previewUrl);
      });
    },
    [],
  );

  useEffect(() => {
    if (contacts.length > 0) {
      return undefined;
    }

    let isMounted = true;
    getParentContacts()
      .then((response) => {
        if (!isMounted) {
          return;
        }

        const nextContacts = Array.isArray(response.data?.contacts)
          ? response.data.contacts
          : [];
        onContactsChange(nextContacts);
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [contacts.length, onContactsChange]);

  useEffect(() => {
    let isMounted = true;

    setIsLoadingSettings(true);
    getMessengerStorySettings()
      .then((response) => {
        if (!isMounted) {
          return;
        }

        const result = getResult(response);
        const settings = normalizeStorySettings(result.settings || initialSettings);
        const nextHasSavedSettings = Boolean(
          result.has_saved_settings || initialHasSavedSettings,
        );
        setExpiryHours(settings.expiry_hours);
        setVisibility(settings.visibility);
        setSelectedAudience(settings.audience_account_numbers);
        setSavedSettings(nextHasSavedSettings ? settings : null);
        setHasSavedSettings(nextHasSavedSettings);
        setIsSettingsEditorOpen(!nextHasSavedSettings);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setMessage(getMessengerErrorMessage(error, "Unable to load story settings."));
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingSettings(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleFilesChange = (event) => {
    const files = Array.from(event.target.files || []);
    const unsupportedFiles = files.filter((file) => !isSupportedStoryMediaFile(file));
    const supportedFiles = files.filter(isSupportedStoryMediaFile);
    const selectedFile = supportedFiles[supportedFiles.length - 1];

    event.target.value = "";
    if (!selectedFile) {
      setMessage(
        unsupportedFiles.length > 0
          ? "Stories support image and video files only."
          : "",
      );
      return;
    }

    const nextFilePreviews = [
      {
        file: selectedFile,
        url: URL.createObjectURL(selectedFile),
      },
    ];

    selectedFilePreviewUrlsRef.current.forEach((previewUrl) => {
      URL.revokeObjectURL(previewUrl);
    });
    selectedFilePreviewUrlsRef.current = nextFilePreviews.map(
      (preview) => preview.url,
    );
    setSelectedFiles([selectedFile]);
    setSelectedFilePreviews(nextFilePreviews);
    setIsPreviewVideoMuted(true);
    setVideoTrim(null);
    setStoryMode("media");
    setMessage(
      unsupportedFiles.length > 0
        ? "Stories support image and video files only."
        : "",
    );
  };

  useEffect(() => {
    const video = selectedVideoPreviewRef.current;
    if (!video || !videoTrim) {
      return;
    }

    video.currentTime = videoTrim.startSeconds;
    video.play().catch(() => {});
  }, [videoTrim]);

  const handleSelectedVideoMetadata = (event) => {
    const duration = Number(event.currentTarget.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      setMessage("Unable to read this video's duration.");
      return;
    }

    setVideoTrim({
      duration,
      endSeconds: duration,
      startSeconds: 0,
    });
  };

  const restartSelectedVideoPreview = () => {
    const video = selectedVideoPreviewRef.current;
    if (!video || !videoTrim) {
      return;
    }

    video.currentTime = videoTrim.startSeconds;
    video.play().catch(() => {});
  };

  const handleSelectedVideoTimeUpdate = (event) => {
    if (
      videoTrim &&
      event.currentTarget.currentTime >=
        videoTrim.endSeconds - STORY_VIDEO_TRIM_EPSILON_SECONDS
    ) {
      restartSelectedVideoPreview();
    }
  };

  const handleVideoTrimStartChange = (event) => {
    const nextStartSeconds = Number(event.target.value);

    setVideoTrim((currentTrim) => {
      if (!currentTrim) {
        return currentTrim;
      }

      const minimumDuration = Math.min(
        MIN_STORY_VIDEO_TRIM_SECONDS,
        currentTrim.duration,
      );
      return {
        ...currentTrim,
        startSeconds: Math.min(
          Math.max(nextStartSeconds, 0),
          currentTrim.endSeconds - minimumDuration,
        ),
      };
    });
  };

  const handleVideoTrimEndChange = (event) => {
    const nextEndSeconds = Number(event.target.value);

    setVideoTrim((currentTrim) => {
      if (!currentTrim) {
        return currentTrim;
      }

      const minimumDuration = Math.min(
        MIN_STORY_VIDEO_TRIM_SECONDS,
        currentTrim.duration,
      );
      return {
        ...currentTrim,
        endSeconds: Math.max(
          Math.min(nextEndSeconds, currentTrim.duration),
          currentTrim.startSeconds + minimumDuration,
        ),
      };
    });
  };

  const handleTextStoryChange = (event) => {
    setTextStoryText(event.target.value.slice(0, TEXT_STORY_MAX_LENGTH));
  };

  const buildSettingsPayload = () => {
    const audienceAccountNumbers =
      visibility === "specific_contacts" ? selectedAudience : [];

    return {
      audience_account_numbers: audienceAccountNumbers,
      expiry_hours: expiryHours,
      visibility,
    };
  };

  const applySavedSettings = (settings, options) => {
    const nextSettings = normalizeStorySettings(settings);

    setExpiryHours(nextSettings.expiry_hours);
    setVisibility(nextSettings.visibility);
    setSelectedAudience(nextSettings.audience_account_numbers);
    setSavedSettings(nextSettings);
    setHasSavedSettings(true);
    setIsSettingsEditorOpen(false);
    onSettingsSaved?.(nextSettings, options);

    return nextSettings;
  };

  const saveStorySettings = async ({ silent = false } = {}) => {
    if (isLoadingSettings) {
      setMessage("Story settings are still loading.");
      return null;
    }

    if (visibility === "specific_contacts" && selectedAudience.length === 0) {
      setMessage("Select at least one contact.");
      return null;
    }

    setIsSavingSettings(true);
    if (!silent) {
      setMessage("");
    }

    try {
      const response = await updateMessengerStorySettings(buildSettingsPayload());
      const nextSettings = applySavedSettings(getResult(response).settings);
      if (!silent) {
        setMessage("Story settings saved.");
      }
      return nextSettings;
    } catch (error) {
      setMessage(getMessengerErrorMessage(error, "Unable to save story settings."));
      return null;
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleSaveSettings = () => {
    if (isSubmitting || isSavingSettings) {
      return;
    }

    saveStorySettings();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting || isSavingSettings) {
      return;
    }

    const isTextStory = storyMode === "text";
    const trimmedTextStory = textStoryText.trim();
    const selectedStoryFile = selectedFiles[0] || null;
    const isSelectedStoryVideo = String(
      selectedStoryFile?.type || "",
    ).startsWith("video/");

    if (!isTextStory && selectedFiles.length === 0) {
      setMessage("Choose at least one image or video.");
      return;
    }

    if (isTextStory && !trimmedTextStory) {
      setMessage("Write text for your story.");
      return;
    }

    if (!isTextStory && isSelectedStoryVideo && !videoTrim) {
      setMessage("Wait for the video preview to finish loading.");
      return;
    }

    if (
      isSettingsEditorOpen &&
      visibility === "specific_contacts" &&
      selectedAudience.length === 0
    ) {
      setMessage("Select at least one contact.");
      return;
    }

    const activeSettings =
      hasSavedSettings && !isSettingsEditorOpen
        ? savedSettings
        : await saveStorySettings({ silent: true });
    if (!activeSettings) {
      return;
    }

    const clientStoryId = createStoryClientId();
    const audienceAccountNumbers =
      activeSettings.visibility === "specific_contacts"
        ? activeSettings.audience_account_numbers
        : [];

    setIsSubmitting(true);
    setMessage("");
    setProgress({ phase: isTextStory ? "creating" : "encrypting", percent: 0 });

    try {
      if (isTextStory) {
        await createMessengerStory({
          audience_account_numbers: audienceAccountNumbers,
          client_story_id: clientStoryId,
          encrypted_payload: createStoryTextPayload({
            text: trimmedTextStory,
            theme: textStoryTheme,
          }),
          encrypted_upload_intent_ids: [],
          expiry_hours: activeSettings.expiry_hours,
          story_type: "text",
          visibility: activeSettings.visibility,
        });
      } else {
        let storyFiles = selectedFiles;
        if (isSelectedStoryVideo && isStoryVideoTrimmed(videoTrim)) {
          setProgress({ phase: "trimming", percent: 0 });
          storyFiles = [
            await trimStoryVideoFile(selectedStoryFile, {
              endSeconds: videoTrim.endSeconds,
              onProgress: (percent) => {
                setProgress({ phase: "trimming", percent });
              },
              startSeconds: videoTrim.startSeconds,
            }),
          ];
        }

        const encryptedStoryMedia = await encryptSelectedFilesForStory(storyFiles, {
          audienceAccountNumbers,
          caption: mediaStoryText,
          clientStoryId,
          onProgress: setProgress,
        });

        setProgress({ phase: "creating", percent: 100 });
        await createMessengerStory({
          audience_account_numbers: audienceAccountNumbers,
          client_story_id: clientStoryId,
          encrypted_payload: encryptedStoryMedia.encryptedPayload,
          encrypted_upload_intent_ids: encryptedStoryMedia.uploadIntentIds,
          expiry_hours: activeSettings.expiry_hours,
          story_type: "media",
          visibility: activeSettings.visibility,
        });
      }
      onCreated();
    } catch (error) {
      setMessage(getMessengerErrorMessage(error, error.message || "Unable to upload story."));
    } finally {
      setIsSubmitting(false);
      setProgress(null);
    }
  };

  const activeTextTheme = getTextStoryTheme(textStoryTheme);
  const shouldShowInlineSettings = !isLoadingSettings && isSettingsEditorOpen;

  const modal = (
    <div
      className="parent-layout-page__modal-backdrop parent-layout-page__story-modal-backdrop"
      role="presentation"
    >
      <form
        className="parent-layout-page__modal parent-layout-page__modal--story parent-layout-page__story-composer"
        onSubmit={handleSubmit}
        aria-modal="true"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close parent-layout-page__story-modal-close"
          type="button"
          onClick={onClose}
          aria-label="Close story composer"
          title="Close"
        >
          <X size={24} aria-hidden="true" />
        </button>

        <header className="parent-layout-page__modal-header parent-layout-page__story-modal-header">
          <div>
            <h2>Add Story</h2>
            <p>Photos, videos, or text board</p>
          </div>
          <UploadCloud size={24} aria-hidden="true" />
        </header>

        <div
          className="parent-layout-page__story-mode-switch"
          role="tablist"
          aria-label="Story type"
        >
          <button
            className={storyMode === "media" ? "is-active" : ""}
            type="button"
            onClick={() => setStoryMode("media")}
            role="tab"
            aria-selected={storyMode === "media"}
          >
            <ImageIcon size={17} aria-hidden="true" />
            <span>Visual Moment</span>
          </button>
          <button
            className={storyMode === "text" ? "is-active" : ""}
            type="button"
            onClick={() => setStoryMode("text")}
            role="tab"
            aria-selected={storyMode === "text"}
          >
            <Type size={17} aria-hidden="true" />
            <span>Text Canvas</span>
          </button>
        </div>

        {storyMode === "media" ? (
          <>
            <button
              className="parent-layout-page__story-file-drop"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                onChange={handleFilesChange}
              />
              <ImageIcon size={28} aria-hidden="true" />
              <span>
                {selectedFiles.length
                  ? "Replace image or video"
                  : "Choose image or video"}
              </span>
            </button>

            {selectedFilePreviews.length > 0 ? (
              <div
                className="parent-layout-page__story-selected-media"
                aria-label="Selected story media previews"
              >
                {selectedFilePreviews.map(({ file, url }, index) => (
                  <figure
                    key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                  >
                    <div className="parent-layout-page__story-selected-media-preview">
                      {file.type.startsWith("video/") ? (
                        <>
                          <video
                            ref={selectedVideoPreviewRef}
                            src={url}
                            autoPlay
                            muted={isPreviewVideoMuted}
                            onEnded={restartSelectedVideoPreview}
                            onLoadedMetadata={handleSelectedVideoMetadata}
                            onTimeUpdate={handleSelectedVideoTimeUpdate}
                            playsInline
                            preload="metadata"
                          />
                          <button
                            className="parent-layout-page__story-video-mute"
                            type="button"
                            onClick={() =>
                              setIsPreviewVideoMuted((isMuted) => !isMuted)
                            }
                            aria-label={
                              isPreviewVideoMuted
                                ? "Unmute video preview"
                                : "Mute video preview"
                            }
                            title={
                              isPreviewVideoMuted
                                ? "Unmute video preview"
                                : "Mute video preview"
                            }
                          >
                            {isPreviewVideoMuted ? (
                              <VolumeX size={17} aria-hidden="true" />
                            ) : (
                              <Volume2 size={17} aria-hidden="true" />
                            )}
                          </button>
                        </>
                      ) : (
                        <img src={url} alt={`Preview of ${file.name}`} />
                      )}
                    </div>
                    <figcaption>{file.name}</figcaption>
                    {file.type.startsWith("video/") && videoTrim ? (
                      <section
                        className="parent-layout-page__story-video-trimmer"
                        aria-label="Trim selected video"
                      >
                        <header>
                          <span>
                            <Scissors size={15} aria-hidden="true" />
                            Trim video
                          </span>
                          <strong>
                            {formatVideoTrimTime(
                              videoTrim.endSeconds - videoTrim.startSeconds,
                            )}
                          </strong>
                        </header>
                        <div
                          className="parent-layout-page__story-video-trim-timeline"
                          style={{
                            "--story-video-trim-end": `${
                              (videoTrim.endSeconds / videoTrim.duration) * 100
                            }%`,
                            "--story-video-trim-start": `${
                              (videoTrim.startSeconds / videoTrim.duration) * 100
                            }%`,
                          }}
                        >
                          <span className="is-start">
                            {formatVideoTrimTime(videoTrim.startSeconds)}
                          </span>
                          <input
                            className="is-start"
                            type="range"
                            min="0"
                            max={videoTrim.duration}
                            step="0.1"
                            value={videoTrim.startSeconds}
                            onChange={handleVideoTrimStartChange}
                            aria-label="Video trim start time"
                          />
                          <input
                            className="is-end"
                            type="range"
                            min="0"
                            max={videoTrim.duration}
                            step="0.1"
                            value={videoTrim.endSeconds}
                            onChange={handleVideoTrimEndChange}
                            aria-label="Video trim end time"
                          />
                          <span className="is-end">
                            {formatVideoTrimTime(videoTrim.endSeconds)}
                          </span>
                        </div>
                      </section>
                    ) : null}
                  </figure>
                ))}
              </div>
            ) : null}

            <label className="parent-layout-page__story-media-text">
              <span>Story text</span>
              <textarea
                value={mediaStoryText}
                onChange={(event) =>
                  setMediaStoryText(event.target.value.slice(0, TEXT_STORY_MAX_LENGTH))
                }
                placeholder="Write something about this story"
                maxLength={TEXT_STORY_MAX_LENGTH}
              />
              <small>
                {mediaStoryText.length}/{TEXT_STORY_MAX_LENGTH}
              </small>
            </label>
          </>
        ) : (
          <section
            className="parent-layout-page__story-text-composer"
            style={{
              "--story-text-background": activeTextTheme.background,
              "--story-text-color": activeTextTheme.color,
            }}
          >
            <textarea
              value={textStoryText}
              onChange={handleTextStoryChange}
              placeholder="Write a story"
              aria-label="Write story text"
              maxLength={TEXT_STORY_MAX_LENGTH}
            />
            <div className="parent-layout-page__story-text-tools">
              <div className="parent-layout-page__story-theme-swatches" aria-label="Story color">
                {TEXT_STORY_THEMES.map((theme) => (
                  <button
                    className={textStoryTheme === theme.key ? "is-active" : ""}
                    key={theme.key}
                    type="button"
                    onClick={() => setTextStoryTheme(theme.key)}
                    style={{ "--story-theme-background": theme.background }}
                    aria-label={theme.label}
                    title={theme.label}
                  />
                ))}
              </div>
              <span>
                {textStoryText.length}/{TEXT_STORY_MAX_LENGTH}
              </span>
            </div>
          </section>
        )}

        {shouldShowInlineSettings ? (
          <StorySettingsFields
            contacts={contacts}
            disabled={isSubmitting || isLoadingSettings}
            expiryHours={expiryHours}
            onExpiryHoursChange={setExpiryHours}
            onSelectedAudienceChange={setSelectedAudience}
            onVisibilityChange={setVisibility}
            selectedAudience={selectedAudience}
            visibility={visibility}
          />
        ) : null}

        {hasSavedSettings && !isSettingsEditorOpen ? (
          <button
            className="parent-layout-page__story-settings-submit"
            type="button"
            onClick={() => setIsSettingsModalOpen(true)}
            disabled={isSubmitting || isSavingSettings || isLoadingSettings}
          >
            <Settings2 size={18} aria-hidden="true" />
            <span>Edit Story Settings</span>
          </button>
        ) : null}

        {progress ? (
          <div className="parent-layout-page__story-upload-progress">
            <span>
              {progress.phase === "encrypting"
                ? "Encrypting"
                : progress.phase === "trimming"
                  ? "Trimming"
                : progress.phase === "creating"
                  ? "Creating"
                  : "Uploading"}
            </span>
            <strong>{progress.percent ?? 0}%</strong>
            <i style={{ "--story-upload-progress": `${progress.percent ?? 0}%` }} />
          </div>
        ) : null}

        {message ? (
          <p className="parent-layout-page__stories-message" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{message}</span>
          </p>
        ) : null}

        <div
          className={`parent-layout-page__story-actions${
            shouldShowInlineSettings ? "" : " is-upload-only"
          }`}
        >
          {shouldShowInlineSettings ? (
            <button
              className="parent-layout-page__story-settings-submit"
              type="button"
              onClick={handleSaveSettings}
              disabled={isSubmitting || isSavingSettings || isLoadingSettings}
            >
              {isSavingSettings ? (
                <LoaderCircle size={18} className="is-spinning" aria-hidden="true" />
              ) : (
                <Save size={18} aria-hidden="true" />
              )}
              <span>{isSavingSettings ? "Saving" : "Save Settings"}</span>
            </button>
          ) : null}

          <button
            className="parent-layout-page__story-submit"
            type="submit"
            disabled={isSubmitting || isSavingSettings || isLoadingSettings}
          >
            {isSubmitting ? (
              <LoaderCircle size={18} className="is-spinning" aria-hidden="true" />
            ) : storyMode === "text" ? (
              <Type size={18} aria-hidden="true" />
            ) : (
              <UploadCloud size={18} aria-hidden="true" />
            )}
            <span>
              {isSubmitting ? "Posting" : storyMode === "text" ? "Post Story" : "Upload Story"}
            </span>
          </button>
        </div>
      </form>

      {isSettingsModalOpen ? (
        <StorySettingsModal
          contacts={contacts}
          initialSettings={savedSettings}
          onClose={() => setIsSettingsModalOpen(false)}
          onContactsChange={onContactsChange}
          onSaved={(settings) => {
            applySavedSettings(settings, { showToast: true });
            setIsSettingsModalOpen(false);
          }}
        />
      ) : null}
    </div>
  );

  return createPortal(modal, document.body);
}

function StoryViewer({
  contacts,
  currentUser,
  inline = false,
  onAddStory,
  onClose,
  onRoomMessage,
  onStoryDeleted,
  onStoryViewed,
  onViewers,
  setViewerState,
  viewerState,
}) {
  const { contact, contactName, isMine, stories, storyIndex } = viewerState;
  const story = stories[storyIndex] || null;
  const media = useMemo(() => (story ? getStoryFirstMedia(story) : null), [story]);
  const mediaStoryCaption = useMemo(
    () => (story ? getStoryMediaCaption(story.encrypted_payload) : ""),
    [story],
  );
  const textStory = useMemo(() => (story ? getStoryText(story) : null), [story]);
  const isTextStory = story?.story_type === "text";
  const isVideoStory = !isTextStory && media?.media_type === "video";
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaError, setMediaError] = useState("");
  const [progress, setProgress] = useState(0);
  const [replyText, setReplyText] = useState("");
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isReactionPickerOpen, setIsReactionPickerOpen] = useState(false);
  const [isStoryVideoMuted, setIsStoryVideoMuted] = useState(true);
  const [isHoldPaused, setIsHoldPaused] = useState(false);
  const [isReplyFocused, setIsReplyFocused] = useState(false);
  const isStoryPaused =
    isHoldPaused || isReplyFocused || isReactionPickerOpen || isSending;
  const reactionPickerRef = useRef(null);
  const replyTextRef = useRef(null);
  const storyVideoRef = useRef(null);
  const timerRef = useRef(null);
  const progressRef = useRef(0);
  const holdStartedAtRef = useRef(0);
  const suppressStoryTapRef = useRef(false);

  const goToStory = useCallback(
    (nextIndex) => {
      if (nextIndex < 0) {
        onClose();
        return;
      }

      if (nextIndex >= stories.length) {
        onClose();
        return;
      }

      setViewerState((currentState) => ({
        ...currentState,
        storyIndex: nextIndex,
      }));
    },
    [onClose, setViewerState, stories.length],
  );

  useEffect(() => {
    setMediaError("");
    setMediaUrl("");
    setProgress(0);
    setReplyText("");
    setMessage("");
    setIsDeleting(false);
    setIsReactionPickerOpen(false);
    setIsStoryVideoMuted(true);
    setIsHoldPaused(false);
    setIsReplyFocused(false);
    progressRef.current = 0;

    if (!story) {
      return undefined;
    }

    if (isTextStory) {
      if (!textStory?.text) {
        setMediaError("Story text is unavailable.");
      }

      if (!isMine) {
        markMessengerStoryViewed(story.id)
          .then(() => onStoryViewed(story.id))
          .catch(() => {});
      }

      return undefined;
    }

    if (!media) {
      setMediaError("Story media is unavailable.");
      return undefined;
    }

    let isMounted = true;
    let objectUrl = "";

    decryptStoryMediaBlob(media)
      .then((blob) => {
        if (!isMounted) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setMediaUrl(objectUrl);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setMediaError(error?.message || "Unable to open story media.");
      });

    if (!isMine) {
      markMessengerStoryViewed(story.id)
        .then(() => onStoryViewed(story.id))
        .catch(() => {});
    }

    return () => {
      isMounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [isMine, isTextStory, media, onStoryViewed, story, textStory]);

  useEffect(() => {
    if (!story || isVideoStory || isStoryPaused) {
      return undefined;
    }

    window.clearInterval(timerRef.current);
    const startingProgress = progressRef.current;
    const startedAt = Date.now();

    timerRef.current = window.setInterval(() => {
      const nextProgress = Math.min(
        startingProgress +
          ((Date.now() - startedAt) / IMAGE_STORY_DURATION_MS) * 100,
        100,
      );
      progressRef.current = nextProgress;
      setProgress(nextProgress);

      if (nextProgress >= 100) {
        window.clearInterval(timerRef.current);
        goToStory(storyIndex + 1);
      }
    }, 120);

    return () => {
      window.clearInterval(timerRef.current);
    };
  }, [goToStory, isStoryPaused, isVideoStory, story, storyIndex]);

  useEffect(() => {
    const video = storyVideoRef.current;
    if (!video || !isVideoStory) {
      return;
    }

    if (isStoryPaused) {
      video.pause();
      return;
    }

    video.play().catch(() => {});
  }, [isStoryPaused, isVideoStory, mediaUrl]);

  useEffect(() => {
    const textarea = replyTextRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [replyText]);

  useEffect(() => {
    if (!isReactionPickerOpen) {
      return undefined;
    }

    const closeReactionPicker = (event) => {
      if (!reactionPickerRef.current?.contains(event.target)) {
        setIsReactionPickerOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeReactionPicker);
    return () => {
      document.removeEventListener("pointerdown", closeReactionPicker);
    };
  }, [isReactionPickerOpen]);

  const sendStoryReaction = async (reaction) => {
    if (!story || isMine || isSending) {
      return;
    }

    setIsSending(true);
    setMessage("");
    setIsReactionPickerOpen(false);

    try {
      const reactionText = getReactionConfig(reaction)?.emoji || reaction;
      const encryptedText = await encryptMessageText({
        recipientAccountNumber: story.owner_account_number,
        text: reactionText,
        user: currentUser,
      });
      const response = await reactToMessengerStory(story.id, {
        client_message_id: createMessengerClientMessageId(),
        reaction,
        text: encryptedText,
      });
      await handleStoryMessageResponse(response, currentUser, onRoomMessage);
      setMessage("Reaction sent.");
    } catch (error) {
      setMessage(getMessengerErrorMessage(error, "Unable to send reaction."));
    } finally {
      setIsSending(false);
    }
  };

  const sendStoryReply = async (event) => {
    event.preventDefault();
    if (!story || isMine || isSending || !replyText.trim()) {
      return;
    }

    setIsSending(true);
    setMessage("");

    try {
      const encryptedText = await encryptMessageText({
        recipientAccountNumber: story.owner_account_number,
        text: replyText,
        user: currentUser,
      });
      const response = await replyToMessengerStory(story.id, {
        client_message_id: createMessengerClientMessageId(),
        text: encryptedText,
      });
      await handleStoryMessageResponse(response, currentUser, onRoomMessage);
      setReplyText("");
      setMessage("Reply sent.");
    } catch (error) {
      setMessage(getMessengerErrorMessage(error, "Unable to send reply."));
    } finally {
      setIsSending(false);
    }
  };

  const handleStoryReplyKeyDown = (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent?.isComposing) {
      return;
    }

    event.preventDefault();
    void sendStoryReply(event);
  };

  const handleDeleteStory = async () => {
    if (!story || !isMine || isDeleting) {
      return;
    }

    const shouldDelete = globalThis.confirm
      ? globalThis.confirm("Delete this story?")
      : true;
    if (!shouldDelete) {
      return;
    }

    setIsDeleting(true);
    setMessage("");

    try {
      await deleteMessengerStory(story.id);
      setIsDeleting(false);
      onStoryDeleted?.(story.id);
    } catch (error) {
      setMessage(getMessengerErrorMessage(error, "Unable to delete story."));
      setIsDeleting(false);
    }
  };

  const handleStoryVideoProgress = (event) => {
    const duration = Number(event.currentTarget.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }

    const nextProgress = Math.min(
      Math.max((event.currentTarget.currentTime / duration) * 100, 0),
      100,
    );
    progressRef.current = nextProgress;
    setProgress(nextProgress);
  };

  const handleStoryVideoCanPlay = (event) => {
    if (!isStoryPaused) {
      event.currentTarget.play().catch(() => {});
    }
  };

  const handleStoryVideoError = () => {
    setMediaError("Unable to play this story video.");
  };

  const toggleStoryVideoMuted = () => {
    setIsStoryVideoMuted((isMuted) => !isMuted);
    if (!isStoryPaused) {
      storyVideoRef.current?.play().catch(() => {});
    }
  };

  const handleStoryPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    holdStartedAtRef.current = Date.now();
    suppressStoryTapRef.current = false;
    setIsHoldPaused(true);
  };

  const handleStoryPointerRelease = () => {
    if (
      holdStartedAtRef.current &&
      Date.now() - holdStartedAtRef.current >= STORY_HOLD_SUPPRESS_TAP_MS
    ) {
      suppressStoryTapRef.current = true;
    }

    holdStartedAtRef.current = 0;
    setIsHoldPaused(false);
  };

  const handleStoryTap = (nextIndex) => {
    if (suppressStoryTapRef.current) {
      suppressStoryTapRef.current = false;
      return;
    }

    goToStory(nextIndex);
  };

  if (!story) {
    return null;
  }

  const activeTextTheme = getTextStoryTheme(textStory?.theme);
  const modal = (
    <div
      className={`parent-layout-page__story-viewer${inline ? " parent-layout-page__story-viewer--room" : ""}${!isMine ? " has-response-controls" : ""}${isTextStory ? " is-text-story" : ""}${isStoryPaused ? " is-paused" : ""}`}
      role="dialog"
      aria-modal={inline ? undefined : "true"}
      onPointerCancel={handleStoryPointerRelease}
      onPointerDown={handleStoryPointerDown}
      onPointerLeave={handleStoryPointerRelease}
      onPointerUp={handleStoryPointerRelease}
    >
      <div className="parent-layout-page__story-progress-row">
        {stories.map((item, index) => (
          <span key={item.id}>
            <i
              style={{
                width:
                  index < storyIndex
                    ? "100%"
                    : index === storyIndex
                      ? `${progress}%`
                      : "0%",
              }}
            />
          </span>
        ))}
      </div>

      <header className="parent-layout-page__story-viewer-header">
        <StoryAvatar
          accountNumber={isMine ? currentUser?.account_number : contact?.account_number}
          contacts={contacts}
          contact={isMine ? currentUser : contact}
          hasRing
        />
        <div>
          <strong>{contactName}</strong>
          <span>{formatStoryTime(story.created_at)} • {formatExpiry(story.expires_at)}</span>
        </div>
        {isMine ? (
          <button
            className="parent-layout-page__story-viewer-add"
            type="button"
            onClick={onAddStory}
            aria-label="Add story"
            title="Add story"
          >
            <Plus size={18} aria-hidden="true" />
          </button>
        ) : null}
        {isMine ? (
          <button type="button" onClick={() => onViewers(story)}>
            <Eye size={18} aria-hidden="true" />
            <span>{story.view_count || 0}</span>
          </button>
        ) : null}
        {isMine ? (
          <button
            className="parent-layout-page__story-viewer-delete"
            type="button"
            onClick={handleDeleteStory}
            disabled={isDeleting}
            aria-label="Delete story"
            title="Delete story"
          >
            {isDeleting ? (
              <LoaderCircle size={18} className="is-spinning" aria-hidden="true" />
            ) : (
              <Trash2 size={18} aria-hidden="true" />
            )}
          </button>
        ) : null}
        <button
          className="parent-layout-page__story-viewer-close"
          type="button"
          onClick={onClose}
          aria-label="Close story"
          title="Close"
        >
          <X size={24} aria-hidden="true" />
        </button>
      </header>

      <button
        className="parent-layout-page__story-tap-zone is-prev"
        type="button"
        onClick={() => handleStoryTap(storyIndex - 1)}
        aria-label="Previous story"
      />
      <button
        className="parent-layout-page__story-tap-zone is-next"
        type="button"
        onClick={() => handleStoryTap(storyIndex + 1)}
        aria-label="Next story"
      />

      <main className="parent-layout-page__story-stage">
        {isTextStory && textStory?.text ? (
          <div
            className="parent-layout-page__story-text-board"
            style={{
              "--story-text-background": activeTextTheme.background,
              "--story-text-color": activeTextTheme.color,
            }}
          >
            <p>{textStory.text}</p>
          </div>
        ) : mediaError ? (
          <div className="parent-layout-page__story-stage-message">
            <AlertCircle size={28} aria-hidden="true" />
            <span>{mediaError}</span>
          </div>
        ) : !mediaUrl ? (
          <div className="parent-layout-page__story-stage-message">
            <LoaderCircle size={28} className="is-spinning" aria-hidden="true" />
            <span>Opening story</span>
          </div>
        ) : (
          <div className="parent-layout-page__story-media-stage">
            <div
              className={`parent-layout-page__story-media-frame${
                media?.media_type === "video" ? " is-video" : ""
              }`}
            >
              {media?.media_type === "video" ? (
                <>
                  <video
                    key={mediaUrl}
                    ref={storyVideoRef}
                    src={mediaUrl}
                    autoPlay
                    muted={isStoryVideoMuted}
                    onCanPlay={handleStoryVideoCanPlay}
                    onEnded={() => goToStory(storyIndex + 1)}
                    onError={handleStoryVideoError}
                    onLoadedMetadata={handleStoryVideoProgress}
                    onTimeUpdate={handleStoryVideoProgress}
                    playsInline
                    preload="auto"
                  />
                  <button
                    className="parent-layout-page__story-video-mute"
                    type="button"
                    onClick={toggleStoryVideoMuted}
                    aria-label={isStoryVideoMuted ? "Unmute story video" : "Mute story video"}
                    title={isStoryVideoMuted ? "Unmute story video" : "Mute story video"}
                  >
                    {isStoryVideoMuted ? (
                      <VolumeX size={17} aria-hidden="true" />
                    ) : (
                      <Volume2 size={17} aria-hidden="true" />
                    )}
                  </button>
                </>
              ) : (
                <StoryMediaImage src={mediaUrl} />
              )}
              {mediaStoryCaption ? (
                <p className="parent-layout-page__story-media-text-overlay">
                  {mediaStoryCaption}
                </p>
              ) : null}
            </div>
          </div>
        )}
      </main>

      {!isMine ? (
        <footer className="parent-layout-page__story-viewer-footer">
          <div className="parent-layout-page__story-response-row">
            <form onSubmit={sendStoryReply} aria-label="Reply to story">
              <div className="parent-layout-page__story-reply-input">
                <textarea
                  ref={replyTextRef}
                  value={replyText}
                  onChange={(event) => setReplyText(event.target.value)}
                  onBlur={() => setIsReplyFocused(false)}
                  onFocus={() => setIsReplyFocused(true)}
                  onKeyDown={handleStoryReplyKeyDown}
                  placeholder={`Reply to ${contactName}'s story`}
                  aria-label="Reply to story"
                  rows={1}
                />
              </div>
              <button
                className="parent-layout-page__story-reply-submit"
                type="submit"
                disabled={isSending || !replyText.trim()}
                aria-busy={isSending}
                aria-label="Send story reply"
                title="Send reply"
              >
                {isSending ? (
                  <LoaderCircle className="app-button-spinner" aria-hidden="true" />
                ) : (
                  <Send size={18} aria-hidden="true" />
                )}
              </button>
            </form>
            <div
              className="parent-layout-page__story-reaction-action"
              ref={reactionPickerRef}
            >
              <button
                className="parent-layout-page__story-emoji-trigger"
                type="button"
                onClick={() => setIsReactionPickerOpen((isOpen) => !isOpen)}
                disabled={isSending}
                aria-expanded={isReactionPickerOpen}
                aria-label="Choose story reaction"
                title="React to story"
              >
                <Smile size={20} aria-hidden="true" />
              </button>
              {isReactionPickerOpen ? (
                <div
                  className="parent-layout-page__story-reaction-picker"
                  role="menu"
                  aria-label="Choose story reaction"
                >
                  {MESSAGE_REACTIONS.map((reaction) => (
                    <button
                      type="button"
                      key={reaction.key}
                      onClick={() => sendStoryReaction(reaction.key)}
                      disabled={isSending}
                      role="menuitem"
                      aria-label={reaction.label}
                      title={reaction.label}
                    >
                      <span>{reaction.emoji}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          {message ? <p>{message}</p> : null}
        </footer>
      ) : null}
    </div>
  );

  if (inline) {
    return modal;
  }

  return createPortal(modal, document.body);
}

async function handleStoryMessageResponse(response, user, onRoomMessage) {
  const result = getResult(response);
  const messageResult = result.message_result;
  const message = messageResult?.message;

  if (!messageResult?.room || !message || typeof onRoomMessage !== "function") {
    return;
  }

  try {
    const decryptedMessage = await decryptMessageForUser(message, user);
    onRoomMessage(messageResult.room, decryptedMessage);
  } catch {
    onRoomMessage(messageResult.room, message);
  }
}

function StoryViewersModal({ contacts, modal, onClose }) {
  const content = (
    <div
      className="parent-layout-page__modal-backdrop parent-layout-page__story-modal-backdrop"
      role="presentation"
    >
      <section
        className="parent-layout-page__modal parent-layout-page__modal--story parent-layout-page__story-viewers-modal"
        aria-modal="true"
        role="dialog"
      >
        <button
          className="parent-layout-page__modal-close parent-layout-page__story-modal-close"
          type="button"
          onClick={onClose}
          aria-label="Close viewers"
          title="Close"
        >
          <X size={24} aria-hidden="true" />
        </button>
        <header className="parent-layout-page__modal-header parent-layout-page__story-modal-header">
          <div>
            <h2>Viewers</h2>
            <p>{modal.viewCount || modal.viewers.length || 0} total</p>
          </div>
          <UsersRound size={24} aria-hidden="true" />
        </header>

        {modal.isLoading ? (
          <div className="parent-layout-page__story-stage-message">
            <LoaderCircle size={26} className="is-spinning" aria-hidden="true" />
            <span>Loading viewers</span>
          </div>
        ) : modal.message ? (
          <p className="parent-layout-page__stories-message">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{modal.message}</span>
          </p>
        ) : modal.viewers.length === 0 ? (
          <p className="parent-layout-page__stories-empty">No viewers yet.</p>
        ) : (
          <div className="parent-layout-page__story-viewer-list">
            {modal.viewers.map((viewer) => {
              const contact = getContactByAccount(contacts, viewer.account_number);
              const name = contact ? getContactName(contact) : viewer.account_number;

              return (
                <div key={`${viewer.user_id}-${viewer.viewed_at}`}>
                  <StoryAvatar
                    accountNumber={viewer.account_number}
                    contacts={contacts}
                    contact={contact}
                  />
                  <span>
                    <strong>{name}</strong>
                    <small>{viewer.account_number}</small>
                  </span>
                  <time dateTime={viewer.viewed_at}>
                    <Clock3 size={14} aria-hidden="true" />
                    {formatStoryTime(viewer.viewed_at)}
                  </time>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );

  return createPortal(content, document.body);
}

export default StoriesPanel;

