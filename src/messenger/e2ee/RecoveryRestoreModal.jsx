import { Eye, EyeOff, KeyRound, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { restoreRecoveryKeyBackup } from "./recovery.js";

function RecoveryRestoreModal({
  backup,
  maxAttempts = 5,
  onFailedAttemptsExceeded,
  onRestore,
  user,
}) {
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [isRecoveryKeyVisible, setIsRecoveryKeyVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [isRestoring, setIsRestoring] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    setIsRestoring(true);
    setMessage("");

    try {
      const result = await restoreRecoveryKeyBackup(user, backup, recoveryPassword);
      setRecoveryPassword("");
      onRestore?.(result);
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
      setIsRestoring(false);
    }
  };

  return (
    <div className="parent-layout-page__modal-backdrop" role="presentation">
      <section
        className="parent-layout-page__modal parent-layout-page__modal--account"
        role="dialog"
        aria-modal="true"
        aria-labelledby="e2ee-restore-title"
      >
        <div className="parent-layout-page__modal-header">
          <KeyRound size={28} aria-hidden="true" />
          <div>
            <p>Encrypted messages</p>
            <h2 id="e2ee-restore-title">Recover this device</h2>
          </div>
        </div>

        <form className="parent-layout-page__modal-form" onSubmit={handleSubmit}>
          <div className="parent-layout-page__form-note">
            <strong>Why this matters:</strong> This device needs your recovery
            key before it can show old messages.
            <ul>
              <li>Enter the exact key you saved earlier.</li>
              <li>Check carefully for typing mistakes.</li>
              <li>Do not guess. After 5 wrong tries, you will be logged out.</li>
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
            disabled={isRestoring}
          >
            {isRestoring ? <LoaderCircle size={16} aria-hidden="true" /> : null}
            <span>{isRestoring ? "Recovering" : "Recover messages"}</span>
          </button>
        </form>
      </section>
    </div>
  );
}

export default RecoveryRestoreModal;
