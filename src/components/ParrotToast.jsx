import { AlertCircle, CheckCircle2, Info } from "@/components/icons";
import { useEffect } from "react";

import "./ParrotToast.css";

function ParrotToast({ toast, onClose, duration = 10000 }) {
  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      onClose?.();
    }, duration);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [duration, onClose, toast]);

  if (!toast) {
    return null;
  }

  const isSuccess = toast.type === "success";
  const isInfo = toast.type === "info";
  const toastType = isSuccess ? "success" : isInfo ? "info" : "error";
  const Icon = isSuccess ? CheckCircle2 : isInfo ? Info : AlertCircle;

  return (
    <aside
      className={`parrot-toast parrot-toast--${toastType}`}
      role="status"
      aria-live="polite"
    >
      <div className="parrot-toast__icon" aria-hidden="true">
        <Icon size={22} />
      </div>

      <div className="parrot-toast__content">
        <strong>{toast.title}</strong>
        {toast.message ? <p>{toast.message}</p> : null}

        {toast.details?.length ? (
          <dl className="parrot-toast__details">
            {toast.details.map(({ label, value }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || "Not available"}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      <button
        className="parrot-toast__close"
        type="button"
        onClick={onClose}
        aria-label="Close message"
        title="Close"
      >
        <span aria-hidden="true">X</span>
      </button>
    </aside>
  );
}

export default ParrotToast;
