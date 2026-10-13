import { Monitor, Moon, Sun } from 'lucide-react';
import { setThemePreference, useTheme } from '../app/theme.js';
import { Menu } from './Menu.jsx';

const CHOICES = [
  { key: 'system', label: 'Match this device', icon: Monitor },
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'dark', label: 'Dark', icon: Moon },
];

/** The colour theme switch: system, light or dark. */
export function ThemeMenu({ className = '' }) {
  const { preference, theme } = useTheme();
  const Icon = theme === 'dark' ? Moon : Sun;
  const current = CHOICES.find((choice) => choice.key === preference);
  return (
    <Menu
      label="Theme"
      items={CHOICES.map((choice) => ({
        key: choice.key,
        label: choice.label,
        icon: choice.icon,
        checked: choice.key === preference,
        onSelect: () => setThemePreference(choice.key),
      }))}
      trigger={
        <button
          type="button"
          aria-label={`Theme: ${current.label}${preference === 'system' ? ` (${theme})` : ''}`}
          title="Theme"
          className={`grid h-10 w-10 place-items-center rounded-md text-graphite hover:bg-ink/6 hover:text-ink ${className}`}
        >
          <Icon aria-hidden="true" size={18} />
        </button>
      }
    />
  );
}
