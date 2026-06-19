import { useEffect, useState } from "react";

export function useAnimatedPresence(isPresent, durationMs = 180) {
  const [shouldRender, setShouldRender] = useState(isPresent);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (isPresent) {
      setShouldRender(true);
      setIsExiting(false);
      return undefined;
    }

    if (!shouldRender) {
      setIsExiting(false);
      return undefined;
    }

    setIsExiting(true);
    const timeoutId = globalThis.setTimeout(() => {
      setShouldRender(false);
      setIsExiting(false);
    }, durationMs);

    return () => globalThis.clearTimeout(timeoutId);
  }, [durationMs, isPresent, shouldRender]);

  return { shouldRender, isExiting };
}
