import * as THREE from './vendor/three/build/three.module.js';
import {OrbitControls} from './vendor/three/examples/jsm/controls/OrbitControls.js';
import {loadCraft,makeRenderer,studioLight,orbitColor,addCraftAccent} from './craft-renderer.js';
// Tracking instrument: original GLB triangle geometry, not a photograph or telemetry.
// The same simulation sample drives position, assumed nadir attitude and the trace.
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n)};
export function modelAxes(sim,k,i){
  const p=sim.vec('pos_ecef',k,i),a=sim.vec('pos_ecef',Math.max(0,k-1),i),b=sim.vec('pos_ecef',Math.min(sim.N-1,k+1),i);
  const z=unit(p.map(v=>-v)),v=b.map((x,j)=>x-a[j]);
  const y=unit(v.map((x,j)=>x-dot(v,z)*z[j])),x=unit(cross(y,z));
  return [x,unit(cross(z,x)),z];
}
export class SatelliteScope {
  constructor(id,sim,meta=sim.meta){
    this.el=document.getElementById(id);this.sim=sim;this.meta=meta;
    this.canvas=document.createElement('canvas');this.el.replaceChildren(this.canvas);
    this.canvas.style.cssText='display:block;width:100%;height:100%;touch-action:none;cursor:grab';
    this.canvas.setAttribute('aria-label','Interactive 3D spacecraft tracking scope. Drag to rotate the inspection camera.');
    this.ctx=this.canvas.getContext('2d');this.yaw=.4;this.pitch=.6;this.zoom=1;
    let drag;
    this.canvas.onpointerdown=e=>{drag=[e.offsetX,e.offsetY,this.yaw,this.pitch];this.canvas.setPointerCapture(e.pointerId)};
    this.canvas.onpointermove=e=>{if(!drag)return;this.yaw=drag[2]+(e.offsetX-drag[0])*.012;this.pitch=Math.max(-1.4,Math.min(1.4,drag[3]+(e.offsetY-drag[1])*.01));this.draw()};
    this.canvas.onpointerup=()=>drag=null;
    this.canvas.onwheel=e=>{e.preventDefault();this.zoom=Math.max(.65,Math.min(1.6,this.zoom*Math.exp(-e.deltaY*.001)));this.draw()};
    this.resizer=new ResizeObserver(()=>this.draw());this.resizer.observe(this.el);
  }
  async init(){const r=await fetch('./assets/satellite-mesh.json');if(!r.ok)throw Error('Satellite model failed to load');this.mesh=await r.json();return this}
  update(snap,state){this.snap=snap;this.state={...state};if(this.target!==state.sat){this.target=state.sat;const ax=modelAxes(this.sim,this.sim.idx(snap.time_s),state.sat),v=unit([0,1,2].map(j=>ax[0][j]*.25+ax[1][j]*-.65+ax[2][j]*.72));this.yaw=Math.atan2(v[1],v[0]);this.pitch=Math.asin(v[2]);this.up=unit(ax[1].map((v,j)=>v*.966+ax[0][j]*.259));}this.draw()}
  resize(){this.draw()}
  dispose(){this.resizer.disconnect();this.el.replaceChildren()}
  draw(){
    if(!this.snap||!this.mesh)return;
    const w=this.el.clientWidth,h=this.el.clientHeight;if(!w||!h)return;
    const d=Math.min(devicePixelRatio||1,1.5),c=this.ctx;
    if(this.canvas.width!==Math.round(w*d)||this.canvas.height!==Math.round(h*d)){this.canvas.width=Math.round(w*d);this.canvas.height=Math.round(h*d)}
    c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,w,h);
    const s=this.snap.satellites[this.state.sat],k=this.sim.idx(this.snap.time_s);
    // Fixed Earth-frame inspection camera: orbital motion changes the apparent attitude.
    const eye=unit([Math.cos(this.yaw)*Math.cos(this.pitch),Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch)]),east=unit(cross(this.up||[0,0,1],eye)),north=unit(cross(eye,east));
    const axes=modelAxes(this.sim,k,s.index),cx=w*.5,cy=h*.48,faces=[];let scale=1;
    for(const m of this.mesh){
      const vv=m.v.map(p=>{const q=[0,1,2].map(j=>axes.reduce((n,a,i)=>n+p[i]*a[j],0));return [dot(q,east),-dot(q,north),dot(q,eye)]});
      for(const f of m.f){const p=f.map(i=>vv[i]);const n=cross(p[1].map((v,i)=>v-p[0][i]),p[2].map((v,i)=>v-p[0][i]));
        if(n[2]>=0)continue;
        const light=.58+.42*Math.abs(dot(unit(n),unit([-.5,-.6,1])));
        faces.push({p,z:p.reduce((n,v)=>n+v[2],0)/3,color:m.color.map(v=>Math.min(255,Math.round(v*light+10)))});
      }
    }
    let ex=.1,ey=.1;for(const f of faces)for(const p of f.p){const q=26/(26-p[2]);ex=Math.max(ex,Math.abs(p[0]*q));ey=Math.max(ey,Math.abs(p[1]*q))}scale=Math.min((w-50)/(2*ex),(h-72)/(2*ey))*this.zoom;
    // Per-pixel depth avoids the painter-order artifacts between panel frames and cells.
    const W=this.canvas.width,H=this.canvas.height,im=c.createImageData(W,H),depth=new Float32Array(W*H);depth.fill(-Infinity);
    for(const f of faces){
      const v=f.p.map(p=>{const iz=1/(26-p[2]);return[(cx+p[0]*scale*26*iz)*d,(cy+p[1]*scale*26*iz)*d,iz]});
      const [a,b,q]=v,area=(b[1]-q[1])*(a[0]-q[0])+(q[0]-b[0])*(a[1]-q[1]);if(Math.abs(area)<1e-9)continue;
      const x0=Math.max(0,Math.floor(Math.min(...v.map(p=>p[0])))),x1=Math.min(W-1,Math.ceil(Math.max(...v.map(p=>p[0])))),y0=Math.max(0,Math.floor(Math.min(...v.map(p=>p[1])))),y1=Math.min(H-1,Math.ceil(Math.max(...v.map(p=>p[1]))));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const u=((b[1]-q[1])*(x+.5-q[0])+(q[0]-b[0])*(y+.5-q[1]))/area;
        const v=((q[1]-a[1])*(x+.5-q[0])+(a[0]-q[0])*(y+.5-q[1]))/area,ww=1-u-v;if(u<0||v<0||ww<0)continue;
        const z=u*a[2]+v*b[2]+ww*q[2],i=y*W+x;if(z<=depth[i])continue;depth[i]=z;const o=i*4;im.data[o]=f.color[0];im.data[o+1]=f.color[1];im.data[o+2]=f.color[2];im.data[o+3]=255;
      }
    }
    this.surface??=document.createElement('canvas');this.surface.width=W;this.surface.height=H;this.surface.getContext('2d').putImageData(im,0,0);c.drawImage(this.surface,0,0,w,h);
    c.fillStyle=orbitColor(this.meta,s);c.fillRect(14,14,28,3);c.fillRect(w-42,14,28,3);this.canvas.dataset.time=String(k);this.canvas.dataset.satellite=s.name;
  }
}

class WebGLScope{
 constructor(id,meta,sim){this.el=document.getElementById(id);this.meta=meta;this.sim=sim;this.kind='webgl';this.renderer=makeRenderer(this.el);this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(32,1,.01,100);this.camera.position.set(2.4,1.6,4.8);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enablePan=false;this.controls.enableDamping=true;this.controls.minDistance=2.6;this.controls.maxDistance=7;this.controls.rotateSpeed=.65;this.controls.addEventListener('change',()=>this.renderer.render(this.scene,this.camera));this.environment=studioLight(this.scene,this.renderer);this.resizer=new ResizeObserver(()=>this.resize());this.resizer.observe(this.el)}
 async init(){this.craft=await loadCraft();this.accent=addCraftAccent(this.craft,'#54B7FF');this.scene.add(this.craft);this.resize();this.running=true;const frame=()=>{if(!this.running)return;this.controls.update();this.raf=requestAnimationFrame(frame)};frame();return this}
 update(snap,state){const color=orbitColor(this.meta,state.sat);this.accent.material.color.set(color);this.accent.material.emissive.set(color);const ax=modelAxes(this.sim,this.sim.idx(snap.time_s),state.sat).map(a=>new THREE.Vector3(a[0],a[2],-a[1]));this.craft.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(...ax));if(this.target!==state.sat){this.target=state.sat;const eye=new THREE.Vector3(.25,-.65,.72).normalize().applyQuaternion(this.craft.quaternion);this.camera.position.copy(eye.multiplyScalar(4.5));this.camera.up.copy(new THREE.Vector3(.259,.966,0).applyQuaternion(this.craft.quaternion));this.controls.target.set(0,0,0);this.controls.update()}this.renderer.domElement.dataset.time=String(snap.time_s);this.renderer.domElement.dataset.satellite=snap.satellites[state.sat].name;this.renderer.render(this.scene,this.camera)}
 resize(){const w=this.el.clientWidth,h=this.el.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.render(this.scene,this.camera)}
 dispose(){this.running=false;cancelAnimationFrame(this.raf);this.resizer.disconnect();this.controls.dispose();this.environment.dispose();this.renderer.dispose();this.el.replaceChildren()}
}
export async function createScope(id,meta,simulation){let scope;try{scope=new WebGLScope(id,meta,simulation);return await scope.init()}catch(e){scope?.dispose();console.info('Using the spacecraft compatibility renderer:',e.message);const fallback=await new SatelliteScope(id,simulation,meta).init();fallback.kind='cpu';return fallback}}
