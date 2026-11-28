// Ice shader written by hand (THREE.ShaderMaterial), one flat mesh per ice patch.
//
// What the fragment shader adds up, and where it comes from in the course:
//   ambient + diffuse (Lambert, N·L)                       Lighting: Phong reflection model
//   specular (Blinn-Phong, (N·H)^n with a large n)         Lighting: sharp, small highlight = glossy ice
//   Fresnel (Schlick, F0 + (1-F0)(1-cosθ)^5)               Shading and Materials: grazing angles reflect more
//   environment map (reflect V about N, read the HDRI)     Texture Mapping 2: environment mapping
//     the HDRI is an equirectangular image: direction -> (longitude, latitude) -> (u, v)
//   normal from a height function (noise + cracks)         Texture Mapping 2: normal map / bump, solid texture
//   soft outline from the patch SDF                        W08L2: implicit surface (same formula as ice.js)
//   sparkles: a few tiny facets whose normal hits H        Cognition: pre-attentive pop-out, "shiny = ice"
//
// Key I cycles uMode so each term can be shown on its own (screenshots for the report):
//   0 full   1 ambient+diffuse   2 +specular   3 +Fresnel·environment   4 normals as colours
import * as THREE from 'three';
import { parkPathGeometry } from './parkPathGeometry.js';

export const ICE_MODES = ['full', 'diffuse', '+specular', '+fresnel env', 'normals'];

const vertexShader = /* glsl */ `
uniform vec2 uSize;            // full patch size (x, z) in metres
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vLocal;           // metres from the patch centre
varying float vFogDepth;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vLocal = (uv - 0.5) * uSize;
  vec4 mv = viewMatrix * wp;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uSunDir;          // L: from the surface toward the sun
uniform vec3 uSunColor;        // colour x intensity
uniform vec3 uAmbient;
uniform vec3 uIceColor;
uniform float uWhiteIce;
uniform float uShininess;      // Blinn-Phong exponent n
uniform float uF0;             // reflectance looking straight down (ice ~ water ~ 0.02)
uniform float uEnvIntensity;
uniform sampler2D uEnvMap;     // equirectangular HDR sky
uniform vec2 uHalf;            // patch half size
uniform int uShape;
uniform int uMode;
uniform vec3 uFogColor;
uniform float uFogDensity;
#ifdef PARK_PATH
uniform vec2 uPath[PATH_POINT_COUNT];
uniform float uPathRadius;
#endif

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vLocal;
varying float vFogDepth;

// ---------------------------------------------------------------- noise (solid texture)
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
// thin lines where the noise crosses 0.5: they read as cracks
float crack(vec2 p) {
  float n = vnoise(p * 0.9) * 0.6 + vnoise(p * 2.3) * 0.4;
  return 1.0 - smoothstep(0.0, 0.02, abs(n - 0.5));
}
float height(vec2 p) { return 0.06 * fbm(p * 1.5) - 0.015 * crack(p); }

// normal of the height field y = height(x, z), by central differences
vec3 bumpNormal(vec2 p) {
  float e = 0.04;
  float hx = height(p + vec2(e, 0.0)) - height(p - vec2(e, 0.0));
  float hz = height(p + vec2(0.0, e)) - height(p - vec2(0.0, e));
  return normalize(vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));
}

// ---------------------------------------------------------------- environment map
vec2 equirectUv(vec3 d) {
  float u = atan(d.z, d.x) * 0.15915494 + 0.5;          // longitude / 2π
  float v = asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5;  // latitude / π
  return vec2(u, v);
}

// ---------------------------------------------------------------- patch outline (SDF)
float sdEllipse(vec2 p, vec2 radius) {
  return (length(p / radius) - 1.0) * min(radius.x, radius.y);
}
float patchDistance(vec2 p) {
#ifdef PARK_PATH
  float distanceToPath = 10000.0;
  for (int i = 0; i < PATH_POINT_COUNT - 1; i++) {
    vec2 a = uPath[i], edge = uPath[i+1]-a;
    float t = clamp(dot(p-a,edge)/dot(edge,edge),0.0,1.0);
    distanceToPath = min(distanceToPath,length(p-a-t*edge));
  }
  return distanceToPath-uPathRadius;
#else
  if (uShape == 1 || uShape == 4) return max(abs(p.x) - uHalf.x, abs(p.y) - uHalf.y);
  if (uShape == 2) return length(p) - min(uHalf.x, uHalf.y);
  if (uShape == 3) {
    float slope = 2.0 * uHalf.y / uHalf.x;
    return max(-p.y - uHalf.y, (p.y - uHalf.y + slope * abs(p.x)) / length(vec2(slope, 1.0)));
  }
  return sdEllipse(p, uHalf);
#endif
}

void main() {
  vec2 p = vWorldPos.xz;

  // inside < 0 < outside; a little noise so the outline is not a perfect rectangle
#ifdef PARK_PATH
  float d = patchDistance(p);
#else
  float d = patchDistance(vLocal) + (fbm(p * 0.8) - 0.5) * 0.22;
#endif
  float alpha = 1.0 - smoothstep(-0.25, 0.0, d);
  if (alpha <= 0.001) discard;
  float rim = smoothstep(-0.9, -0.05, d);              // frosty white near the edge

  vec3 N = bumpNormal(p);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + V);
  float NdotL = max(dot(N, L), 0.0);

  float fracture = crack(p);
  vec3 base = mix(uIceColor, vec3(0.85, 0.92, 1.0), clamp(rim * 0.55 + fracture * 0.24, 0.0, 1.0));
  base = mix(base, vec3(0.86,0.92,0.96), uWhiteIce*0.35);
  vec3 ambient = uAmbient * base;
  vec3 diffuse = base * uSunColor * NdotL;
  float spec = NdotL > 0.0 ? pow(max(dot(N, H), 0.0), uShininess) : 0.0;

  // sparkles: one cell in ~12 gets a tilted micro facet; it lights up only when it faces H
  vec2 cell = floor(p * 14.0);
  vec3 Ng = normalize(N + vec3(hash(cell + 3.1) - 0.5, 0.0, hash(cell + 7.7) - 0.5) * 0.9);
  float glint = step(0.97, hash(cell)) * pow(max(dot(Ng, H), 0.0), 300.0) * 1.8;

  float cosT = max(dot(N, V), 0.0);
  float F = uF0 + (1.0 - uF0) * pow(1.0 - cosT, 5.0);   // Schlick
  vec3 R = reflect(-V, N);
  vec3 env = min(texture2D(uEnvMap, equirectUv(R)).rgb, vec3(8.0)) * uEnvIntensity;

  vec3 color;
  if (uMode == 1)      color = ambient + diffuse;
  else if (uMode == 2) color = ambient + diffuse + spec * uSunColor;
  else if (uMode == 3) color = mix(ambient + diffuse, env, F) + spec * uSunColor;
  else if (uMode == 4) color = N * 0.5 + 0.5;
  else                 color = mix(ambient + diffuse, env, F) + (spec + glint) * uSunColor;
  // Keep the lighting and sky reflection: an opaque white override looks painted.
  color += uWhiteIce * (vec3(rim*0.055) - vec3(fracture*0.035));

  float opacity = mix(mix(0.60,0.82,F),mix(0.38,0.68,F),uWhiteIce);
  gl_FragColor = vec4(color, alpha * opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  // exponential-squared fog, same as scene.fog (FogExp2)
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, fogF);
}
`;

export function makeIceMaterial(patch, { envMap, sunDir, sunColor, sunIntensity, fog }) {
  const curved = patch.shape === 'bezier';
  return new THREE.ShaderMaterial({
    defines:curved?{PARK_PATH:1,PATH_POINT_COUNT:patch.points.length}:{},
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      ...(curved?{
        uPath:{value:patch.points.map(([x,z])=>new THREE.Vector2(x,z))},
        uPathRadius:{value:patch.halfWidth},
      }:{}),
      uSize: { value: new THREE.Vector2(patch.h[0] * 2 + 1, patch.h[1] * 2 + 1) },
      uHalf: { value: new THREE.Vector2(patch.h[0], patch.h[1]) },
      uSunDir: { value: sunDir.clone().negate().normalize() },     // scene sunDir points away from the sun
      uSunColor: { value: sunColor.clone().multiplyScalar(sunIntensity / Math.PI) },
      uAmbient: { value: new THREE.Vector3(0.32, 0.38, 0.46) },
      uIceColor: { value: new THREE.Color(patch.color) },
      uWhiteIce: { value: patch.color === '#ffffff' ? 1 : 0 },
      uShape: { value: ['ellipse', 'rectangle', 'circle', 'triangle', 'long-rectangle'].indexOf(patch.shape) },
      uShininess: { value: 256.0 },
      uF0: { value: patch.color === '#ffffff' ? 0.07 : 0.04 },
      uEnvIntensity: { value: patch.color === '#ffffff' ? 0.85 : 1.0 },
      uEnvMap: { value: envMap },
      uMode: { value: 0 },
      uFogColor: { value: fog ? fog.color : new THREE.Color(1, 1, 1) },
      uFogDensity: { value: fog ? fog.density : 0 },
    },
  });
}

// one plane per patch, laid on the ground a little above the road tiles under it
export function buildIce(scene, patches, roadBoxes, opts) {
  const group = new THREE.Group();
  group.name = 'ice';
  const materials = [];
  for (const patch of patches) {
    const curved = patch.shape === 'bezier';
    const [cx, cz] = patch.c;
    let top = 0;
    const samples = curved ? patch.points : [[cx,cz]];
    for (const b of roadBoxes) {
      if (samples.some(([x,z])=>x>=b.min.x && x<=b.max.x && z>=b.min.z && z<=b.max.z)) top = Math.max(top,b.max.y);
    }
    // a margin of 0.5 m on every side so the noisy outline has room
    const geo = curved ? parkPathGeometry(patch,0.06) : new THREE.PlaneGeometry(patch.h[0] * 2 + 1, patch.h[1] * 2 + 1);
    const mat = makeIceMaterial(patch, opts);
    const mesh = new THREE.Mesh(geo, mat);
    if (curved) mesh.position.y = top+0.015;
    else {
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(cx, top + 0.015, cz);
    }
    mesh.name = curved ? 'park-bezier-ice' : 'ice-patch';
    mesh.renderOrder = 2;
    group.add(mesh);
    materials.push(mat);
  }
  scene.add(group);
  return {
    group,
    mode: 0,
    cycle() {
      this.mode = (this.mode + 1) % ICE_MODES.length;
      for (const m of materials) m.uniforms.uMode.value = this.mode;
      return ICE_MODES[this.mode];
    },
  };
}
