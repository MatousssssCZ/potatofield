import * as THREE from 'three';
import type { ControlPoint, MapDocument, SpawnPoint, TeamOwner, Zone } from '../../shared/map/schema';

export const TEAM_COLORS: Record<TeamOwner | 'both', string> = {
  teamA: '#3d7fd9',
  teamB: '#d9503d',
  neutral: '#e6e0cf',
  both: '#a65fd1',
};

export const markerId = {
  cp: (id: string) => `cp:${id}`,
  sp: (id: string) => `sp:${id}`,
  zn: (id: string) => `zn:${id}`,
  parse(sel: string): { collection: 'controlPoints' | 'spawnPoints' | 'zones'; id: string } | null {
    const m = /^(cp|sp|zn):(.+)$/.exec(sel);
    if (!m) return null;
    return { collection: m[1] === 'cp' ? 'controlPoints' : m[1] === 'sp' ? 'spawnPoints' : 'zones', id: m[2] };
  },
};

/** Stožár s praporem – sdílený editorem i hrou (barva podle vlastníka). */
export function makeFlag(): { group: THREE.Group; setOwner: (o: TeamOwner, progress?: number) => void; cloth: THREE.Mesh } {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 8, 10), new THREE.MeshStandardMaterial({ color: '#9c9c96', metalness: 0.8, roughness: 0.35 }));
  pole.position.y = 4;
  pole.castShadow = true;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.3, 16), new THREE.MeshStandardMaterial({ color: '#8d877a', roughness: 0.9 }));
  base.position.y = 0.15;
  base.castShadow = base.receiveShadow = true;
  const clothGeo = new THREE.PlaneGeometry(1.8, 1.1, 12, 6);
  clothGeo.translate(0.9, 0, 0);
  const clothMat = new THREE.MeshStandardMaterial({ color: '#e6e0cf', side: THREE.DoubleSide, roughness: 0.9 });
  const cloth = new THREE.Mesh(clothGeo, clothMat);
  cloth.position.set(0.06, 7.3, 0);
  cloth.castShadow = true;
  g.add(pole, base, cloth);
  const setOwner = (o: TeamOwner, progress = 1) => {
    clothMat.color.set(TEAM_COLORS[o]);
    // Postup zabírání: prapor sjíždí/vyjíždí po stožáru.
    cloth.position.y = 1.6 + 5.7 * Math.max(0, Math.min(1, progress));
  };
  return { group: g, setOwner, cloth };
}

/** Animace vlnění praporu (kosmetika). */
export function waveCloth(cloth: THREE.Mesh, t: number) {
  const pos = (cloth.geometry as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, Math.sin(x * 2.2 - t * 4.5) * 0.12 * (x / 1.8));
  }
  pos.needsUpdate = true;
}

/**
 * Vizualizace herních markerů v editoru: vlajky s objemem zabírání, spawny
 * s orientací a týmovou barvou, zakázané zóny jako orientované boxy.
 */
export class MarkerView {
  readonly root = new THREE.Group();
  readonly volumes = new THREE.Group();
  private flags: Array<ReturnType<typeof makeFlag>> = [];
  showVolumes = true;

  constructor() {
    this.root.name = 'markers';
    this.root.add(this.volumes);
  }

  rebuild(doc: MapDocument) {
    for (const c of [...this.root.children]) if (c !== this.volumes) this.dispose(c);
    for (const c of [...this.volumes.children]) this.dispose(c);
    this.flags = [];
    for (const cp of doc.controlPoints) this.addCP(cp);
    for (const sp of doc.spawnPoints) this.addSpawn(sp, doc);
    for (const z of doc.zones) this.addZone(z);
    this.volumes.visible = this.showVolumes;
  }

  private dispose(o: THREE.Object3D) {
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    o.removeFromParent();
  }

  private addCP(cp: ControlPoint) {
    const f = makeFlag();
    f.setOwner(cp.defaultOwner);
    // Viditelnou vlajku kreslí FlagSystem (stejná jako ve hře); tento stožár slouží jen k výběru kliknutím.
    f.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.visible = false;
    });
    f.group.position.set(...cp.position);
    tag(f.group, markerId.cp(cp.id));
    this.root.add(f.group);
    this.flags.push(f);
    // Objem zabírání: válec s podstavou u markeru (poloměr × výška).
    const col = new THREE.Color(TEAM_COLORS[cp.defaultOwner]);
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(cp.radius, cp.radius, cp.height, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: cp.capturable ? 0.14 : 0.06, side: THREE.DoubleSide, depthWrite: false }),
    );
    cyl.position.set(cp.position[0], cp.position[1] + cp.height / 2, cp.position[2]);
    const ring = new THREE.Mesh(new THREE.RingGeometry(cp.radius - 0.15, cp.radius, 64), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cp.position[0], cp.position[1] + 0.05, cp.position[2]);
    const top = ring.clone();
    top.material = (ring.material as THREE.MeshBasicMaterial).clone();
    (top.material as THREE.MeshBasicMaterial).opacity = 0.4;
    top.position.y = cp.position[1] + cp.height;
    for (const m of [cyl, ring, top]) {
      m.raycast = () => {};
      this.volumes.add(m);
    }
  }

  private addSpawn(sp: SpawnPoint, doc: MapDocument) {
    const team = sp.teams.length === 2 ? 'both' : sp.teams[0] ?? 'neutral';
    const color = TEAM_COLORS[team as keyof typeof TEAM_COLORS];
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.2, 4, 10), mat);
    body.position.y = 0.9;
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 10), new THREE.MeshBasicMaterial({ color }));
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(0, 1.65, -0.5);
    g.add(body, arrow);
    g.position.set(...sp.position);
    g.rotation.y = sp.yaw;
    tag(g, markerId.sp(sp.id));
    this.root.add(g);
    // Vazba na bod: čára ke stožáru.
    const cp = sp.controlPointId ? doc.controlPoints.find((c) => c.id === sp.controlPointId) : undefined;
    if (cp) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(sp.position[0], sp.position[1] + 0.1, sp.position[2]), new THREE.Vector3(cp.position[0], cp.position[1] + 0.1, cp.position[2])]);
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color, dashSize: 0.6, gapSize: 0.4 }));
      line.computeLineDistances();
      line.raycast = () => {};
      this.volumes.add(line);
    }
  }

  private addZone(z: Zone) {
    const g = new THREE.Group();
    const box = new THREE.BoxGeometry(z.halfExtents[0] * 2, z.halfExtents[1] * 2, z.halfExtents[2] * 2);
    const fill = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: z.kind === 'forbidden' ? '#ff3b2f' : '#ffd23f', transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: z.kind === 'forbidden' ? '#ff6a4d' : '#ffe27a' }));
    edges.raycast = () => {};
    g.add(fill, edges);
    g.position.set(...z.center);
    g.rotation.y = z.yaw;
    tag(g, markerId.zn(z.id));
    this.root.add(g);
  }

  update(t: number) {
    for (const f of this.flags) waveCloth(f.cloth, t);
  }

  setVolumesVisible(v: boolean) {
    this.showVolumes = v;
    this.volumes.visible = v;
  }

  objectFor(sel: string): THREE.Object3D | undefined {
    return this.root.children.find((c) => c.userData.special === sel);
  }
}

function tag(o: THREE.Object3D, id: string) {
  o.traverse((c) => (c.userData.special = id));
}
