import { loadSavedSearches, saveSavedSearches } from './backend';
import type { Criteria } from './criteria';
import {
  parseSavedSearches,
  removeSavedSearch,
  upsertSavedSearch,
  type SavedSearch,
} from './savedSearches';

/** The saved searches list, kept in sync with the file the backend owns. */
export class SavedSearchStore {
  searches = $state.raw<SavedSearch[]>([]);
  /** A problem worth showing next to the menu, such as an unreadable file that was set aside. */
  notice = $state<string | null>(null);

  constructor() {
    void this.reload();
  }

  async reload() {
    try {
      const loaded = await loadSavedSearches();
      this.searches = parseSavedSearches(loaded.json);
      this.notice = loaded.warning;
    } catch (error) {
      this.notice = `Could not load saved searches: ${error}`;
    }
  }

  async save(name: string, criteria: Criteria) {
    await this.write(upsertSavedSearch(this.searches, { name: name.trim(), criteria }));
  }

  async remove(name: string) {
    await this.write(removeSavedSearch(this.searches, name));
  }

  /** Updates the list only after the backend accepted it, so the menu never shows unsaved state. */
  private async write(next: SavedSearch[]) {
    try {
      await saveSavedSearches(JSON.stringify(next));
      this.searches = next;
      this.notice = null;
    } catch (error) {
      this.notice = `Could not save: ${error}`;
    }
  }
}
