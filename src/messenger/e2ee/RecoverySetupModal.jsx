import { KeyRound, LoaderCircle, X } from "lucide-react";
import { useState } from "react";

import { saveRecoveryKeyBackup } from "./recovery.js";

function RecoverySetupModal({ onComplete, onSkip, user }) {
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (recoveryPassword !== confirmPassword) {
      setMessage("Recovery passwords do not match.");
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
        <button
          type="button"
          className="parent-layout-page__modal-close"
          onClick={onSkip}
          aria-label="Close recovery setup"
          title="Close"
        >
          <X size={18} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header">
          <KeyRound size={28} aria-hidden="true" />
          <div>
            <p>Encrypted messages</p>
            <h2 id="e2ee-recovery-title">Recovery password</h2>
          </div>
        </div>

        <form className="parent-layout-page__modal-form" onSubmit={handleSubmit}>
          <p className="parent-layout-page__form-note">
            This password is not stored. Losing it means old messages cannot be
            recovered on a new device.
          </p>

          <label>
            Recovery password
            <input
              type="password"
              value={recoveryPassword}
              onChange={(event) => setRecoveryPassword(event.target.value)}
              minLength={12}
              autoComplete="new-password"
              required
            />
          </label>

          <label>
            Confirm recovery password
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={12}
              autoComplete="new-password"
              required
            />
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

          <button
            type="button"
            className="parent-layout-page__modal-submit parent-layout-page__modal-submit--secondary"
            onClick={onSkip}
            disabled={isSaving}
          >
            <span>Later</span>
          </button>
        </form>
      </section>
    </div>
  );
}

export default RecoverySetupModal;
