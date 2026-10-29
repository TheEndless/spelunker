import { checkForUpdates } from './backend';
import type { Preferences } from './preferences.svelte';
import type { UpdateInfo } from './types';
import { bannerShown, shouldCheckOnStart } from './updatePolicy';

export type CheckState = 'idle' | 'checking' | 'failed';

/**
 * What the app knows about newer releases: the last answer, whether a check is running, and why the
 * last one failed. The About tab and the banner share one, so a check from either shows in both.
 */
export class UpdateChecker {
  info = $state<UpdateInfo | null>(null);
  state = $state<CheckState>('idle');
  failure = $state('');

  constructor(private readonly preferences: Preferences) {}

  /** The release the banner announces, or null when there is none or it was dismissed. */
  get announced(): UpdateInfo | null {
    return this.info && bannerShown(this.info, this.preferences.dismissedUpdate) ? this.info : null;
  }

  /** Checks as the app starts, unless the person turned that off or a check was made in the last day. */
  checkOnStart(): void {
    if (shouldCheckOnStart(this.preferences.checkForUpdates, this.preferences.lastUpdateCheck, Date.now())) {
      void this.check({ quiet: true });
    }
  }

  /** `quiet` is for a check nobody asked for: when it fails, the person is not told. */
  async check({ quiet = false } = {}): Promise<void> {
    if (this.state === 'checking') return;
    this.state = 'checking';
    this.failure = '';
    try {
      this.info = await checkForUpdates();
      this.preferences.lastUpdateCheck = Date.now();
      this.preferences.save();
      this.state = 'idle';
    } catch (error) {
      if (quiet) {
        this.state = 'idle';
      } else {
        this.failure = String(error);
        this.state = 'failed';
      }
    }
  }

  /** Hides the banner for the version it announces. A later release brings it back. */
  dismiss(): void {
    if (!this.info) return;
    this.preferences.dismissedUpdate = this.info.latest;
    this.preferences.save();
  }
}
