import {simulation} from './simulation.js';
import {createScene} from './scene.js';
import {createScope} from './scope.js';
import {UsersViz} from './users-viz.js';
import {Scenarios} from './scenarios.js';
import {buildSaudiPlaybackProfile, advancePlayback, isSaudiPass} from './playback.js';

const $=id=>document.getElementById(id);
const state={time:0,region:0,sat:3,user:1,play:false,speed:100,page:'dashboard',source:0,destination:1,failed:false,showLinks:false};
let meta,snap,regionalSnap,network,scene,scope,usersViz,scenarios,ready=false,drawing=false;
let elapsed=0,last=performance.now(),playhead=0,playbackProfile;
const colors={Good:'#4BDA8D',Weak:'#F59E0B',Outage:'#FF5B68'};
const labels={Good:'Strong',Weak:'Weak',Outage:'No connection'};
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format=(v,n=1)=>v==null||!Number.isFinite(+v)?'—':Number(v).toLocaleString('en',{maximumFractionDigits:n});
const clock=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,6000)}
function error(e){console.error(e);toast(e.message||String(e))}
function run(action){try{const r=action();r?.catch?.(error)}catch(e){error(e)}}
function playback(){
 $('play').querySelector('span').textContent=state.play?'Pause':'Play';$('play').setAttribute('aria-label',state.play?'Pause simulation':'Play simulation');
 $('play').classList.toggle('playing',state.play);$('play').querySelector('svg').innerHTML=state.play?'<path d="M8 5v14M16 5v14"/>':'<use href="#i-play"/>';
 $('timeline').value=state.time;$('timeReadout').textContent=clock(state.time);$('speed').value=String(state.speed);
 const saudiPass=playbackProfile&&isSaudiPass(state.time,playbackProfile);
 $('passSpeed').textContent=saudiPass?`Saudi pass · ${format(state.speed/2)}×`:`${format(state.speed)}×`;
 $('passSpeed').classList.toggle('is-saudi',!!saudiPass);
 $('passSpeed').title=saudiPass?'Playback slows to half speed while a satellite is above Saudi Arabia.':'Selected playback speed. Saudi overpasses play at half speed.';
 if(meta)$('simClock').textContent=new Date(Date.parse(meta.epoch)+state.time*1000).toLocaleTimeString('en-GB',{timeZone:'Asia/Riyadh',hour12:false});
}
function stop(){state.play=false;elapsed=0;playhead=state.time;last=performance.now();playback()}
function fillUsers(){
 $('userSelect').innerHTML=meta.users.filter(u=>u.region_index===state.region).map(u=>`<option value="${u.id}">User ${String(u.id).padStart(2,'0')}</option>`).join('');$('userSelect').value=String(state.user);
}
function selectedUser(){return regionalSnap.users.find(u=>u.id===state.user)||regionalSnap.users[0]}
function info(){
 const s=snap.satellites[state.sat];$('satName').textContent=s.name;$('satName').style.color=s.color;$('satSelect').value=String(state.sat);$('satSelect').style.color=s.color;
 $('satState').textContent=s.access_users?'In view':'Out of view';$('satState').classList.toggle('in-view',!!s.access_users);
 $('satAltitude').textContent=format(s.altitude_km,0)+' km';$('satVelocity').textContent=format(s.velocity_km_s,2)+' km/s';$('satInclination').textContent=format(s.inclination_deg,1)+'°';
 $('satLatLon').textContent=`${format(Math.abs(s.lat),2)}° ${s.lat>=0?'N':'S'} / ${format(Math.abs(s.lon),2)}° ${s.lon>=0?'E':'W'}`;
 $('satCovered').textContent=s.access_users+'/'+meta.regions[state.region].user_count;$('satConnected').textContent=s.service_users+'/'+meta.regions[state.region].user_count;
 $('radioUL').textContent=(meta.radio.ul_hz/1e9).toFixed(3)+' GHz';$('radioDL').textContent=(meta.radio.dl_hz/1e9).toFixed(3)+' GHz';
 $('regionSelect').value=String(state.region);$('userSelect').value=String(state.user);
 const visibleCount=snap.satellites.filter(s=>s.access_users>0).length;
 $('regionSummary').textContent=`${meta.regions[state.region].name} · ${visibleCount} ${visibleCount===1?'satellite':'satellites'} in view`;
 $('sceneLegend').innerHTML=meta.satellites.map(s=>`<button type="button" data-legend-sat="${s.index}" class="${s.index===state.sat?'active':''}" style="--satellite-color:${s.color}"><i style="background:${s.color}"></i>${escape(s.name)}</button>`).join('');
 $('sceneLegend').querySelectorAll('[data-legend-sat]').forEach(b=>b.onclick=()=>chooseSat(+b.dataset.legendSat));
}
function showUser(){
 if(!snap)return;const u=selectedUser();$('selectedPanel').hidden=false;
 const row=(k,v)=>`<div class="detail-row"><span>${escape(k)}</span><strong>${escape(v)}</strong></div>`;
 $('selectedContent').innerHTML=`<h2>User ${String(u.id).padStart(2,'0')}</h2><p style="color:${colors[u.status]}">${labels[u.status]}</p>`+
 row('Region',u.region)+row('Connection mode','Automatic network')+row('Serving satellite',u.serving_satellite||'—')+row('Assigned satellite',u.candidate||'—')+row('SNR',u.snr_db==null?'—':format(u.snr_db,2)+' dB')+
 row('BER',u.ber==null?'—':u.ber.toExponential(2))+row('RF design margin',u.margin_db==null?'—':format(u.margin_db,2)+' dB')+
 row('UL / DL delivery',format(u.ul_delivery_fraction*100,0)+'% / '+format(u.dl_delivery_fraction*100,0)+'%')+row('Delivery window',u.delivery_window_samples+' s')+row('UL / DL goodput',format(u.ul_bps)+' / '+format(u.dl_bps)+' bit/s')+row('Elevation',format(u.elevation_deg)+'°')+row('Slant range',format(u.range_km)+' km')+
 row('Position',format(u.lat,5)+'°, '+format(u.lon,5)+'°')+(u.reason?`<p class="user-reason">${escape(u.reason)}</p>`:'');
}
function refresh(){
 if(!ready||drawing)return;drawing=true;
 try{
  snap=simulation.snapshot(state.time,state.region,state.sat);regionalSnap=simulation.regionSnapshot(state.time,state.region);network=simulation.network(state.time,state.source,state.destination,state.failed);
  const beams=regionalSnap.allocated_satellites;
  snap.dual_footprints=beams.map(i=>({satellite_index:i,color:meta.satellites[i].color,points:simulation.footprint(snap.time_index,state.region,i)}));
  playback();info();
  if(state.page==='dashboard'){scene.update({...snap,footprint:[],users:regionalSnap.users,counts:regionalSnap.counts},network,state);scope.update(snap,state);usersViz.update(regionalSnap,state)}
  else scenarios.update(snap,network,state);
  if(!$('selectedPanel').hidden)showUser();
 }finally{drawing=false}
}
function setTime(t,fromPlayback=false){state.time=Math.max(meta.times[0],Math.min(meta.times.at(-1),Math.round(Number(t)||0)));if(!fromPlayback)playhead=state.time;refresh()}
function chooseRegion(index,focus=true){if(!ready)return;stop();state.region=Number(index);state.user=meta.users.find(u=>u.region_index===state.region).id;fillUsers();refresh();if(focus&&state.page==='dashboard')scene.region(state.region)}
function chooseSat(index){if(!ready)return;stop();state.sat=(Number(index)+meta.satellites.length)%meta.satellites.length;refresh()}
function chooseUser(id,open=true){if(!ready)return;stop();const u=meta.users.find(x=>x.id===+id);if(!u)return;state.region=u.region_index;state.user=u.id;fillUsers();refresh();if(open)showUser()}
function page(name){if(!ready)return;stop();state.page=name;$('dashboardPage').hidden=name!=='dashboard';$('scenariosPage').hidden=name!=='scenarios';$('selectedPanel').hidden=true;for(const [id,p]of [['navDashboard','dashboard'],['navScenarios','scenarios']]){const active=name===p;$(id).classList.toggle('active',active);if(active)$(id).setAttribute('aria-current','page');else $(id).removeAttribute('aria-current')}refresh();requestAnimationFrame(()=>{if(name==='dashboard'){scene.resize?.();scope.resize?.();usersViz.update(regionalSnap,state)}else scenarios.resize()})}
function bind(){
 $('navDashboard').onclick=()=>page('dashboard');$('navScenarios').onclick=()=>page('scenarios');document.querySelector('.wordmark').onclick=e=>{e.preventDefault();page('dashboard');scene.home()};
 $('satSelect').onchange=e=>run(()=>chooseSat(+e.target.value));$('prevSat').onclick=()=>run(()=>chooseSat(state.sat-1));$('nextSat').onclick=()=>run(()=>chooseSat(state.sat+1));
 $('regionSelect').onchange=e=>run(()=>chooseRegion(+e.target.value));$('userSelect').onchange=e=>run(()=>chooseUser(+e.target.value,false));$('userDetails').onclick=showUser;$('closeUser').onclick=()=>$('selectedPanel').hidden=true;
 $('focusSaudi').onclick=()=>scene.home();$('focusRegion').onclick=()=>scene.region(state.region);$('focusSat').onclick=()=>scene.satellite(state.sat);
 $('play').onclick=()=>{if(state.time>=meta.times.at(-1))setTime(0);state.play=!state.play;elapsed=0;playhead=state.time;last=performance.now();playback()};
 $('reset').onclick=()=>run(()=>{stop();setTime(0)});$('stepBack').onclick=()=>run(()=>{stop();setTime(state.time-1)});$('stepForward').onclick=()=>run(()=>{stop();setTime(state.time+1)});
 $('timeline').oninput=e=>{const value=Number(e.target.value);run(()=>{stop();setTime(value)})};$('speed').onchange=e=>{state.speed=Number(e.target.value);elapsed=0;last=performance.now();playback()};
 $('radioInfo').onclick=()=>toast(`QPSK · ${meta.radio.phy_rate_bps/1000} kbit/s · UE ${meta.radio.ue_power_dbm} dBm · EIRP ${meta.radio.eirp_density_dbw_mhz} dBW/MHz`);
 addEventListener('keydown',e=>{if(e.key==='Escape')$('selectedPanel').hidden=true});document.addEventListener('visibilitychange',()=>{elapsed=0;last=performance.now()});
}
async function init(){
 await simulation.init();meta=simulation.meta;state.time=Math.min(state.time,meta.times.at(-1));
 const boundaryResponse=await fetch(new URL('./assets/saudi.geojson',import.meta.url));
 if(!boundaryResponse.ok)throw Error('Saudi boundary could not load. Please reload the dashboard.');
 playbackProfile=buildSaudiPlaybackProfile(simulation,await boundaryResponse.json());playhead=state.time;
 $('totalSatellites').textContent=meta.satellites.length;$('totalRegions').textContent=meta.regions.length;$('totalUsers').textContent=meta.users.length;
 const opening=simulation.snapshot(state.time,state.region,state.sat);const available=opening.satellites.filter(s=>s.access_users>0).sort((a,b)=>(b.mean_margin_db??-Infinity)-(a.mean_margin_db??-Infinity));if(available.length)state.sat=available[0].index;
 $('loadingText').textContent='Preparing Earth and spacecraft…';$('timeline').max=meta.times.at(-1);$('timeEnd').textContent=clock(meta.times.at(-1));
 $('regionSelect').innerHTML=meta.regions.map((r,i)=>`<option value="${i}">${escape(r.name)}</option>`).join('');
 $('satSelect').innerHTML=meta.satellites.map(s=>`<option value="${s.index}">${escape(s.name)}</option>`).join('');fillUsers();
 const handlers={sat:i=>run(()=>chooseSat(i)),region:i=>run(()=>chooseRegion(i)),user:id=>run(()=>chooseUser(id))};
 [scene,scope]=await Promise.all([createScene('earthScene',meta,handlers,simulation),createScope('satScopeScene',meta,simulation)]);
 usersViz=await new UsersViz({userMap:'userMap',saudiMap:'saudiMap',stateCounts:'stateCounts'},meta,{user:id=>run(()=>chooseUser(id)),region:i=>run(()=>chooseRegion(i))}).init();
 scenarios=await new Scenarios({tabs:'scenarioTabs',content:'scenariosContent'},simulation,{getState:()=>state,onTime:t=>run(()=>{stop();setTime(t)}),onSatellite:i=>run(()=>chooseSat(i)),onRegion:i=>run(()=>chooseRegion(i,false)),onUser:id=>run(()=>chooseUser(id,false)),onError:error,onNetworkChange:changes=>{Object.assign(state,changes);run(refresh)}}).init();
 bind();ready=true;refresh();$('loading').remove();document.body.dataset.ready='true';document.body.dataset.renderer=scene.kind||'webgl';scene.resize?.();scope.resize?.();
}
setInterval(()=>{const now=performance.now(),dt=(now-last)/1000;last=now;if(!ready||!state.play||document.hidden)return;run(()=>{playhead=advancePlayback(playhead,dt,state.speed,playbackProfile);const next=Math.floor(playhead+1e-9);if(next!==state.time)setTime(next,true);if(playhead>=meta.times.at(-1))stop()})},100);
init().catch(e=>{console.error(e);$('loadingText').textContent=e.message||String(e);const button=document.createElement('button');button.textContent='Reload';button.onclick=()=>location.reload();$('loading').append(button)});
