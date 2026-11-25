// Depth-tested projection of the bundled spacecraft mesh for the compatibility renderer.
export function spacecraftSprite(mesh,size=224){
 const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;const c=canvas.getContext('2d'),im=c.createImageData(size,size),depth=new Float32Array(size*size);depth.fill(-Infinity);const scale=size/10.6;
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 for(const m of mesh){const pp=m.v.map(p=>[p[0],p[1]*.72-p[2]*.7,p[1]*.7+p[2]*.72]);for(const f of m.f){const p=f.map(i=>pp[i]),n=cross(p[1].map((x,i)=>x-p[0][i]),p[2].map((x,i)=>x-p[0][i]));if(n[2]>=0)continue;const norm=Math.hypot(...n)||1,light=.56+.5*Math.abs((n[0]*-.3+n[1]*-.5+n[2]*.81)/norm);const col=m.color.map(x=>Math.min(255,Math.round(x*light+7)));const v=p.map(a=>{const iz=1/(26-a[2]);return[size/2+a[0]*scale*26*iz,size/2+a[1]*scale*26*iz,iz]});const [a,b,q]=v,area=(b[1]-q[1])*(a[0]-q[0])+(q[0]-b[0])*(a[1]-q[1]);if(Math.abs(area)<1e-9)continue;
 const x0=Math.max(0,Math.floor(Math.min(...v.map(p=>p[0])))),x1=Math.min(size-1,Math.ceil(Math.max(...v.map(p=>p[0])))),y0=Math.max(0,Math.floor(Math.min(...v.map(p=>p[1])))),y1=Math.min(size-1,Math.ceil(Math.max(...v.map(p=>p[1]))));
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const u=((b[1]-q[1])*(x+.5-q[0])+(q[0]-b[0])*(y+.5-q[1]))/area,vv=((q[1]-a[1])*(x+.5-q[0])+(a[0]-q[0])*(y+.5-q[1]))/area,ww=1-u-vv;if(u<0||vv<0||ww<0)continue;const z=u*a[2]+vv*b[2]+ww*q[2],i=y*size+x;if(z<=depth[i])continue;depth[i]=z;const o=i*4;im.data[o]=col[0];im.data[o+1]=col[1];im.data[o+2]=col[2];im.data[o+3]=255;}
 }}c.putImageData(im,0,0);return canvas;
}
