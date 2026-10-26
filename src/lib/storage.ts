import demoLesson from "@/fixtures/demo-lesson.json";
import { initialState } from "./ledger";
import { AppStateSchema, type AppState } from "./schema";

/**
 * On-device persistence (localStorage). Versioned and schema-validated on load.
 * Does NOT sync across devices or browsers.
 */

export const STORAGE_KEY = "daily-signal:state";
const BACKUP_KEY = "daily-signal:corrupt-backup";

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** schemaVersion N -> N+1. Add entries here when the shape changes. */
const MIGRATIONS: Record<number, Migration> = {
  // v2 adds reviewBank and per-section reviewQuestion. v1 could only cache the
  // bundled sample lesson, so refresh cached copies of it from the fixture.
  1: (raw) => {
    const lessons = { ...((raw.lessons as Record<string, { id?: string }>) ?? {}) };
    for (const [date, l] of Object.entries(lessons)) if (l?.id === demoLesson.id) lessons[date] = demoLesson;
    return { ...raw, schemaVersion: 2, reviewBank: {}, lessons };
  },
};
const CURRENT_VERSION = 2;

export function parseState(json: string | null): { state: AppState; recovered: boolean } {
  if (!json) return { state: initialState(), recovered: false };
  try {
    let raw = JSON.parse(json) as Record<string, unknown>;
    let v = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;
    while (v < CURRENT_VERSION) {
      const m = MIGRATIONS[v];
      if (!m) throw new Error(`No migration from v${v}`);
      raw = m(raw);
      v += 1;
    }
    return { state: AppStateSchema.parse(raw), recovered: false };
  } catch {
    return { state: initialState(), recovered: true };
  }
}

export function loadState(): { state: AppState; recovered: boolean } {
  const json = window.localStorage.getItem(STORAGE_KEY);
  const result = parseState(json);
  if (result.recovered && json) window.localStorage.setItem(BACKUP_KEY, json);
  return result;
}

export function saveState(state: AppState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetState(): AppState {
  window.localStorage.removeItem(STORAGE_KEY);
  return initialState();
}
