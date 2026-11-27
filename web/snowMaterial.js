// Snow settles on surfaces that face up. Keep the original atlas and PBR lighting.
import { Color } from 'three';

const profiles = {
  paved: { color: '#c5d6e4', cover: 0.81, slope: 0.55 },
  roof: { color: '#eef6ff', cover: 0.98, slope: 0.34 },
  foliage: { color: '#e5f1f9', cover: 0.87, slope: 0.25 },
  dust: { color: '#e5f1f9', cover: 0.49, slope: 0.58 },
};
const variants = new WeakMap();

export function snowProfile(kit, name) {
  if (kit === 'fantasy-town-kit') return 'roof';
  if (kit === 'city-kit-roads' && /^(road-|tile-)/.test(name) || name.startsWith('driveway-')) return 'paved';
  if (name.startsWith('building-')) return 'roof';
  if (name.startsWith('tree') && !name.includes('-snow') || name.startsWith('plant_')) return 'foliage';
  if (kit === 'car-kit' || /^(planter|rock_|stump_|detail-parasol)/.test(name)) return 'dust';
  return null;
}

export function snowMaterial(base, profile) {
  if (!profile || !base.isMeshStandardMaterial) return base;
  let byProfile = variants.get(base);
  if (!byProfile) {
    byProfile = new Map();
    variants.set(base, byProfile);
  }
  if (byProfile.has(profile)) return byProfile.get(profile);

  const material = base.clone();
  const { color, cover, slope } = profiles[profile];
  material.customProgramCacheKey = () => `snow-cover-${profile}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnowColor = { value: new Color(color) };
    shader.uniforms.uSnowCover = { value: cover };
    shader.uniforms.uSnowSlope = { value: slope };
    shader.vertexShader = `
      varying float vSnowUp;
      varying vec3 vSnowPosition;
    ` + shader.vertexShader.replace('#include <project_vertex>', `
      #include <project_vertex>
      // The normal and world up are both expressed in view space.
      vSnowUp = dot(normalize(transformedNormal), normalize(viewMatrix[1].xyz));
      vSnowPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
    `);
    shader.fragmentShader = `
      uniform vec3 uSnowColor;
      uniform float uSnowCover;
      uniform float uSnowSlope;
      varying float vSnowUp;
      varying vec3 vSnowPosition;
    ` + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      // Sample in world space so adjoining pavement tiles agree at their edges.
      vec2 p = vSnowPosition.xz;
      float variation = sin(p.x * 1.9 + p.y * 1.1) * sin(p.y * 2.4 - p.x * 0.7);
      float snow = smoothstep(uSnowSlope, 0.88, vSnowUp + 0.10 * variation) * uSnowCover;
      diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor * (0.97 + 0.03 * variation), snow);
    `).replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.94, snow);
    `).replace('#include <metalnessmap_fragment>', `
      #include <metalnessmap_fragment>
      metalnessFactor = mix(metalnessFactor, 0.0, snow);
    `);
  };
  byProfile.set(profile, material);
  return material;
}
