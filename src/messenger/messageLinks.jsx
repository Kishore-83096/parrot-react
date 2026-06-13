import { ExternalLink, Link2 } from "@/components/icons";

const URL_PATTERN =
  /((?:https?:\/\/|www\.)[^\s<>"']+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|edu|gov|io|co|ai|app|dev|me|in|uk|us|info|biz|xyz|site|online|tech|store|cloud|link|ly|tv)(?:\/[^\s<>"']*)?)/gi;
const TRAILING_PUNCTUATION_PATTERN = /[.,!?;:]+$/;
const CLOSING_PAIRS = [
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
];

function countCharacter(value, character) {
  return Array.from(value).filter((current) => current === character).length;
}

function trimTrailingUrlPunctuation(value) {
  let url = value;

  while (TRAILING_PUNCTUATION_PATTERN.test(url)) {
    url = url.replace(TRAILING_PUNCTUATION_PATTERN, "");
  }

  let didTrimClosingCharacter = true;

  while (didTrimClosingCharacter) {
    didTrimClosingCharacter = false;

    CLOSING_PAIRS.forEach(([openingCharacter, closingCharacter]) => {
      if (
        url.endsWith(closingCharacter) &&
        countCharacter(url, closingCharacter) > countCharacter(url, openingCharacter)
      ) {
        url = url.slice(0, -1);
        didTrimClosingCharacter = true;
      }
    });
  }

  return url;
}

function getMessageLinkHref(url) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return `https://${url}`;
}

function getMessageLinkHost(href, fallback) {
  try {
    return new URL(href).hostname.replace(/^www\./i, "");
  } catch {
    return fallback;
  }
}

function getMessageLinkDisplayText(link) {
  try {
    const url = new URL(link.href);
    const path = `${url.pathname || ""}${url.search || ""}`.replace(/\/$/, "");
    const displayText = `${url.hostname.replace(/^www\./i, "")}${path}`;

    return displayText || link.text;
  } catch {
    return link.text;
  }
}

export function extractMessageLinks(text) {
  const value = String(text || "");
  const pattern = new RegExp(URL_PATTERN);
  const links = [];
  let match = pattern.exec(value);

  while (match) {
    const rawUrl = match[0];
    const url = trimTrailingUrlPunctuation(rawUrl);

    if (url) {
      links.push({
        end: match.index + url.length,
        href: getMessageLinkHref(url),
        start: match.index,
        text: url,
      });
    }

    match = pattern.exec(value);
  }

  return links;
}

export function MessageLinkPreview({ links }) {
  const primaryLink = Array.isArray(links) ? links[0] : null;

  if (!primaryLink) {
    return null;
  }

  const host = getMessageLinkHost(primaryLink.href, primaryLink.text);
  const displayText = getMessageLinkDisplayText(primaryLink);
  const extraLinkCount = Math.max(links.length - 1, 0);

  return (
    <a
      className="parent-layout-page__message-link-card"
      href={primaryLink.href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      aria-label={`Open link to ${host}`}
      title={primaryLink.href}
    >
      <span className="parent-layout-page__message-link-icon" aria-hidden="true">
        <Link2 size={16} />
      </span>
      <span className="parent-layout-page__message-link-copy">
        <span className="parent-layout-page__message-link-tag">Link</span>
        <strong>{host}</strong>
        <small>
          {displayText}
          {extraLinkCount > 0 ? ` +${extraLinkCount} more` : ""}
        </small>
      </span>
      <ExternalLink size={15} aria-hidden="true" />
    </a>
  );
}

export function MessageTextWithLinks({ links, text }) {
  const value = String(text || "");
  const safeLinks = Array.isArray(links) ? links : extractMessageLinks(value);
  const parts = [];
  let cursor = 0;

  safeLinks.forEach((link, index) => {
    if (link.start > cursor) {
      parts.push(value.slice(cursor, link.start));
    }

    parts.push(
      <a
        href={link.href}
        key={`${link.href}-${link.start}-${index}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        title={link.href}
      >
        {value.slice(link.start, link.end)}
      </a>,
    );

    cursor = link.end;
  });

  if (cursor < value.length) {
    parts.push(value.slice(cursor));
  }

  return <p className="parent-layout-page__message-text">{parts}</p>;
}
