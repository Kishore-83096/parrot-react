import { Eye, EyeOff, KeyRound, LoaderCircle, X } from "@/components/icons";
import { useState } from "react";

import { verifyRecoveryKeyBackup } from "./recovery.js";

function RecoveryVerifyModal({
  backup,
  maxAttempts = 5,
  onClose,
  onFailedAttemptsExceeded,
  onVerify,
  user,
}) {
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [isRecoveryKeyVisible, setIsRecoveryKeyVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    setIsVerifying(true);
    setMessage("");

    try {
      const result = await verifyRecoveryKeyBackup(
        user,
        backup,
        recoveryPassword,
      );
      setRecoveryPassword("");
      onVerify?.(result);
    } catch {
      const nextFailedAttempts = failedAttempts + 1;
      const remainingAttempts = Math.max(maxAttempts - nextFailedAttempts, 0);

      setFailedAttempts(nextFailedAttempts);
      setRecoveryPassword("");

      if (remainingAttempts <= 0) {
        setMessage("Recovery key is not correct. Logging out.");
        onFailedAttemptsExceeded?.();
        return;
      }

      setMessage(
        `Recovery key is not correct. ${remainingAttempts} ${
          remainingAttempts === 1 ? "try" : "tries"
        } left.`,
      );
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal parent-layout-page__modal--account"
        role="dialog"
        aria-modal="true"
        aria-labelledby="e2ee-verify-title"
      >
        {onClose ? (
          <button
            type="button"
            className="parent-layout-page__modal-close"
            onClick={onClose}
            aria-label="Close recovery key"
            title="Close"
          >
            <X size={18} aria-hidden="true" />
          </button>
        ) : null}

        <div className="parent-layout-page__modal-header">
          <KeyRound size={28} aria-hidden="true" />
          <div>
            <p>Encrypted messages</p>
            <h2 id="e2ee-verify-title">Confirm recovery key</h2>
          </div>
        </div>

        <form className="parent-layout-page__modal-form" onSubmit={handleSubmit}>
          <div className="parent-layout-page__form-note">
            <strong>Why this matters:</strong> The recovery key was updated on
            the default device. This device needs the current key confirmed, but
            it will not save or show the key here.
            <ul>
              <li>Enter the newest recovery key.</li>
              <li>The key is checked locally against the encrypted backup.</li>
              <li>After 5 wrong tries, this device will be logged out.</li>
            </ul>
          </div>

          <label>
            Recovery key
            <div className="parent-layout-page__table-input-action">
              <input
                type={isRecoveryKeyVisible ? "text" : "password"}
                value={recoveryPassword}
                onChange={(event) => setRecoveryPassword(event.target.value)}
                autoComplete="current-password"
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

          {message ? (
            <p className="parent-layout-page__modal-error" role="alert">
              {message}
            </p>
          ) : null}

          <button
            type="submit"
            className="parent-layout-page__modal-submit"
            disabled={isVerifying}
          >
            {isVerifying ? <LoaderCircle size={16} aria-hidden="true" /> : null}
            <span>{isVerifying ? "Checking" : "Confirm key"}</span>
          </button>
        </form>
      </section>
    </div>
  );
}

export default RecoveryVerifyModal;
