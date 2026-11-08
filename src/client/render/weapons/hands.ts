import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bevelBox, lathe, merge } from './meshkit';

/**
 * Společný rig rukou: dlaň, čtyři prsty po třech článcích, palec, zápěstí s manžetou,
 * předloktí s rukávem. Lokální osy ruky: +Y hřbet, −Z směr prstů, palec na straně −X
 * (pravá ruka; levá je zrcadlená). Pózy = data (ohyb článků), žádné full-body IK.
 */
export interface HandLook {
  id: string;
  glove: string;
  gloveDark: string;
  /** Prsty bez rukavice (bezprsté rukavice / holé ruce). */
  fingerless: boolean;
  bare: boolean;
  skin: string;
  sleeve: 'usmcDesert' | 'mecDesert' | 'plaGreen';
  rolledSleeve: boolean;
}

export const HAND_LOOKS: Record<string, HandLook> = {
  usmcAssault: { id: 'usmcAssault', glove: '#b59d78', gloveDark: '#8f7a5a', fingerless: false, bare: false, skin: '#c99a7a', sleeve: 'usmcDesert', rolledSleeve: false },
  usmcMedic: { id: 'usmcMedic', glove: '#c99a7a', gloveDark: '#a77b5f', fingerless: false, bare: true, skin: '#c99a7a', sleeve: 'usmcDesert', rolledSleeve: true },
  usmcSupport: { id: 'usmcSupport', glove: '#5b6043', gloveDark: '#43472f', fingerless: false, bare: false, skin: '#b8876a', sleeve: 'usmcDesert', rolledSleeve: false },
  usmcEngineer: { id: 'usmcEngineer', glove: '#2e2d2b', gloveDark: '#1f1e1c', fingerless: false, bare: false, skin: '#8d5d42', sleeve: 'usmcDesert', rolledSleeve: false },
  mecAssault: { id: 'mecAssault', glove: '#1e1e1e', gloveDark: '#141414', fingerless: false, bare: false, skin: '#a8775a', sleeve: 'mecDesert', rolledSleeve: false },
  mecSupport: { id: 'mecSupport', glove: '#6b5038', gloveDark: '#4f3a28', fingerless: true, bare: false, skin: '#9c6c50', sleeve: 'mecDesert', rolledSleeve: false },
  plaAssault: { id: 'plaAssault', glove: '#4f5a3c', gloveDark: '#39422b', fingerless: false, bare: false, skin: '#d1a582', sleeve: 'plaGreen', rolledSleeve: false },
  usmcSniper: { id: 'usmcSniper', glove: '#6f6448', gloveDark: '#57503a', fingerless: false, bare: false, skin: '#c49a7c', sleeve: 'usmcDesert', rolledSleeve: false },
  mecSniper: { id: 'mecSniper', glove: '#2e2c27', gloveDark: '#1f1e1b', fingerless: false, bare: false, skin: '#a37656', sleeve: 'mecDesert', rolledSleeve: false },
  mecMedic: { id: 'mecMedic', glove: '#a8775a', gloveDark: '#8a5f45', fingerless: false, bare: true, skin: '#a8775a', sleeve: 'mecDesert', rolledSleeve: true },
  mecEngineer: { id: 'mecEngineer', glove: '#6e6658', gloveDark: '#544d41', fingerless: false, bare: false, skin: '#b07e5e', sleeve: 'mecDesert', rolledSleeve: false },
  plaMedic: { id: 'plaMedic', glove: '#d1a582', gloveDark: '#b38966', fingerless: false, bare: true, skin: '#d1a582', sleeve: 'plaGreen', rolledSleeve: true },
  plaSupport: { id: 'plaSupport', glove: '#34402c', gloveDark: '#262f20', fingerless: false, bare: false, skin: '#c99c78', sleeve: 'plaGreen', rolledSleeve: false },
  plaEngineer: { id: 'plaEngineer', glove: '#3d3e3c', gloveDark: '#2b2c2a', fingerless: false, bare: false, skin: '#be8f6c', sleeve: 'plaGreen', rolledSleeve: false },
};

export interface FingerPose {
  /** Ohyb tří článků (rad) pro ukazovák, prostředník, prsteník, malík. */
  fingers: [number, number, number][];
  /** Palec: [rozevření, ohyb1, ohyb2]. */
  thumb: [number, number, number];
  /** Ukazovák mimo spoušť (natažený podél pouzdra). */
  triggerOff?: boolean;
}

export const POSES: Record<'grip' | 'support' | 'handguard' | 'magazine' | 'open', FingerPose> = {
  grip: { fingers: [[0.15, 0.25, 0.2], [1.25, 1.35, 0.7], [1.3, 1.4, 0.75], [1.35, 1.4, 0.8]], thumb: [0.9, 0.4, 0.3], triggerOff: true },
  /** Podpůrná ruka u pistole: celá dlaň obejme pravou ruku (bez prstu na spoušti). */
  support: { fingers: [[1.1, 1.2, 0.6], [1.2, 1.3, 0.7], [1.25, 1.35, 0.7], [1.3, 1.35, 0.75]], thumb: [0.6, 0.3, 0.2] },
  handguard: { fingers: [[0.9, 1.1, 0.6], [1.0, 1.15, 0.65], [1.05, 1.2, 0.7], [1.1, 1.2, 0.7]], thumb: [0.4, 0.2, 0.1] },
  magazine: { fingers: [[0.9, 0.9, 0.5], [1.0, 1.0, 0.55], [1.05, 1.05, 0.6], [1.1, 1.1, 0.6]], thumb: [0.7, 0.5, 0.3] },
  open: { fingers: [[0.15, 0.2, 0.1], [0.2, 0.25, 0.1], [0.25, 0.25, 0.15], [0.3, 0.3, 0.15]], thumb: [0.5, 0.1, 0.05] },
};

const FINGER_LEN: [number, number, number][] = [
  [0.042, 0.026, 0.021],
  [0.046, 0.029, 0.022],
  [0.043, 0.027, 0.021],
  [0.034, 0.021, 0.018],
];
const FINGER_X = [-0.029, -0.0095, 0.0095, 0.027];
const FINGER_R = [0.0088, 0.0092, 0.0086, 0.0076];

/**
 * Jedna ruka jako SkinnedMesh: kosti = klouby, každý článek je tuze navázaný na svou kost.
 * Celá ruka (rukavice, holá kůže, manžeta) = jeden mesh a jeden materiál (barvy vrcholů).
 */
export class Hand {
  readonly root = new THREE.Group();
  readonly forearm = new THREE.Group();
  private bones: THREE.Bone[][] = [];
  private thumbB: THREE.Bone[] = [];
  readonly side: 1 | -1;
  readonly mesh: THREE.SkinnedMesh;

  constructor(side: 'right' | 'left', mats: { glove: THREE.Material; sleeve: THREE.Material; skin: THREE.Material }, look: HandLook, geo: HandGeometry) {
    this.side = side === 'right' ? 1 : -1;
    const holder = new THREE.Group();
    holder.scale.x = this.side; // levá ruka = zrcadlo
    this.root.add(holder);
    const rootBone = new THREE.Bone();
    const all: THREE.Bone[] = [rootBone];
    for (let f = 0; f < 4; f++) {
      const chain: THREE.Bone[] = [];
      let parent: THREE.Bone = rootBone;
      for (let k = 0; k < 3; k++) {
        const b = new THREE.Bone();
        b.position.copy(fingerJointOffset(f, k));
        parent.add(b);
        chain.push(b);
        all.push(b);
        parent = b;
      }
      this.bones.push(chain);
    }
    let parent: THREE.Bone = rootBone;
    for (let k = 0; k < 3; k++) {
      const b = new THREE.Bone();
      if (k === 0) {
        b.position.set(-0.038, -0.006, -0.022);
        b.rotation.set(0, 0.9, 0);
      } else b.position.set(0, 0, -THUMB_LEN[k - 1]);
      parent.add(b);
      this.thumbB.push(b);
      all.push(b);
      parent = b;
    }
    this.mesh = new THREE.SkinnedMesh(geo.hand, mats.glove);
    this.mesh.add(rootBone);
    // Klidová póza: světové matice kostí musí existovat před výpočtem inverzí.
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(all), new THREE.Matrix4());
    this.mesh.frustumCulled = false;
    holder.add(this.mesh);
    const arm = new THREE.Mesh(look.rolledSleeve ? geo.forearmRolled : geo.forearm, mats.sleeve);
    arm.frustumCulled = false;
    this.forearm.add(arm);
    void mats.skin;
  }

  /** Rámec ruky pro model paží: zápěstí ve světě, směr prstů a hřbetu (zrcadlení už započtené). */
  frame(): { wrist: THREE.Vector3; fingers: THREE.Vector3; back: THREE.Vector3 } {
    const holder = this.root.children[0];
    holder.updateWorldMatrix(true, false);
    const o = holder.localToWorld(new THREE.Vector3());
    return {
      wrist: o,
      fingers: holder.localToWorld(new THREE.Vector3(0, 0, -1)).sub(o).normalize(),
      back: holder.localToWorld(new THREE.Vector3(0, 1, 0)).sub(o).normalize(),
    };
  }

  /** Ohyb prstů (rad, kladně = sevřít): [ukazovák, prostředník, prsteník, malík][článek], palec [3]. */
  curls(): { fingers: number[][]; thumb: number[] } {
    return { fingers: this.bones.map((ch) => ch.map((b) => -b.rotation.x)), thumb: this.thumbB.map((b) => -b.rotation.x) };
  }

  /** Skryje vlastní geometrii ruky a předloktí (kreslí je model paží). */
  hideGeometry() {
    this.mesh.visible = false;
    for (const c of this.forearm.children) c.visible = false;
  }

  setPose(p: FingerPose, blend = 1) {
    for (let f = 0; f < 4; f++) {
      for (let k = 0; k < 3; k++) {
        let a = p.fingers[f][k];
        if (f === 0 && p.triggerOff && k === 0) a = 0.12;
        const b = this.bones[f][k];
        b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, -a, blend);
      }
    }
    this.thumbB[0].rotation.x = THREE.MathUtils.lerp(this.thumbB[0].rotation.x, -p.thumb[0] * 0.6, blend);
    this.thumbB[1].rotation.x = THREE.MathUtils.lerp(this.thumbB[1].rotation.x, -p.thumb[1], blend);
    this.thumbB[2].rotation.x = THREE.MathUtils.lerp(this.thumbB[2].rotation.x, -p.thumb[2], blend);
  }
}

const THUMB_LEN = [0.04, 0.03, 0.025];
function fingerJointOffset(f: number, k: number) {
  if (k === 0) return new THREE.Vector3(FINGER_X[f], 0.002, -0.088 + (f === 0 || f === 3 ? 0.006 : 0));
  return new THREE.Vector3(0, 0, -FINGER_LEN[f][k - 1]);
}

export interface HandGeometry {
  hand: THREE.BufferGeometry;
  forearm: THREE.BufferGeometry;
  forearmRolled: THREE.BufferGeometry;
  dispose(): void;
}

/** Článek prstu: zaoblená kapsle podél −Z. */
function capsuleZ(r: number, len: number, seg: number, color: string) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 1.2), 2, seg);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, -len / 2);
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(color);
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3])), 3));
  return g.toNonIndexed();
}

function withSkin(g: THREE.BufferGeometry, bone: number) {
  const n = g.getAttribute('position').count;
  const idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    idx[i * 4] = bone;
    w[i * 4] = 1;
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
  return g;
}

export function buildHandGeometry(look: HandLook, segScale = 1): HandGeometry {
  const seg = Math.max(6, Math.round(10 * segScale));
  const gc = look.glove;
  const parts: THREE.BufferGeometry[] = [];
  // Kost 0 = dlaň (+ manžeta). Pořadí kostí: dlaň, 4×3 prsty, 3 palec.
  const palmParts = [
    bevelBox(0.084, 0.028, 0.092, 0.011, look.bare ? look.skin : gc, [0, 0, -0.046]),
    bevelBox(0.076, 0.012, 0.02, 0.005, look.bare ? look.skin : look.gloveDark, [0, 0.013, -0.084]),
    lathe([[0.0, -0.005], [0.036, -0.005], [0.04, 0.02], [0.04, 0.05], [0.0, 0.05]], seg, look.bare ? look.skin : look.gloveDark),
  ];
  if (!look.bare) palmParts.push(bevelBox(0.05, 0.006, 0.04, 0.003, look.gloveDark, [0.004, 0.015, -0.04]));
  for (const g of palmParts) parts.push(withSkin(g, 0));
  // Články v klidové póze: pozice = součet offsetů kloubů.
  for (let f = 0; f < 4; f++) {
    const pos = new THREE.Vector3();
    for (let k = 0; k < 3; k++) {
      pos.add(fingerJointOffset(f, k));
      const bare = look.bare || (look.fingerless && k > 0);
      const g = capsuleZ(FINGER_R[f] * (1 - k * 0.08), FINGER_LEN[f][k], seg, bare ? look.skin : gc);
      g.translate(pos.x, pos.y, pos.z);
      parts.push(withSkin(g, 1 + f * 3 + k));
    }
  }
  // Palec: první kost je natočená → geometrii otočit stejně.
  const tb = new THREE.Matrix4().compose(new THREE.Vector3(-0.038, -0.006, -0.022), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.9, 0)), new THREE.Vector3(1, 1, 1));
  let off = 0;
  [0.012, 0.0105, 0.0095].forEach((r, k) => {
    const bare = look.bare || (look.fingerless && k > 1);
    const g = capsuleZ(r, THUMB_LEN[k], seg, bare ? look.skin : gc);
    g.translate(0, 0, -off);
    g.applyMatrix4(tb);
    off += THUMB_LEN[k];
    parts.push(withSkin(g, 13 + k));
  });
  const hand = mergeGeometries(parts, false)!;
  for (const g of parts) g.dispose();
  hand.computeBoundingSphere();
  // Předloktí s rukávem: rotační profil se záhyby (geometrie, ne simulace látky).
  const prof: Array<[number, number]> = [[0.0, 0.0]];
  for (let i = 0; i <= 12; i++) prof.push([0.045 + i * 0.0012 + (i % 3 === 0 ? 0.004 : 0), 0.04 + i * 0.024]);
  prof.push([0.0, 0.34]);
  const forearm = lathe(prof, seg + 4, '#ffffff');
  forearm.applyMatrix4(new THREE.Matrix4().makeScale(1, 0.85, 1));
  // Vyhrnutý rukáv: holé předloktí (barva kůže přes barvy vrcholů) + srolovaný lem.
  const rolled = [lathe([[0.0, 0.0], [0.03, 0.01], [0.034, 0.06], [0.04, 0.16], [0.0, 0.16]], seg + 4, look.skin), lathe([[0.0, 0.15], [0.055, 0.15], [0.06, 0.2], [0.05, 0.34], [0.0, 0.34]], seg + 4, '#ffffff')];
  const forearmRolled = merge(rolled);
  return {
    hand,
    forearm,
    forearmRolled,
    dispose() {
      hand.dispose();
      forearm.dispose();
      forearmRolled.dispose();
    },
  };
}

/** Procedurální kamufláž rukávu (vlastní vzory, ne kopie BF2). Generuje se jednou. */
export function makeCamoTexture(kind: HandLook['sleeve']): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  let s = 1234 + kind.length * 77;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pal =
    kind === 'usmcDesert' ? ['#b9a37f', '#9d8462', '#c9b694', '#7e6a4f'] : kind === 'mecDesert' ? ['#6b5440', '#5b4636', '#7a634b', '#64503c'] /* hnědá košile MEC (shodně s world modelem) */ : ['#5c6447', '#495238', '#757a59', '#3a3f2c'];
  g.fillStyle = pal[0];
  g.fillRect(0, 0, 256, 256);
  if (kind === 'usmcDesert') {
    // Digitální (pixelový) vzor ve shlucích.
    for (let k = 0; k < 900; k++) {
      const x = Math.floor(r() * 64) * 4, y = Math.floor(r() * 64) * 4;
      g.fillStyle = pal[1 + Math.floor(r() * 3)];
      const w = (1 + Math.floor(r() * 3)) * 4, h = (1 + Math.floor(r() * 2)) * 4;
      g.fillRect(x, y, w, h);
    }
  } else {
    // Skvrnitý vzor: měkké nepravidelné skvrny.
    for (let k = 0; k < 70; k++) {
      g.fillStyle = pal[1 + Math.floor(r() * 3)];
      g.beginPath();
      const x = r() * 256, y = r() * 256, rad = 8 + r() * 26;
      for (let a = 0; a < Math.PI * 2; a += 0.6) {
        const rr = rad * (0.6 + r() * 0.6);
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        if (a === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
    }
  }
  // Jemná textilní struktura.
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = ((i / 4) % 2 === 0 ? 6 : -6) + (r() - 0.5) * 10;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 3);
  t.anisotropy = 4;
  return t;
}
