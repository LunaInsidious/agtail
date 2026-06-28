import { useEffect, useState } from "react";

type Theme = "dark" | "light";
const KEY = "agtail.theme";

// Persisted choice wins; otherwise follow the OS preference, defaulting to dark
// (the app's original look).
function initialTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Light/dark theme, applied as `data-theme` on <html> and persisted. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}
