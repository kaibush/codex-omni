import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getCookie, removeCookie, setCookie } from "@/lib/cookies";

type Theme = "dark" | "light" | "system";
type ResolvedTheme = Exclude<Theme, "system">;

const DEFAULT_THEME: Theme = "system";
const THEME_COOKIE_NAME = "vite-ui-theme";
const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  defaultTheme: Theme;
  resolvedTheme: ResolvedTheme;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resetTheme: () => void;
};

const initialState: ThemeProviderState = {
  defaultTheme: DEFAULT_THEME,
  resolvedTheme: "light",
  theme: DEFAULT_THEME,
  setTheme: () => null,
  resetTheme: () => null
};

const ThemeContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME,
  storageKey = THEME_COOKIE_NAME
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(
    () => (getCookie(storageKey) as Theme | undefined) || defaultTheme
  );

  const resolvedTheme = useMemo((): ResolvedTheme => {
    if (theme === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return theme;
  }, [theme]);

  useEffect(() => {
    const root = window.document.documentElement;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = (current: ResolvedTheme) => {
      root.classList.remove("light", "dark");
      root.classList.add(current);
    };
    const handleChange = () => {
      if (theme === "system") applyTheme(mediaQuery.matches ? "dark" : "light");
    };
    applyTheme(resolvedTheme);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme, resolvedTheme]);

  const setTheme = (next: Theme) => {
    setCookie(storageKey, next, THEME_COOKIE_MAX_AGE);
    setThemeState(next);
  };

  const resetTheme = () => {
    removeCookie(storageKey);
    setThemeState(DEFAULT_THEME);
  };

  return (
    <ThemeContext
      value={{
        defaultTheme,
        resolvedTheme,
        resetTheme,
        theme,
        setTheme
      }}
    >
      {children}
    </ThemeContext>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
};
