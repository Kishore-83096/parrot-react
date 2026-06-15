import {
  Activity,
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  LogIn,
  MessageCircle,
  MessagesSquare,
  Mic,
  Paperclip,
  ParrotIcon,
  Reply,
  ShieldCheck,
  UserPlus,
  UsersRound,
} from "@/components/icons";
import { useCallback, useEffect, useRef, useState } from "react";

import ParrotToast from "../../../components/ParrotToast.jsx";
import ThemeToggleButton from "../../../theme css/ThemeToggleButton.jsx";
import { loginParent, registerParent } from "../../api.js";
import "../css/WelcomePage.css";

const featureCards = [
  {
    Icon: MessagesSquare,
    accent: "purple",
    title: "Direct and Group Chat",
    text: "Save contacts, open direct rooms, create groups, reply, react, edit or delete recent messages, and track delivery state.",
  },
  {
    Icon: Paperclip,
    accent: "blue",
    title: "Encrypted Media",
    text: "Send files, images, audio, video, and browser-recorded voice notes with encrypted upload and inline playback.",
  },
  {
    Icon: Activity,
    accent: "green",
    title: "Stories With Audiences",
    text: "Post encrypted text, image, or video stories with expiry choices, viewers, replies, reactions, and specific-contact visibility.",
  },
  {
    Icon: ShieldCheck,
    accent: "amber",
    title: "Linked-Device Safety",
    text: "Use browser keys, a default-device model, and recovery-key verification to reopen encrypted messages on trusted devices.",
  },
  {
    Icon: UsersRound,
    accent: "purple",
    title: "Desktop Workflow",
    text: "Use wide chat panels, hover message actions, message info, profile tools, group settings, and media modals on larger screens.",
  },
  {
    Icon: Reply,
    accent: "blue",
    title: "Mobile Workflow",
    text: "Tap message bubbles for actions, swipe either direction to reply, and use compact menus built for shorter screens.",
  },
];

const registerInitialForm = {
  first_name: "",
  last_name: "",
  username: "",
  password: "",
  confirm_password: "",
};

const loginInitialForm = {
  username: "",
  password: "",
};

const SPLASH_DURATION_MS = 1000;

function waitForSplashDuration() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, SPLASH_DURATION_MS);
  });
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

function getAccountToastDetails(user, fallbackUsername) {
  const username = user?.username || fallbackUsername || "";

  return [
    { label: "Username", value: username },
    { label: "Account Number", value: user?.account_number },
    {
      label: "Email",
      value: user?.email || (username ? `${username}@epost.com` : ""),
    },
  ];
}

function WelcomePage({ onLoginSuccess }) {
  const [activeModal, setActiveModal] = useState(null);
  const [isLandingSplashVisible, setIsLandingSplashVisible] = useState(true);
  const [isLoginSplashVisible, setIsLoginSplashVisible] = useState(false);
  const [registerForm, setRegisterForm] = useState(registerInitialForm);
  const [registerMessage, setRegisterMessage] = useState(null);
  const [loginForm, setLoginForm] = useState(loginInitialForm);
  const [loginMessage, setLoginMessage] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [toast, setToast] = useState(null);
  const isMountedRef = useRef(false);

  const closeModal = useCallback(() => {
    setActiveModal(null);
    setRegisterMessage(null);
    setLoginMessage(null);
    setIsRegistering(false);
    setIsLoggingIn(false);
  }, []);

  const closeToast = useCallback(() => {
    setToast(null);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    const splashTimerId = window.setTimeout(() => {
      setIsLandingSplashVisible(false);
    }, SPLASH_DURATION_MS);

    return () => {
      isMountedRef.current = false;
      window.clearTimeout(splashTimerId);
    };
  }, []);

  useEffect(() => {
    if (!activeModal) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeModal, closeModal]);

  const openRegisterModal = () => {
    setRegisterMessage(null);
    setLoginMessage(null);
    setActiveModal("register");
  };

  const openLoginModal = () => {
    setLoginMessage(null);
    setRegisterMessage(null);
    setActiveModal("login");
  };

  const handleRegisterChange = (event) => {
    const { name, value } = event.target;

    setRegisterForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
    setRegisterMessage(null);
  };

  const handleLoginChange = (event) => {
    const { name, value } = event.target;

    setLoginForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
    setLoginMessage(null);
  };

  const handleRegisterSubmit = async (event) => {
    event.preventDefault();
    setRegisterMessage(null);
    setIsRegistering(true);

    try {
      const payload = {
        first_name: registerForm.first_name.trim() || null,
        last_name: registerForm.last_name.trim() || null,
        username: registerForm.username.trim(),
        password: registerForm.password,
        confirm_password: registerForm.confirm_password,
      };
      const response = await registerParent(payload);
      const registeredUser = response.data?.user || {};
      const registeredUsername = registeredUser.username || payload.username;

      setRegisterForm(registerInitialForm);
      setLoginForm({
        ...loginInitialForm,
        username: registeredUsername,
      });
      setLoginMessage({
        type: "success",
        text: "Account created. Login to continue.",
      });
      setToast({
        type: "success",
        title: "Account created",
        message: "Your Parrot account is ready.",
        details: getAccountToastDetails(registeredUser, registeredUsername),
      });
      setActiveModal("login");
    } catch (error) {
      const errorMessage = getApiErrorMessage(
        error,
        "Unable to create your account.",
      );

      setRegisterMessage({
        type: "error",
        text: errorMessage,
      });
      setToast({
        type: "error",
        title: "Failed to create account",
        message: errorMessage,
      });
    } finally {
      setIsRegistering(false);
    }
  };

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    setLoginMessage(null);
    setIsLoggingIn(true);

    try {
      const payload = {
        username: loginForm.username.trim(),
        password: loginForm.password,
      };
      const response = await loginParent(payload);
      const user = response.data?.user || {};
      setIsLoginSplashVisible(true);
      await waitForSplashDuration();

      if (!isMountedRef.current) {
        return;
      }

      setIsLoginSplashVisible(false);
      setLoginMessage({
        type: "success",
        text: "Login successful.",
      });
      setToast({
        type: "success",
        title: "Login successful",
        message: "Your session is active.",
        details: getAccountToastDetails(user, payload.username),
      });
      setIsLoggingIn(false);
      onLoginSuccess?.(user);
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      const errorMessage = getApiErrorMessage(
        error,
        "Login failed. Check your username and password.",
      );

      setLoginMessage({
        type: "error",
        text: errorMessage,
      });
      setToast({
        type: "error",
        title: "Login failed",
        message: errorMessage,
      });
      setIsLoggingIn(false);
    }
  };

  return (
    <main className="parent-welcome">
      {isLandingSplashVisible || isLoginSplashVisible ? (
        <div className="parent-welcome__splash" aria-hidden="true">
          <ParrotIcon className="parent-welcome__splash-icon" />
          <span className="parent-welcome__splash-label">PARROT</span>
        </div>
      ) : null}

      <header className="parent-welcome__header">
        <a className="parent-welcome__brand" href="/" aria-label="Parrot home">
          <ParrotIcon />
          <span>Parrot</span>
        </a>

        <nav className="parent-welcome__actions" aria-label="Account actions">
          <ThemeToggleButton className="parent-welcome__theme-toggle" />
          <button
            className="parent-welcome__login"
            type="button"
            onClick={openLoginModal}
          >
            <LogIn size={19} aria-hidden="true" />
            <span>Login</span>
          </button>
          <button
            className="parent-welcome__create"
            type="button"
            onClick={openRegisterModal}
          >
            <UserPlus size={19} aria-hidden="true" />
            <span>Create Account</span>
          </button>
        </nav>
      </header>

      <section className="parent-welcome__hero" aria-labelledby="welcome-title">
        <div className="parent-welcome__copy">
          <p className="parent-welcome__eyebrow">
            <MessageCircle size={17} aria-hidden="true" />
            <span>Private messaging for desktop and mobile</span>
          </p>

          <h1 id="welcome-title">Private chats, groups, and stories across every screen.</h1>
          <p className="parent-welcome__intro">
            Parrot brings saved contacts, direct chats, group rooms, encrypted
            attachments, voice notes, stories, and linked-device recovery into
            one browser app. Desktop gets roomy controls, while mobile keeps
            tap actions and swipe-to-reply close at hand.
          </p>
        </div>

        <div className="parent-welcome__preview" aria-hidden="true">
          <div className="parent-welcome__phone">
            <div className="parent-welcome__phone-top">
              <ParrotIcon />
              <strong>Today</strong>
            </div>

            <div className="parent-welcome__bubble parent-welcome__bubble--light">
              <Mic size={17} />
              <span>Voice note encrypted</span>
            </div>

            <div className="parent-welcome__bubble parent-welcome__bubble--primary">
              <Paperclip size={17} />
              <span>File shared safely</span>
            </div>

            <div className="parent-welcome__bubble parent-welcome__bubble--status">
              <Reply size={17} />
              <span>Swipe reply ready</span>
            </div>
          </div>
        </div>
      </section>

      <section className="parent-welcome__features" aria-label="Parrot features">
        {featureCards.map(({ Icon, accent, title, text }) => (
          <article className="parent-welcome__feature" key={title}>
            <span
              className={`parent-welcome__feature-icon parent-welcome__feature-icon--${accent}`}
              aria-hidden="true"
            >
              <Icon size={25} />
            </span>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <ParrotToast toast={toast} onClose={closeToast} />

      {activeModal === "login" ? (
        <div className="parent-welcome__modal-backdrop" role="presentation">
          <section
            className="parent-welcome__modal"
            aria-modal="true"
            aria-labelledby="parent-login-title"
            role="dialog"
          >
            <button
              className="parent-welcome__modal-close"
              type="button"
              onClick={closeModal}
              aria-label="Close login"
              title="Close"
            >
              <span aria-hidden="true">X</span>
            </button>

            <div className="parent-welcome__modal-header">
              <ParrotIcon />
              <div>
                <p>Login</p>
                <h2 id="parent-login-title">Welcome Back</h2>
              </div>
            </div>

            <form
              className="parent-welcome__register-form"
              onSubmit={handleLoginSubmit}
            >
              <label>
                <span className="parent-welcome__field-label">
                  Username
                  <em className="is-required">Required</em>
                </span>
                <input
                  name="username"
                  type="text"
                  value={loginForm.username}
                  onChange={handleLoginChange}
                  autoComplete="username"
                  required
                />
              </label>

              <label>
                <span className="parent-welcome__field-label">
                  Password
                  <em className="is-required">Required</em>
                </span>
                <input
                  name="password"
                  type="password"
                  value={loginForm.password}
                  onChange={handleLoginChange}
                  autoComplete="current-password"
                  required
                />
              </label>

              {loginMessage ? (
                <p
                  className={`parent-welcome__form-message parent-welcome__form-message--${loginMessage.type}`}
                  role="alert"
                >
                  {loginMessage.type === "success" ? (
                    <CheckCircle2 size={18} aria-hidden="true" />
                  ) : (
                    <AlertCircle size={18} aria-hidden="true" />
                  )}
                  <span>{loginMessage.text}</span>
                </p>
              ) : null}

              <button
                className="parent-welcome__register-submit"
                type="submit"
                disabled={isLoggingIn}
                aria-busy={isLoggingIn}
              >
                {isLoggingIn ? (
                  <LoaderCircle className="app-button-spinner" aria-hidden="true" />
                ) : (
                  <LogIn size={19} aria-hidden="true" />
                )}
                <span>{isLoggingIn ? "Logging in..." : "Login"}</span>
              </button>
            </form>
          </section>
        </div>
      ) : null}

      {activeModal === "register" ? (
        <div className="parent-welcome__modal-backdrop" role="presentation">
          <section
            className="parent-welcome__modal"
            aria-modal="true"
            aria-labelledby="parent-register-title"
            role="dialog"
          >
            <button
              className="parent-welcome__modal-close"
              type="button"
              onClick={closeModal}
              aria-label="Close registration"
              title="Close"
            >
              <span aria-hidden="true">X</span>
            </button>

            <div className="parent-welcome__modal-header">
              <ParrotIcon />
              <div>
                <p>Create Account</p>
                <h2 id="parent-register-title">Join Parrot</h2>
              </div>
            </div>

            <form
              className="parent-welcome__register-form"
              onSubmit={handleRegisterSubmit}
            >
              <div className="parent-welcome__form-grid">
                <label>
                  <span className="parent-welcome__field-label">
                    First Name
                    <em>Optional</em>
                  </span>
                  <input
                    name="first_name"
                    type="text"
                    value={registerForm.first_name}
                    onChange={handleRegisterChange}
                    autoComplete="given-name"
                  />
                </label>

                <label>
                  <span className="parent-welcome__field-label">
                    Last Name
                    <em>Optional</em>
                  </span>
                  <input
                    name="last_name"
                    type="text"
                    value={registerForm.last_name}
                    onChange={handleRegisterChange}
                    autoComplete="family-name"
                  />
                </label>
              </div>

              <label>
                <span className="parent-welcome__field-label">
                  Username
                  <em className="is-required">Required</em>
                </span>
                <input
                  name="username"
                  type="text"
                  value={registerForm.username}
                  onChange={handleRegisterChange}
                  autoComplete="username"
                  minLength={3}
                  maxLength={80}
                  pattern="[A-Za-z0-9_]+"
                  required
                />
              </label>

              <div className="parent-welcome__form-grid">
                <label>
                  <span className="parent-welcome__field-label">
                    Password
                    <em className="is-required">Required</em>
                  </span>
                  <input
                    name="password"
                    type="password"
                    value={registerForm.password}
                    onChange={handleRegisterChange}
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>

                <label>
                  <span className="parent-welcome__field-label">
                    Confirm Password
                    <em className="is-required">Required</em>
                  </span>
                  <input
                    name="confirm_password"
                    type="password"
                    value={registerForm.confirm_password}
                    onChange={handleRegisterChange}
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>
              </div>

              {registerMessage ? (
                <p
                  className={`parent-welcome__form-message parent-welcome__form-message--${registerMessage.type}`}
                  role="alert"
                >
                  {registerMessage.type === "success" ? (
                    <CheckCircle2 size={18} aria-hidden="true" />
                  ) : (
                    <AlertCircle size={18} aria-hidden="true" />
                  )}
                  <span>{registerMessage.text}</span>
                </p>
              ) : null}

              <button
                className="parent-welcome__register-submit"
                type="submit"
                disabled={isRegistering}
                aria-busy={isRegistering}
              >
                {isRegistering ? (
                  <LoaderCircle className="app-button-spinner" aria-hidden="true" />
                ) : (
                  <UserPlus size={19} aria-hidden="true" />
                )}
                <span>{isRegistering ? "Creating..." : "Create Account"}</span>
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default WelcomePage;
