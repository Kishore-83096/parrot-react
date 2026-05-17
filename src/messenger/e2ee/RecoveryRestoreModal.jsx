import { KeyRound, LoaderCircle, X } from "lucide-react";
import { useState } from "react";

import { restoreRecoveryKeyBackup } from "./recovery.js";

function RecoveryRestoreModal({ backup, onRestore, onUseNewKey, user }) {
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isRestoring, setIsRestoring] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    setIsRestoring(true);
    setMessage("");

    try {
      const result = await restoreRecoveryKeyBackup(user, backup, recoveryPassword);
      onRestore?.(result);
    } catch {
      setMessage("Recovery password is incorrect or this backup is damaged.");
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
        <button
          type="button"
          className="parent-layout-page__modal-close"
          onClick={onUseNewKey}
          aria-label="Skip recovery"
          title="Skip recovery"
        >
          <X size={18} aria-hidden="true" />
        </button>

        <div className="parent-layout-page__modal-header">
          <KeyRound size={28} aria-hidden="true" />
          <div>
            <p>Encrypted messages</p>
            <h2 id="e2ee-restore-title">Recover this device</h2>
          </div>
        </div>

        <form className="parent-layout-page__modal-form" onSubmit={handleSubmit}>
          <p className="parent-layout-page__form-note">
            Enter your recovery password to decrypt old messages on this device.
          </p>

          <label>
            Recovery password
            <input
              type="password"
              value={recoveryPassword}
              onChange={(event) => setRecoveryPassword(event.target.value)}
              autoComplete="current-password"
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
            disabled={isRestoring}
          >
            {isRestoring ? <LoaderCircle size={16} aria-hidden="true" /> : null}
            <span>{isRestoring ? "Recovering" : "Recover messages"}</span>
          </button>

          <button
            type="button"
            className="parent-layout-page__modal-submit parent-layout-page__modal-submit--secondary"
            onClick={onUseNewKey}
            disabled={isRestoring}
          >
            <span>Use new key</span>
          </button>
        </form>
      </section>
    </div>
  );
}

export default RecoveryRestoreModal;
