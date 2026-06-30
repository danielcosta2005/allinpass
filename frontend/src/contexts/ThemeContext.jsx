import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';

export const THEME_STORAGE_KEY = 'allinpass-theme';

const DEFAULT_THEME = 'light';
const VALID_THEMES = new Set(['light', 'dark']);

const ThemeContext = createContext(null);

function getStoredTheme() {
  if (typeof window === 'undefined') return DEFAULT_THEME;

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return VALID_THEMES.has(storedTheme) ? storedTheme : DEFAULT_THEME;
  } catch (_) {
    return DEFAULT_THEME;
  }
}

function persistTheme(theme) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (_) {
    // Ignore storage failures; the visible theme should still update.
  }
}

function applyDocumentTheme(theme) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
}

function resetDocumentTheme() {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  root.classList.remove('dark');
  root.style.colorScheme = 'light';
}

function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getStoredTheme);
  const isDarkTheme = theme === 'dark';

  useLayoutEffect(() => {
    return resetDocumentTheme;
  }, []);

  useLayoutEffect(() => {
    applyDocumentTheme(theme);
    persistTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo(() => ({
    isDarkTheme,
    setTheme,
    theme,
    toggleTheme,
  }), [isDarkTheme, theme, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }

  return context;
}

export { ThemeProvider, useTheme };
