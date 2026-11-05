// Vývojový nástroj: trojúhelníky a kontrola orientace normál všech variant vojáka (npx tsx scripts/soldier-report.ts).
import * as THREE from 'three';
import { buildSoldierGeometry, SOLDIER_LODS } from '../src/client/render/soldier/body';
for (const f of ['usmc', 'mec'] as const)
  for (const v of ['base', 'assault', 'medic', 'sniper'] as const) {
    const tris = SOLDIER_LODS.map((l) => buildSoldierGeometry(f, v, l));
    const g = tris[0];
    // Podíl normál mířících od svislé osy těla ven (tělo, materiál 0).
    const pos = g.getAttribute('position'), n = g.getAttribute('normal');
    const n0 = g.groups[0].count;
    let out = 0, tot = 0;
    for (let i = 0; i < n0; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(pos as THREE.BufferAttribute, i);
      const nn = new THREE.Vector3().fromBufferAttribute(n as THREE.BufferAttribute, i);
      if (p.y < 0.2) continue;
      // osa: pro paže/nohy lokální, zde jen hrubě vodorovný směr od středu nejbližší končetiny
      const cx = Math.abs(p.x) > 0.17 && p.y > 0.8 ? Math.sign(p.x) * 0.19 : Math.abs(p.x) > 0.04 && p.y < 0.9 ? Math.sign(p.x) * 0.095 : 0;
      const d = new THREE.Vector3(p.x - cx, 0, p.z);
      if (d.length() < 0.02) continue;
      tot++;
      if (d.normalize().dot(new THREE.Vector3(nn.x, 0, nn.z)) > 0) out++;
    }
    console.log(`${f}/${v}: LOD ${tris.map((t) => t.getAttribute('position').count / 3).join(' / ')} trojúhelníků, normály ven ${(100 * out / tot).toFixed(0)} %, skupiny ${g.groups.map((x) => x.count / 3).join('+')}`);
  }
