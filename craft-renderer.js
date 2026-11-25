import * as THREE from './vendor/three/build/three.module.js';
import {GLTFLoader} from './vendor/three/examples/jsm/loaders/GLTFLoader.js';
import {RoomEnvironment} from './vendor/three/examples/jsm/environments/RoomEnvironment.js';
export const orbitKey=s=>'plane:'+(s.plane??('sat-'+s.index));
export function orbitColor(meta,s){s=typeof s==='number'?meta.satellites[s]:s;return s.orbit_color||meta.planes?.find(p=>p.index===s.plane)?.color||s.color||'#54B7FF'}
export function orbitRepresentatives(meta,selected){const planes=new Map();for(const s of meta.satellites){const key=orbitKey(s);if(!planes.has(key)||s.index===selected)planes.set(key,s.index)}return [...planes.values()].sort((a,b)=>(a===selected)-(b===selected));}
export function addCraftAccent(craft,color){const material=new THREE.MeshStandardMaterial({color,metalness:.55,roughness:.32,emissive:color,emissiveIntensity:.15});const accent=new THREE.Mesh(new THREE.BoxGeometry(1.18,.05,.075),material);accent.position.set(0,-.86,.43);accent.name='Orbital plane identification strip';craft.add(accent);return accent}
let craftPromise;
export async function loadCraft(){
  craftPromise??=new GLTFLoader().loadAsync(new URL('./assets/satellite.glb',import.meta.url).href).then(g=>{
    const object=g.scene,box=new THREE.Box3().setFromObject(object),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    object.position.sub(center);const group=new THREE.Group();group.add(object);group.scale.setScalar(2/Math.max(size.x,size.y,size.z));
    object.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;n.frustumCulled=false;if(n.material){n.material.envMapIntensity=1.1;n.material.needsUpdate=true}}});
    return group;
  });
  return (await craftPromise).clone(true);
}
export function makeRenderer(el){
  const canvas=document.createElement('canvas');
  const context=canvas.getContext('webgl2',{alpha:true,antialias:true,powerPreference:'high-performance'});
  if(!context)throw Error('WebGL2 unavailable');
  const renderer=new THREE.WebGLRenderer({canvas,context,alpha:true,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));renderer.setClearColor(0x000000,0);
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;
  el.replaceChildren(renderer.domElement);renderer.domElement.style.cssText='display:block;width:100%;height:100%;touch-action:none;outline:none';
  return renderer;
}
export function studioLight(scene,renderer){
  const env=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer),target=pmrem.fromScene(env,.04);
  scene.environment=target.texture;env.dispose();pmrem.dispose();
  const sun=new THREE.DirectionalLight(0xfff5e4,3);sun.position.set(3,4,5);scene.add(sun);
  const fill=new THREE.DirectionalLight(0xa5cfff,2);fill.position.set(-4,-1,2);scene.add(fill);
  scene.add(new THREE.HemisphereLight(0xc8e3ff,0x293455,1.4));return target;
}
