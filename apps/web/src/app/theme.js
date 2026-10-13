// The colour theme: the person's choice (system, light or dark), remembered in this browser and
// applied as data-theme on <html>, which the stylesheet's tokens follow. "System" tracks the
// operating system's setting live. public/theme-boot.js applies the same choice before first paint.
import { useSyncExternalStore } from 'react';

const KEY = 'syncspace.theme';
const CHROME = { light: '#E6E4EC', dark: '#14121C' };
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

function readPreference() {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

let preference = readPreference();
let snapshot = '';

export function resolveTheme(choice, systemDark = media.matches) {
  if (choice === 'light' || choice === 'dark') return choice;
  return systemDark ? 'dark' : 'light';
}

function apply() {
  const theme = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[theme]);
  snapshot = `${preference}:${theme}`;
  listeners.forEach((listener) => listener());
}

media.addEventListener('change', () => {
  if (preference === 'system') apply();
});

// Another tab changed the theme.
window.addEventListener('storage', (event) => {
  if (event.key !== KEY) return;
  preference = readPreference();
  apply();
});

apply();

/** @param {'system' | 'light' | 'dark'} next */
export function setThemePreference(next) {
  preference = next;
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // Not remembered, but still applied for this visit.
  }
  apply();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** @returns {{ preference: 'system' | 'light' | 'dark', theme: 'light' | 'dark' }} */
export function useTheme() {
  const value = useSyncExternalStore(subscribe, () => snapshot);
  const [choice, theme] = value.split(':');
  return { preference: choice, theme };
}

/** Calls `listener` whenever the applied theme changes (for code outside React, like the 3D scene). */
export function onThemeChange(listener) {
  return subscribe(listener);
}

export function currentTheme() {
  return resolveTheme(preference);
}
