# Postup měření výkonu (audit 2026-11)

Všechna měření auditu jdou zopakovat těmito příkazy. Surová data jsou v `docs/perf-audit/data/`.

## Diagnostika ve hře (vypnutá, dokud ji nezapnete)

Diagnostika je v `src/client/runtime/perf.ts`. Když je vypnutá, stojí jen jednu kontrolu příznaku na každý měřený úsek. Nic nevypisuje do konzole.

- **Zapnutí:** `?perf` v adrese, nebo `__pf.perf.enable()` v konzoli. Data se čtou přes `__pf.perf.report()` a mažou přes `__pf.perf.reset()`.
- **Co měří:**
  - interval mezi snímky (rAF) a CPU čas celé smyčky;
  - CPU čas úseků: `sim`, `events`, `soldiers`, `camera`, `tags`, `sounds`, `effects`, `hud`, `ui`, `env`, `grass`, `render`.
    - `render` je jen čas, kdy JavaScript odesílá vykreslení. Není to čas GPU.
  - GPU čas přes `EXT_disjoint_timer_query_webgl2`, pokud ho prohlížeč nabízí (Chrome na Windows obvykle ano);
  - počet volání `renderer.render` (průchody), počet vykreslovacích volání, trojúhelníky a snímky s překreslením stínové mapy;
  - JS heap jednou za sekundu (jen Chromium);
  - 8 nejdelších snímků s rozpadem na úseky.
- **Režie:** změřena srovnáním CPU času snímku s diagnostikou a bez ní v jednom scénáři. Je pod rozlišovací schopností měření (viz zpráva).
- **A/B přepínače** se zapínají přes `&ab=` a dají se kombinovat čárkou. Slouží jen k diagnostice a nejsou to herní volby.

  | Přepínač | Co udělá |
  |---|---|
  | `noshadow` | vypne stínovou mapu |
  | `noanim` | vzdálení vojáci se přestanou animovat (póza se nastaví jednou) |
  | `noeffects` | vypne částice, stopy a nábojnice |
  | `nohud` | HUD se po prvním vykreslení už nepřekresluje |
  | `nograss` | vypne trávu |
  | `half` | vykresluje v polovičním rozlišení |
  | `norender` | `renderer.render` se nevolá; měří se jen herní logika a UI |

- **Server:** volba `profile: true` v `GameServer` zapne měření fází ticku. Výsledek vrací `server.profile()`.
  - Fáze: `inputs`, `sim`, `events`, `team`, `visibility`, `snapshots`.
  - Dále příchozí zprávy (počet, bajty, čas zpracování) a odchozí bajty podle typu zprávy.
  - Bez volby `profile` server za tick zavolá jen několik `performance.now()` navíc.

## Server

```bash
npx tsx scripts/perf/server.ts --bots 16 --mode fight --warmup 15 --seconds 60 --out docs/perf-audit/data/server.json
```

```bash
./scripts/perf/server-matrix.sh
```

- Matice trvá zhruba 17 minut: 8 a 16 botů ve 3 opakováních, k tomu 32 a 64 botů.
- Server běží v jednom procesu, boti (`scripts/perf/bots.ts`) v druhém, takže si nekradou CPU.
- Měří se 60 s po 15 s zahřátí.
- Režimy botů:
  - `fight` – boti se stahují k nepříteli a střílí; vzniká shluk;
  - `spread` – každý běží k vlastnímu náhodnému bodu a nestřílí; vzniká rozptýlení.
- Boti jsou automatizovaní klienti, ne prohlížeče a ne lidé.
- Rozpad přenosu podle typu zprávy: `docs/perf-audit/data/server-bandwidth.json`.

## Klient

Předpoklady jsou produkční build a náhledový server:

```bash
npx vite build
```

```bash
npx vite preview --port 4173 --strictPort --host 127.0.0.1
```

Pak spusťte matici:

```bash
./scripts/perf/client-matrix.sh
```

Nebo jednotlivé scénáře:

```bash
npx tsx scripts/perf/client.ts --scenario fight16 --q standard --w 1280 --h 720 --seconds 30 --out x.json
```

- Scénáře: `idle`, `route` (6 pevných stanovišť), `first` (první výstřel, granát, nasazení, skóre), `fight8`, `fight16`, `fight32`, `spread16`, `spread32`, `lifecycle` (respawn, reconnect, nové kolo), `long` (`--long 600`).
- Měřící hráč je nesmrtelný. Server ignoruje jeho poškození; jde o úpravu jen v měřicím skriptu.
- Dynamické rozlišení je vypnuté.
- V tomto prostředí běží jen **SwiftShader** (softwarová grafika). Platí to:
  - **Spolehlivé:** CPU časy úseků herní logiky, počty vykreslovacích volání, trojúhelníků a průchodů, paměť, růst objektů, počty nově přeložených shaderů.
  - **Nespolehlivé:** interval snímků a FPS při vykreslování, GPU čas v ms. Časovač GPU v SwiftShaderu měří CPU rasterizaci a hodí se jen pro poměry A/B.

## Co musí změřit člověk na referenčním notebooku (i5-1335U, 16 GB, Iris Xe)

V tomto prostředí to změřit nelze, protože tu není skutečná GPU.

1. Prohlížeč Chrome. Notebook na síti, ne na baterii. Zapsat verzi Chrome, OS, rozlišení displeje, DPR a měřítko Windows.
2. Spusťte lokálně `npm run server` a `npx vite build && npx vite preview`. Otevřete `http://localhost:4173/?perf&q=standard`.
3. V Nastavení vypněte Automatické rozlišení. Okno maximalizované, zapsat rozlišení canvasu: `__pf.renderer.domElement.width/height`.
4. Připojte se, nasaďte se na základně A a dívejte se dolů ulicí (yaw 0).
5. Počkejte 30 s na zahřátí.
6. V konzoli spusťte `__pf.perf.reset()`, stůjte 60 s a pak zkopírujte výstup `JSON.stringify(__pf.perf.report())`. Opakujte 3×.
7. Totéž opakujte s `&ab=noshadow`, s `&ab=half` a s `?q=low`. Každá změna = nové načtení stránky.
8. Pokud je k dispozici druhý počítač nebo telefon, pusťte boty: `npx tsx scripts/perf/bots.ts ws://localhost:8787 15 fight 300`. Změřte stejně při souboji 16 hráčů.

Pošlete mi tyto hodnoty:

- `interval` (p50, p95, p99), `cpu`, `gpu` (jestli není `null`), `sections`, `calls`, `triangles`, `hitches`;
- GPU renderer: `__pf.renderer.getContext().getParameter(0x9246)` po `getExtension('WEBGL_debug_renderer_info')`.
