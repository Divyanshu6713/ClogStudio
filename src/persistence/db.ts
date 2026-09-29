// Minimal promise wrapper over IndexedDB. Kept private to the persistence
// layer; the rest of the app talks to the repository interfaces.

const DB_NAME = 'clog-studio';
const DB_VERSION = 1;

export const STORES = {
  projects: 'projects', // key: project id → Project JSON
  assets: 'assets', // key: asset id → StoredAssetBlobs
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser does not provide IndexedDB, so projects cannot be saved locally.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.projects)) db.createObjectStore(STORES.projects);
      if (!db.objectStoreNames.contains(STORES.assets)) db.createObjectStore(STORES.assets);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open local database'));
    req.onblocked = () => reject(new Error('Local database is blocked by another open tab. Close other Clog Studio tabs and reload.'));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return wrap(db.transaction(store, 'readonly').objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value, key);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Write failed'));
    tx.onabort = () =>
      reject(
        tx.error?.name === 'QuotaExceededError'
          ? new Error('Browser storage is full. Remove unused projects or large assets and try again.')
          : (tx.error ?? new Error('Write aborted')),
      );
  });
}

export async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDb();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

export async function idbAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  return wrap(db.transaction(store, 'readonly').objectStore(store).getAll()) as Promise<T[]>;
}
