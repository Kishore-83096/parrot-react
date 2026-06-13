function StoryTabIcon({ size = 24 }) {
  return (
    <svg
      className="parent-layout-page__story-tab-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        className="parent-layout-page__story-tab-icon-orbit"
        d="M18.9 9.1a8 8 0 1 1-5.5-4.9"
      />
      <path
        className="parent-layout-page__story-tab-icon-inner"
        d="M8.2 8.5a6.3 6.3 0 0 0-1.1 6.6M9.5 17.2a6.2 6.2 0 0 0 5 .1"
      />
      <circle
        className="parent-layout-page__story-tab-icon-play-ring"
        cx="16.7"
        cy="7.2"
        r="4.2"
      />
      <path
        className="parent-layout-page__story-tab-icon-play"
        d="M15.6 5.4v3.6l3-1.8-3-1.8Z"
      />
    </svg>
  );
}

export default StoryTabIcon;
