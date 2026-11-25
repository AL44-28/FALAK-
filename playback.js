/**
 * Presentation clock only. Satellite positions, physical velocities and radio
 * calculations continue to use the original simulation time and data.
 *
 * An overpass means at least one satellite's ground subpoint lies inside the
 * supplied Saudi polygon. It is independent of the selected city/satellite and
 * does not claim that an overhead satellite provides a working radio link.
 */

const EDGE_EPSILON = 1e-9;

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
  return value;
}

function prepareRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) throw new Error('Saudi boundary contains an invalid polygon ring.');
  const points = ring.map(point => {
    if (!Array.isArray(point) || point.length < 2) throw new Error('Saudi boundary contains an invalid coordinate.');
    const lon = finiteNumber(point[0], 'Boundary longitude');
    const lat = finiteNumber(point[1], 'Boundary latitude');
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) throw new RangeError('Saudi boundary coordinates are out of range.');
    return [lon, lat];
  });
  if (new Set(points.map(point => point.join(','))).size < 3) throw new Error('Saudi boundary ring needs three distinct points.');
  return {
    points,
    minLon: Math.min(...points.map(p => p[0])), maxLon: Math.max(...points.map(p => p[0])),
    minLat: Math.min(...points.map(p => p[1])), maxLat: Math.max(...points.map(p => p[1]))
  };
}

// 0 outside, 1 inside, 2 on the border. Coordinates are longitude/latitude.
function ringLocation(lon, lat, ring) {
  if (lon < ring.minLon - EDGE_EPSILON || lon > ring.maxLon + EDGE_EPSILON ||
      lat < ring.minLat - EDGE_EPSILON || lat > ring.maxLat + EDGE_EPSILON) return 0;
  let inside = false;
  const points = ring.points;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[j], [bx, by] = points[i];
    const dx = bx - ax, dy = by - ay;
    const cross = (lon - ax) * dy - (lat - ay) * dx;
    if (Math.abs(cross) <= EDGE_EPSILON * Math.max(1, Math.hypot(dx, dy)) &&
        lon >= Math.min(ax, bx) - EDGE_EPSILON && lon <= Math.max(ax, bx) + EDGE_EPSILON &&
        lat >= Math.min(ay, by) - EDGE_EPSILON && lat <= Math.max(ay, by) + EDGE_EPSILON) return 2;
    if ((ay > lat) !== (by > lat) && lon < (bx - ax) * (lat - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside ? 1 : 0;
}

/** Prepare a GeoJSON Polygon/MultiPolygon once; holes remain excluded. */
export function prepareSaudiBoundary(geo) {
  const polygons = [];
  function collect(value) {
    if (!value || typeof value !== 'object') throw new Error('Saudi boundary is missing.');
    if (value.type === 'FeatureCollection') {
      if (!Array.isArray(value.features)) throw new Error('Saudi boundary has no features.');
      value.features.forEach(collect);
    } else if (value.type === 'Feature') collect(value.geometry);
    else if (value.type === 'Polygon') addPolygon(value.coordinates);
    else if (value.type === 'MultiPolygon') {
      if (!Array.isArray(value.coordinates)) throw new Error('Saudi boundary has invalid polygons.');
      value.coordinates.forEach(addPolygon);
    } else throw new Error(`Unsupported Saudi boundary geometry: ${value.type || 'unknown'}.`);
  }
  function addPolygon(rings) {
    if (!Array.isArray(rings) || !rings.length) throw new Error('Saudi boundary contains an empty polygon.');
    polygons.push(rings.map(prepareRing));
  }
  collect(geo);
  if (!polygons.length) throw new Error('Saudi boundary is empty.');
  return Object.freeze({
    contains(lat, lon) {
      finiteNumber(lat, 'Satellite latitude'); finiteNumber(lon, 'Satellite longitude');
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new RangeError('Satellite ground coordinates are out of range.');
      return polygons.some(([outer, ...holes]) => ringLocation(lon, lat, outer) !== 0 &&
        !holes.some(hole => ringLocation(lon, lat, hole) !== 0));
    }
  });
}

/**
 * Build once after simulation.init(). Each original sample controls the display
 * rate until the next sample (one second in the frozen FALAK dataset).
 * weightedTime charges two playback units per simulation second over Saudi,
 * versus one elsewhere. Its inverse allows exact crossing of speed boundaries.
 */
export function buildSaudiPlaybackProfile(simulation, geo) {
  if (!simulation?.meta?.times || typeof simulation.vec !== 'function') throw new Error('Load the orbital simulation before preparing playback.');
  const times = Float64Array.from(simulation.meta.times);
  if (!times.length) throw new Error('Playback requires at least one simulation sample.');
  for (let i = 0; i < times.length; i++) {
    finiteNumber(times[i], 'Simulation time');
    if (i && times[i] <= times[i - 1]) throw new Error('Simulation times must be strictly increasing.');
  }
  const satelliteCount = simulation.meta.satellites?.length;
  if (!Number.isInteger(satelliteCount) || satelliteCount < 1) throw new Error('Playback requires satellite metadata.');
  const boundary = prepareSaudiBoundary(geo);
  const passes = new Uint8Array(times.length);
  const weightedTime = new Float64Array(times.length);
  let slowDurationS = 0;
  for (let k = 0; k < times.length; k++) {
    for (let sat = 0; sat < satelliteCount; sat++) {
      const point = simulation.vec('geodetic', k, sat);
      if (!point || point.length < 2) throw new Error(`Missing satellite ground position at sample ${k}, satellite ${sat}.`);
      if (boundary.contains(point[0], point[1])) passes[k] = 1;
    }
    if (k) {
      const duration = times[k] - times[k - 1];
      if (passes[k - 1]) slowDurationS += duration;
      weightedTime[k] = weightedTime[k - 1] + duration * (passes[k - 1] ? 2 : 1);
    }
  }
  return Object.freeze({times, passes, weightedTime, slowDurationS});
}

// Index of the latest sample <= value; values before the first sample use 0.
function sampleIndex(values, value) {
  let low = 0, high = values.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (values[mid] <= value) low = mid;
    else high = mid - 1;
  }
  return low;
}

function validateProfile(profile) {
  if (!profile?.times?.length || profile.times.length !== profile.passes?.length ||
      profile.times.length !== profile.weightedTime?.length) throw new Error('Playback profile is missing or invalid.');
}

/** True at the supplied simulation time when the display should use half speed. */
export function isSaudiPass(time, profile) {
  validateProfile(profile); finiteNumber(time, 'Playback time');
  return Boolean(profile.passes[sampleIndex(profile.times, time)]);
}

/**
 * Return the next fractional simulation time. baseSpeed is the user's selected
 * multiplier, e.g. 100 means 100x elsewhere and 50x during a Saudi pass.
 * Keep the returned fraction between UI updates. Clamp only display snapshots
 * to their stored sample; do not pass a rounded time back here on every tick.
 */
export function advancePlayback(time, wallDeltaSeconds, baseSpeed, profile) {
  validateProfile(profile);
  finiteNumber(time, 'Playback time'); finiteNumber(wallDeltaSeconds, 'Elapsed wall time'); finiteNumber(baseSpeed, 'Playback speed');
  if (wallDeltaSeconds < 0 || baseSpeed < 0) throw new RangeError('Playback duration and speed cannot be negative.');
  const {times, passes, weightedTime} = profile;
  const end = times.length - 1;
  const current = Math.max(times[0], Math.min(times[end], time));
  if (current === times[end] || wallDeltaSeconds === 0 || baseSpeed === 0) return current;
  const currentIndex = sampleIndex(times, current);
  const currentWeighted = weightedTime[currentIndex] + (current - times[currentIndex]) * (passes[currentIndex] ? 2 : 1);
  const nextWeighted = Math.min(weightedTime[end], currentWeighted + wallDeltaSeconds * baseSpeed);
  if (nextWeighted >= weightedTime[end]) return times[end];
  const index = sampleIndex(weightedTime, nextWeighted);
  return times[index] + (nextWeighted - weightedTime[index]) / (passes[index] ? 2 : 1);
}
