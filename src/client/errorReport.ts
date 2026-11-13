import { defaultAddress } from './ui/servers';

/**
 * Hlášení neošetřených chyb hry správci serveru (POST /client-error na výchozím herním serveru).
 * Posílá se jen text chyby, zásobník volání a verze sestavení – žádné jméno, adresa stránky ani
 * nastavení hráče. Nejvýš 3 hlášení za spuštění; selhání odeslání se tiše ignoruje.
 */
let sent = 0;
const seen = new Set<string>();

function endpoint(): string | null {
  try {
    const u = new URL(defaultAddress());
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    // Šifrovaná stránka nesmí volat nešifrovaný server (prohlížeč by to stejně zablokoval).
    if (location.protocol === 'https:' && u.protocol !== 'https:') return null;
    u.pathname = '/client-error';
    return u.toString();
  } catch {
    return null;
  }
}

function report(msg: string, stack: string, where: string) {
  if (sent >= 3 || seen.has(msg) || /pointer ?lock/i.test(msg)) return;
  const url = endpoint();
  if (!url) return;
  seen.add(msg);
  sent++;
  const body = JSON.stringify({ msg: msg.slice(0, 300), stack: stack.replace(/https?:\/\/[^/\s)]+/g, '').slice(0, 1500), build: String(import.meta.env?.MODE ?? ''), where });
  void fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body, keepalive: true, mode: 'cors', credentials: 'omit' }).catch(() => {});
}

export function installErrorReporting() {
  window.addEventListener('error', (e) => report(String(e.message), String((e.error as Error | undefined)?.stack ?? ''), 'error'));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as Error | undefined;
    report(String(r?.message ?? r), String(r?.stack ?? ''), 'promise');
  });
}
