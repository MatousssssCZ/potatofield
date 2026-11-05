# Implementační plán a stav

Zadání: *Editor mapy* (editor, formát, stavebnice, prostředí, Conquest), *Pohyb, pohled a zbraň*
(controller, kamera, střelba, síť), *Grafika zbraní* (arzenál, M4A1, ruce), *Pohyb vojáků a držení zbraní*
(pózy, souhra stavů), *Týmové mechaniky multiplayeru* (chat, čety, rádio, spot, commander).

Legenda: `[x]` hotovo a ověřeno (test / skutečný běh), `[~]` částečně, `[ ]` zbývá. Ověření na
cílovém notebooku i5-1335U **neproběhlo** (není k dispozici) – výkonová čísla klienta jsou čekající.

## Krok 0–3 (základ, hráč, editor, historie) – hotovo
Viz git historie; 20 testů pohybu, editor s gizmy, historie, IndexedDB, export/import, 20 přepnutí bez úniků.

## Krok 4 – parametrická stavebnice
- [x] Plot/zeď (10 m → 5 polí/6 sloupků, 11 m → 6/7), koncové sloupky, pletivo propouští střely
- [x] Budovy obytné/obchodní/průmyslové/hotel po modulech; rozšíření = okenní osa, patro = řada oken a posun střechy
- [x] **Zapuštěný vchod** (výklenek s kolizí – kryt), parametry hloubka a šířka
- [x] Bunkr, budka, domek se skutečnými otvory (dveře ≥ 1,0 × 2,1 m)
- [x] Schodiště (kolizní rampa ≤ 45°), žebřík (E/W/S/Space, bezpečný výstup, blokovaný výstup), most, silnice/roh/křižovatka
- [x] Kryty BF2 stylu: HESCO, ježci, bloky, průlezná roura, palety, suť, kontejnery, pneumatiky, buben, pytlové stanoviště, ostnatý drát, vrak auta
- [~] Automatické napojování koncových bodů plotů (zatím ručně přes parametry sloupků)

## Krok 5 – terén a markery
- [x] Štětce zvýšit/snížit/vyhladit/srovnat + malba hlíny/městského povrchu; tah = 1 undo; render i kolize synchronně
- [x] Vlajky (objem, vlastník, zabíratelnost, spawn, bleed), spawny s vazbou, zóny, scénáře s přepsáním
- [x] Kontrola mapy (spawn v objektu, žebřík, scénář bez spawnu), zobrazení kolizí/objemů/svahů, „Položit na povrch“
- [ ] Explicitní změna velikosti existujícího plátna (v pilotu blokováno – velikost se volí u nové mapy)

## Krok 6 – 3D zbraň a dotažená ulice
- [x] M4A1 z profilovaných dílů, kolimátor s tečkou ze směru (jen průhledem), 3 484 trojúhelníků zbraně (s rukama 8,7 tis.), ~10 draw calls
- [x] Skinned ruce (USMC Assault), úchopy, ADS přes opticEye, sprint/přebití/výstřel/tasení/stažení u zdi
- [x] Logika zbraně (kadence, semi/auto, reload commit, priority, recoil vs. rozptyl, blokace hlavně) – testy
- [x] Projektily s gravitací, hitboxy podle postoje, efekty zásahů v poolu, procedurální zvuk
- [x] Referenční ulice 70 m, předvolby prašné poledne / čisté slunečno / zataženo s deštěm
- [~] Ruce: držení funguje, prsty a levá ruka potřebují další ladění póz
- [x] Krok 5 grafického zadání – Assault a Medic všech frakcí: M16A2, AK-101 (boční montáž kolimátoru), AKM, QBZ-95 (kolimátor na nosné rukojeti), Type 81; rodiny AR / AK / bullpup se sdílenými díly, vlastní rig (hip póza, poloha oka), skutečná mechanická mířidla, přebití podle konstrukce (naklopení zásobníku AK, natažení páky). Testy: osa mířidel, paprsek otvorem hledí, volný průhled kolimátoru, near plane, rozpočet ≤ 20 tis. trojúhelníků
- [x] Výbava hráče: výběr classy na obrazovce nasazení (frakce podle týmu, ve volném testu libovolná), server ji ověřuje (`zbraň nepatří frakci týmu`), protokol v2 přenáší zbraň i vzdáleným hráčům; výchozí zbraň volného testu v Nastavení
- [~] Referenční karty nových zbraní: rozměry jsou umělecký odhad, porovnání s referencemi neproběhlo (Type 81 bez dostupné reference)
- [x] Krok 6 grafického zadání – Support: M249 a PKM (víko na závěsu, schránka s úsekem pásu na správné straně, přebití víko → schránka → pás na lůžko → zavřít víko → páka), QBB-95 (buben, mířidla na rukojeti). Test: vstup pásu leží pod zavřeným víkem
- [x] Pravidla podle classy (N): PF-Rifle (Assault, Medic), PF-MG (Support: 100 ran, automat), PF-Pump (870, Hawk: 9 broků, pumpa, nabíjení po jednom s přerušením výstřelem, dopumpování), PF-Auto12 (Saiga: 8 broků, jednotlivé rány, zásobník). Broky deterministické ze seedu serveru, každý nese svá pravidla – testy
- [x] Krok 7 grafického zadání – Engineer: Remington 870, Saiga-12 (rodina AK), pumpa jako pohyblivý díl, nabíjení po jednom s viditelným nábojem jen ve fázi vkládání, procedurální zvuky pumpy a náboje
- [~] Hawk Type 97: **blokováno k ověření** – reference nebyla dostupná; model je označený neověřený návrh (viz docs/weapons/Hawk97.md)
- [x] Krok 8 – world modely všech 12 zbraní ve 3P podle výbavy, LOD0/1/2 (siluety z řezů), hystereze přepnutí, sdílená mezipaměť; test 63 postav (LOD 25/18/20)
- [x] Rozpočty autora: zbraň v první osobě 3 418–3 498 trojúhelníků, u ostatních hráčů 1 040–1 298, vzdálená varianta 264–300 – testy pro všech 12 zbraní; mířidla a near plane ověřené na zjednodušené geometrii
- [ ] Pistole (rozpočet 1 500–2 000) – pistole zatím nejsou součástí arzenálu
- [~] Postava vzdáleného hráče stále ~12 draw calls (instancing zbývá)
- [~] 12 profilů rukou/rukávů existuje (rukavice, holé ruce s vyhrnutým rukávem, bezprsté), ruce potřebují doladit pózy
- [ ] Výkonové měření klienta na i5-1335U

## Krok 7 – lokální Conquest
- [x] Zabrání, neutralizace, spor, opuštění a návrat, nezabíratelné body, výškový limit, spawny, zóny, bleed, konec, restart – testy

## Krok 8 – multiplayer
- [x] Autoritativní server (60 Hz, snapshot 30 Hz), handshake (protokol, hash mapy, verze generátorů)
- [x] Predikce + korekce s přehráním vstupů, interpolace 100 ms, deduplikace efektů, simulace RTT/jitteru/ztrát
- [x] Server odmítá cizí spawn, neznámé zprávy (klientský damage/capture), neplatné vstupy; smrt = 1 ticket; join uprostřed; odpojení
- [x] End-to-end se 2 prohlížeči
- [ ] Bounded lag compensation (zdokumentovaná nevýhoda vysokého pingu)

## Týmové mechaniky (P1 hotovo, P2/P3 zbývá)
- [x] Chat all/team/squad s izolací na serveru, limit spamu, text nikdy jako HTML
- [x] Čety (6 členů, atomické přijetí, nástupnictví, zámek, předání s cooldownem), nasazení u velitele (pravidlo vstupu během smrti)
- [x] Rádiové kolo Q (potvrzení klikem, cooldowny), ruční spot ověřený viditelností, kontakty jen vlastnímu týmu, TTL 6 s / 4 s
- [x] Rozkazy čety T (útok/obrana/přesun, dokončení), minimapa, skóre
- [ ] Medic/Support (léčení, oživení, munice) – vyžaduje classy a vybavení
- [ ] Commander, UAV, scan, supply drop, infrastruktura, hlas, hlasování, artillery, perzistentní statistiky

## Krok 9 – zátěž a prostředí
- [x] 16 aktivních botů 60 s: tick 2,3 ms průměr / 3,8 ms p95 (rozpočet 16,7 ms) – `docs/PERFORMANCE.md`
- [ ] Lidský playtest 16 hráčů; test 32/63 vzdálených postav v klientu
