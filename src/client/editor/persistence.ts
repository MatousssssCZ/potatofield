import type { MapDocument } from '../../shared/map/schema';
import { parseMapJson, validateMap } from '../../shared/map/validate';

/**
 * Lokální úložiště map v IndexedDB. Ukládá se jen dokument, který prošel validací;
 * předchozí uložená verze se drží jako záloha („poslední dobrá“). Prohlížeč může data
 * smazat – proto UI vždy nabízí export souboru.
 */
const DB = 'potatofield';
const VERSION = 1;

export interface MapMeta {
  id: string;
  name: string;
  updatedAt: number;
  objects: number;
}

export class QuotaError extends Error {}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('maps')) db.createObjectStore('maps', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function tx<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result: T;
    const req = fn(t);
    if (req) req.onsuccess = () => (result = req.result);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const isQuota = (e: unknown) => e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');

export class MapStore {
  private dbp: Promise<IDBDatabase> | null = null;
  private db() {
    return (this.dbp ??= open());
  }

  async list(): Promise<MapMeta[]> {
    const db = await this.db();
    const all = await tx<Array<{ id: string; doc: MapDocument; updatedAt: number }>>(db, ['maps'], 'readonly', (t) => t.objectStore('maps').getAll());
    return all
      .map((r) => ({ id: r.id, name: r.doc.name, updatedAt: r.updatedAt, objects: r.doc.objects.length }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<{ doc: MapDocument; fromBackup: boolean } | null> {
    const db = await this.db();
    const rec = await tx<{ doc: MapDocument } | undefined>(db, ['maps'], 'readonly', (t) => t.objectStore('maps').get(id));
    if (rec && validateMap(rec.doc).ok) return { doc: rec.doc, fromBackup: false };
    const bak = await tx<{ doc: MapDocument } | undefined>(db, ['backups'], 'readonly', (t) => t.objectStore('backups').get(id));
    if (bak && validateMap(bak.doc).ok) return { doc: bak.doc, fromBackup: true };
    return null;
  }

  /** Uloží validní dokument; předchozí verzi přesune do zálohy. Nevalidní neuloží. */
  async save(doc: MapDocument): Promise<void> {
    const v = validateMap(JSON.parse(JSON.stringify(doc)));
    if (!v.ok) throw new Error('Mapa neprošla validací – neukládám, poslední dobrá verze zůstává.');
    const db = await this.db();
    try {
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction(['maps', 'backups', 'meta'], 'readwrite');
        const maps = t.objectStore('maps');
        const g = maps.get(doc.id);
        g.onsuccess = () => {
          if (g.result) t.objectStore('backups').put(g.result);
          maps.put({ id: doc.id, doc, updatedAt: Date.now() });
          t.objectStore('meta').put({ id: 'lastMap', value: doc.id });
        };
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    } catch (e) {
      if (isQuota(e)) throw new QuotaError('Úložiště prohlížeče je plné.');
      throw e;
    }
  }

  async remove(id: string) {
    const db = await this.db();
    await tx(db, ['maps', 'backups'], 'readwrite', (t) => {
      t.objectStore('maps').delete(id);
      t.objectStore('backups').delete(id);
    });
  }

  async lastMapId(): Promise<string | null> {
    const db = await this.db();
    const r = await tx<{ value: string } | undefined>(db, ['meta'], 'readonly', (t) => t.objectStore('meta').get('lastMap'));
    return r?.value ?? null;
  }
}

/** Autosave s debounce a viditelným stavem. */
export class AutoSaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  state: 'saved' | 'pending' | 'saving' | 'error' = 'saved';
  message = '';
  savedAt = 0;
  onState: () => void = () => {};

  constructor(
    private store: MapStore,
    private getDoc: () => MapDocument,
    private delay = 800,
  ) {}

  schedule() {
    this.state = 'pending';
    this.onState();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delay);
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.state = 'saving';
    this.onState();
    try {
      await this.store.save(structuredClone(this.getDoc()));
      this.state = 'saved';
      this.savedAt = Date.now();
      this.message = '';
    } catch (e) {
      this.state = 'error';
      this.message = e instanceof QuotaError ? 'Plné úložiště – exportujte mapu do souboru.' : (e as Error).message;
    }
    this.onState();
  }
}

/** Stáhne mapu jako soběstačný JSON soubor (bez externích cest). */
export function exportMapFile(doc: MapDocument) {
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const safe = doc.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'mapa';
  a.download = `${safe}.potatofield.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Načte soubor a validuje ho dřív, než cokoli změní. */
export async function readMapFile(file: File) {
  if (file.size > 32 * 1024 * 1024) return { ok: false as const, issues: [{ severity: 'error' as const, path: '', message: 'soubor je příliš velký' }] };
  const text = await file.text();
  return parseMapJson(text);
}
