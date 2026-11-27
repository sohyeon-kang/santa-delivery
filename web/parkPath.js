// W07L1, pp. 15/28/35: cubic Bernstein form, derivative and C1 joins.
// Coordinates are [world x, world z]. Keep this module independent of rendering.
export const PARK_CURVES = [
  [[3.8,1], [5,-1], [9,0.5], [10,-2]],
  [[10,-2], [11,-4.5], [12.8,-5], [13,-7]],
  [[13,-7], [13.2,-9], [12,-12], [12,-16]],
];

export function bezierPoint(control, t) {
  const u = 1-t;
  return [0,1].map(axis => u*u*u*control[0][axis]
    + 3*u*u*t*control[1][axis] + 3*u*t*t*control[2][axis] + t*t*t*control[3][axis]);
}

export function bezierTangent(control, t) {
  const u = 1-t;
  return [0,1].map(axis => 3*u*u*(control[1][axis]-control[0][axis])
    + 6*u*t*(control[2][axis]-control[1][axis]) + 3*t*t*(control[3][axis]-control[2][axis]));
}

export function makeBezierPath(curves, halfWidth, color, id) {
  const points = [], tangents = [];
  for (const [index, curve] of curves.entries()) {
    // The shared endpoint occurs once. Derivatives agree before normalization.
    for (let step = index === 0 ? 0 : 1; step <= 16; step++) {
      const t = step/16;
      points.push(bezierPoint(curve,t));
      const tangent = bezierTangent(curve,t);
      const length = Math.hypot(...tangent);
      tangents.push(tangent.map(value => value/length));
    }
  }
  const minX = Math.min(...points.map(point=>point[0]))-halfWidth;
  const maxX = Math.max(...points.map(point=>point[0]))+halfWidth;
  const minZ = Math.min(...points.map(point=>point[1]))-halfWidth;
  const maxZ = Math.max(...points.map(point=>point[1]))+halfWidth;
  
  return {
    id, curves, shape:'bezier', color, halfWidth, points, tangents,
    c:[(minX+maxX)/2,(minZ+maxZ)/2], h:[(maxX-minX)/2,(maxZ-minZ)/2],
  };
}

export const PARK_ICE_PATH = makeBezierPath(PARK_CURVES,0.9,'#85DFFF','park-east');
// A different sweep and exit, rather than a reflection of the eastern path.
export const PARK_WHITE_PATH = makeBezierPath([
  [[-3.8,1.8],[-5,0],[-10,0],[-11,3]],
  [[-11,3],[-12,6],[-10,7],[-8,10]],
  [[-8,10],[-6,13],[-7,15],[-6,16]],
],0.8,'#ffffff','park-west');

function roadRibbon(center, vertical, length, radius, color, id, bend = 1.25) {
  const local = [
    [[-length/2,-0.5],[-length*0.34,-bend],[-length*0.18,bend],[0,0.3]],
    [[0,0.3],[length*0.18,0.6-bend],[length*0.34,bend],[length/2,-0.4]],
  ];
  const curves = local.map(curve=>curve.map(([along,across])=>vertical
    ? [center[0]+across,center[1]+along]
    : [center[0]+along,center[1]+across]));
  return makeBezierPath(curves,radius,color,id);
}

// Replace selected pools with longer, C1-connected ribbons along the streets.
export const ROAD_CURVE_REPLACEMENTS = [
  { center:[-40,-16], path:roadRibbon([-40.5,-15.5],false,15,1.0,'#cff1fc','road-far-north-blue') },
  { center:[41.5,16], path:roadRibbon([40,16.5],false,16,0.95,'#ffffff','road-far-south-white',-1.4) },
  { center:[-24,-7.5], path:roadRibbon([-24.4,-5.5],true,14,0.9,'#ffffff','road-west-white',-1.3) },
  { center:[17,16], path:roadRibbon([14,15.3],false,12,1.05,'#85DFFF','road-south-blue') },
  { center:[24,-39], path:roadRibbon([24.5,-39],true,12,0.9,'#cff1fc','road-outer-northeast-blue',-1.2) },
  { center:[-24,39], path:roadRibbon([-24.3,39],true,12,0.85,'#ffffff','road-outer-southwest-white') },
  { center:[-11,-16], path:makeBezierPath([
    [[-16,-16.8],[-13,-14.8],[-10,-17.8],[-6,-15.8]],
  ],1.05,'#85DFFF','road-north-blue') },
  { center:[24,7.5], path:makeBezierPath([
    [[23.2,3.8],[25.8,5.8],[22.2,8.6],[24.5,11.2]],
  ],1,'#cff1fc','road-east-blue') },
  { center:[-24,-29], path:makeBezierPath([
    [[-24.8,-31.5],[-22.5,-30.6],[-25.3,-28.5],[-23.4,-26.8]],
  ],0.95,'#ffffff','road-northwest-white') },
  { center:[24,29], path:makeBezierPath([
    [[24.9,26.6],[22.5,27.7],[25.3,30],[23.7,31.6]],
  ],0.9,'#ffffff','road-southeast-white') },
];

// Short, broad melt pools stay within the old patch's bounds. Gentle bends avoid
// pinched inner edges when the width is large compared with the curve length.
export function makeMeltPool(patch, index) {
  const horizontal = patch.h[0] >= patch.h[1];
  const major = Math.max(...patch.h), minor = Math.min(...patch.h);
  const radius = minor*(0.68+0.16*(0.5+0.5*Math.sin(index*2.17)));
  const reach = (major-radius)*0.92;
  const bend = (index%2 ? 1 : -1)*Math.min(minor*0.22,reach*reach/radius*0.02);
  const local = [[-reach,-bend*0.25],[-reach*0.4,bend],[reach*0.35,-bend*0.7],[reach,bend*0.2]];
  const angle = Math.sin(index*1.91)*0.28;
  const control = local.map(([along,across]) => {
    const a = along*Math.cos(angle)-across*Math.sin(angle);
    const b = along*Math.sin(angle)+across*Math.cos(angle);
    return horizontal ? [patch.c[0]+a,patch.c[1]+b] : [patch.c[0]+b,patch.c[1]+a];
  });
  return makeBezierPath([control],radius,patch.color,`melt-pool-${index}`);
}

export function parkPathSDF(x, z, path = PARK_ICE_PATH) {
  let distance = Infinity;
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i-1], b = path.points[i];
    const dx = b[0]-a[0], dz = b[1]-a[1];
    const t = Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
    distance = Math.min(distance,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));
  }
  return distance-path.halfWidth;
}
