import { DEFAULT_ENVIRONMENT, MAP_SCHEMA_VERSION, makeFlatTerrain, type ControlPoint, type MapDocument, type MapObject, type SpawnPoint, type Team, type Zone } from '../../shared/map/schema';
import { getAsset, resolveParams } from '../registry';

/**
 * Skladová osada – hratelný blockout podle zadání (8 vs 8, Conquest, 4 vlajky, ~230 × 190 m).
 * Sever = −Z. Modrá základna jihozápad, červená severovýchod; A Náves (západ), B Skladový dvůr
 * (severovýchod uvnitř), C Dílna (jihozápad uvnitř), D Vodojem (jihovýchod). Uprostřed zalomená
 * clona skladových hal, na jihu nízký hřbet a delší obchvat.
 *
 * Rozměry a polohy jsou návrhové hodnoty blockoutu odvozené z kompozice reference, ne měření
 * obrázku. Vše jsou běžné objekty katalogu – mapa jde dál upravovat v editoru.
 */

export const OSADA_HALF = { x: 118, z: 98 };

const smooth = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};
/** Eliptický pahorek: výška h ve středu, plynule k nule na okraji. */
const bump = (x: number, z: number, cx: number, cz: number, rx: number, rz: number, h: number) => {
  const d = Math.hypot((x - cx) / rx, (z - cz) / rz);
  return h * smooth(1 - d);
};

/**
 * Výška terénu: rovina osady, jižní nízký hřbet (kryje obchvat, není rozhledna – haly jsou vyšší),
 * jihovýchodní pahorky a zvednutý okraj kolem hrací plochy.
 */
export function osadaHeight(x: number, z: number): number {
  let h = 0;
  // Nízký hřbet mezi osadou a obchvatem (dva překrývající se pahorky = protáhlý tvar se sedlem).
  h = Math.max(h, bump(x, z, -30, 66, 30, 11, 4.2), bump(x, z, 4, 68, 28, 10, 3.6));
  // Jihovýchodní pahorky za vodojemem.
  h = Math.max(h, bump(x, z, 92, 82, 24, 14, 4.5), bump(x, z, 108, 30, 9, 26, 3.2));
  // Okraj mapy: plynulý val za hranicí hrací plochy (viditelné ukončení, ne neviditelná zeď).
  const out = Math.max(Math.abs(x) - OSADA_HALF.x, Math.abs(z) - OSADA_HALF.z);
  if (out > -6) h = Math.max(h, 7 * smooth((out + 6) / 12));
  return Math.round(h * 100) / 100;
}

type P = MapObject['params'];

export function buildOsadaMap(): MapDocument {
  const terrain = makeFlatTerrain(272, 232, 2);
  for (let iz = 0; iz < terrain.samplesZ; iz++)
    for (let ix = 0; ix < terrain.samplesX; ix++) terrain.heights[iz * terrain.samplesX + ix] = osadaHeight(terrain.origin[0] + ix * terrain.spacing, terrain.origin[1] + iz * terrain.spacing);
  terrain.baseMaterial = 'sand';
  const objects: MapObject[] = [];
  let n = 0;
  const add = (assetId: string, x: number, z: number, yaw = 0, params: P = {}, name?: string, material?: string, dy = 0) => {
    const def = getAsset(assetId);
    if (!def) throw new Error(`osada: neznámý asset ${assetId}`);
    const o: MapObject = {
      id: `so_${String(++n).padStart(3, '0')}`,
      assetId,
      generatorVersion: def.generatorVersion,
      transform: { position: [Math.round(x * 100) / 100, Math.round((osadaHeight(x, z) + dy) * 100) / 100, Math.round(z * 100) / 100], rotation: [0, yaw, 0] },
      params: resolveParams(def, params),
      seed: (n * 2654435761) >>> 0,
      ...(material ? { material } : {}),
      ...(name ? { editor: { name } } : {}),
    };
    objects.push(o);
    return o;
  };
  /** Budova s pivotem v rohu půdorysu, zadaná středem (L podél lokální X, D podél lokální Z). */
  const centered = (assetId: string, cx: number, cz: number, L: number, D: number, yaw: number, params: P, name: string, material?: string) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return add(assetId, cx - (c * L) / 2 - (s * D) / 2, cz + (s * L) / 2 - (c * D) / 2, yaw, params, name, material);
  };
  const Q = Math.PI / 2;

  // ------------------------------------------------------------------ cesty
  const road = (pts: Array<[number, number]>, params: P, name: string) => {
    const [x0, z0] = pts[0];
    return add('osada.road', x0, z0, 0, { points: pts.map(([x, z]) => `${Math.round((x - x0) * 10) / 10},${Math.round((z - z0) * 10) / 10}`).join(';'), nodeIds: pts.map((_, i) => `n${i + 1}`).join(';'), ...params }, name);
  };
  // Severní hlavní propojení: modrá základna → náves → skladový dvůr → červená základna.
  road([[-86, 56], [-72, 40], [-64, 16], [-64, -8], [-60, -26], [-44, -46], [-20, -60], [8, -58], [30, -50], [48, -38], [70, -34], [86, -48]], { width: 6, surface: 'asphalt' }, 'R01 Severní cesta (náves – dvůr)');
  // Jižní vnitřní propojení přes dílnu a vodojem.
  road([[-66, 16], [-66, 32], [-56, 42], [-40, 46], [-12, 44], [14, 40], [30, 34], [42, 44]], { width: 5, surface: 'gravel', shoulder: 0.5 }, 'R02 Štěrková cesta (dílna – vodojem)');
  road([[42, 44], [60, 46], [86, 44], [96, 20], [94, -10], [90, -36], [92, -50]], { width: 5, surface: 'gravel', shoulder: 0.5 }, 'R02 Východní cesta (vodojem – červená základna)');
  // Delší jižní obchvat za hřbetem.
  road([[-82, 74], [-62, 84], [-30, 88], [4, 88], [34, 84], [46, 72], [58, 66]], { width: 4.5, surface: 'dirt', shoulder: 0.4 }, 'R03 Jižní obchvat');
  // Betonová plocha dvora (příjezd k halám).
  road([[8, -58], [10, -40], [26, -30], [44, -28]], { width: 7, surface: 'concrete', shoulder: 0 }, 'R04 Betonový příjezd dvora');

  // ------------------------------------------------------------------ centrální clona skladů
  centered('osada.hall', -12, -20, 44, 16, Q, { length: 44, width: 16, eave: 5.6, gateWall: 'front', gateAt: 22, gateLock: true, through: true, sideDoor: false }, 'B09 Centrální sklad – severní křídlo (průchod Z–V)', 'brick');
  centered('osada.hall', 16, 7, 40, 18, 0, { length: 40, width: 18, eave: 5.6, gateWall: 'front', gateAt: 20, gateLock: true, through: true, sideDoor: true }, 'B09 Centrální sklad – východní křídlo (průchod S–J)', 'brick');
  centered('osada.hall', 28, 23, 16, 14, 0, { length: 16, width: 14, eave: 4.8, gateWall: 'back', gateAt: 8, gateLock: true, through: false, sideDoor: true, gateState: 'open' }, 'B10 Přístavek skladu', 'metalSheet');
  // Skladový dvůr (B) a východní sklady.
  centered('osada.hall', 12, -82, 28, 14, 0, { length: 28, width: 14, eave: 5.5, gateWall: 'back', gateAt: 14, gateLock: true, through: false, sideDoor: true }, 'B08 Severní hala dvora');
  centered('osada.hall', 64, -58, 30, 14, Q, { length: 30, width: 14, eave: 5.5, gateWall: 'front', gateAt: 15, gateLock: true, through: false, sideDoor: true }, 'B08 Východní hala dvora', 'metalSheetRust');
  centered('osada.hall', 78, -10, 26, 14, 0, { length: 26, width: 14, eave: 5, gateWall: 'front', gateAt: 13, gateLock: true, through: true, sideDoor: false }, 'B10 Sklad u východní cesty (průjezd)');
  centered('osada.hall', 52, -14, 14, 12, Q, { length: 14, width: 12, eave: 4.6, gateWall: 'front', gateAt: 7, gateLock: true, through: true, sideDoor: false, gateWidth: 3.2 }, 'B10 Průchozí sklad', 'metalSheetRust');
  // Dílna (C).
  centered('osada.hall', -50, 22, 20, 12, 0, { length: 20, width: 12, eave: 5, pitch: 10, bay: 5, gateWall: 'back', gateAt: 10, gateLock: true, through: false, sideDoor: true, gateWidth: 4, gateHeight: 3.6 }, 'B07 Dílna', 'metalSheet');
  add('setD.workshopGarage', -30, 30, Q, {}, 'Autodílna u dílny');

  // ------------------------------------------------------------------ vesnice (A) – 21 domů
  const houses: Array<[number, number, number, number, number, string, string, boolean?]> = [
    // severní řada
    [-100, -72, 9, 7, 0.1, 'back', 'plasterWarm'], [-84, -80, 8, 7, -0.08, 'back', 'plaster'], [-68, -84, 10, 7, 0, 'back', 'plasterOchre'],
    [-52, -78, 8, 6, 0.12, 'back', 'plasterWarm'], [-37, -84, 9, 7, 0, 'back', 'sandstone'], [-23, -76, 8, 7, -0.1, 'back', 'plaster'],
    // druhá řada
    [-105, -52, 8, 7, Q, 'back', 'plasterOchre'], [-89, -58, 10, 7, 0, 'back', 'plasterWarm'], [-74, -62, 8, 6, 0.1, 'back', 'plasterWhite'], [-58, -64, 8, 7, 0, 'left', 'plasterWarm'],
    // západ a okolí návsi
    [-105, -28, 9, 7, Q, 'back', 'plaster'], [-102, -4, 8, 7, Q, 'back', 'plasterWarm'], [-88, -40, 8, 7, 0, 'back', 'sandstone'], [-87, -12, 9, 7, Q, 'front', 'plasterOchre'],
    [-44, -28, 10, 7, Q, 'front', 'plasterWarm', true], [-43, -6, 8, 7, 0, 'front', 'plaster'],
    // jih návsi
    [-84, 8, 9, 7, 0, 'front', 'plasterWarm'], [-102, 28, 8, 7, Q, 'back', 'plasterWhite'], [-84, 30, 8, 6, 0, 'front', 'plasterOchre'],
    // mezi vesnicí a sklady
    [-30, -38, 9, 7, 0, 'back', 'plasterWarm'], [-31, -14, 8, 7, Q, 'front', 'sandstone'],
  ];
  houses.forEach(([cx, cz, L, D, yaw, doorWall, mat, walk], i) =>
    centered('osada.house', cx, cz, L, D, yaw, { length: L, depth: D, height: 3.3 + (i % 3) * 0.2, doorWall, doorAt: L / 2, interior: walk ? 'walk' : 'closed', windowFill: walk ? 'bars' : i % 4 === 0 ? 'shutter' : 'glass' }, `B01 Dům ${i + 1}${walk ? ' (průchozí)' : ''}`, mat),
  );
  // Drobná hospodářská stavení v zahradách a patrový dům jako dominanta návsi.
  for (const [cx, cz, yaw] of [[-96, -62, 0], [-66, -70, Q], [-96, 12, 0], [-72, 30, Q], [-20, -46, 0]] as const)
    centered('osada.house', cx, cz, 5, 4, yaw, { length: 5, depth: 4, height: 3, parapet: 0.3, doorWall: 'front', doorAt: 2.5, windows: false }, 'B06 Hospodářské stavení', 'plaster');
  add('small.terraceHouse', -76, -44, 0, {}, 'B02 Dům s terasou (dominanta návsi)');
  add('setK.oliveOld', -58, -24, 0.4, {}, 'Olivovník na návsi');

  // ------------------------------------------------------------------ vodojem (D)
  add('struct.silo', 56, 31, 0, { height: 5, diameter: 7, ladder: false }, 'B13 Vodojem – nádrž');
  centered('osada.house', 48, 52, 6, 4, 0, { length: 6, depth: 4, height: 3, parapet: 0.3, doorWall: 'front', doorAt: 3, windows: false }, 'B14 Čerpací domek', 'plaster');
  const wall = (pts: Array<[number, number]>, name: string, params: P = {}, material = 'plasterWarm') => {
    const [x0, z0] = pts[0];
    return add('osada.fence', x0, z0, 0, { points: pts.map(([x, z]) => `${x - x0},${z - z0}`).join(';'), kind: 'plaster', height: 2.2, thickness: 0.35, spacing: 4, slope: 'step', ...params }, name, material);
  };
  // Ohradní zeď vodojemu se čtyřmi vstupy (Z, S, V, J) – každý 5–6 m.
  wall([[40, 38], [40, 22], [50, 22]], 'F04 Zeď vodojemu SZ');
  wall([[66, 22], [84, 22], [84, 36]], 'F04 Zeď vodojemu SV');
  wall([[84, 42], [84, 62], [66, 62]], 'F04 Zeď vodojemu JV');
  wall([[60, 62], [40, 62], [40, 44]], 'F04 Zeď vodojemu JZ');

  // ------------------------------------------------------------------ základny
  const base = (sx: number, sz: number, team: 'A' | 'B') => {
    // sx/sz = znaménko rohu mapy (modrá −1,+1; červená +1,−1). Ohrada s třemi výstupy krytými zdí.
    const X = (v: number) => sx * v, Z = (v: number) => sz * v;
    const nm = team === 'A' ? 'modrých' : 'červených';
    wall([[X(80), Z(60)], [X(80), Z(52)], [X(92), Z(52)]], `F04 Zeď základny ${nm} 1`, { height: 2.6 }, 'concrete');
    wall([[X(100), Z(52)], [X(114), Z(52)], [X(114), Z(92)], [X(80), Z(92)], [X(80), Z(86)]], `F04 Zeď základny ${nm} 2`, { height: 2.6 }, 'concrete');
    wall([[X(80), Z(78)], [X(80), Z(68)]], `F04 Zeď základny ${nm} 3`, { height: 2.6 }, 'concrete');
    centered('osada.house', X(106), Z(60), 10, 6, sx > 0 ? 0 : Math.PI, { length: 10, depth: 6, height: 3.4, doorWall: 'back', doorAt: 5 }, `B11 Správní budova (${nm})`, 'plasterWhite');
    centered('osada.house', X(108), Z(84), 5, 4, 0, { length: 5, depth: 4, height: 3, parapet: 0.3, doorWall: sz > 0 ? 'front' : 'back', doorAt: 2.5, windows: false }, `B12 Strážní budka (${nm})`, 'plaster');
    add('setE.sandbagPost', X(86), Z(73), sx > 0 ? -Q : Q, {}, `Stanoviště u východu (${nm})`);
    add('cover.container', X(96), Z(88), 0, {}, `Kontejner základny (${nm})`);
    add('setH.truckCanvas', X(92), Z(62), sx > 0 ? 0.3 : Math.PI + 0.3, {}, `Nákladní auto (${nm})`);
    // Kryt před výstupy (žádný přímý průstřel do základny).
    add('setG.jersey', X(96), Z(47), 0, {}, 'Jersey před severním výstupem');
    add('setG.jersey', X(75), Z(64), Q, {}, 'Jersey před výstupem');
    add('setG.jersey', X(75), Z(82), Q, {}, 'Jersey před výstupem');
  };
  base(-1, 1, 'A');
  base(1, -1, 'B');

  // ------------------------------------------------------------------ dvůr B: kontejnery, auta, bedny
  for (const [x, z, yaw, mat] of [[0, -47, Q, 'containerRed'], [0, -39, Q, 'containerBlue'], [22, -36, 0, 'containerBlue'], [30, -36, 0, 'containerRed'], [44, -44, Q, 'containerSand'], [40, -70, 0.2, 'containerGreen']] as const)
    add('cover.container', x, z, yaw, {}, 'P01 Kontejner', mat);
  add('setH.truckCanvas', 20, -48, 0.5, {}, 'P08 Nákladní auto ve dvoře');
  add('setH.truckCanvasDamaged', 46, -62, -0.4, {}, 'P08 Odstavené nákladní auto');
  const scatter = (id: string, list: Array<[number, number, number?]>, name: string, params: P = {}) => list.forEach(([x, z, yaw]) => add(id, x, z, yaw ?? 0, params, name));
  scatter('setJ.crateLarge', [[34, -60], [36, -58, 0.5], [12, -44], [-6, -44, 0.3], [54, -30], [-36, 36], [-62, 44, 0.4], [66, 52], [22, 44], [-20, 6]], 'P03 Bedna');
  scatter('setJ.crateStrapped', [[35, -59.2, 0.2], [13.2, -45.4], [-35, 37.4, 0.6], [67.2, 53], [-21, 7.4]], 'P03 Bedna s pásy');
  scatter('setJ.drumMetal', [[26, -62], [27, -62.8], [-52, 31], [-51, 31.9], [62, 36], [4, 36], [72, -24]], 'P06 Sud');
  scatter('setJ.palletStack', [[2, -72], [48, -52], [-38, 32], [40, 34]], 'P04 Stoh palet');
  scatter('setG.jersey', [[30, -44, 0.3], [38, -52, Q], [-8, 48, 0], [18, 48, 0.2], [-38, 4, Q], [90, 6, 0.3], [92, -24, Q]], 'F10 Betonová bariéra');
  scatter('setG.bagsStraight', [[-70, -18, 0.6], [-56, -34, -0.5], [58, 56, 0], [70, 40, Q], [-46, 46, 0.2], [26, -56, 0.8]], 'F11 Pytlová bariéra');
  add('setH.smallBurnt', -52, -10, 0.7, {}, 'P09 Ohořelé auto');
  add('setH.vanBurnt', 42, 26, -0.3, {}, 'P10 Dodávka');
  add('setH.smallCrashed', -14, 54, 1.9, {}, 'P09 Havarované auto');

  // Zídky zahrad a clony mezi vesnicí a sklady (krátké spojky zůstávají volné).
  const low = (pts: Array<[number, number]>, name: string) => wall(pts, name, { height: 1.1, thickness: 0.3, spacing: 4 }, 'sandstone');
  low([[-96, -20], [-96, -36], [-82, -36]], 'F05 Zídka zahrady 1');
  low([[-76, 0], [-76, -12]], 'F05 Zídka zahrady 2');
  low([[-54, 4], [-47, 4]], 'F05 Zídka u cesty');
  low([[-94, 20], [-78, 20], [-78, 26]], 'F05 Zídka zahrady 3');
  low([[-36, -52], [-26, -58]], 'F05 Zídka u severní cesty');
  // Kryt v otevřeném prostoru mezi dílnou, sklady a vodojemem (přerušuje dlouhé průstřely podél štěrkové cesty).
  low([[-28, 12], [-14, 12]], 'F05 Zídka u skladu 1');
  low([[-8, 26], [-8, 36]], 'F05 Zídka u skladu 2');
  low([[2, 32], [14, 34]], 'F05 Zídka u skladu 3');
  low([[-74, -2], [-70, 10]], 'F05 Zídka u jižní cesty');
  add('cover.container', -18, 30, 0.3, {}, 'P02 Kontejner u dílny', 'containerGreen');
  add('cover.container', 26, 46, Q, {}, 'P02 Kontejner u vodojemu', 'containerSand');
  add('cover.container', -30, 2, 0, {}, 'P02 Kontejner u skladu', 'containerBlue');
  add('cover.container', 84, -28, 0.2, {}, 'P02 Kontejner u východní cesty', 'containerRed');
  // Opěrná zídka mezi dílnou a hřbetem s průchody (schody z konceptu = mezery).
  wall([[-70, 52], [-52, 52]], 'F12 Opěrná zeď 1', { height: 1.4 }, 'concrete');
  wall([[-46, 52], [-18, 54]], 'F12 Opěrná zeď 2', { height: 1.4 }, 'concrete');
  wall([[-10, 54], [24, 52]], 'F12 Opěrná zeď 3', { height: 1.4 }, 'concrete');
  // Pletivo skladového areálu (střely projdou, pohyb ne) s branami = mezerami.
  const mesh = (pts: Array<[number, number]>, name: string) => {
    const [x0, z0] = pts[0];
    add('osada.fence', x0, z0, 0, { points: pts.map(([x, z]) => `${x - x0},${z - z0}`).join(';'), kind: 'chainlink', height: 2.2 }, name);
  };
  mesh([[-8, -92], [-8, -74]], 'F01 Pletivo dvora Z');
  mesh([[30, -90], [52, -90], [52, -78]], 'F01 Pletivo dvora SV');
  mesh([[38, 6], [44, 6], [44, -4]], 'F01 Pletivo u průchozího skladu');

  // ------------------------------------------------------------------ hřbet a obchvat: skály, keře, stromy
  scatter('osada.boulder', [[-44, 62, 0.3], [-26, 70, 1.1], [-8, 64, 2], [12, 72, 0.6], [26, 66, 1.7], [-58, 76, 0.2], [64, 76, 1.3], [84, 70, 2.4], [100, 60, 0.5], [102, 8, 1.9], [-16, 84, 0.9], [18, 92, 2.8]], 'T05 Balvan', { size: 2.4, sink: 0.35 });
  scatter('setK.boulderLarge', [[-34, 60, 0.7], [0, 62, 1.5], [90, 86, 0.2], [44, 90, 2.2], [-70, 90, 1]], 'T06 Skalní blok');
  scatter('setK.bushOlive', [[-50, 68], [-18, 60], [8, 60], [34, 74], [72, 84], [96, 44], [-92, 44], [-110, 6], [-64, -90], [-10, -72], [60, -84], [98, -30], [104, -8], [-74, 70], [52, 80]], 'T08 Nízký keř');
  scatter('setK.bushDense', [[-40, 74], [20, 78], [80, 58], [-106, -84], [28, -92], [108, 50]], 'T09 Vysoký keř');
  scatter('setK.oliveSmall', [[-94, -90], [-46, -90], [-112, -40], [-112, 40], [-70, 58], [-22, 22], [-36, 16], [34, -12], [40, 12], [74, 8], [100, -42], [76, -84], [22, -68], [-8, 30], [90, 52], [-60, -46]], 'T10 Olivovník');
  scatter('setK.oliveLarge', [[-78, -22], [-20, -90], [56, -78], [30, 56], [-98, 46], [104, 74]], 'T10 Velký olivovník');
  scatter('setK.treeDead', [[-2, 78], [58, 90], [-88, 92]], 'T11 Suchý strom');
  scatter('setI.lampSingle', [[-58, -18], [6, -52], [36, -42], [-48, 40], [50, 40]], 'P16 Pouliční lampa');

  // ------------------------------------------------------------------ herní data
  const y = (x: number, z: number) => osadaHeight(x, z) + 0.1;
  const cp = (id: string, name: string, x: number, z: number, owner: ControlPoint['defaultOwner'], capturable: boolean, radius = 9): ControlPoint => ({ id, name, position: [x, y(x, z), z], radius, height: 4, defaultOwner: owner, capturable, spawnEnabled: true, countsForBleed: capturable });
  const controlPoints: ControlPoint[] = [
    cp('cp_blue', 'Základna modrých', -98, 72, 'teamA', false, 10),
    cp('cp_a', 'A Náves', -64, -26, 'neutral', true),
    cp('cp_b', 'B Skladový dvůr', 30, -54, 'neutral', true),
    cp('cp_c', 'C Dílna', -44, 38, 'neutral', true),
    cp('cp_d', 'D Vodojem', 62, 48, 'neutral', true),
    cp('cp_red', 'Základna červených', 98, -72, 'teamB', false, 10),
  ];
  const spawnPoints: SpawnPoint[] = [];
  const sp = (id: string, x: number, z: number, yaw: number, teams: Team[], cpId: string) => spawnPoints.push({ id, position: [x, y(x, z), z], yaw, teams, controlPointId: cpId });
  // Základny: 8 míst (celý tým najednou), čelem k výstupům.
  for (let i = 0; i < 8; i++) {
    const dx = (i % 4) * 2.4, dz = Math.floor(i / 4) * 2.6;
    sp(`blue${i}`, -104 + dx, 68 + dz, -Q * 0.5, ['teamA'], 'cp_blue');
    sp(`red${i}`, 97 + dx, -74 + dz, Math.PI - Q * 0.5, ['teamB'], 'cp_red');
  }
  // Body: místa mimo střed zabírání a mimo přímý výhled z hlavního přístupu (za domy, halami, zdí).
  const both: Team[] = ['teamA', 'teamB'];
  const around: Record<string, Array<[number, number, number]>> = {
    cp_a: [[-78, -34, -Q], [-52, -36, Q], [-70, -8, 0], [-52, -16, Q]],
    cp_b: [[14, -70, Math.PI], [44, -66, Q], [6, -46, -Q], [50, -46, Q]],
    cp_c: [[-70, 36, -Q], [-36, 49, 0], [-24, 40, Q], [-58, 48, 0]],
    cp_d: [[46, 32, Math.PI], [76, 30, Math.PI], [76, 56, Q], [46, 58, 0]],
  };
  for (const [id, list] of Object.entries(around)) list.forEach(([x, z, yaw], i) => sp(`${id}_${i}`, x, z, yaw, both, id));

  const zones: Zone[] = [
    // Ochrana základen: nepřítel uvnitř ohrady má 8 s na odchod.
    { id: 'zone_blue', kind: 'forbidden', center: [-97, 4, 72], halfExtents: [16, 8, 19], yaw: 0, appliesTo: ['teamB'], countdown: 8 },
    { id: 'zone_red', kind: 'forbidden', center: [97, 4, -72], halfExtents: [16, 8, 19], yaw: 0, appliesTo: ['teamA'], countdown: 8 },
    // Hranice mapy: za valem kolem hrací plochy.
    { id: 'zone_n', kind: 'boundary', center: [0, 6, -(OSADA_HALF.z + 12)], halfExtents: [140, 14, 9], yaw: 0, appliesTo: both, countdown: 6 },
    { id: 'zone_s', kind: 'boundary', center: [0, 6, OSADA_HALF.z + 12], halfExtents: [140, 14, 9], yaw: 0, appliesTo: both, countdown: 6 },
    { id: 'zone_w', kind: 'boundary', center: [-(OSADA_HALF.x + 12), 6, 0], halfExtents: [9, 14, 120], yaw: 0, appliesTo: both, countdown: 6 },
    { id: 'zone_e', kind: 'boundary', center: [OSADA_HALF.x + 12, 6, 0], halfExtents: [9, 14, 120], yaw: 0, appliesTo: both, countdown: 6 },
  ];
  const zoneIds = zones.map((z) => z.id);

  return {
    schemaVersion: MAP_SCHEMA_VERSION,
    id: 'skladova_osada',
    name: 'Skladová osada',
    author: 'Potatofield',
    units: 'meters',
    terrain,
    environment: { ...DEFAULT_ENVIRONMENT, sunAzimuthDeg: 230, sunElevationDeg: 48 },
    objects,
    controlPoints,
    spawnPoints,
    zones,
    scenarios: [
      { id: 'sc_conquest', name: 'Conquest – čtyři body', overrides: [], tickets: { teamA: 150, teamB: 150 }, timeLimit: 1500, respawnDelay: 10, captureTime: 12, neutralizeTime: 10, bleedInterval: 5, zoneIds },
      {
        id: 'sc_headstart',
        name: 'Conquest – rozdělená osada',
        overrides: [
          { controlPointId: 'cp_a', defaultOwner: 'teamA' },
          { controlPointId: 'cp_c', defaultOwner: 'teamA' },
          { controlPointId: 'cp_b', defaultOwner: 'teamB' },
          { controlPointId: 'cp_d', defaultOwner: 'teamB' },
        ],
        tickets: { teamA: 150, teamB: 150 },
        timeLimit: 1500,
        respawnDelay: 10,
        captureTime: 12,
        neutralizeTime: 10,
        bleedInterval: 5,
        zoneIds,
      },
    ],
    testSpawn: { position: [-98, y(-98, 62), 62], rotation: [0, -Q * 0.5, 0] },
  };
}
