import * as THREE from 'three';
import { expect, it } from 'vitest';
import { shareOrm } from '../src/client/render/materials';

it('ORM textura se čte jednou místo třikrát (drsnost, kov, AO)', () => {
  const t = new THREE.Texture();
  const m = new THREE.MeshStandardMaterial({ roughnessMap: t, metalnessMap: t, aoMap: t });
  const sh = { fragmentShader: '#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <aomap_fragment>' };
  shareOrm(m, sh);
  expect((sh.fragmentShader.match(/texture2D/g) ?? []).length).toBe(1);
  expect(sh.fragmentShader).toContain('gOrm.r');
  expect(sh.fragmentShader).toContain('metalnessFactor *= texelMetalness.b');
});

it('různé textury drsnosti a AO zůstanou samostatná čtení', () => {
  const m = new THREE.MeshStandardMaterial({ roughnessMap: new THREE.Texture(), aoMap: new THREE.Texture() });
  const sh = { fragmentShader: '#include <roughnessmap_fragment>\n#include <aomap_fragment>' };
  shareOrm(m, sh);
  expect(sh.fragmentShader).toContain('#include <aomap_fragment>');
});
