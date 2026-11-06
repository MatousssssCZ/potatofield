# Zadání pro ChatGPT: free balíček animací držení zbraně (+ zbraně)

Zkopíruj celý blok níže do ChatGPT (ideálně s režimem prohledávání webu / „deep research“).

---

Hledám **zdarma použitelné** 3D animace vojáka s puškou a pistolí a ideálně i 3D modely zbraní pro
webovou FPS hru (prohlížeč, Three.js, multiplayer, nekomerční zatím, ale chci mít možnost ji
v budoucnu zpeněžit). Potřebuji, abys našel **konkrétní balíčky ke stažení** a u každého **ověřil
licenci** přímo na stránce zdroje.

## Co přesně hledám (podle priority)

1. **Animace postavy ve třetí osobě s puškou (rifle locomotion set)** pro humanoidní kostru:
   - idle s puškou (uvolněný i v pohotovosti), míření (aim idle), chůze vpřed/vzad/do stran,
     běh, sprint s puškou u těla, přikrčení (idle + chůze), leh (idle + plazení),
   - přebití pušky, hod granátem, útok nožem, léčení/použití předmětu (stačí obecné „use“),
   - pád/smrt (alespoň 2 varianty), skok,
   - ideálně totéž **s pistolí** (idle, míření, chůze, přebití).
   - Animace by měly být „in place“ (bez posunu kořene), nebo mít root motion oddělitelný.
2. **Animace rukou v první osobě (FPS arms)** pro pušku: idle, míření (ADS), výstřel/zpětný ráz,
   přebití, sprint, přepnutí zbraně (vytažení / schování). Ruce stačí bez těla.
3. **Modely zbraní** v nízkém rozlišení vhodném pro web: útočná puška typu M16/M4, AK
   (AK-74/AK-101), odstřelovací puška s optikou (bolt-action), pistole, ideálně i brokovnice
   a kulomet. Ideálně s **odděleným zásobníkem, závěrem a spouští** (kvůli animaci přebití).

## Tvrdé požadavky

- **Licence:** CC0 (nejlepší), nebo CC-BY 4.0 (s uvedením autora). **Nechci** NC (nekomerční),
  ND (bez úprav), „editorial use only“, ani nic, co zakazuje použití ve hře, úpravy nebo šíření
  ve hře. U každé položky uveď přesný název licence a odkaz na stránku, kde je licence uvedena.
- **Žádné vytažené (ripnuté) assety z komerčních her** (Battlefield, Call of Duty, CS, Arma…)
  ani „fan“ balíčky, které je obsahují. Žádné modely s logy výrobců nebo ochrannými známkami.
- **Formát:** glTF/GLB (nejlepší) nebo FBX. Blend je OK, pokud jde exportovat do glTF.
- **Kostra:** standardní humanoid (např. pojmenování kostí jako Mixamo, Unreal Mannequin, Unity
  Humanoid, nebo jiné běžné). Klidová póza T-pose nebo A-pose. Napiš, jakou kostru balíček používá
  a kolik má kostí. (Kvůli převodu na vlastní kostru: 20 kostí – pánev, 2× páteř, krk, hlava,
  klíční kosti, paže, předloktí, ruce, stehna, holeně, chodidla.)
- **Velikost:** modely zbraní ideálně do ~10 000 trojúhelníků, textury 1K–2K (PBR: barva, normála,
  drsnost/kovovost). Postava ideálně do ~20 000 trojúhelníků.
- Animace musí mít **zbraň správně v rukou** (pravá ruka na rukojeti, levá na předpažbí), aby
  držení vypadalo přirozeně, ne jen obecné „pistolové“ póze.

## Kde hledat (prověř všechny, ale nejen tyto)

- Quaternius (quaternius.com) – CC0 balíčky postav, animací a zbraní
- Kenney (kenney.nl) – CC0
- OpenGameArt.org (filtrovat CC0 / CC-BY)
- Sketchfab (filtr „Downloadable“ + licence CC0 / CC-BY; ověř licenci u každého modelu zvlášť)
- itch.io (assety „free“ – pozor, licence se liší, ověř text licence)
- Poly Haven (hlavně rekvizity, CC0)
- Mixamo (Adobe) – zdarma, ale **ověř a vysvětli podmínky** pro použití ve webové hře, kde jsou
  soubory stažitelné z prohlížeče (smí se animace šířit jako součást hry? smí se upravovat?).
  Uveď to jako samostatnou možnost s rizikem, ne jako první volbu.
- GitHub repozitáře s CC0/CC-BY animacemi (např. sady pro Godot/Three.js)

## Co od tebe chci jako výstup

Tabulku s **5–10 nejlepšími kandidáty**, seřazenou od nejvhodnějšího. Pro každý:

| Pole | Obsah |
|---|---|
| Název a autor | |
| Přímý odkaz ke stažení | (stránka balíčku, ne vyhledávání) |
| Licence | přesný název + odkaz na text licence na stránce zdroje |
| Co obsahuje | seznam animací / modelů (zaškrtni, co pokrývá z mého seznamu výše) |
| Formát | glTF/GLB/FBX/Blend |
| Kostra | jaká, kolik kostí, T/A-pose, in-place ano/ne |
| Zbraně | které, počet trojúhelníků, oddělený zásobník/závěr ano/ne |
| Co chybí | co z mého seznamu nepokrývá |
| Rizika | např. nejasná licence, nutnost uvádět autora, stylizovaný vzhled |

Pod tabulkou:

1. **Doporučení**: nejlepší kombinace (např. „animace z A + ruce z B + zbraně z C“), aby to
   pokrylo co nejvíc, s co nejjednodušší licencí.
2. **Text pro uvedení autorů** (credits) pro každou CC-BY položku, připravený ke zkopírování.
3. Pokud nic nesplňuje požadavky přesně, napiš to otevřeně a navrhni nejbližší náhradu.

Nevymýšlej odkazy ani licence – pokud si něčím nejsi jistý, napiš „neověřeno“.

---

## Co s výsledkem udělat potom

Pošli mi (Claudovi) do konverzace tabulku od ChatGPT a vybrané odkazy. Já pak:

- ověřím licenci a obsah,
- balíček stáhnu do `assets/third_party/<název>/` a autory zapíšu do `ASSET_CREDITS.md`,
- převedu animace na naši kostru (20 kostí) a napojím je na animátor vojáka a na ruce v první osobě,
- zbraně nasadím místo nynějších procedurálních modelů (stávající zůstanou jako záloha).
