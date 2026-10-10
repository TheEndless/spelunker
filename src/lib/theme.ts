import type { Mode } from './palettes';
import type { ThemePreference } from './types';

export function resolveTheme(preference: ThemePreference, systemIsDark: boolean): Mode {
  if (preference === 'system') return systemIsDark ? 'dark' : 'light';
  return preference;
}
