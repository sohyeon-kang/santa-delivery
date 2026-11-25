// Ice patches on the roads, described as an implicit surface (W08L2: SDF).
//
//   sdf(p) < 0  : p is on the ice
//   sdf(p) = 0  : p is on the edge
//   sdf(p) > 0  : p is on snow, and the value is the distance to the nearest ice
//
// One rounded rectangle per patch. The same formula is used twice:
//   - here, in JavaScript, to ask "is the player standing on ice?"
//   - in iceMaterial.js, in the fragment shader, to draw a soft frosty edge
// Pure math, no three.js import, so dev/test_spike.mjs can run it in Node.

// c: centre [x, z] (m), h: half size [x, z] (m), r: corner radius (m)
// Positions follow docs/level_sketch_v3: roads run along x = ±24 and z = ±16, 8 m wide.
export const ICE_PATCHES = [
  { c: [-11, -16], h: [6.0, 3.0], r: 1.2 },   // north road, west segment
  { c: [24, -16],  h: [4.0, 4.0], r: 1.5 },   // north-east crossroad (a dangerous turn)
  { c: [-24, 16],  h: [4.0, 4.0], r: 1.5 },   // south-west crossroad (a dangerous turn)
  { c: [41.5, 16], h: [7.5, 3.0], r: 1.2 },   // south road, east segment
  { c: [-24, -7.5], h: [3.0, 3.5], r: 1.0 },  // west road
  { c: [24, 7.5],  h: [3.0, 3.5], r: 1.0 },   // east road
];

// signed distance from (x, z) to one rounded rectangle (Inigo Quilez, sdRoundBox in 2D)
export function sdRoundBox(x, z, patch) {
  const qx = Math.abs(x - patch.c[0]) - (patch.h[0] - patch.r);
  const qz = Math.abs(z - patch.c[1]) - (patch.h[1] - patch.r);
  const ox = Math.max(qx, 0), oz = Math.max(qz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(qx, qz), 0) - patch.r;
}

// union of all patches = the minimum of their distances
export function iceSDF(x, z, patches = ICE_PATCHES) {
  let d = Infinity;
  for (const p of patches) d = Math.min(d, sdRoundBox(x, z, p));
  return d;
}

export const onIce = (x, z, patches = ICE_PATCHES) => iceSDF(x, z, patches) < 0;
