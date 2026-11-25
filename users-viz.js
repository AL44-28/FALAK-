/** Saudi overview and exact-position local user map. No simulation state is changed. */
const SVG_NS = 'http://www.w3.org/2000/svg';
const DEG = Math.PI / 180;
const A = 6378.137, E2 = 6.69437999014e-3;
export const USER_STATES = Object.freeze({
  Good: {label: 'Strong', color: '#4BDA8D'},
  Weak: {label: 'Weak', color: '#F59E0B'},
  Outage: {label: 'No connection', color: '#FF5B68'}
});

export function regionalUserCount(meta, index) {
  if (Array.isArray(meta.users)) return meta.users.filter(u => Number(u.region_index) === Number(index) || (u.region_index == null && u.region === meta.regions[index].name)).length;
  return Number(meta.region_counts?.[index] ?? meta.regions[index].user_count ?? 0);
}

function ecef(lat, lon, heightM = 0) {
  const la = lat * DEG, lo = lon * DEG, n = A / Math.sqrt(1 - E2 * Math.sin(la) ** 2), h = heightM / 1000;
  return [(n + h) * Math.cos(la) * Math.cos(lo), (n + h) * Math.cos(la) * Math.sin(lo), (n * (1 - E2) + h) * Math.sin(la)];
}

/** WGS84 east/north/up in km, using the supplied city reference, without jitter. */
export function localENU(lat, lon, originLat, originLon, heightM = 0) {
  const p = ecef(lat, lon, heightM), o = ecef(originLat, originLon);
  const [x, y, z] = p.map((v, i) => v - o[i]), la = originLat * DEG, lo = originLon * DEG;
  return [-Math.sin(lo) * x + Math.cos(lo) * y,
    -Math.sin(la) * Math.cos(lo) * x - Math.sin(la) * Math.sin(lo) * y + Math.cos(la) * z,
    Math.cos(la) * Math.cos(lo) * x + Math.cos(la) * Math.sin(lo) * y + Math.sin(la) * z];
}

export function geoRings(geo) {
  const features = geo.type === 'FeatureCollection' ? geo.features : [geo.type === 'Feature' ? geo : {geometry: geo}];
  return features.flatMap(({geometry: g}) => g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);
}

/** North-up equirectangular projection; the same function maps boundary and cities. */
export function fitSaudiProjection(geo, width = 240, height = 220, padding = 22) {
  const rings = geoRings(geo), points = rings.flat();
  if (!points.length) throw new Error('Saudi boundary has no polygon coordinates.');
  const latitudes = points.map(p => p[1]), longitudes = points.map(p => p[0]);
  const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes), maxLon = Math.max(...longitudes);
  const correction = Math.cos((minLat + maxLat) / 2 * DEG);
  const rawWidth = (maxLon - minLon) * correction, rawHeight = maxLat - minLat;
  const scale = Math.min((width - padding * 2) / rawWidth, (height - padding * 2) / rawHeight);
  const ox = (width - rawWidth * scale) / 2, oy = (height - rawHeight * scale) / 2;
  return {rings, width, height, bounds: {minLat, maxLat, minLon, maxLon},
    project: ([lon, lat]) => [ox + (lon - minLon) * correction * scale, oy + (maxLat - lat) * scale]};
}

function resolveElement(value) {
  if (!value) return null;
  return typeof value === 'string' ? document.getElementById(value.replace(/^#/, '')) : value;
}
function svgNode(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
function finite(value) { return Number.isFinite(Number(value)) && value !== null && value !== ''; }
function stateKey(value) {
  if (value === 'Good' || value === 'Strong' || value === 2) return 'Good';
  if (value === 'Weak' || value === 1) return 'Weak';
  return 'Outage';
}
function niceStep(value) {
  const power = 10 ** Math.floor(Math.log10(Math.max(value, .0001))), n = value / power;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * power;
}
function styles() {
  if (document.getElementById('users-viz-styles')) return;
  const style = document.createElement('style'); style.id = 'users-viz-styles';
  style.textContent = `
    .uv-canvas{display:block;width:100%;height:100%;aspect-ratio:1;outline:none;touch-action:manipulation}
    .uv-canvas:focus-visible{outline:1px solid #6ca9ff;outline-offset:3px;border-radius:8px}
    .uv-saudi{display:block;width:100%;height:100%;overflow:visible}
    .uv-city{cursor:pointer;outline:none}
    .uv-city text{font-family:Inter,Segoe UI,sans-serif;font-weight:500;paint-order:stroke;stroke:#0b1624;stroke-width:3px;stroke-linejoin:round}
    .uv-city:hover text,.uv-city:focus-visible text{fill:#fff}
    .uv-city:focus-visible .uv-city-ring{stroke:#dceaff;stroke-width:1.5}
    .uv-states{display:flex;align-items:center;justify-content:flex-start;gap:10px;flex-wrap:wrap}
    .state-counts .uv-state{display:inline-flex;align-items:center;gap:8px;padding:7px 11px;border:1px solid color-mix(in srgb,var(--state-color) 36%,transparent);border-radius:8px;background:color-mix(in srgb,var(--state-color) 9%,transparent);white-space:nowrap;font-family:Inter,Segoe UI,sans-serif;font-size:14px;color:var(--state-color)}
    .state-counts .uv-state i{display:inline-block;width:10px;height:10px;flex:none;border-radius:50%;box-shadow:0 0 0 3px color-mix(in srgb,var(--state-color) 12%,transparent)}
    .state-counts .uv-state b{font-weight:700;color:var(--state-color);font-variant-numeric:tabular-nums;font-size:17px}
    @media(max-width:560px){.uv-states{gap:7px}.state-counts .uv-state{font-size:12px;padding:6px 8px;gap:6px}.state-counts .uv-state b{font-size:15px}.state-counts .uv-state i{width:9px;height:9px}}
  `;
  document.head.append(style);
}

export class UsersViz {
  constructor({userMap, saudiMap, stateCounts} = {}, meta, handlers = {}) {
    this.host = resolveElement(userMap); this.saudiHost = resolveElement(saudiMap);
    this.countHost = resolveElement(stateCounts); this.meta = meta; this.handlers = handlers;
    if (!this.host || !this.saudiHost) throw new Error('UsersViz requires userMap and saudiMap elements.');
    this.canvas = this.host.tagName?.toLowerCase() === 'canvas' ? this.host : this.host.appendChild(document.createElement('canvas'));
    this.svg = this.saudiHost.tagName?.toLowerCase() === 'svg' ? this.saudiHost : this.saudiHost.appendChild(svgNode('svg'));
    this.points = []; this.users = []; this.markers = []; this.countNodes = new Map();
    this.state = {region: 0, user: null}; this.hoverId = null; this.width = 180; this.height = 180;
    this.bound = []; this.mapBound = [];
  }

  async init() {
    styles(); this.canvas.classList.add('uv-canvas'); this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Regional users. Arrow keys select a user; Enter opens details.');
    this.svg.classList.add('uv-saudi'); this.svg.setAttribute('viewBox', '0 0 240 220');
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet'); this.svg.setAttribute('role', 'group');
    this.svg.setAttribute('aria-label', 'Saudi Arabia: select Riyadh, Jeddah, Madinah, Dammam or Abha');
    const response = await fetch(new URL('./assets/saudi.geojson', import.meta.url));
    if (!response.ok) throw new Error(`Saudi boundary could not load (${response.status}).`);
    this.geo = await response.json(); this.drawSaudi(); this.createCounts();
    this.listen(this.canvas, 'pointermove', e => this.pointer(e));
    this.listen(this.canvas, 'pointerleave', () => {this.hoverId = null; this.drawUsers();});
    this.listen(this.canvas, 'click', e => {
      const p = this.hit(e); if (p) this.handlers.user?.(p.user.id);
    });
    this.listen(this.canvas, 'keydown', e => this.key(e));
    this.listen(this.canvas, 'blur', () => {this.hoverId = null; this.drawUsers();});
    this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(this.canvas);
    this.resizeObserver?.observe(this.svg);
    this.resize(); return this;
  }

  listen(element, event, callback) {
    element.addEventListener(event, callback); this.bound.push([element, event, callback]);
  }

  createCounts() {
    if (!this.countHost) return;
    this.countHost.replaceChildren(); this.countHost.classList.add('uv-states');
    for (const [key, info] of Object.entries(USER_STATES)) {
      const item = document.createElement('span'); item.className = 'uv-state';
      item.style.setProperty('--state-color', info.color); item.dataset.status = key;
      item.setAttribute('aria-label', `${info.label}: 0 users`);
      const dot = document.createElement('i'); dot.style.background = info.color;
      const count = document.createElement('b'); count.textContent = '0';
      const label = document.createElement('span'); label.textContent = info.label;
      item.append(dot, count, label); this.countHost.append(item); this.countNodes.set(key, count);
    }
  }

  drawSaudi() {
    const bounds = this.svg.getBoundingClientRect();
    const width = Math.max(120, bounds.width || 240), height = Math.max(100, bounds.height || 220);
    const padding = Math.max(15, Math.min(26, height * .09));
    const fit = fitSaudiProjection(this.geo, width, height, padding);
    this.saudiSize = [width, height];
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    for (const [node,event,callback] of this.mapBound) node.removeEventListener(event,callback);
    this.mapBound = []; this.svg.replaceChildren();
    const mapListen = (node,event,callback) => {node.addEventListener(event,callback);this.mapBound.push([node,event,callback]);};
    const fontSize = width < 210 ? 12 : height >= 230 ? 16 : 14;
    const title = svgNode('title'); title.textContent = 'Saudi Arabia'; this.svg.append(title);
    const d = fit.rings.map(ring => ring.map((p, i) => (i ? 'L' : 'M') + fit.project(p).map(n => n.toFixed(3)).join(',')).join(' ') + 'Z').join(' ');
    this.svg.append(svgNode('path', {d, fill: '#213B56', 'fill-rule': 'evenodd', stroke: '#90AEC9', 'stroke-width': 1.6, 'vector-effect': 'non-scaling-stroke'}));
    // Labels move for legibility; their city anchors always use the exact coordinates.
    const labelOffsets = {
      Riyadh: {dx: 10, dy: 18, anchor: 'start'},
      Jeddah: {dx: -10, dy: 10, anchor: 'end'},
      Madinah: {dx: -10, dy: -11, anchor: 'end'},
      Dammam: {dx: 9, dy: -12, anchor: 'start'},
      Abha: {dx: 9, dy: 18, anchor: 'start'}
    };
    this.markers = this.meta.regions.map((region, index) => {
      const [x, y] = fit.project([Number(region.lon), Number(region.lat)]);
      const info = labelOffsets[region.name] || {dx: 7, dy: -9, anchor: 'start'};
      const color = region.color || '#67A9FF';
      const userCount = regionalUserCount(this.meta, index);
      const group = svgNode('g', {class: 'uv-city', tabindex: 0, role: 'button', 'aria-label': `Select ${region.name}, ${userCount} users`, 'data-uv-region': index, 'data-user-count': userCount});
      const hit = svgNode('circle', {cx: x, cy: y, r: 13, fill: 'transparent'});
      const ring = svgNode('circle', {class: 'uv-city-ring', cx: x, cy: y, r: 7.3, fill: color, 'fill-opacity': .12, stroke: 'none'});
      const dot = svgNode('circle', {cx: x, cy: y, r: 3.6, fill: color, stroke: '#0C1A2B', 'stroke-width': 1.4});
      const label = svgNode('text', {x: x + info.dx, y: y + info.dy, fill: '#BDCEE1', 'font-size': fontSize, 'text-anchor': info.anchor});
      label.textContent = region.name;
      const tooltip = svgNode('title'); tooltip.textContent = `${region.name} · ${userCount} users · ${Number(region.lat).toFixed(5)}° N, ${Number(region.lon).toFixed(5)}° E`;
      group.append(hit, ring, dot, label, tooltip); this.svg.append(group);
      mapListen(group, 'click', () => this.handlers.region?.(index));
      mapListen(group, 'keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); this.handlers.region?.(index);}
      });
      return {group, ring, dot, label, color, x, y};
    });
    // Keep label ink inside the SVG even in engines with slightly different fonts.
    for (const marker of this.markers) {
      try {
        const box = marker.label.getBBox();
        let x = Number(marker.label.getAttribute('x'));
        if (box.x < 3) x += 3 - box.x;
        if (box.x + box.width > width - 3) x -= box.x + box.width - (width - 3);
        marker.label.setAttribute('x', x);
        let y = Number(marker.label.getAttribute('y'));
        if (box.y < 3) y += 3 - box.y;
        if (box.y + box.height > height - 3) y -= box.y + box.height - (height - 3);
        marker.label.setAttribute('y', y);
      } catch { /* getBBox is unavailable before the SVG is connected. */ }
    }
    this.updateSaudiSelection();
  }

  update(snap, state) {
    const oldRegion = this.state.region;
    this.state = {...this.state, ...state};
    const region = this.meta.regions[this.state.region];
    const inRegion = u => u.region_index != null ? Number(u.region_index) === Number(this.state.region) : u.region ? u.region === region.name : true;
    this.users = (snap.users || []).filter(inRegion).filter(u => finite(u.lat) && finite(u.lon));
    this.region = region;
    const servingNames = [...new Set(this.users.map(u => u.serving_satellite).filter(Boolean))];
    this.satelliteName = `Auto · ${servingNames.length ? servingNames.join(' / ') : 'No active link'}`;
    this.canvas.dataset.userCount = String(this.users.length);
    this.canvas.dataset.region = region.name;
    this.canvas.dataset.satellite = servingNames.join(',');
    this.canvas.dataset.connectionMode = 'automatic-network';
    this.local = this.users.map(user => ({user, enu: localENU(Number(user.lat), Number(user.lon), Number(region.lat), Number(region.lon), Number(user.height_m || 0))}));
    if (oldRegion !== this.state.region || !this.users.some(u => u.id === this.hoverId)) this.hoverId = null;
    const counts = {Good: 0, Weak: 0, Outage: 0};
    for (const user of this.users) counts[stateKey(user.status)]++;
    for (const [key, node] of this.countNodes) {
      node.textContent = counts[key];
      node.parentElement.setAttribute('aria-label', `${USER_STATES[key].label}: ${counts[key]} users`);
    }
    this.updateSaudiSelection();
    this.canvas.setAttribute('aria-label', `${region.name}, ${this.users.length} users, ${this.satelliteName}. ${counts.Good} Strong, ${counts.Weak} Weak, ${counts.Outage} No connection. Arrow keys select a user; Enter opens details.`);
    this.drawUsers();
  }

  updateSaudiSelection() {
    for (const [index, marker] of this.markers.entries()) {
      const selected = index === Number(this.state.region);
      marker.group.setAttribute('aria-pressed', String(selected));
      marker.ring.setAttribute('r', selected ? 8.8 : 7.3);
      marker.ring.setAttribute('fill-opacity', selected ? .3 : .1);
      marker.dot.setAttribute('r', selected ? 4.5 : 3.6);
      marker.label.setAttribute('fill', selected ? '#FFFFFF' : '#BDCEE1');
      marker.label.setAttribute('font-weight', selected ? '650' : '500');
    }
  }

  resize() {
    const box = this.canvas.getBoundingClientRect();
    this.width = Math.max(80, box.width || this.host.clientWidth || 180);
    this.height = Math.max(90, box.height || this.host.clientHeight || 180);
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2.5);
    const width = Math.round(this.width * ratio), height = Math.round(this.height * ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) {this.canvas.width = width; this.canvas.height = height;}
    this.pixelRatio = ratio;
    const saudi = this.svg.getBoundingClientRect();
    if (this.geo && saudi.width > 0 && saudi.height > 0 && (!this.saudiSize || Math.abs(saudi.width - this.saudiSize[0]) > .5 || Math.abs(saudi.height - this.saudiSize[1]) > .5)) this.drawSaudi();
    this.drawUsers();
  }

  drawUsers() {
    const ctx = this.canvas.getContext('2d'); if (!ctx) return;
    const w = this.width, h = this.height;
    ctx.setTransform(this.pixelRatio || 1, 0, 0, this.pixelRatio || 1, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!this.region || !this.local?.length) return;
    const fontSize = w < 320 ? 12 : 14;
    const lineHeight = fontSize + 6;
    ctx.font = `600 ${fontSize}px Inter, Segoe UI, sans-serif`;
    const primaryCaption = `${this.region.name} · ${this.users.length} users`;
    const fullCaption = primaryCaption + (this.satelliteName ? ` · ${this.satelliteName}` : '');
    const twoLineCaption = Boolean(this.satelliteName) && ctx.measureText(fullCaption).width > w - 44;
    this.figureScale = Math.max(.85, Math.min(1.55, h / 175));
    const inset = Math.max(16, this.figureScale * 10);
    const box = {left: inset, right: w - inset, top: twoLineCaption ? lineHeight * 2 + 12 : lineHeight + 16, bottom: h - 35};
    const east = this.local.map(p => p.enu[0]), north = this.local.map(p => p.enu[1]);
    const minE = Math.min(...east), maxE = Math.max(...east), minN = Math.min(...north), maxN = Math.max(...north);
    const cx = (minE + maxE) / 2, cy = (minN + maxN) / 2;
    const scale = Math.min((box.right - box.left) / Math.max(maxE - minE, .5), (box.bottom - box.top) / Math.max(maxN - minN, .5)) * .92;
    const centerX = (box.left + box.right) / 2, centerY = (box.top + box.bottom) / 2;
    const project = (e, n) => [centerX + (e - cx) * scale, centerY - (n - cy) * scale];
    const step = niceStep(Math.max((box.right - box.left) / scale, (box.bottom - box.top) / scale) / 4);
    const e0 = cx + (box.left - centerX) / scale, e1 = cx + (box.right - centerX) / scale;
    const n0 = cy - (box.bottom - centerY) / scale, n1 = cy - (box.top - centerY) / scale;
    ctx.save(); ctx.beginPath(); ctx.rect(box.left - 3, box.top - 3, box.right - box.left + 6, box.bottom - box.top + 6); ctx.clip();
    ctx.lineWidth = .8; ctx.strokeStyle = 'rgba(135,170,204,.16)';
    for (let e = Math.ceil(e0 / step) * step; e <= e1; e += step) {const [x] = project(e, 0); ctx.beginPath(); ctx.moveTo(x, box.top); ctx.lineTo(x, box.bottom); ctx.stroke();}
    for (let n = Math.ceil(n0 / step) * step; n <= n1; n += step) {const [,y] = project(0, n); ctx.beginPath(); ctx.moveTo(box.left, y); ctx.lineTo(box.right, y); ctx.stroke();}
    ctx.restore();
    ctx.font = `600 ${fontSize}px Inter, Segoe UI, sans-serif`; ctx.fillStyle = '#DFEAF8'; ctx.textAlign = 'left';
    const fitText = (text, width) => {let label=text;while (label.length && ctx.measureText(label).width > width) label=label.slice(0,-1);return label===text ? label : label.slice(0,-1)+'…';};
    ctx.fillText(fitText(twoLineCaption ? primaryCaption : fullCaption, w - 48), 8, fontSize + 1);
    if (twoLineCaption) {ctx.fillStyle = '#B6CCE2'; ctx.fillText(fitText(this.satelliteName, w - 48), 8, fontSize + 1 + lineHeight);}
    ctx.font = '600 11px Inter, Segoe UI, sans-serif'; ctx.fillStyle = '#AEC4D9'; ctx.textAlign = 'center'; ctx.fillText('N', w - 15, 12);
    ctx.strokeStyle = '#AEC4D9'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(w - 15, 30); ctx.lineTo(w - 15, 18); ctx.moveTo(w - 18, 22); ctx.lineTo(w - 15, 18); ctx.lineTo(w - 12, 22); ctx.stroke();
    this.points = this.local.map(({user, enu}) => {const [x,y] = project(enu[0], enu[1]); return {user, x, y};});
    const ordered = [...this.points].sort((a,b) => Number(a.user.id === this.state.user || a.user.id === this.hoverId) - Number(b.user.id === this.state.user || b.user.id === this.hoverId));
    for (const point of ordered) this.drawPerson(ctx, point);
    const scaleKm = niceStep(Math.min(85, w * .27) / scale), scaleWidth = scaleKm * scale;
    const sx = 12, sy = h - 15;
    ctx.strokeStyle = '#A4BDD5'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(sx, sy - 3); ctx.lineTo(sx, sy); ctx.lineTo(sx + scaleWidth, sy); ctx.lineTo(sx + scaleWidth, sy - 3); ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillStyle = '#A4BDD5'; ctx.font = '11px Inter, Segoe UI, sans-serif'; ctx.fillText(`${scaleKm < 1 ? Math.round(scaleKm * 1000) + ' m' : scaleKm + ' km'}`, sx, h - 3);
    const hovered = this.points.find(p => p.user.id === this.hoverId);
    if (hovered) this.tooltip(ctx, hovered);
  }

  drawPerson(ctx, point) {
    const key = stateKey(point.user.status), color = USER_STATES[key].color;
    const selected = point.user.id === this.state.user, hovered = point.user.id === this.hoverId;
    ctx.save(); ctx.translate(point.x, point.y);
    if (selected || hovered) {
      ctx.beginPath(); ctx.arc(0, 0, this.figureScale * 10, 0, Math.PI * 2); ctx.fillStyle = selected ? 'rgba(105,170,255,.13)' : 'rgba(255,255,255,.05)'; ctx.fill();
      ctx.strokeStyle = selected ? '#8ABEFF' : '#D3DEEA'; ctx.lineWidth = .8; ctx.stroke();
    }
    const figureScale = this.figureScale || 1;
    ctx.scale(figureScale, figureScale); ctx.shadowColor = '#0A1628'; ctx.shadowBlur = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, -6, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-2.5, -2.3); ctx.quadraticCurveTo(0, -3.5, 2.5, -2.3); ctx.lineTo(2.8, 3); ctx.lineTo(-2.8, 3); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2.1;
    ctx.beginPath(); ctx.moveTo(-2.1, -1.6); ctx.lineTo(-5, 2.2); ctx.moveTo(2.1, -1.6); ctx.lineTo(5, 2.2); ctx.moveTo(-1.5, 2.5); ctx.lineTo(-2.4, 7); ctx.moveTo(1.5, 2.5); ctx.lineTo(2.4, 7); ctx.stroke();
    ctx.restore();
  }

  hit(event) {
    const box = this.canvas.getBoundingClientRect(), x = (event.clientX - box.left) * this.width / box.width, y = (event.clientY - box.top) * this.height / box.height;
    let nearest = null, distance = Math.max(13, (this.figureScale || 1) * 10);
    for (const p of this.points) {const d = Math.hypot(p.x - x, p.y - y); if (d < distance) {distance = d; nearest = p;}}
    return nearest;
  }
  pointer(event) {
    const p = this.hit(event), id = p?.user.id ?? null;
    this.canvas.style.cursor = p ? 'pointer' : 'default';
    if (id !== this.hoverId) {this.hoverId = id; this.drawUsers();}
  }
  key(event) {
    if (!this.users.length) return;
    if (['ArrowLeft','ArrowUp','ArrowRight','ArrowDown'].includes(event.key)) {
      event.preventDefault(); const step = ['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1;
      const current = this.users.findIndex(u => u.id === (this.hoverId ?? this.state.user));
      const next = current < 0 ? (step > 0 ? 0 : this.users.length - 1) : (current + step + this.users.length) % this.users.length;
      this.hoverId = this.users[next].id; this.drawUsers();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); const id = this.hoverId ?? this.state.user ?? this.users[0].id; this.handlers.user?.(id);
    } else if (event.key === 'Escape') {this.hoverId = null; this.drawUsers();}
  }
  tooltip(ctx, point) {
    const user = point.user, info = USER_STATES[stateKey(user.status)];
    const label = `User ${String(user.id).padStart(2, '0')}`;
    const lines = [label, info.label, user.serving_satellite || 'No serving satellite'];
    if (finite(user.snr_db)) lines.push(`SNR ${Number(user.snr_db).toFixed(1)} dB`);
    const fontSize = this.width < 320 ? 12 : 14, lineHeight = fontSize + 6;
    ctx.font = `${fontSize}px Inter, Segoe UI, sans-serif`;
    const width = Math.min(this.width - 10, Math.max(...lines.map(l => ctx.measureText(l).width)) + 18), height = lines.length * lineHeight + 16;
    let x = point.x + 12, y = point.y - height - 10;
    if (x + width > this.width - 5) x = point.x - width - 12;
    x = Math.max(5, Math.min(x, this.width - width - 5));
    if (y < 23) y = point.y + 12;
    y = Math.max(4, Math.min(y, this.height - height - 3));
    ctx.save(); ctx.fillStyle = '#102035'; ctx.strokeStyle = '#344A63'; ctx.lineWidth = .8;
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x,y,width,height,5); else ctx.rect(x,y,width,height); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'left'; lines.forEach((line,i) => {ctx.fillStyle = i === 1 ? info.color : i === 0 ? '#EEF4FF' : '#A6BCD2'; ctx.fillText(line,x + 9,y + fontSize + 7 + i * lineHeight,width - 15);});
    ctx.restore();
  }
  destroy() {
    this.resizeObserver?.disconnect();
    for (const [element,event,callback] of [...this.bound,...this.mapBound]) element.removeEventListener(event,callback);
    this.bound = []; this.mapBound = [];
  }
}
