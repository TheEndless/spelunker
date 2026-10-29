import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateInfo } from './types';

const checkForUpdates = vi.fn<() => Promise<UpdateInfo>>();
vi.mock('./backend', () => ({ checkForUpdates: () => checkForUpdates() }));

import { Preferences } from './preferences.svelte';
import { UpdateChecker } from './updates.svelte';
import { CHECK_INTERVAL_MS } from './updatePolicy';

const newer: UpdateInfo = {
  current: '1.1.0',
  latest: '1.2.0',
  available: true,
  page: 'https://github.com/TheEndless/spelunker/releases/tag/v1.2.0',
  published: null,
};

describe('UpdateChecker', () => {
  beforeEach(() => {
    checkForUpdates.mockReset();
    const stored = new Map<string, string>();
    vi.stubGlobal('window', { addEventListener: () => {} });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the banner after finding a newer release, and records when it looked', async () => {
    checkForUpdates.mockResolvedValue(newer);
    const preferences = new Preferences();
    const checker = new UpdateChecker(preferences);
    await checker.check();
    expect(checker.state).toBe('idle');
    expect(checker.announced).toEqual(newer);
    expect(preferences.lastUpdateCheck).not.toBeNull();
  });

  it('hides the banner for a dismissed version only', async () => {
    checkForUpdates.mockResolvedValue(newer);
    const preferences = new Preferences();
    const checker = new UpdateChecker(preferences);
    await checker.check();
    checker.dismiss();
    expect(checker.announced).toBeNull();
    expect(preferences.dismissedUpdate).toBe('1.2.0');
    checkForUpdates.mockResolvedValue({ ...newer, latest: '1.3.0' });
    await checker.check();
    expect(checker.announced?.latest).toBe('1.3.0');
  });

  it('keeps the reason a check failed, and does not count it as a check', async () => {
    checkForUpdates.mockRejectedValue('Could not reach GitHub.');
    const preferences = new Preferences();
    const checker = new UpdateChecker(preferences);
    await checker.check();
    expect(checker.state).toBe('failed');
    expect(checker.failure).toBe('Could not reach GitHub.');
    expect(preferences.lastUpdateCheck).toBeNull();
    expect(checker.announced).toBeNull();
  });

  it('says nothing when a check made at start fails', async () => {
    checkForUpdates.mockRejectedValue('Could not reach GitHub.');
    const checker = new UpdateChecker(new Preferences());
    await checker.check({ quiet: true });
    expect(checker.state).toBe('idle');
    expect(checker.failure).toBe('');
  });

  it('does not start a second check while one runs', async () => {
    let finish: (info: UpdateInfo) => void = () => {};
    checkForUpdates.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const checker = new UpdateChecker(new Preferences());
    const first = checker.check();
    await checker.check();
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    finish(newer);
    await first;
  });

  it('checks at start only when allowed and due', () => {
    checkForUpdates.mockResolvedValue(newer);
    const off = new Preferences();
    off.checkForUpdates = false;
    new UpdateChecker(off).checkOnStart();
    expect(checkForUpdates).not.toHaveBeenCalled();

    const recent = new Preferences();
    recent.lastUpdateCheck = Date.now() - CHECK_INTERVAL_MS / 2;
    new UpdateChecker(recent).checkOnStart();
    expect(checkForUpdates).not.toHaveBeenCalled();

    new UpdateChecker(new Preferences()).checkOnStart();
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });
});
