function GroupPeopleIcon({
  size = 20,
  className = "",
  strokeWidth = 2,
  ...props
}) {
  return (
    <svg
      className={className || undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      {...props}
    >
      <path d="M12 12.6a4.4 4.4 0 1 0 0-8.8 4.4 4.4 0 0 0 0 8.8Z" />
      <path d="M5.1 20.2c.7-4 3.3-6.1 6.9-6.1s6.2 2.1 6.9 6.1" />
      <path d="M5.8 13.5a3.2 3.2 0 1 1 1.6-5.9" />
      <path d="M2.4 19.2c.5-2.7 2.1-4.5 4.4-5.2" />
      <path d="M18.2 13.5a3.2 3.2 0 1 0-1.6-5.9" />
      <path d="M21.6 19.2c-.5-2.7-2.1-4.5-4.4-5.2" />
    </svg>
  );
}

export default GroupPeopleIcon;
