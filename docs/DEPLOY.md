# Nasazení: web na GitHub Pages, herní server na Render

Obojí je zdarma. Web (klient) jsou statické soubory; herní server je stálý proces Node.js
s WebSocketem (autoritativní simulace 60 Hz), proto běží jinde než web.

## 1. Web – GitHub Pages (jednorázově zapnout)

1. GitHub → repozitář **potatofield** → **Settings → Pages** → *Build and deployment* →
   **Source: GitHub Actions**.
2. Hotovo: každý push na `main` spustí workflow **Web (GitHub Pages)** (`.github/workflows/pages.yml`) –
   typová kontrola, testy, build, nasazení. Web: <https://matousssssscz.github.io/potatofield/>
   (přesná adresa je v záložce Actions u běhu workflow, krok *deploy*).

Bez serveru na webu funguje trénink (offline Conquest), editor map i ukládání map v prohlížeči.

## 2. Herní server – Render (free)

1. <https://dashboard.render.com> → přihlásit se přes GitHub → **New → Blueprint** →
   vybrat repozitář **potatofield**. Render načte `render.yaml` (služba `potatofield-server`,
   region Frankfurt, plán Free) → **Apply**.
2. Po prvním buildu má služba adresu `https://potatofield-server.onrender.com`
   (kontrola: `/health` vrátí „Potatofield server OK“, `/info` údaje serveru).
3. Pokud Render přidělil jinou adresu (název byl obsazený): GitHub → **Settings → Secrets and
   variables → Actions → Variables** → nová proměnná `PF_SERVER_URL` = `wss://<adresa>.onrender.com`
   → v Actions znovu spustit workflow (Run workflow). Web pak nabízí tento server jako výchozí.

Nastavení serveru (Render → služba → Environment): `PF_NAME` (název v seznamu), `PF_TEAM_SIZE`
(výchozí 8), `PF_FF=1` (friendly fire), `PF_MAP`, `PF_SCENARIO`, `PF_NO_PILOT=1`.

### Omezení bezplatného plánu
- Po ~15 min bez provozu server usne; první dotaz ho probudí (až ~1 min). Hra mezitím ukazuje
  „Server je nedostupný“ – stačí *Zkusit znovu*; připojení samo čeká až 75 s.
- Restart / nové nasazení odpojí hráče se zprávou „server se restartuje“.
- Jedna instance = jeden zápas (16 hráčů). Provoz ~17,6 KiB/s na hráče (~1 GB/h při 16 hráčích).
- Podmínky bezplatných plánů se mění – ověřte aktuální limity na render.com.

## Lokálně
`npm run dev` + `npm run server` – klient se k serveru `ws://localhost:8787` připojí sám.
Stránka na HTTPS se smí připojit jen na `wss://` (hra to vysvětlí); `ws://` funguje jen lokálně.
