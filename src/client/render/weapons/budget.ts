import type { Detail } from './meshkit';

/**
 * Stupně detailu od nejjemnějšího po nejhrubší. Generátor zbraně se postaví v nejjemnějším
 * stupni, který se vejde do rozpočtu (geometrie se tvoří jednou při přípravě assetu).
 * P0–P4 pro vlastní pohled (bez vynechání dílů), P5–P8 pro world modely (vynechává drobnosti).
 */
export const DETAIL_PRESETS: Detail[] = [
  { bevelSegments: 3, corner: 3, latheScale: 1.3, latheMin: 10, magSegs: 12, minPart: 0 },
  { bevelSegments: 2, corner: 2, latheScale: 1, latheMin: 8, magSegs: 10, minPart: 0 },
  { bevelSegments: 1, corner: 1, latheScale: 0.85, latheMin: 8, magSegs: 8, minPart: 0 },
  { bevelSegments: 1, corner: 0, latheScale: 0.7, latheMin: 8, magSegs: 6, minPart: 0 },
  { bevelSegments: 0, corner: 0, latheScale: 0.6, latheMin: 6, magSegs: 5, minPart: 0 },
  { bevelSegments: 0, corner: 0, latheScale: 0.5, latheMin: 6, magSegs: 4, minPart: 0.008 },
  { bevelSegments: 0, corner: 0, latheScale: 0.4, latheMin: 6, magSegs: 4, minPart: 0.014 },
  { bevelSegments: 0, corner: 0, latheScale: 0.33, latheMin: 5, magSegs: 3, minPart: 0.02 },
  { bevelSegments: 0, corner: 0, latheScale: 0.25, latheMin: 4, magSegs: 3, minPart: 0.03 },
];

/** Rozpočty trojúhelníků (zadání autora). */
export const WEAPON_BUDGET = {
  firstPerson: { min: 3000, max: 3500 },
  world: { min: 1000, max: 1300 },
  worldFar: { min: 200, max: 300 },
} as const;
