import { Eye, EyeOff, KeyRound, LoaderCircle, X } from "@/components/icons";
import { useState } from "react";

import { saveRecoveryKeyBackup } from "./recovery.js";

function RecoverySetupModal({ onComplete, onSkip, user }) {
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isRecoveryKeyVisible, setIsRecoveryKeyVisible] = useState(false);
  const [isConfirmRecoveryKeyVisible, setIsConfirmRecoveryKeyVisible] =
    useState(false);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (recoveryPassword !== confirmPassword) {
      setMessage("Recovery keys do not match.");
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      await saveRecoveryKeyBackup(user, recoveryPassword);
      onComplete?.();
    } catch (error) {
      setMessage(error?.message || "Unable to create recovery backup.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal parent-layout-page__modal--account"
        role="dialog"
        aria-modal="true"
        aria-labelledby="e2ee-recovery-title"
      >
        {onSkip ? (
          <button
            type="button"
            className="parent-layout-page__modal-close"
            onClick={onSkip}
            aria-label="Close recovery setup"
            title="Close"
          >
            <X size={18} aria-hidden="true" />
          </button>
        ) : null}

        <div className="parent-layout-page__modal-header">
          <KeyRound size={28} aria-hidden="true" />
          <div>
            <p>Encrypted messages</p>
            <h2 id="e2ee-recovery-title">Recovery key</h2>
          </div>
        </div>

        <form className="parent-layout-page__modal-form" onSubmit={handleSubmit}>
          <div className="parent-layout-page__form-note">
            <strong>Why this matters:</strong> This key helps you get old
            messages back if you use a new phone or browser.
            <ul>
              <li>Save this key somewhere safe outside this browser.</li>
              <li>Use only your own trusted device for this step.</li>
              <li>Do not share this key with anyone.</li>
            </ul>
          </div>

          <label>
            Recovery key
            <div className="parent-layout-page__table-input-action">
              <input
                type={isRecoveryKeyVisible ? "text" : "password"}
                value={recoveryPassword}
                onChange={(event) => setRecoveryPassword(event.target.value)}
                minLength={12}
                autoComplete="new-password"
                required
              />
              <button
                className="parent-layout-page__table-icon-button"
                type="button"
                onClick={() =>
                  setIsRecoveryKeyVisible((currentValue) => !currentValue)
                }
                aria-label={
                  isRecoveryKeyVisible ? "Hide recovery key" : "Show recovery key"
                }
                title={isRecoveryKeyVisible ? "Hide recovery key" : "Show recovery key"}
              >
                {isRecoveryKeyVisible ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>
          </label>

          <label>
            Confirm recovery key
            <div className="parent-layout-page__table-input-action">
              <input
                type={isConfirmRecoveryKeyVisible ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={12}
                autoComplete="new-password"
                required
              />
              <button
                className="parent-layout-page__table-icon-button"
                type="button"
                onClick={() =>
                  setIsConfirmRecoveryKeyVisible((currentValue) => !currentValue)
                }
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

          {message ? (
            <p className="parent-layout-page__modal-error" role="alert">
              {message}
            </p>
          ) : null}

          <button
            type="submit"
            className="parent-layout-page__modal-submit"
            disabled={isSaving}
          >
            {isSaving ? <LoaderCircle size={16} aria-hidden="true" /> : null}
            <span>{isSaving ? "Creating backup" : "Create backup"}</span>
          </button>

          {onSkip ? (
            <button
              type="button"
              className="parent-layout-page__modal-submit parent-layout-page__modal-submit--secondary"
              onClick={onSkip}
              disabled={isSaving}
            >
              <span>Later</span>
            </button>
          ) : null}
        </form>
      </section>
    </div>
  );
}

export default RecoverySetupModal;
