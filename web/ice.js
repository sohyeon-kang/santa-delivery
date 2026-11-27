// Ice patches on the roads, described as an implicit surface (W08L2: SDF).
//
//   sdf(p) < 0  : p is on the ice
//   sdf(p) = 0  : p is on the edge
//   sdf(p) > 0  : p is on snow, and the value is the distance to the nearest ice
//
// Each patch uses the same shape in movement checks and the ice shader:
//   - here, in JavaScript, to ask "is the player standing on ice?"
//   - in iceMaterial.js, in the fragment shader, to draw a soft frosty edge
// Pure math, no three.js import, so dev/test_spike.mjs can run it in Node.

// c: centre [x, z] (m), h: half size [x, z] (m).
// Positions follow docs/level_sketch_v3: roads run along x = ±24 and z = ±16, 8 m wide.
const patches = [
  { c: [-11, -16], h: [5.8, 3.1] },
  { c: [24, -16], h: [4.2, 3.6] },
  { c: [-24, 16], h: [4.1, 3.8] },
  { c: [41.5, 16], h: [6.3, 3.1] },
  { c: [-24, -7.5], h: [3.2, 4.2] },
  { c: [24, 7.5], h: [3.2, 4.2] },
  { c: [-40, -16], h: [3.6, 2.8] },
  { c: [2, -16], h: [4.5, 2.7] },
  { c: [45, -16], h: [3.8, 2.8] },
  { c: [-45, 16], h: [4.0, 2.8] },
  { c: [0, 16], h: [4.0, 2.8] },
  { c: [17, 16], h: [3.7, 2.7] },
  // The house entrances face the road, between each house and the street.
  ...[-48, -36, -12, 0, 12, 36, 48].flatMap(x => [
    { c: [x + 3.2, -21.4], h: [2.5, 2.5], color: 'white' },
    { c: [x - 3.2, 21.4], h: [2.5, 2.5], color: 'white' },
    { c: [x + 3.2, -24.0], h: [1.7, 1.6] },
    { c: [x - 3.2, 24.0], h: [1.7, 1.6] },
  ]),
  // Spread ice toward the outer residential blocks and both distant north/south roads.
  { c: [-24, -39], h: [3.0, 4.4] },
  { c: [24, -39], h: [3.2, 4.2] },
  { c: [-24, 39], h: [3.4, 4.0] },
  { c: [24, 39], h: [3.0, 4.6] },
  { c: [-24, -29], h: [2.0, 2.8], color: 'white' },
  { c: [24, -29], h: [2.2, 2.7] },
  { c: [-24, 29], h: [2.3, 2.5] },
  { c: [24, 29], h: [2.1, 2.8], color: 'white' },
  { c: [-52, -36], h: [2.4, 2.0] },
  { c: [-39, -38], h: [2.2, 2.1], color: 'white' },
  { c: [-7, -37], h: [2.5, 1.9] },
  { c: [9, -39], h: [2.1, 2.0], color: 'white' },
  { c: [39, -38], h: [2.5, 2.1] },
  { c: [52, -36], h: [2.3, 1.9], color: 'white' },
  { c: [-52, 36], h: [2.2, 2.0], color: 'white' },
  { c: [-39, 38], h: [2.4, 2.1] },
  { c: [-8, 38], h: [2.5, 1.9], color: 'white' },
  { c: [9, 37], h: [2.3, 2.0] },
  { c: [39, 39], h: [2.4, 2.0], color: 'white' },
  { c: [52, 37], h: [2.1, 2.1] },
];
const shapes = ['ellipse', 'rectangle', 'circle', 'triangle', 'long-rectangle'];
const iceColors = ['#cff1fc', '#e6f8ff', '#85DFFF'];
export const ICE_PATCHES = patches.map((patch, index) => ({
  ...patch,
  shape: shapes[index % shapes.length],
  h: index % shapes.length === 4 ? [patch.h[0] * 1.3, patch.h[1] * 0.65] : patch.h,
  color: patch.color === 'white' ? '#ffffff' : iceColors[index % iceColors.length],
}));

export function patchSDF(x, z, patch) {
  const px = x - patch.c[0];
  const pz = z - patch.c[1];
  const [hx, hz] = patch.h;
  if (patch.shape === 'rectangle' || patch.shape === 'long-rectangle') {
    return Math.max(Math.abs(px) - hx, Math.abs(pz) - hz);
  }
  if (patch.shape === 'triangle') {
    const side = (pz - hz + 2 * hz * Math.abs(px) / hx) / Math.hypot(2 * hz / hx, 1);
    return Math.max(-pz - hz, side);
  }
  if (patch.shape === 'circle') return Math.hypot(px, pz) - Math.min(hx, hz);
  return (Math.hypot(px / hx, pz / hz) - 1) * Math.min(hx, hz);
}

// union of all patches = the minimum of their distances
export function iceSDF(x, z, patches = ICE_PATCHES) {
  let d = Infinity;
  for (const p of patches) d = Math.min(d, patchSDF(x, z, p));
  return d;
}

export const onIce = (x, z, patches = ICE_PATCHES) => iceSDF(x, z, patches) < 0;

export function iceSurface(x, z, patches = ICE_PATCHES) {
  let white = false;
  for (const patch of patches) {
    if (patchSDF(x, z, patch) >= 0) continue;
    if (patch.color !== '#ffffff') return 'colored';
    white = true;
  }
  return white ? 'white' : 'snow';
}
