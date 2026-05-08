import { useEffect, useState } from "react";
import {
  Activity,
  LogIn,
  Mail,
  MessageCircle,
  Mic,
  PhoneCall,
  UserPlus,
  Video,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import {
  clearMessengerSession,
  getMessengerToken,
} from "../../../messenger/api.js";
import { loginParent, registerParent } from "../../api.js";
import ParrotIcon from "../../components/ParrotIcon.jsx";
import "../css/WelcomePage.css";
import "../tab/WelcomePage.css";
import "../mobile/WelcomePage.css";

const loginInitialForm = {
  username: "",
  password: "",
};

const registerInitialForm = {
  first_name: "",
  last_name: "",
  username: "",
  password: "",
  confirm_password: "",
};

const featureCards = [
  {
    number: "01",
    Icon: MessageCircle,
    title: "Chats and Groups",
    text: "Message people directly or create group spaces for casual everyday conversations.",
  },
  {
    number: "02",
    Icon: PhoneCall,
    title: "Voice and Video Calls",
    text: "Move from typing to live voice or video calls whenever the conversation needs more.",
  },
  {
    number: "03",
    Icon: Mail,
    title: "Mail and Voice Notes",
    text: "Send longer mail-style messages or quick voice notes when text feels too slow.",
  },
  {
    number: "04",
    Icon: Activity,
    title: "Status Updates",
    text: "Share what you are doing and keep friends or groups updated in one simple place.",
  },
];

function WelcomePage() {
  const navigate = useNavigate();
  const [showSplash, setShowSplash] = useState(true);
  const [activeModal, setActiveModal] = useState(null);
  const [loginForm, setLoginForm] = useState(loginInitialForm);
  const [registerForm, setRegisterForm] = useState(registerInitialForm);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const splashTimer = window.setTimeout(() => {
      setShowSplash(false);
    }, 1000);

    return () => window.clearTimeout(splashTimer);
  }, []);

  const closeModal = () => {
    setActiveModal(null);
    setMessage("");
    setIsSubmitting(false);
  };

  const openModal = (modalName) => {
    setActiveModal(modalName);
    setMessage("");
  };

  const handleLoginChange = (event) => {
    const { name, value } = event.target;
    setLoginForm((currentForm) => ({ ...currentForm, [name]: value }));
  };

  const handleRegisterChange = (event) => {
    const { name, value } = event.target;
    setRegisterForm((currentForm) => ({ ...currentForm, [name]: value }));
  };

  const getErrorMessage = (error, fallbackMessage) => {
    const errors = error.response?.data?.errors;

    if (errors) {
      return Object.entries(errors)
        .map(([field, fieldErrors]) => `${field}: ${fieldErrors.join(", ")}`)
        .join(" ");
    }

    return error.response?.data?.message || fallbackMessage;
  };

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    try {
      await loginParent(loginForm);
      clearMessengerSession();
      getMessengerToken({ forceRefresh: true }).catch(() => undefined);
      setLoginForm(loginInitialForm);
      closeModal();
      navigate("/navigation", { replace: true });
    } catch (error) {
      setMessage(
        getErrorMessage(
          error,
          "Login failed. Check your username and password.",
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (event) => {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    try {
      await registerParent(registerForm);
      setRegisterForm(registerInitialForm);
      setLoginForm({
        username: registerForm.username,
        password: "",
      });
      setActiveModal("login");
      setMessage("Account created. Login to continue.");
    } catch (error) {
      setMessage(getErrorMessage(error, "Registration failed."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="parent-welcome">
      {showSplash ? (
        <section className="parent-splash" aria-label="Parrot loading">
          <ParrotIcon className="parent-splash__mark" />
          <h1>Parrot</h1>
        </section>
      ) : (
        <div className="parent-welcome__content">
          <header className="parent-welcome__nav">
            <div className="parent-welcome__brand">
              <ParrotIcon className="parent-welcome__brand-icon" />
              Parrot
            </div>

            <div className="parent-welcome__header-actions">
              <button
                className="parent-welcome__ghost"
                type="button"
                onClick={() => openModal("login")}
              >
                <LogIn aria-hidden="true" />
                <span>Login</span>
              </button>
              <button
                className="parent-welcome__solid"
                type="button"
                onClick={() => openModal("register")}
              >
                <UserPlus aria-hidden="true" />
                <span>Create Account</span>
              </button>
            </div>
          </header>

          <section className="parent-welcome__hero">
            <div className="parent-welcome__hero-copy">
              <p className="parent-welcome__eyebrow">
                <MessageCircle aria-hidden="true" />
                One spot for casual communication
              </p>
              <h1>Keep every conversation close with Parrot.</h1>
              <p className="parent-welcome__intro">
                Parrot is a simple communication space for people and groups.
                Chat, send mail, call with voice or video, share voice notes,
                and keep your status fresh from one account.
              </p>
            </div>

            <div className="parent-welcome__showcase" aria-hidden="true">
            <div className="parent-welcome__phone-card">
              <div className="parent-welcome__phone-top">
                  <ParrotIcon className="parent-welcome__phone-icon" />
                  <strong>Today</strong>
                </div>
                <div className="parent-welcome__bubble parent-welcome__bubble--left">
                  <Mic aria-hidden="true" />
                  <span>Voice note sent</span>
                </div>
                <div className="parent-welcome__bubble parent-welcome__bubble--right">
                  <Video aria-hidden="true" />
                  <span>Video call at 8?</span>
                </div>
                <div className="parent-welcome__status-pill">
                  <Activity aria-hidden="true" />
                  <span>Status updated</span>
                </div>
              </div>
            </div>
          </section>

          <section className="parent-welcome__cards" aria-label="Parrot features">
            {featureCards.map((feature) => (
              <article className="parent-welcome__card" key={feature.number}>
                <span className="parent-welcome__card-icon" aria-hidden="true">
                  <feature.Icon />
                </span>
                <h2>{feature.title}</h2>
                <p>{feature.text}</p>
              </article>
            ))}
          </section>
        </div>
      )}

      {activeModal ? (
        <div className="parent-welcome__modal-backdrop" role="presentation">
          <section
            className="parent-welcome__modal"
            aria-modal="true"
            role="dialog"
            aria-labelledby="parent-auth-title"
          >
            <button
              className="parent-welcome__modal-close"
              type="button"
              onClick={closeModal}
              aria-label="Close"
            >
              <X aria-hidden="true" />
            </button>

            {activeModal === "login" ? (
              <>
                <p className="parent-welcome__modal-kicker">Welcome Back</p>
                <h2 id="parent-auth-title">Login to Parrot</h2>
                <form className="parent-welcome__form" onSubmit={handleLoginSubmit}>
                  <label htmlFor="parent-login-username">Username</label>
                  <input
                    id="parent-login-username"
                    name="username"
                    type="text"
                    value={loginForm.username}
                    onChange={handleLoginChange}
                    autoComplete="username"
                    required
                  />

                  <label htmlFor="parent-login-password">Password</label>
                  <input
                    id="parent-login-password"
                    name="password"
                    type="password"
                    value={loginForm.password}
                    onChange={handleLoginChange}
                    autoComplete="current-password"
                    required
                  />

                  {message ? (
                    <p className="parent-welcome__form-message" role="alert">
                      {message}
                    </p>
                  ) : null}

                  <button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Logging in..." : "Login"}
                  </button>
                </form>

                <p className="parent-welcome__modal-switch">
                  New to Parrot?{" "}
                  <button type="button" onClick={() => openModal("register")}>
                    Create an account
                  </button>
                </p>
              </>
            ) : (
              <>
                <p className="parent-welcome__modal-kicker">Get Started</p>
                <h2 id="parent-auth-title">Create your Parrot account</h2>
                <form className="parent-welcome__form" onSubmit={handleRegisterSubmit}>
                  <div className="parent-welcome__form-row">
                    <div>
                      <label htmlFor="parent-first-name">First name</label>
                      <input
                        id="parent-first-name"
                        name="first_name"
                        type="text"
                        value={registerForm.first_name}
                        onChange={handleRegisterChange}
                        autoComplete="given-name"
                      />
                    </div>
                    <div>
                      <label htmlFor="parent-last-name">Last name</label>
                      <input
                        id="parent-last-name"
                        name="last_name"
                        type="text"
                        value={registerForm.last_name}
                        onChange={handleRegisterChange}
                        autoComplete="family-name"
                      />
                    </div>
                  </div>

                  <label htmlFor="parent-register-username">Username</label>
                  <input
                    id="parent-register-username"
                    name="username"
                    type="text"
                    value={registerForm.username}
                    onChange={handleRegisterChange}
                    autoComplete="username"
                    required
                  />

                  <label htmlFor="parent-register-password">Password</label>
                  <input
                    id="parent-register-password"
                    name="password"
                    type="password"
                    value={registerForm.password}
                    onChange={handleRegisterChange}
                    autoComplete="new-password"
                    required
                  />

                  <label htmlFor="parent-confirm-password">Confirm password</label>
                  <input
                    id="parent-confirm-password"
                    name="confirm_password"
                    type="password"
                    value={registerForm.confirm_password}
                    onChange={handleRegisterChange}
                    autoComplete="new-password"
                    required
                  />

                  {message ? (
                    <p className="parent-welcome__form-message" role="alert">
                      {message}
                    </p>
                  ) : null}

                  <button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Creating account..." : "Create Account"}
                  </button>
                </form>

                <p className="parent-welcome__modal-switch">
                  Already have an account?{" "}
                  <button type="button" onClick={() => openModal("login")}>
                    Login
                  </button>
                </p>
              </>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default WelcomePage;
