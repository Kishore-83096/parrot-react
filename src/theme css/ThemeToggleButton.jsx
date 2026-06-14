import { Moon, Sun } from "@/components/icons";

import { useTheme } from "./themeManager.jsx";

function ThemeToggleButton({
  className = "",
  showLabel = false,
  size = 18,
}) {
  const { isDarkTheme, toggleTheme } = useTheme();
  const Icon = isDarkTheme ? Sun : Moon;
  const label = isDarkTheme ? "Switch to light theme" : "Switch to dark theme";

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
