import { useEffect, useMemo, useState } from "react";

export const IMAGE_CLOUD_ERROR_MESSAGE = "Unable to load image from the cloud.";

function firstLetter(value) {
  const match = String(value || "").match(/[A-Za-z]/);

  return match ? match[0].toUpperCase() : "";
}

export function getAvatarInitials({
  fallback = "P",
  firstName,
  lastName,
  maxLetters = 2,
  name,
  username,
} = {}) {
  const nameInitials = [firstLetter(firstName), firstLetter(lastName)]
    .filter(Boolean)
    .join("");

  if (nameInitials) {
    return nameInitials.slice(0, maxLetters);
  }

  const usernameInitial = firstLetter(username);
  if (usernameInitial) {
    return usernameInitial;
  }

  const source = String(name || "");
  const tokenInitials = source
    .split(/\s+/)
    .map(firstLetter)
    .filter(Boolean)
    .join("");

  if (tokenInitials) {
    return tokenInitials.slice(0, maxLetters);
  }

  return firstLetter(fallback) || "P";
}

function SmartAvatar({
  alt = "",
  ariaHidden = true,
  children,
  className,
  fallback = "P",
  firstName,
  imageErrorMessage = IMAGE_CLOUD_ERROR_MESSAGE,
  initials,
  lastName,
  maxLetters = 2,
  name,
  src,
  title,
  username,
}) {
  const [imageStatus, setImageStatus] = useState(src ? "loading" : "missing");

  useEffect(() => {
    setImageStatus(src ? "loading" : "missing");
  }, [src]);

  const fallbackText = useMemo(
    () =>
      initials ||
      getAvatarInitials({
        fallback,
        firstName,
        lastName,
        maxLetters,
        name,
        username,
      }),
    [fallback, firstName, initials, lastName, maxLetters, name, username],
  );
  const hasImageError = Boolean(src) && imageStatus === "error";
  const shouldShowImage = Boolean(src) && imageStatus !== "error";
  const avatarTitle = hasImageError ? imageErrorMessage : title;

  return (
    <span
      className={className}
      aria-hidden={ariaHidden ? "true" : undefined}
      aria-label={ariaHidden ? undefined : avatarTitle || alt || fallbackText}
      data-image-state={imageStatus}
      title={avatarTitle}
    >
      {shouldShowImage ? (
        <img
          src={src}
          alt={alt}
          onLoad={() => setImageStatus("ready")}
          onError={() => setImageStatus("error")}
        />
      ) : null}
      {!shouldShowImage ? (
        <span className="parent-avatar-fallback">{fallbackText}</span>
      ) : null}
      {children}
    </span>
  );
}

export default SmartAvatar;
