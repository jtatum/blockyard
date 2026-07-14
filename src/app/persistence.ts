/**
 * Persistence (product spec §3.11 P1-P4): IndexedDB autosave of the raw
 * encoded town, plus URL fragment sharing via compressed share codes.
 *
 * Autosave stores the UNcompressed encodeTown bytes — IDB has no size
 * pressure and skipping deflate keeps the debounced write cheap. Only share
 * codes pay for compression. IDB access uses the raw API (promisified
 * inline) to stay dependency-free; every autosave failure is swallowed with
 * a console warning because saving must never break the toy.
 */

import { encodeTown, encodeShareCode } from '../town/serialize';
import type { Town } from '../town/town';

const DB_NAME = 'blockyard';
const STORE = 'saves';
const KEY = 'autosave';
const DEBOUNCE_MS = 600;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** run one request in its own transaction; closes the db either way */
async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Debounced IndexedDB autosave. Subscribes to town changes for the life of
 * the app (Town has no unsubscribe — intentional, towns and autosaves are
 * app-lifetime singletons). Also flushes when the tab is hidden, which
 * additionally captures timeOfDay tweaks that don't go through apply().
 */
export class Autosave {
  private readonly town: Town;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(town: Town) {
    this.town = town;
    town.onChange(() => this.schedule());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
  }

  private schedule(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.persist();
    }, DEBOUNCE_MS);
  }

  private flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    void this.persist();
  }

  private async persist(): Promise<void> {
    try {
      await withStore('readwrite', (store) => store.put(encodeTown(this.town), KEY));
    } catch (err) {
      console.warn('[blockyard] autosave failed', err);
    }
  }
}

export async function loadAutosave(): Promise<Uint8Array | null> {
  try {
    const result: unknown = await withStore('readonly', (store) => store.get(KEY));
    return result instanceof Uint8Array ? result : null;
  } catch {
    // IDB unavailable (private mode etc.) — boot with a fresh town
    return null;
  }
}

export async function clearAutosave(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(KEY));
  } catch {
    // nothing to clear if IDB is unavailable
  }
}

// -- URL sharing --------------------------------------------------------------

/** shareable link for the current town: origin + path + '#t=' + code */
export async function townToUrl(town: Town): Promise<string> {
  const code = await encodeShareCode(town);
  return location.origin + location.pathname + '#t=' + code;
}

/** share code from the current URL fragment, or null if none */
export function shareCodeFromUrl(): string | null {
  const m = /[#&]t=([A-Za-z0-9_-]+)/.exec(location.hash);
  return m ? m[1]! : null;
}
