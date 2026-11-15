/**
 * Výstroj vojáků podle frakce a kitu (verze 2). Autor: externí návrh (ChatGPT) dle zadání
 * docs/ZADANI_CHATGPT_VOJACI.md, uvolněno jako CC0; v projektu upraveny jen importy.
 */
import * as THREE from 'three';
import type { Builder, LodSpec, SoldierFaction } from './body';
import type { BoneName } from './rig';

/** Zadní plocha batohu medika (z, m) – sem se lepí symbol zdravotníka (obtisk v soldier.ts). */
export const MEDIC_BACK: Record<SoldierFaction, number> = { usmc: 0.18 + 0.125 / 2, mec: 0.18 + 0.17 / 2 };
export type Kit = 'assault' | 'medic' | 'support' | 'engineer' | 'sniper';
type W = Array<[BoneName, number]>;
type V = [number, number, number];
const v = (x:number,y:number,z:number) => new THREE.Vector3(x,y,z);
export function gearV2(B:Builder, faction:SoldierFaction, kit:Kit, lod:LodSpec, headC:THREE.Vector3):void {
  const fc=faction==='usmc';
  const c=fc?{cloth:'#b4a17b',armor:'#82765a',dark:'#5c5f3d',metal:'#777d78',patch:'#2f5d9a'}:{cloth:'#665d42',armor:'#4b3d2c',dark:'#3f3527',metal:'#777568',patch:'#b2392e'};
  const seg=Math.max(6,lod.seg), detail=lod.detail>0, high=lod.detail>=1;
  const bone=(name:BoneName):W=>[[name,1]];
  const box=(p:V,s:V,color:string,b:BoneName,rot?:THREE.Euler)=>B.box(1,v(...p),s,color,bone(b),rot);
  const ell=(p:V,r:V,color:string,b:BoneName,theta=Math.PI)=>B.ellipsoid(1,v(...p),r,seg,Math.max(4,Math.ceil(seg*.55)),color,bone(b),theta);
  const prof=(rings:Array<{y:number,rx:number,rz:number,cx:number,cz:number}>,color:string,b:BoneName)=>B.profile(1,rings,seg,color,bone(b),null,true,true);
  const strap=(a:V,b:V,width:number,depth:number,color:string,boneName:BoneName)=>{
    const A=v(...a),C=v(...b),mid=A.clone().add(C).multiplyScalar(.5),delta=C.sub(A);
    const rot=new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(v(0,1,0),delta.clone().normalize()));
    B.box(1,mid,[width,delta.length(),depth],color,bone(boneName),rot);
  };
  // Main silhouettes use coarse profiles so distant LOD remains inexpensive.
  const vest=kit!=='sniper';
  if(vest){
    prof([{y:1.055,rx:.174,rz:.119,cx:0,cz:0},{y:1.24,rx:.185,rz:.125,cx:0,cz:0},{y:1.355,rx:.181,rz:.128,cx:0,cz:0}],fc?c.armor:c.cloth,'spine2');
  }else{
    prof([{y:1.18,rx:.165,rz:.111,cx:0,cz:0},{y:1.33,rx:.184,rz:.125,cx:0,cz:0}],c.cloth,'spine2');
  }
  // Waist belt.
  prof([{y:.955,rx:.172,rz:.117,cx:0,cz:0},{y:.993,rx:.172,rz:.117,cx:0,cz:0}],c.dark,'pelvis');
  // Helmet, soft cap or sniper hood.
  if(kit==='sniper'){
    ell([headC.x,headC.y+.026,headC.z],[.119,.132,.133],c.cloth,'head',Math.PI*.62);
    if(detail){box([0,1.49,-.093],[.17,.09,.035],c.dark,'head');}
  }else if(!fc && (kit==='medic'||kit==='support'||kit==='engineer')){
    ell([headC.x,headC.y+.055,headC.z],[.108,.065,.113],c.dark,'head',Math.PI*.64);
    if(kit==='engineer')box([0,1.665,-.104],[.18,.014,.09],c.cloth,'head');
  }else{
    ell([headC.x,headC.y+.055,headC.z],[.118,.115,.13],c.armor,'head',Math.PI*.57);
    if(!fc && kit==='assault')box([0,1.555,.092],[.18,.085,.034],c.cloth,'head');
  }
  // Main pack shapes deliberately vary by class.
  if(kit==='medic'){
    box([0,1.215,.18],fc?[.26,.29,.125]:[.31,.36,.17],c.cloth,'spine2');
    if(detail){box([0,1.22,MEDIC_BACK[faction]-.004],[.09,.09,.012],c.patch,'spine2');box([-.17,1.02,-.02],[.105,.15,.10],c.armor,'pelvis');}
  }else if(kit==='engineer'){
    box([0,1.22,.17],[.26,.34,.13],c.cloth,'spine2');
    if(detail){strap([-.09,1.05,.26],[.09,1.47,.26],.024,.025,c.metal,'spine2');box([.1,1.46,.26],[.105,.06,.025],c.metal,'spine2');}
  }else if(kit==='support'){
    box([0,1.16,-.153],[.24,.17,.095],c.dark,'spine2');
    if(detail)strap([-.14,1.38,-.15],[.13,1.11,-.16],.055,.03,c.metal,'spine2');
  }else if(kit==='assault' && fc){
    box([0,1.24,.16],[.20,.23,.10],c.cloth,'spine2');
  }
  if(!fc && kit==='assault' && detail)strap([-.17,1.36,-.14],[.15,1.07,-.12],.065,.03,c.dark,'spine2');
  // All classes get a canteen and matching glove cuffs.
  if(detail){
    box([.16,.975,.065],[.075,.12,.085],c.cloth,'pelvis');
    box([-.19,.905,-.01],[.077,.055,.083],c.dark,'handL');
    box([.19,.905,-.01],[.077,.055,.083],c.dark,'handR');
    box([-.205,1.29,-.012],[.012,.085,.085],c.patch,'upperArmL');
    if(kit==='assault'){
      for(let i=-1;i<=1;i++)box([i*.088,1.20,-.149],[.075,.12,.047],c.dark,'spine2');
      if(high){ell([-.13,1.065,-.127],[.032,.048,.032],c.metal,'spine2');ell([.13,1.065,-.127],[.032,.048,.032],c.metal,'spine2');}
    }
    if(kit==='sniper'){
      box([0,1.24,-.135],[.115,.06,.055],c.dark,'spine2');
      if(high){ell([-.055,1.24,-.167],[.043,.048,.039],c.metal,'spine2');ell([.055,1.24,-.167],[.043,.048,.039],c.metal,'spine2');}
    }
    if(fc && (kit==='assault'||kit==='support')){
      box([.14,1.3,.145],[.07,.10,.06],c.dark,'spine2');
      if(high)box([.14,1.41,.145],[.008,.15,.008],c.metal,'spine2');
    }
    if(fc && kit==='assault')box([0,1.665,-.115],[.15,.045,.035],c.dark,'head');
    if(!fc && kit==='medic')box([.12,1.07,-.13],[.11,.15,.065],c.dark,'spine2');
  }
}
