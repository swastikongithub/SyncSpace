// Applies the saved colour theme before the first paint, so a dark page never flashes light.
// Kept tiny and external (the Content Security Policy allows no inline scripts). The live logic,
// including the switch, is in src/app/theme.js; both read the same storage key.
(() => {
  let preference = 'system';
  try {
    preference = localStorage.getItem('syncspace.theme') || 'system';
  } catch {
    // Storage unavailable (private mode, blocked): follow the system.
  }
  const dark = preference === 'dark' || (preference !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
