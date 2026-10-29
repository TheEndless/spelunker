import { describe, expect, it } from 'vitest';
import type { UpdateInfo } from './types';
import { CHECK_INTERVAL_MS, bannerShown, checkedAgo, shouldCheckOnStart } from './updatePolicy';

const NOW = 1_800_000_000_000;
const found = (overrides: Partial<UpdateInfo> = {}): UpdateInfo => ({
  current: '1.1.0',
  latest: '1.2.0',
  available: true,
  page: 'https://github.com/TheEndless/spelunker/releases/tag/v1.2.0',
  published: null,
  ...overrides,
});

describe('shouldCheckOnStart', () => {
  it('never checks when the person turned it off', () => {
    expect(shouldCheckOnStart(false, null, NOW)).toBe(false);
    expect(shouldCheckOnStart(false, NOW - 10 * CHECK_INTERVAL_MS, NOW)).toBe(false);
  });

  it('checks the first time', () => {
    expect(shouldCheckOnStart(true, null, NOW)).toBe(true);
  });

  it('checks again only after a day', () => {
    expect(shouldCheckOnStart(true, NOW - 60_000, NOW)).toBe(false);
    expect(shouldCheckOnStart(true, NOW - CHECK_INTERVAL_MS + 1, NOW)).toBe(false);
    expect(shouldCheckOnStart(true, NOW - CHECK_INTERVAL_MS, NOW)).toBe(true);
  });

  it('checks when the last check is in the future, as after the clock was set back', () => {
    expect(shouldCheckOnStart(true, NOW + 5 * CHECK_INTERVAL_MS, NOW)).toBe(true);
  });
});

describe('bannerShown', () => {
  it('is shown for a newer release that was not dismissed', () => {
    expect(bannerShown(found(), null)).toBe(true);
  });

  it('is not shown when nothing newer was found, or nothing was checked', () => {
    expect(bannerShown(found({ available: false }), null)).toBe(false);
    expect(bannerShown(null, null)).toBe(false);
  });

  it('is not shown for the version that was dismissed, but is for a later one', () => {
    expect(bannerShown(found(), '1.2.0')).toBe(false);
    expect(bannerShown(found({ latest: '1.3.0' }), '1.2.0')).toBe(true);
  });
});

describe('checkedAgo', () => {
  it('says when no check has been made', () => {
    expect(checkedAgo(null, NOW)).toBe('Not checked yet');
  });

  it('counts minutes, hours and days, and says one in the singular', () => {
    expect(checkedAgo(NOW - 20_000, NOW)).toBe('Checked just now');
    expect(checkedAgo(NOW - 60_000, NOW)).toBe('Checked 1 minute ago');
    expect(checkedAgo(NOW - 5 * 60_000, NOW)).toBe('Checked 5 minutes ago');
    expect(checkedAgo(NOW - 60 * 60_000, NOW)).toBe('Checked 1 hour ago');
    expect(checkedAgo(NOW - 3 * 60 * 60_000, NOW)).toBe('Checked 3 hours ago');
    expect(checkedAgo(NOW - 24 * 60 * 60_000, NOW)).toBe('Checked 1 day ago');
    expect(checkedAgo(NOW - 4 * 24 * 60 * 60_000, NOW)).toBe('Checked 4 days ago');
  });
});
