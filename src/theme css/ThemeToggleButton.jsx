import { Moon, Sun } from "@/components/icons";

import { useTheme } from "./themeManager.jsx";

function ThemeToggleButton({
  className = "",
  iconMode = "target",
  showLabel = false,
  size = 18,
}) {
  const { isDarkTheme, toggleTheme } = useTheme();
  const Icon =
    iconMode === "current"
      ? isDarkTheme
        ? Moon
        : Sun
      : isDarkTheme
        ? Sun
        : Moon;
  const actionLabel = isDarkTheme ? "Switch to light theme" : "Switch to dark theme";
  const label =
    iconMode === "current"
      ? `${isDarkTheme ? "Dark theme" : "Light theme"}. ${actionLabel}`
      : actionLabel;

  return (
    <button
      className={`theme-toggle-button${className ? ` ${className}` : ""}`}
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      aria-pressed={isDarkTheme}
    >
      <Icon size={size} aria-hidden="true" />
      {showLabel ? (
        <span>{isDarkTheme ? "Light" : "Dark"}</span>
      ) : null}
    </button>
  );
}

export default ThemeToggleButton;
