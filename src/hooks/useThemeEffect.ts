import { useEffect } from "react";
import { useSettingsStore } from "../store/settingsStore";

/**
 * Syncs theme state from settingsStore to <html> classes.
 * - `.dark` toggles the dark-mode CSS-variable block in index.css
 * - `.reduce-motion` opts into the user-controlled reduced-motion override
 *   (CSS-wise: same rule body as `@media (prefers-reduced-motion: reduce)`).
 *   This is independent from the OS preference — either trigger kills animations.
 *
 * Call once in App.tsx.
 */
export function useThemeEffect() {
  const mode = useSettingsStore((s) => s.theme.mode);
  const reducedMotion = useSettingsStore((s) => s.theme.reducedMotion);

  useEffect(() => {
    const root = document.documentElement;

    // Brief transition class for smooth color change
    root.classList.add("theme-transition");

    if (mode === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    // Remove transition class after animation completes
    const timer = setTimeout(() => root.classList.remove("theme-transition"), 250);
    return () => clearTimeout(timer);
  }, [mode]);

  useEffect(() => {
    const root = document.documentElement;
    if (reducedMotion) {
      root.classList.add("reduce-motion");
    } else {
      root.classList.remove("reduce-motion");
    }
  }, [reducedMotion]);
}
