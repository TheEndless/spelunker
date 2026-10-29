import type { UpdateInfo } from './types';

/** A check at start-up is made at most this often, so opening the app many times a day asks GitHub once. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Whether the app should look for a newer release as it starts. */
export function shouldCheckOnStart(enabled: boolean, lastCheck: number | null, now: number): boolean {
  if (!enabled) return false;
  if (lastCheck === null) return true;
  // A clock set back leaves a last check in the future, which would otherwise stop checks for good.
  if (lastCheck > now) return true;
  return now - lastCheck >= CHECK_INTERVAL_MS;
}

/** Whether the banner is shown: a newer release was found, and it is not the one that was dismissed. */
export function bannerShown(info: UpdateInfo | null, dismissed: string | null): boolean {
  return info !== null && info.available && info.latest !== dismissed;
}

/** How long ago a check was, in words, for the About tab. */
export function checkedAgo(checkedAt: number | null, now: number): string {
  if (checkedAt === null) return 'Not checked yet';
  const minutes = Math.floor((now - checkedAt) / 60_000);
  if (minutes < 1) return 'Checked just now';
  if (minutes < 60) return `Checked ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Checked ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `Checked ${days} day${days === 1 ? '' : 's'} ago`;
}
