import * as THREE from 'three';

// Offset B(t) perpendicular to its unit tangent; the same footprint serves the map.
export function parkPathGeometry(path, margin = 0) {
  const positions = [], indices = [], normals = [], uvs = [];
  // The small margin covers the implicit edge, which the shader clips precisely.
  const radius = path.halfWidth+margin;
  function vertex(x,z) {
    const index = positions.length/3;
    positions.push(x,0,z);
    normals.push(0,1,0);
    uvs.push((x-path.c[0])/(2*path.h[0])+0.5,(z-path.c[1])/(2*path.h[1])+0.5);
    return index;
  }
  for (let i = 0; i < path.points.length; i++) {
    const [x,z] = path.points[i], [tx,tz] = path.tangents[i];
    vertex(x-tz*radius,z+tx*radius);
    vertex(x+tz*radius,z-tx*radius);
    if (i) {
      const a = 2*(i-1), b = a+1, c = a+2, d = a+3;
      indices.push(a,c,b,b,c,d);
    }
  }
  for (const end of [0,path.points.length-1]) {
    const [x,z] = path.points[end], [tx,tz] = path.tangents[end];
    const center = vertex(x,z);
    const start = Math.atan2(tz,tx)+(end===0?Math.PI/2:-Math.PI/2);
    let previous = vertex(x+Math.cos(start)*radius,z+Math.sin(start)*radius);
    for (let step = 1; step <= 12; step++) {
      const angle = start+step/12*Math.PI;
      const next = vertex(x+Math.cos(angle)*radius,z+Math.sin(angle)*radius);
      indices.push(center,next,previous);
      previous = next;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
