// Frozen SGP4 states from Python; WGS84 geometry and radio model run locally.
// Units: km, s, Hz, dB. This module never contacts a Python API.
import {lab,recovery} from './statistics.js';
const A=6378.137,E2=6.69437999014e-3,B=A*Math.sqrt(1-E2),C=299792.458,K=1.380649e-23,D=Math.PI/180;
const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0),sub=(a,b)=>a.map((x,i)=>x-b[i]),norm=a=>Math.hypot(...a),unit=a=>{let n=norm(a);return a.map(x=>x/n)},clamp=(x,l=-1,h=1)=>Math.max(l,Math.min(h,x));
export function ecef(lat,lon){let la=lat*D,lo=lon*D,n=A/Math.sqrt(1-E2*Math.sin(la)**2);return[n*Math.cos(la)*Math.cos(lo),n*Math.cos(la)*Math.sin(lo),n*(1-E2)*Math.sin(la)]}
function geodetic(p){let r=Math.hypot(p[0],p[1]),lo=Math.atan2(p[1],p[0]),la=Math.atan2(p[2],r*(1-E2)),n;for(let i=0;i<10;i++){n=A/Math.sqrt(1-E2*Math.sin(la)**2);la=Math.atan2(p[2]+E2*n*Math.sin(la),r)}n=A/Math.sqrt(1-E2*Math.sin(la)**2);return[la/D,lo/D,r/Math.cos(la)-n]}
export function geometry(sat,ground,center){let delta=sub(sat,ground),range=norm(delta),normal=unit([ground[0]/(A*A),ground[1]/(A*A),ground[2]/(B*B)]),elevation=Math.asin(clamp(dot(delta,normal)/range))/D,bore=unit(sub(center,sat)),off_axis=Math.acos(clamp(dot(delta.map(x=>-x/range),bore)))/D;return{range,elevation,off_axis,access:elevation>=10&&off_axis<=4.416}}
// Numerical Recipes erfc approximation; maximum fractional error ~1.2e-7.
function erfc(x){let z=Math.abs(x),t=1/(1+.5*z),r=t*Math.exp(-z*z-1.26551223+t*(1.00002368+t*(.37409196+t*(.09678418+t*(-.18628806+t*(.27886807+t*(-1.13520398+t*(1.48851587+t*(-.82215223+t*.17087277)))))))));return x>=0?r:2-r}
export function budget(distance,off,R){const fspl=f=>20*Math.log10(4*Math.PI*distance*f/C),loss=12*(off/R.beamwidth_deg)**2,bw=R.phy_rate_bps/2,ul=R.ue_power_dbm-30+R.ue_gain_dbi+R.sat_gt_dbk-loss-fspl(R.ul_hz)-10*Math.log10(K),dl=R.eirp_density_dbw_mhz+10*Math.log10(bw/1e6)-loss-fspl(R.dl_hz)+R.ue_gain_dbi-10*Math.log10(K)-10*Math.log10(290*10**(R.ue_nf_db/10)),ue=ul-10*Math.log10(R.phy_rate_bps),de=dl-10*Math.log10(R.phy_rate_bps),ub=.5*erfc(Math.sqrt(10**(ue/10))),db=.5*erfc(Math.sqrt(10**(de/10)));return{snr:Math.min(ul,dl)-10*Math.log10(bw),ber:Math.max(ub,db),margin:Math.min(ue,de)-R.required_ebno_db,ul_ber:ub,dl_ber:db}}
// Operational colors are based on original packet outcomes, never fabricated RF gain.
export const SERVICE_POLICY={basis:'Simulated packet delivery over the trailing 10 one-second samples',window_samples:10,strong_delivery_fraction:.95,offered_unique_bps_per_direction:128};
export function serviceStatus(access,ul,dl){if(!access||!Number.isFinite(ul)||!Number.isFinite(dl)||ul<=0||dl<=0)return 0;const threshold=SERVICE_POLICY.offered_unique_bps_per_direction*SERVICE_POLICY.strong_delivery_fraction;return ul>=threshold&&dl>=threshold?2:1}
export function serviceReason(access,status,ul,dl,elevation=null){if(!access)return elevation!==null&&elevation<10?'Low elevation':'Outside selected beam';if(status===0){if(ul<=0&&dl<=0)return 'No UL or DL packets delivered in the recent window';return ul<=0?'No uplink packets delivered in the recent window':'No downlink packets delivered in the recent window'}return status===1?'Partial packet delivery in the recent window':null}
async function fetchTimed(url){const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(`Could not load ${url}: HTTP ${r.status}`);return r}
export class Simulation{
 async init(){this.meta=await(await fetchTimed(new URL('./data/meta.json',import.meta.url))).json();if(!globalThis.DecompressionStream)throw Error('Use a current Chrome, Edge, Firefox or Safari browser.');const r=await fetchTimed(new URL('./data/'+this.meta.binary.file,import.meta.url));const buffer=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();if(buffer.byteLength!==this.meta.binary.bytes)throw Error('Incomplete simulation file. Please reload.');if(globalThis.crypto?.subtle){const digest=await crypto.subtle.digest('SHA-256',buffer),hex=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');if(hex!==this.meta.binary.sha256)throw Error('Simulation checksum failed. Please reload the site.')}this.load(this.meta,buffer);return this}
 load(meta,buffer){this.meta=meta;this.arr={};for(const[n,d]of Object.entries(meta.binary.arrays))this.arr[n]=new(d.dtype==='u1'?Uint8Array:Float64Array)(buffer,d.offset,d.length);this.N=meta.times.length;this.users=meta.users;this.regionCounts=meta.regions.map((_,r)=>this.users.filter(u=>u.region_index===r).length);this.regionOffsets=this.regionCounts.map((_,r)=>this.regionCounts.slice(0,r).reduce((a,b)=>a+b,0));this.userCount=this.users.length;this.compactPackets=meta.binary.arrays.packets.shape.length===3;this.ground=this.users.map(u=>ecef(u.lat,u.lon));this.centers=Array.from({length:5},(_,r)=>[0,1,2].map(a=>this.ground.slice(this.regionOffsets[r],this.regionOffsets[r]+this.regionCounts[r]).reduce((s,g)=>s+g[a],0)/this.regionCounts[r]));this.accessEnds=new Uint32Array(this.arr.packets.length);this.anyAccess=new Uint8Array(50*this.N);this.fullAccess=new Uint8Array(50*this.N);this.anyEnds=new Uint32Array(50*this.N);for(let r=0;r<5;r++)for(let s=0;s<10;s++){let next=Array(this.regionCounts[r]).fill(this.N),anyEnd=this.N;for(let k=this.N-1;k>=0;k--){let any=false,full=true;for(let j=0;j<this.regionCounts[r];j++){const ix=this.pi(r,s,k,j);if(!(this.arr.packets[ix]&1)){next[j]=k;full=false}else any=true;this.accessEnds[ix]=next[j]}const ix=(r*10+s)*this.N+k;this.anyAccess[ix]=Number(any);this.fullAccess[ix]=Number(full);if(!any)anyEnd=k;this.anyEnds[ix]=anyEnd}}this.cache=new Map();this.dualCache=null;return this}
 idx(t){return clamp(Math.floor(Number(t)||0),0,this.N-1)}
 vec(name,k,s){let i=(k*10+s)*3;return Array.from(this.arr[name].subarray(i,i+3))}
 pi(r,s,k,j){return this.compactPackets?(s*this.N+k)*this.userCount+this.regionOffsets[r]+j:((r*10+s)*this.N+k)*this.regionCounts[r]+j}
 rem(k,end){return{seconds:Math.max(0,(end===this.N?this.N-1:end)-k),censored:end===this.N}}
 cell(k,r,s,j){let g=geometry(this.vec('pos_ecef',k,s),this.ground[this.regionOffsets[r]+j],this.centers[r]),v=budget(g.range,g.off_axis,this.meta.radio),ix=this.pi(r,s,k,j),a=!!(this.arr.packets[ix]&1),ul=0,dl=0,start=Math.max(0,k-9);for(let t=start;t<=k;t++){const b=this.arr.packets[this.pi(r,s,t,j)];ul+=(b&2)?128:0;dl+=(b&4)?128:0}let pu=1-(1-Math.exp(128*Math.log1p(-v.ul_ber)))**4,pd=1-(1-Math.exp(128*Math.log1p(-v.dl_ber)))**4;return{...g,...v,access:a,status:serviceStatus(a,ul/(k-start+1),dl/(k-start+1)),ul_bps:ul/(k-start+1),dl_bps:dl/(k-start+1),p_success:a?pu*pd:0,remaining_access:a?this.rem(k,this.accessEnds[ix]):{seconds:0,censored:false}}}
 // This separate network view never changes the selected-satellite experiment.
 // Assignments and primary-link packet outcomes were computed once in Python.
 dual(k,selectedRegion=-1,selectedCells=null){
  if(!this.arr.beam_assignments)return{available:false,regions:[],satellites:[],allocation_policy:null};
  if(this.dualCache?.time_index===k)return this.dualCache;
  const assigned=this.arr.beam_assignments.subarray(k*10,k*10+10),states=['Outage','Weak','Good'];
  const satelliteStats=Array.from({length:10},(_,i)=>({index:i,allocated_region:assigned[i]<5?assigned[i]:null,covered_users:0,connected_users:0,radio_capable_users:0,primary_users:0,backup_users:0}));
  const regions=Array.from({length:5},(_,r)=>{
   const allocated=Array.from({length:10},(_,i)=>i).filter(i=>assigned[i]===r);
   const candidates=Array.from({length:10},(_,i)=>i).filter(i=>this.anyAccess[(r*10+i)*this.N+k]);
   const fullCandidates=candidates.filter(i=>this.fullAccess[(r*10+i)*this.N+k]);
   const cells=new Map(allocated.map(i=>[i,r===selectedRegion&&selectedCells?selectedCells[i]:Array.from({length:this.regionCounts[r]},(_,j)=>this.cell(k,r,i,j))]));
   for(const i of allocated){satelliteStats[i].covered_users=cells.get(i).filter(v=>v.access).length;satelliteStats[i].radio_capable_users=cells.get(i).filter(v=>v.access&&v.margin>=0).length;}
   const users=Array.from({length:this.regionCounts[r]},(_,j)=>{
    const ui=this.regionOffsets[r]+j,si=this.arr.beam_user_choices[k*this.userCount+ui],v=si<10?cells.get(si)?.[j]:null;
    let ul=0,dl=0;const start=Math.max(0,k-9);
    for(let t=start;t<=k;t++){const b=this.arr.beam_packets[t*this.userCount+ui];ul+=(b&2)?128:0;dl+=(b&4)?128:0;}
    const status=serviceStatus(!!v?.access,ul/(k-start+1),dl/(k-start+1));
    if(v){satelliteStats[si].primary_users++;if(status>0)satelliteStats[si].connected_users++;}
    return{...this.users[ui],candidate:si<10?this.meta.satellites[si].name:null,candidate_index:si<10?si:null,
     serving_satellite:status>0?this.meta.satellites[si].name:null,serving_index:status>0?si:null,
     status:states[status],reason:!v?(fullCandidates.length?'No beam allocated under the one-beam-per-satellite policy':candidates.length?'No candidate covers every regional user':'No satellite access'):serviceReason(!!v.access,status,ul/(k-start+1),dl/(k-start+1),v.elevation),
     status_basis:SERVICE_POLICY.basis,delivery_window_samples:k-start+1,ul_delivery_fraction:ul/(k-start+1)/128,dl_delivery_fraction:dl/(k-start+1)/128,design_margin_met:!!v?.access&&v.margin>=0,design_reserve_met:!!v?.access&&v.margin>=3,
     access:!!v?.access,elevation_deg:v?.elevation??null,range_km:v?.range??null,snr_db:v?.access?v.snr:null,ber:v?.access?v.ber:null,margin_db:v?.access?v.margin:null,
     ul_bps:ul/(k-start+1),dl_bps:dl/(k-start+1),p_success:v?.p_success??0,
     remaining_access:v?.remaining_access??{seconds:0,censored:false},
     geometric_satellite_count:allocated.reduce((n,i)=>n+Number(cells.get(i)[j].access),0),
     radio_satellite_count:allocated.reduce((n,i)=>n+Number(cells.get(i)[j].access&&cells.get(i)[j].margin>=0),0),
     throughput_basis:'Trailing unique packet outcomes from the allocated primary link at each sample'};
   });
   for(const i of allocated)satelliteStats[i].backup_users=users.filter(u=>u.candidate_index!==i&&cells.get(i)[u.id-this.regionOffsets[r]-1].access&&cells.get(i)[u.id-this.regionOffsets[r]-1].margin>=0).length;
   const counts=Object.fromEntries(states.map(name=>[name,users.filter(u=>u.status===name).length]));
   return{...this.meta.regions[r],region_index:r,candidate_count:candidates.length,candidate_satellites:candidates,
    full_user_candidate_count:fullCandidates.length,full_user_candidate_satellites:fullCandidates,
    allocated_satellites:allocated,dual_user_count:users.filter(u=>u.geometric_satellite_count>=2).length,
    geometric_user_count:users.filter(u=>u.geometric_satellite_count>=1).length,
    dual_radio_user_count:users.filter(u=>u.radio_satellite_count>=2).length,connected_users:counts.Good+counts.Weak,counts,users};
  });
  const counts={Good:0,Weak:0,Outage:0};for(const r of regions)for(const name of states)counts[name]+=r.counts[name];
  this.dualCache={available:true,time_index:k,time_s:this.meta.times[k],regions,satellites:satelliteStats,counts,
   geometric_user_count:regions.reduce((n,r)=>n+r.geometric_user_count,0),dual_user_count:regions.reduce((n,r)=>n+r.dual_user_count,0),
   allocation_policy:this.meta.allocation_policy};return this.dualCache;
 }
 // Region-wide service follows the stored automatic assignments, not the inspector's satellite.
 // Packet delivery remains the time-varying primary stream across handovers.
 regionSnapshot(t,r){
  const regionIndex=Number(r);
  if(!Number.isInteger(regionIndex)||regionIndex<0||regionIndex>=this.meta.regions.length)throw Error('Unknown region');
  const k=this.idx(t),network=this.dual(k);
  if(!network.available)throw Error('Re-export the dataset to enable automatic regional service.');
  const region=network.regions[regionIndex];
  return{view:'regional-network',time_s:this.meta.times[k],time_index:k,region_index:regionIndex,
   region,users:region.users,counts:region.counts,
   allocated_satellites:region.allocated_satellites,
   serving_satellites:[...new Set(region.users.filter(u=>u.serving_index!==null).map(u=>u.serving_index))],
   allocation_policy:network.allocation_policy};
 }
 dualHistory(r){
  if(!this.arr.beam_assignments)throw Error('Re-export the dataset to enable regional allocation history.');
  const key='dual:'+r;if(this.cache.has(key))return this.cache.get(key);
  const h={time_s:this.meta.times,region_index:r,candidate_count:[],full_user_candidate_count:[],allocated_satellite_count:[],geometric_user_count:[],dual_user_count:[],dual_radio_user_count:[],Good:[],Weak:[],Outage:[]};
  for(let k=0;k<this.N;k++){const i=k*5+r,n=this.arr.beam_allocation_counts[i];h.candidate_count.push(this.arr.beam_candidate_counts[i]);h.full_user_candidate_count.push(this.arr.beam_full_candidate_counts[i]);h.allocated_satellite_count.push(n);h.geometric_user_count.push(n?this.regionCounts[r]:0);h.dual_user_count.push(n>=2?this.regionCounts[r]:0);h.dual_radio_user_count.push(this.arr.beam_dual_radio_counts[i]);for(const [j,name]of ['Outage','Weak','Good'].entries())h[name].push(this.arr.beam_state_counts[i*3+j]);}
  if(this.cache.size>=8)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,h);return h;
 }
 footprint(k,r,s){const center=this.centers[r],p=this.vec('pos_ecef',k,s),[lat,lon]=geodetic(center),la=lat*D,lo=lon*D;if(!geometry(p,ecef(lat,lon),center).access)return[];return Array.from({length:81},(_,i)=>{let az=i*Math.PI*2/80;const surface=d=>{const la2=Math.asin(Math.sin(la)*Math.cos(d)+Math.cos(la)*Math.sin(d)*Math.cos(az)),lo2=lo+Math.atan2(Math.sin(az)*Math.sin(d)*Math.cos(la),Math.cos(d)-Math.sin(la)*Math.sin(la2));return[lo2/D,la2/D]};let low=0,high=.8;for(let n=0;n<26;n++){const mid=(low+high)/2,[lon,lat]=surface(mid);if(geometry(p,ecef(lat,lon),center).access)low=mid;else high=mid}return surface(low)})}
 snapshot(t,r,s){const k=this.idx(t),all=Array.from({length:10},(_,i)=>Array.from({length:this.regionCounts[r]},(_,j)=>this.cell(k,r,i,j))),states=['Outage','Weak','Good'];const users=all[s].map((v,j)=>({...this.users[this.regionOffsets[r]+j],candidate:this.meta.satellites[s].name,serving_satellite:v.status?this.meta.satellites[s].name:null,status:states[v.status],reason:serviceReason(v.access,v.status,v.ul_bps,v.dl_bps,v.elevation),status_basis:SERVICE_POLICY.basis,delivery_window_samples:Math.min(k+1,10),ul_delivery_fraction:v.ul_bps/128,dl_delivery_fraction:v.dl_bps/128,design_margin_met:v.access&&v.margin>=0,design_reserve_met:v.access&&v.margin>=3,access:v.access,elevation_deg:v.elevation,range_km:v.range,snr_db:v.access?v.snr:null,ber:v.access?v.ber:null,margin_db:v.access?v.margin:null,ul_bps:v.ul_bps,dl_bps:v.dl_bps,p_success:v.p_success,remaining_access:v.remaining_access}));
 const satellites=all.map((q,i)=>{const geo=this.vec('geodetic',k,i),mask=q.filter(v=>v.access),mean=(a,f)=>a.length?a.reduce((s,v)=>s+v[f],0)/a.length:null;return{...this.meta.satellites[i],xyz_km:this.vec('pos_ecef',k,i),lat:geo[0],lon:geo[1],altitude_km:geo[2],velocity_km_s:norm(this.vec('vel_teme',k,i)),mean_elevation_deg:mean(q,'elevation'),mean_range_km:mean(q,'range'),access_users:mask.length,service_users:q.filter(v=>v.status>0).length,mean_margin_db:mean(mask,'margin'),mean_snr_db:mean(mask,'snr'),mean_ber:mean(mask,'ber'),mean_dl_bps:mean(q,'dl_bps'),remaining_access:this.rem(k,this.anyEnds[(r*10+i)*this.N+k])}});
 const regions=this.meta.regions.map((region,i)=>{const q=i===r?all[s]:Array.from({length:this.regionCounts[i]},(_,j)=>this.cell(k,i,s,j));return{...region,geometric_coverage_pct:q.filter(v=>v.access).length/q.length*100,service_pct:q.filter(v=>v.status>0).length/q.length*100,good:q.filter(v=>v.status===2).length,weak:q.filter(v=>v.status===1).length,outage:q.filter(v=>v.status===0).length}});
 const curve=this.arr.orbit_gcrs,points=curve.length/30,m=this.arr.rotation_itrs.subarray(k*9,k*9+9),orbits=Array.from({length:10},(_,i)=>Array.from({length:points},(_,p)=>{const j=(p*10+i)*3;return[0,1,2].map(a=>m[a*3]*curve[j]+m[a*3+1]*curve[j+1]+m[a*3+2]*curve[j+2])}));return{time_s:k,time_index:k,region_index:r,satellite_index:s,satellites,users,regions,dual:this.dual(k,r,all),footprint:this.footprint(k,r,s),orbit_xyz_km:orbits[s],all_orbits_xyz_km:orbits,counts:Object.fromEntries(states.map(x=>[x,users.filter(u=>u.status===x).length]))}}
 history(r,s,uid){const j=uid-this.regionOffsets[r]-1;if(j<0||j>=this.regionCounts[r])throw Error('User is outside selected region');const key=`${r}:${s}:${uid}`;if(this.cache.has(key))return this.cache.get(key);let h={time_s:this.meta.times,user_id:uid},fields=['snr','ber','margin','range','elevation','ul_bps','dl_bps','p_success','status','outage_fraction','empirical_outage_probability'];for(const f of fields)h[f]=[];let outages=0;for(let k=0;k<this.N;k++){let v=this.cell(k,r,s,j);for(const f of fields.slice(0,9))h[f].push(!v.access&&['snr','ber','margin'].includes(f)?null:v[f]);outages+=v.status===0;h.outage_fraction.push(this.arr.outage_fraction[(r*10+s)*this.N+k]);h.empirical_outage_probability.push(outages/(k+1));}if(this.cache.size>=8)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,h);return h}
 access(r){return{times:this.meta.times,names:this.meta.satellites.map(s=>s.name),values:Array.from({length:10},(_,s)=>Array.from(this.anyAccess.subarray((r*10+s)*this.N,(r*10+s+1)*this.N)))}}
 network(t,source=0,destination=1,failed=false){const k=this.idx(t),edges=[],adj=Array.from({length:10},()=>[]);for(let a=0;a<10;a++)for(let b=a+1;b<10;b++){const p=this.vec('pos_ecef',k,a),q=this.vec('pos_ecef',k,b),pa=p.map((x,i)=>x/(i===2?B:A)),pb=q.map((x,i)=>x/(i===2?B:A)),v=sub(pb,pa),u=clamp(-dot(pa,v)/dot(v,v),0,1),near=pa.map((x,i)=>x+u*v[i]),clear=dot(near,near)>1+1e-12,dist=norm(sub(q,p)),delta=sub(this.vec('pos_teme',k,b),this.vec('pos_teme',k,a)),dv=sub(this.vec('vel_teme',k,b),this.vec('vel_teme',k,a)),isFailed=failed&&((a===source&&b===destination)||(b===source&&a===destination)),delay=dist/C*1000;edges.push({a,b,distance_km:dist,delay_ms:delay,earth_clear:clear,failed:isFailed,range_rate_km_s:dot(delta,dv)/norm(delta)});if(clear&&!isFailed){adj[a].push([b,delay]);adj[b].push([a,delay])}}
 const cost=Array(10).fill(Infinity),prev=Array(10).fill(-1),seen=new Set();cost[source]=0;for(let i=0;i<10;i++){let a=-1;for(let j=0;j<10;j++)if(!seen.has(j)&&(a<0||cost[j]<cost[a]))a=j;if(a<0||!Number.isFinite(cost[a]))break;seen.add(a);for(const[b,w]of adj[a])if(cost[a]+w<cost[b]){cost[b]=cost[a]+w;prev[b]=a}}let path=[];if(Number.isFinite(cost[destination])){for(let n=destination;n>=0;n=prev[n]){path.unshift(n);if(n===source)break}}const nearest=adj[source].filter(([j])=>j!==destination).sort((a,b)=>a[1]-b[1])[0];return{time_s:k,source,destination,failed,edges,path,path_propagation_ms:path.length?cost[destination]:null,nearest_alternative:nearest?.[0]??null,nearest_delay_ms:nearest?.[1]??null,arrival_within_1ms_possible:path.length>0&&cost[destination]<=1,scope:'Geometry-only propagation lower bounds; no terminal, acquisition or queue model'}}
 async request(url,body){const u=new URL(url,'https://local.invalid'),p=u.searchParams,n=(key,d=0)=>Number(p.get(key)??d);switch(u.pathname){case'/api/meta':return this.meta;case'/api/snapshot':return this.snapshot(n('time'),n('region'),n('sat'));case'/api/network':return this.network(n('time'),n('source'),n('destination',1),p.get('failed')==='true');case'/api/history':return this.history(n('region'),n('sat'),n('user',1));case'/api/access':return this.access(n('region'));case'/api/lab':return lab(body);case'/api/recovery':return recovery(body,this.network(body.time,body.source,body.destination,true));default:throw Error('This function is not available in the browser edition.')}}
}
export const simulation=new Simulation();
