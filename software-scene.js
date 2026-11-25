import {orbitColor,orbitRepresentatives} from './craft-renderer.js';
import {spacecraftSprite} from './mesh-raster.js';
// CPU projection of the same Earth coordinates and GLB triangle mesh.
// Used only when a browser cannot initialize WebGL. Rendering never feeds the physics.
const R=6378.137,rad=Math.PI/180,E2=.00669437999014,B2=1-E2;
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const n=Math.hypot(...a);return a.map(x=>x/n)};
const pos=(lon,lat,r=R)=>{const a=lat*rad,o=lon*rad,n=R/Math.sqrt(1-E2*Math.sin(a)**2),h=r-R;return[(n+h)*Math.cos(a)*Math.cos(o),(n+h)*Math.cos(a)*Math.sin(o),(n*B2+h)*Math.sin(a)]};
export class SoftwareScene{
 constructor(id,meta,handlers,small=false){this.el=document.getElementById(id);this.el.innerHTML='';this.canvas=document.createElement('canvas');this.el.append(this.canvas);this.canvas.style.cssText='width:100%;height:100%;touch-action:none;cursor:grab';this.ctx=this.canvas.getContext('2d');this.meta=meta;this.handlers=handlers;this.small=small;this.lon=44;this.lat=24;this.zoom=small?.78:1;this.pan=[0,0];this.hits=[];this.mode='earth';this.cache=document.createElement('canvas');this.skyCache=document.createElement('canvas');this.dirty=true;
 let down;this.canvas.onpointerdown=e=>{down={x:e.offsetX,y:e.offsetY,lon:this.lon,lat:this.lat,pan:[...this.pan],shift:e.shiftKey};this.canvas.setPointerCapture(e.pointerId)};
 this.canvas.onpointermove=e=>{if(!down){const hit=[...this.hits].reverse().find(h=>Math.hypot(h.x-e.offsetX,h.y-e.offsetY)<h.r),key=hit?hit.kind+':'+hit.id:null;if(key!==this.hover){this.hover=key;this.canvas.style.cursor=hit?'pointer':'grab';this.draw()}return;}const dx=e.offsetX-down.x,dy=e.offsetY-down.y;if(down.shift)this.pan=[down.pan[0]+dx,down.pan[1]+dy];else {this.lon=down.lon-dx/this.zoom*.12;this.lat=Math.max(-85,Math.min(85,down.lat+dy/this.zoom*.12));}this.dirty=true;this.draw()};
 this.canvas.onpointerup=e=>{if(down&&Math.hypot(e.offsetX-down.x,e.offsetY-down.y)<5){const hit=[...this.hits].reverse().find(h=>Math.hypot(h.x-e.offsetX,h.y-e.offsetY)<h.r);if(hit)this.handlers[hit.kind]?.(hit.id);else if(this.small)this.handlers.all?.()}down=null};
 this.canvas.onpointerleave=()=>{if(!down&&this.hover){this.hover=null;this.draw()}};
 this.canvas.onwheel=e=>{e.preventDefault();this.zoom=Math.max(.4,Math.min(this.mode==='earth'?4:8,this.zoom*Math.exp(-e.deltaY*.001)));this.dirty=true;this.draw()};
 this.resizer=new ResizeObserver(()=>{this.dirty=true;this.draw()});this.resizer.observe(this.el);
 }
 async init(){const image=new Image();image.src='./assets/earth.jpg';await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);this.tex={data:ctx.getImageData(0,0,c.width,c.height).data,w:c.width,h:c.height};const cloud=new Image();cloud.src='./assets/earth-clouds.jpg';await cloud.decode();const cl=document.createElement('canvas');cl.width=cloud.width;cl.height=cloud.height;cl.getContext('2d').drawImage(cloud,0,0);this.cloud={data:cl.getContext('2d').getImageData(0,0,cl.width,cl.height).data,w:cl.width,h:cl.height};this.mesh=await(await fetch('./assets/satellite-mesh.json')).json();this.sprite=spacecraftSprite(this.mesh);this.geo=await(await fetch('./assets/saudi.geojson')).json();this.draw();return this}
 update(snap,network,state){this.snap=snap;this.network=network;this.state={...state};this.canvas.dataset.time=String(snap.time_s);this.canvas.dataset.renderer='cpu';this.draw()}
 home(){this.mode='earth';this.lon=44;this.lat=24;this.zoom=this.small?.78:1;this.pan=[0,0];this.dirty=true;this.draw()}
 region(index=this.state?.region??0){const r=this.meta.regions[index];this.mode='earth';this.lon=r.lon;this.lat=r.lat;this.zoom=1.35;this.pan=[0,0];this.dirty=true;this.draw()}
 satellite(index=this.state?.sat??0){this.mode='satellite';this.focusIndex=index;this.zoom=1;this.pan=[0,0];this.draw()}
 dispose(){this.resizer.disconnect();this.el.replaceChildren()}
 project(p){const x=dot(p,this.east),y=dot(p,this.north),z=dot(p,this.eye),front=this.surfaceDepth(x/R,y/R);return{x:this.cx+x/R*this.radius,y:this.cy-y/R*this.radius,z,visible:front===null||z/R>=front-0.00025};}
 surfaceDepth(x,y){const q=[0,1,2].map(i=>this.east[i]*x+this.north[i]*y),w=1/B2,eye=this.eye;const A=eye[0]**2+eye[1]**2+eye[2]**2*w,B=q[0]*eye[0]+q[1]*eye[1]+q[2]*eye[2]*w,C=q[0]**2+q[1]**2+q[2]**2*w-1,D=B*B-A*C;return D<0?null:(-B+Math.sqrt(D))/A;}
 line(points,col,width=1,close=false){const c=this.ctx;c.beginPath();let started=false;for(const p of points){const q=this.project(p);if(q.visible){started?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y);started=true}else started=false}if(close)c.closePath();c.strokeStyle=col;c.lineWidth=width;c.stroke()}
 earth(){
  if(!this.tex)return;const c=this.ctx;
  if(this.dirty){
   const w=this.w,h=this.h;this.cache.width=w;this.cache.height=h;const cc=this.cache.getContext('2d'),im=cc.createImageData(w,h),o=im.data,t=this.tex,cl=this.cloud;
   const left=Math.max(0,Math.floor(this.cx-this.radius)),right=Math.min(w,Math.ceil(this.cx+this.radius)),top=Math.max(0,Math.floor(this.cy-this.radius)),bottom=Math.min(h,Math.ceil(this.cy+this.radius));
   for(let y=top;y<bottom;y++){const py=(this.cy-y)/this.radius;for(let x=left;x<right;x++){
    const px=(x-this.cx)/this.radius,z=this.surfaceDepth(px,py);if(z===null)continue;
    const vx=this.east[0]*px+this.north[0]*py+this.eye[0]*z,vy=this.east[1]*px+this.north[1]*py+this.eye[1]*z,vz=this.east[2]*px+this.north[2]*py+this.eye[2]*z;
    const lon=Math.atan2(vy,vx),lat=Math.atan2(vz,B2*Math.hypot(vx,vy)),u=lon/(Math.PI*2)+.5,v=.5-lat/Math.PI;
    const tx=Math.min(t.w-1,Math.max(0,Math.floor(u*t.w))),ty=Math.min(t.h-1,Math.max(0,Math.floor(v*t.h))),q=(ty*t.w+tx)*4,i=(y*w+x)*4;
    const light=.85+.25*Math.max(0,-px*.22+py*.38+z*.87),haze=Math.pow(1-Math.max(0,z),4)*.18;
    const cx=Math.min(cl.w-1,Math.max(0,Math.floor(u*cl.w))),cy=Math.min(cl.h-1,Math.max(0,Math.floor(v*cl.h))),alpha=Math.pow(cl.data[(cy*cl.w+cx)*4]/255,1.25)*.65;
    for(let ch=0;ch<3;ch++){const tone=255*Math.pow(t.data[q+ch]/255,.9)*light;o[i+ch]=(tone*(1-alpha)+242*light*alpha)*(1-haze)+[44,128,220][ch]*haze;}o[i+3]=255;
   }}cc.putImageData(im,0,0);this.dirty=false;
  }
  c.save();c.shadowColor='#428ed6';c.shadowBlur=this.small?4:16;c.drawImage(this.cache,0,0);c.restore();c.beginPath();c.arc(this.cx,this.cy,this.radius,0,Math.PI*2);c.strokeStyle='#83c6ff70';c.lineWidth=this.small?1:1.4;c.stroke();
 }
 stars(){
  if(this.small)return;const w=this.w,h=this.h,sky=this.skyCache;
  if(sky.width!==w||sky.height!==h){sky.width=w;sky.height=h;const c=sky.getContext('2d');let seed=167714;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
   const haze=c.createRadialGradient(w*.61,h*.32,0,w*.61,h*.32,w*.55);haze.addColorStop(0,'rgba(65,88,155,0.055)');haze.addColorStop(.6,'rgba(65,77,147,0.018)');haze.addColorStop(1,'rgba(25,42,85,0)');c.fillStyle=haze;c.fillRect(0,0,w,h);
   const count=Math.min(1050,Math.max(160,Math.round(w*h*.00095)));
   for(let i=0;i<count;i++){const x=random()*w,y=random()*h,bright=random(),radius=bright>.975?1.05:.3+random()*.48,alpha=.16+bright*.55;c.beginPath();c.arc(x,y,radius,0,Math.PI*2);c.fillStyle=`rgba(${bright>.7?'221,233,255':'147,181,225'},${alpha})`;c.fill();if(bright>.994){c.strokeStyle='rgba(199,225,255,.2)';c.lineWidth=.6;c.beginPath();c.moveTo(x-2.5,y);c.lineTo(x+2.5,y);c.moveTo(x,y-2.5);c.lineTo(x,y+2.5);c.stroke();}}
  }this.ctx.drawImage(sky,0,0,w,h);
 }
 drawLabels(){
  const c=this.ctx,placed=[],overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  for(const l of this.labels.sort((a,b)=>b.priority-a.priority)){c.font=l.kind==='sat'?'600 13px Segoe UI':'500 12px Segoe UI';const width=c.measureText(l.text).width+12,height=21;
   const offsets=l.kind==='sat'?[[0,-35],[0,40],[48,0],[-48,0],[50,-31],[-50,-31],[65,34],[-65,34]]:[[0,23],[31,-15],[-31,-15],[42,28],[-42,28],[0,-29],[64,0],[-64,0]];
   let box;for(const [dx,dy]of offsets){const b={x:l.x+dx-width/2,y:l.y+dy-height/2,w:width,h:height};if(b.x<8||b.x+b.w>this.w-8||b.y<8||b.y+b.h>this.h-8)continue;if(placed.some(p=>overlap(b,p)))continue;if(this.hits.some(p=>p.kind==='sat'&&overlap(b,{x:p.x-20,y:p.y-18,w:40,h:36})))continue;box=b;break;}
   if(!box)continue;placed.push({...box,x:box.x-4,y:box.y-3,w:box.w+8,h:box.h+6});
   c.fillStyle='#061327b8';c.beginPath();c.roundRect(box.x,box.y,box.w,box.h,5);c.fill();c.textAlign='center';c.textBaseline='middle';c.fillStyle=l.color;c.fillText(l.text,box.x+box.w/2,box.y+box.h/2+.5);c.textBaseline='alphabetic';
  }
 }
 ship(x,y,scale,angle=0){if(!this.sprite)return;const c=this.ctx,side=scale*10.6;c.save();c.translate(x,y);c.rotate(angle);c.drawImage(this.sprite,-side/2,-side/2,side,side);c.restore()}
 person(x,y,col,id){const c=this.ctx;c.fillStyle=col;c.strokeStyle=col;c.lineWidth=2;c.beginPath();c.arc(x,y-7,2.7,0,7);c.fill();c.beginPath();c.moveTo(x,y-3);c.lineTo(x,y+5);c.moveTo(x-5,y+4);c.lineTo(x,y-2);c.lineTo(x+5,y+4);c.moveTo(x-3,y+11);c.lineTo(x,y+4);c.lineTo(x+3,y+11);c.stroke();if(id===this.state.user){c.strokeStyle='#e9f4ff';c.lineWidth=1;c.strokeRect(x-10,y-13,20,29)}this.hits.push({kind:'user',id,x,y,r:13})}
 draw(){const w=Math.round(this.el.clientWidth),h=Math.round(this.el.clientHeight);if(!w||!h)return;if(w!==this.w||h!==this.h){this.w=w;this.h=h;this.dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.round(w*this.dpr);this.canvas.height=Math.round(h*this.dpr);this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);this.dirty=true}const c=this.ctx;c.clearRect(0,0,w,h);this.stars();this.hits=[];this.labels=[];if(!this.snap)return;
 if(this.mode==='satellite'){const s=this.snap.satellites[this.state.sat];this.ship(w*.47,h*.47,Math.min(w,h)*.07*this.zoom,-.3);c.fillStyle=orbitColor(this.meta,s);c.textAlign='center';c.font='24px Segoe UI';c.fillText(s.name,w*.47,h*.7);return}
 this.eye=norm(pos(this.lon,this.lat));this.east=norm([-Math.sin(this.lon*rad),Math.cos(this.lon*rad),0]);this.north=cross(this.eye,this.east);this.cx=w*(this.small?.5:.49)+this.pan[0];this.cy=h*(this.small?.5:.52)+this.pan[1];this.radius=Math.min(w*.44,h*.435)*this.zoom;
 this.earth();const rings=this.geo?.features[0].geometry.coordinates||[];rings.forEach(r=>this.line(r.map(p=>pos(...p)),'#d7c89c99',.8));if(this.state.showOrbits!==false)for(const i of orbitRepresentatives(this.meta,this.state.sat))this.line(this.snap.all_orbits_xyz_km[i],orbitColor(this.meta,i)+(i===this.state.sat?'ff':'c2'),i===this.state.sat?2.8:1.65);if(this.snap.footprint.length&&!this.small){const p=this.snap.footprint.map(p=>this.project(pos(...p)));if(p.every(a=>a.visible)){c.beginPath();p.forEach((q,i)=>i?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y));c.closePath();c.fillStyle=orbitColor(this.meta,this.state.sat)+'22';c.strokeStyle=orbitColor(this.meta,this.state.sat)+'dd';c.fill();c.stroke()}}
 // Allocated region beams are geometric footprints, not RF success claims.
 if(!this.small&&this.snap.dual_footprints?.length){
   const region=this.meta.regions[this.state.region];
   for(const input of this.snap.dual_footprints){const beam={...input,color:orbitColor(this.meta,input.satellite_index)};
     const points=beam.points||[];
     if(points.length>2){
       const projected=points.map(p=>this.project(pos(...p)));
       if(projected.every(p=>p.visible)){c.beginPath();projected.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();c.fillStyle=beam.color+'12';c.fill();}
       this.line([...points,points[0]].map(p=>pos(...p)),beam.color+'cc',1.3);
     }
     const sat=this.snap.satellites[beam.satellite_index];
     if(sat){c.setLineDash([3,5]);this.line([sat.xyz_km,pos(region.lon,region.lat)],beam.color+'80',.9);c.setLineDash([]);}
   }
 }
 if(this.network&&(this.state.showLinks||this.state.page==='scenarios')&&!this.small)this.network.edges.forEach(e=>{const path=this.network.path,route=path.some((v,i)=>i<path.length-1&&new Set([v,path[i+1],e.a,e.b]).size===2);if(!e.earth_clear||(!route&&e.a!==this.state.source&&e.b!==this.state.source))return;c.setLineDash(e.failed?[7,5]:route?[]:[3,5]);this.line([this.snap.satellites[e.a].xyz_km,this.snap.satellites[e.b].xyz_km],e.failed?'#ef7d85':route&&this.state.failed?'#e8c482':'#7cb5eb66',route?1.5:.8)});c.setLineDash([]);
 if(!this.small)this.meta.regions.forEach((r,i)=>{const p=this.project(pos(r.lon,r.lat));if(!p.visible)return;c.beginPath();c.arc(p.x,p.y,i===this.state.region?3.7:2.8,0,7);c.fillStyle=r.color;c.fill();this.hits.push({kind:'region',id:i,x:p.x,y:p.y,r:13});if(i===this.state.region||this.hover==='region:'+i)this.labels.push({text:r.name,color:r.color,x:p.x,y:p.y,kind:'region',priority:i===this.state.region?3:4});});
 this.snap.satellites.forEach((s,i)=>{const p=this.project(s.xyz_km);if(!p.visible)return;this.ship(p.x,p.y,this.small?1.2:5.3,-.35+i*.18);if(!this.small){const accent=orbitColor(this.meta,s),selected=i===this.state.sat;c.fillStyle=accent;c.fillRect(p.x-(selected?7:5),p.y+(selected?25:21),selected?14:10,3);if(selected){c.strokeStyle=accent;c.lineWidth=1.4;c.beginPath();c.moveTo(p.x-27,p.y-9);c.lineTo(p.x-27,p.y-17);c.lineTo(p.x-19,p.y-17);c.moveTo(p.x+27,p.y+9);c.lineTo(p.x+27,p.y+17);c.lineTo(p.x+19,p.y+17);c.stroke();}this.hits.push({kind:'sat',id:i,x:p.x,y:p.y,r:24});if(i===this.state.sat||this.hover==='sat:'+i)this.labels.push({text:s.name,color:orbitColor(this.meta,s),x:p.x,y:p.y,kind:'sat',priority:i===this.state.sat?5:4});}});
 this.drawLabels();
 }
}
