import { PROTOCOL_VERSION } from '../../shared/net/protocol';

/**
 * Seznam serverů: uložené adresy (lokálně) + skutečné údaje z GET /info každého serveru.
 * Žádný centrální master server ani matchmaking – nic se nepředstírá. Ping je doba odpovědi
 * HTTP dotazu (orientační); neznámý ping se zobrazí jako pomlčka.
 */
export interface ServerInfo {
  name: string;
  map: string;
  mode: 'conquest' | 'free';
  players: number;
  capacity: number;
  friendlyFire: boolean;
  protocol: number;
  pilot: boolean;
  teamSize: number;
  kits: string[];
  factions: { teamA: string; teamB: string };
}

export interface ServerEntry {
  address: string;
  state: 'loading' | 'ok' | 'error';
  info?: ServerInfo;
  ping: number | null;
  error?: string;
}

const KEY = 'pf.servers';

export function defaultAddress() {
  const host = typeof location !== 'undefined' && location.hostname ? location.hostname : 'localhost';
  return `ws://${host}:8787`;
}

export function loadAddresses(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.length ? v : [defaultAddress()];
  } catch {
    /* poškozená hodnota → výchozí */
  }
  return [defaultAddress()];
}

export function saveAddresses(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set(list)].slice(0, 32)));
  } catch {
    /* ignorovat */
  }
}

/** ws://host:port → http://host:port/info (wss → https). Neplatná adresa = null. */
export function infoUrl(address: string): string | null {
  try {
    const u = new URL(address);
    if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return null;
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    u.pathname = '/info';
    return u.toString();
  } catch {
    return null;
  }
}

export async function fetchInfo(address: string, timeoutMs = 3000, signal?: AbortSignal): Promise<ServerEntry> {
  const url = infoUrl(address);
  if (!url) return { address, state: 'error', ping: null, error: 'address' };
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), timeoutMs);
  signal?.addEventListener('abort', () => ctl.abort());
  const t0 = performance.now();
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) return { address, state: 'error', ping: null, error: `http ${r.status}` };
    const info = (await r.json()) as ServerInfo;
    return { address, state: 'ok', info, ping: Math.round(performance.now() - t0) };
  } catch (e) {
    return { address, state: 'error', ping: null, error: (e as Error).name === 'AbortError' ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(tm);
  }
}

export const compatible = (e: ServerEntry) => e.info?.protocol === PROTOCOL_VERSION;
export const full = (e: ServerEntry) => !!e.info && e.info.players >= e.info.capacity;

/** Doporučený server: kompatibilní, s volným místem, nejnižší ping; jinak nic (žádný falešný). */
export function recommend(list: ServerEntry[]): ServerEntry | null {
  const ok = list.filter((e) => e.state === 'ok' && compatible(e) && !full(e));
  ok.sort((a, b) => (a.ping ?? 1e9) - (b.ping ?? 1e9));
  return ok[0] ?? null;
}
