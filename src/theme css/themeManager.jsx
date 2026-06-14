import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const THEME_STORAGE_KEY = "parrot-theme";
export const THEMES = ["light", "dark"];
export const DEFAULT_THEME = "light";

const ThemeContext = createContext(null);

function isSupportedTheme(theme) {
  return THEMES.includes(theme);
}

export function getStoredTheme() {
  if (typeof window === "undefined") {
    return DEFAULT_THEME;
  }

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isSupportedTheme(storedTheme) ? storedTheme : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme) {
  if (typeof document === "undefined") {
    return;
  }

  const nextTheme = isSupportedTheme(theme) ? theme : DEFAULT_THEME;
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;
}

export function initializeTheme() {
  applyTheme(getStoredTheme());
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => getStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setAppTheme = useCallback((nextTheme) => {
    const resolvedTheme = isSupportedTheme(nextTheme) ? nextTheme : DEFAULT_THEME;

    setTheme(resolvedTheme);
    applyTheme(resolvedTheme);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, resolvedTheme);
    } catch {
      // Theme switching should keep working even when storage is unavailable.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setAppTheme(theme === "dark" ? "light" : "dark");
  }, [setAppTheme, theme]);

  const value = useMemo(
    () => ({
      isDarkTheme: theme === "dark",
      setTheme: setAppTheme,
      theme,
      toggleTheme,
    }),
    [setAppTheme, theme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }

  return context;
}
