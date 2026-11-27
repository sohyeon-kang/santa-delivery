// P3 Starter (three.js): walk around a Kenney town with a dog that greets you and plays fetch.
// Run a local server in the P3-Starter-Pack folder:  python -m http.server 8000
// then open http://localhost:8000/web/
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Animator, Dog, Player, headingOf, turnToward } from './actors.js';
import { SantaPlayer, SANTA_SCALE, makeGift, setGiftModels, withCarryClips } from './santa.js';
import { ICE_PATCHES, onIce } from './ice.js';
import { buildIce } from './iceMaterial.js';
import { snowMaterial, snowProfile } from './snowMaterial.js';
import { Ball, makeCollider, mouseRay, rayAABB, rayGround } from './physics.js';
import { Minimap, RANGE, SIZE, deliveryStarTexture } from './minimap.js';
import { Sound } from './sound.js';

const MODELS = '../assets/models/';
const params = new URLSearchParams(location.search);   // test options: cam, demo, t
const CLICK_PIXELS = 5;   // a press that moves less than this is a click, not a camera drag

// ------------------------------------------------------------ renderer and scene
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 300);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const data = await (await fetch('../' + (params.get('scene') ?? 'scene.json'))).json();   // ?scene=other.json
const sky = new THREE.Color('#91a9ca');
scene.background = sky;
scene.fog = new THREE.FogExp2(sky, 0.012);

// image-based ambient light from an HDRI (Poly Haven, CC0)
const hdr = await new RGBELoader().loadAsync('../assets/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(hdr).texture;
scene.environmentIntensity = 0.57;
// keep the equirectangular HDR: the ice shader reads it as its environment map

// sun with a shadow camera that follows the player
const sunDir = new THREE.Vector3(...data.sun.direction).normalize();
const sun = new THREE.DirectionalLight(new THREE.Color(...data.sun.color), data.sun.intensity * 0.86);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 140 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(data.ground.size, data.ground.size),
  new THREE.MeshStandardMaterial({ color: '#e4eef9', roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;     // Keep the ground below the road tiles.
ground.receiveShadow = true;
scene.add(ground);

// ------------------------------------------------------------ models
const loader = new GLTFLoader();
const cache = new Map();
function loadGLB(rel) {
  if (!cache.has(rel)) cache.set(rel, loader.loadAsync(MODELS + rel));
  return cache.get(rel);
}

async function place(desc, winter = false) {
  const gltf = await loadGLB(desc.model);
  const kit = desc.model.split('/')[0];
  // SkeletonUtils.clone also copies bones, so skinned characters can be instanced
  const obj = SkeletonUtils.clone(gltf.scene);
  obj.name = desc.model.split('/').pop().replace('.glb', '');
  const profile = winter ? snowProfile(kit, obj.name) : null;
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.receiveShadow = true;
      const prepare = (material) => {
        if (material.map) material.map.magFilter = THREE.NearestFilter;
        return snowMaterial(material, profile);
      };
      o.material = Array.isArray(o.material) ? o.material.map(prepare) : prepare(o.material);
    }
  });
  obj.position.set(...(desc.pos ?? [0, 0, 0]));
  obj.rotation.y = THREE.MathUtils.degToRad(desc.rotY ?? 0);
  obj.scale.setScalar((desc.scale ?? 1) * (data.kitScale[kit] ?? 1));
  scene.add(obj);
  return { obj, clips: gltf.animations };
}

const giftFiles = ['present-a-cube', 'present-b-cube', 'present-a-rectangle',
  'present-b-rectangle', 'present-a-round'];
setGiftModels(await Promise.all(giftFiles.map(async name =>
  (await loadGLB('holiday-kit/' + name + '.glb')).scene)));

const props = await Promise.all(data.props
  .filter(({ model }) => !/^nature-kit\/(grass_|flower_)/.test(model))
  .map((desc) => place(desc, true)));
// world-space AABBs (rest pose): picking, and ground-plane colliders (see physics.js)
for (const p of props) { p.obj.updateMatrixWorld(true); p.box = new THREE.Box3().setFromObject(p.obj); }
const colliders = props.map((p) => makeCollider(p.obj.name, p.box, p.obj.position)).filter(Boolean);

// player = rig (position, heading) > tilt (lean around the feet) > model   (see santa.js)
const p = await place(data.player);
p.obj.scale.multiplyScalar(SANTA_SCALE);
const rig = new THREE.Group(), tilt = new THREE.Group();
rig.position.copy(p.obj.position);
rig.rotation.y = p.obj.rotation.y;
p.obj.position.set(0, 0, 0);
p.obj.rotation.set(0, 0, 0);
tilt.add(p.obj);
rig.add(tilt);
scene.add(rig);
const player = new SantaPlayer(rig, tilt, new Animator(p.obj, withCarryClips(p.clips)), colliders, scene);
const d = await place(data.dog);
const dog = new Dog(d.obj, new Animator(d.obj, d.clips), data.dog.home ?? data.dog.pos,
  data.dog.wanderRadius ?? 4, colliders);

const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(Ball.RADIUS, 24, 16),
  new THREE.MeshStandardMaterial({ color: '#e0261a', roughness: 0.5 }));
ballMesh.castShadow = true;
scene.add(ballMesh);
const ball = new Ball(ballMesh);

// observers: the player waves back when greeted, the dog chases a thrown ball
dog.onGreet.push((dg) => player.wave(dg.pos));
player.onThrow.push((pl) => dog.ballThrown(ball, pl.pos));

// sound effects are observers too: they react to the same events
const sound = new Sound(scene);
sound.load().catch((e) => console.warn('sound off:', e));   // load in the background; the game starts silent
// hard ground (roads, pavements, plazas) for footstep sounds: footprints of road and tile pieces
const hardGround = props.filter((p) => p.obj.name.includes('road') || p.obj.name.includes('tile')
  || p.obj.name.includes('driveway')).map((p) => p.box);
const surface = (q) => (onIce(q.x, q.z) ? 'ice'
  : hardGround.some((b) => q.x >= b.min.x && q.x <= b.max.x && q.z >= b.min.z && q.z <= b.max.z) ? 'hard' : 'grass');

const up = (q, h) => q.clone().add(new THREE.Vector3(0, h, 0));
player.onStep.push((pl) => sound.play('step_' + surface(pl.pos), pl.pos.clone()));
player.onThrow.push((pl) => sound.play('throw', up(pl.pos, 1.2)));
ball.onHit.push((b, kind, v) => sound.play(kind === 'ground' ? 'bounce' : 'wall', b.pos.clone(), Math.min(1, v / 5)));
dog.onBark.push((dg) => sound.play('bark', up(dg.pos, 0.5)));

// ice patches with the hand-written shader (iceMaterial.js)
const ice = buildIce(scene, ICE_PATCHES, hardGround, {
  envMap: hdr, sunDir, sunColor: sun.color, sunIntensity: sun.intensity, fog: scene.fog,
});

// balance events: sound + (on screen) the "!" above the head, so no message is sound-only
player.onBalance.push((pl, e) => {
  if (e === 'wobble') sound.play('wobble', up(pl.pos, 1.6));
  if (e === 'recover') sound.play('recover', up(pl.pos, 1.6));
  if (e === 'fall') sound.play('fall', pl.pos.clone());
});
// Clear pickup spots beside the five park trees (world x/z).
const giftSpots = [
  [[-0.95, 3.3], [0, 3.5], [0.95, 3.3]],
  [[-6.2, 0.8], [-5.3, 1], [-4.4, 0.8]],
  [[4.5, 0.6], [5.4, 0.8], [6.3, 0.6]],
  [[4.3, 6.5], [5.2, 6.7], [6.1, 6.5]],
  [[-6.2, 6], [-5.3, 6.2], [-4.4, 6]],
];
const lastTree = new Map();
const groundGifts = new Map();
const pickupRadius = 1.8;
function spawnGift(id) {
  const gift = makeGift(id);
  gift.userData.giftId = id;
  const occupied = new Set(Array.from(groundGifts.values(), entry => entry.spot));
  const candidates = giftSpots.map((spots, tree) => ({
    tree, free: spots.filter(spot => !occupied.has(spot)),
  })).filter(group => group.tree !== lastTree.get(id) && group.free.length);
  // Prefer the least occupied trees, then break ties randomly.
  const mostFree = Math.max(...candidates.map(group => group.free.length));
  const tied = candidates.filter(group => group.free.length === mostFree);
  const group = tied[Math.floor(Math.random() * tied.length)];
  const spot = group.free[Math.floor(Math.random() * group.free.length)];
  lastTree.set(id, group.tree);
  gift.position.set(spot[0], gift.userData.halfHeight, spot[1]);
  scene.add(gift);
  groundGifts.set(id, { obj: gift, spot, box: new THREE.Box3().setFromObject(gift) });
}
for (let id = 0; id < 5; id++) spawnGift(id);

function takeGift(gift) {
  groundGifts.delete(gift.userData.giftId);
  player.gifts.add(gift);
}
function nearbyGift() {
  let nearest = null, distance = pickupRadius;
  for (const { obj } of groundGifts.values()) {
    const d = Math.hypot(obj.position.x - player.pos.x, obj.position.z - player.pos.z);
    if (d <= distance) { nearest = obj; distance = d; }
  }
  return nearest;
}
player.onGiftBreak.push((pl, q, id) => {
  sound.play('gift_break', q);
  spawnGift(id);
});
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => sound.resume());

// collider outlines for the B key
const colliderView = new THREE.Group();
colliderView.visible = false;
for (const c of colliders) {
  const box = c.type === 'box'
    ? new THREE.Box3(new THREE.Vector3(c.lo[0], 0, c.lo[1]), new THREE.Vector3(c.hi[0], c.height, c.hi[1]))
    : new THREE.Box3(new THREE.Vector3(c.c[0] - c.r, 0, c.c[1] - c.r), new THREE.Vector3(c.c[0] + c.r, c.height, c.c[1] + c.r));
  colliderView.add(new THREE.Box3Helper(box, 0xff4433));
}
scene.add(colliderView);

// ------------------------------------------------------------ picking and click-to-move
let selected = null;        // picked object
let walkTarget = null;      // click-to-move goal on the ground
let stuck = 0;
const marker = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.3, 24),
  new THREE.MeshBasicMaterial({ color: 0x33ff66 }));
marker.rotation.x = -Math.PI / 2;
marker.visible = false;
scene.add(marker);

function select(obj) {
  selected = obj;
  document.getElementById('selected').textContent = selected ? selected.name : '-';
}

const minimap = new Minimap(scene);

// Choose five distinct suburban houses for this run.
const houses = props.filter(({ obj }) => obj.name.startsWith('building-type-'));
for (let i = houses.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [houses[i], houses[j]] = [houses[j], houses[i]];
}
const deliveryTargets = houses.slice(0, 5);
const targetColors = ['#ffe46d', '#ff9b88', '#82e8ff', '#ff9ce0', '#c5a4ff'];
const glowGroundMaterial = new THREE.ShaderMaterial({
  uniforms: { uGlow: { value: 0.8 } },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uGlow;
    varying vec2 vUv;
    void main() {
      float radius = length(vUv - 0.5) * 2.0;
      float fade = 1.0 - smoothstep(0.15, 1.0, radius);
      gl_FragColor = vec4(1.0, 0.75, 0.18, fade * 0.24 * uGlow);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
});
const targetMarkers = deliveryTargets.map(({ obj, box }, index) => {
  const texture = deliveryStarTexture(targetColors[index]);
  const worldTexture = deliveryStarTexture('#ffe25d', false);
  const star = new THREE.Sprite(new THREE.SpriteMaterial({
    map: worldTexture, depthTest: false, depthWrite: false, transparent: true,
  }));
  star.position.set(obj.position.x, box.max.y + 1.5, obj.position.z);
  star.scale.set(3.2, 3.2, 1);
  scene.add(star);
  const groundGlow = new THREE.Mesh(new THREE.PlaneGeometry(15, 15), glowGroundMaterial);
  groundGlow.rotation.x = -Math.PI / 2;
  groundGlow.position.set(obj.position.x, 0.09, obj.position.z);
  scene.add(groundGlow);
  const light = new THREE.PointLight('#ffd36a', 32, 20, 2);
  light.position.set(obj.position.x, Math.min(box.max.y * 0.6, 5), obj.position.z + (obj.position.z < 0 ? 3 : -3));
  scene.add(light);
  return { star, texture, light, groundGlow };

});
minimap.setDeliveryTargets(deliveryTargets.map(({ obj }, index) => ({
  position: obj.position, texture: targetMarkers[index].texture,
})));
const deliveredHomes = new Set();
const startedAt = performance.now();
let finishedTime = null;
const formatTime = seconds => `${Math.floor(seconds / 60)}분 ${Math.floor(seconds % 60)}초`;
const ending = document.getElementById('ending');
const celebration = document.getElementById('celebration');
const endingMusic = new Audio('../assets/sounds/music/jingle-bells-kevin-macleod.mp3');
endingMusic.preload = 'auto';
endingMusic.volume = 0.65;
function playEndingMusic() {
  endingMusic.muted = sound.muted;
  endingMusic.currentTime = 0;
  endingMusic.play().catch(error => console.warn('ending music:', error));
}
function celebrate() {
  const colors = ['#ffe17a', '#fff4c2', '#ff8f8f', '#9fe0ff', '#dcb6ff'];
  for (let i = 0; i < 5; i++) {
    const firework = document.createElement('span');
    firework.className = 'firework';
    firework.style.setProperty('--x', `${14 + i * 18}%`);
    firework.style.setProperty('--y', `${21 + (i % 2) * 24}%`);
    firework.style.setProperty('--color', colors[i]);
    firework.style.setProperty('--delay', `${i * 0.42}s`);
    celebration.append(firework);
  }
  for (let i = 0; i < 44; i++) {
    const piece = document.createElement('span');
    piece.className = 'celebration-piece';
    piece.textContent = i % 4 === 0 ? '★' : '■';
    piece.style.setProperty('--x', `${Math.random() * 100}%`);
    piece.style.setProperty('--color', colors[i % colors.length]);
    piece.style.setProperty('--size', `${10 + Math.random() * 16}px`);
    piece.style.setProperty('--duration', `${2.4 + Math.random() * 1.6}s`);
    piece.style.setProperty('--delay', `${Math.random() * 0.8}s`);
    piece.style.setProperty('--drift', `${Math.random() * 140 - 70}px`);
    celebration.append(piece);
  }
}
function showEnding() {
  finishedTime = (performance.now() - startedAt) / 1000;
  document.getElementById('final-time').textContent = formatTime(finishedTime);
  ending.hidden = false;
  deliveryNotice.hidden = true;
  celebrate();
  playEndingMusic();
}
document.getElementById('play-again').addEventListener('click', () => location.reload());
let pendingDelivery = null;
let deliveryNoticeTime = 0;
const deliveryNotice = document.getElementById('delivery-notice');
function distanceToHome({ box }) {
  const x = Math.max(box.min.x - player.pos.x, 0, player.pos.x - box.max.x);
  const z = Math.max(box.min.z - player.pos.z, 0, player.pos.z - box.max.z);
  return Math.hypot(x, z);
}
function deliverTo(target) {
  if (!target || pendingDelivery || deliveredHomes.has(target) || !player.carry || player.balance.locked || distanceToHome(target) > 2) return false;
  const gift = player.gifts.removeTop(scene);
  const start = gift.position.clone();
  const north = target.obj.position.z < 0;
  const finish = new THREE.Vector3(
    THREE.MathUtils.clamp(player.pos.x, target.box.min.x + 0.5, target.box.max.x - 0.5),
    gift.userData.halfHeight,
    north ? target.box.max.z + 0.35 : target.box.min.z - 0.35,
  );
  const handoff = start.clone().addScaledVector(
    finish.clone().sub(player.pos).setY(0).normalize(), 0.35);
  handoff.y += 0.12;
  player.body.vel.x = player.body.vel.z = 0;
  const arm = player.tilt.getObjectByName('arm-right');
  pendingDelivery = { target, gift, start, handoff, finish, arm, armStartX: arm.rotation.x, time: 0 };
  walkTarget = null;
  return true;
}
function finishDelivery({ target, gift }) {
  scene.remove(gift);
  walkTarget = null;
  deliveredHomes.add(target);
  const index = deliveryTargets.indexOf(target);
  targetMarkers[index].star.visible = false;
  targetMarkers[index].light.visible = false;
  targetMarkers[index].groundGlow.visible = false;
  minimap.setDeliveryTargets(deliveryTargets.flatMap(({ obj }, i) =>
    deliveredHomes.has(deliveryTargets[i]) ? [] : [{ position: obj.position, texture: targetMarkers[i].texture }]));
  deliveryNoticeTime = 3.0;
  deliveryNotice.hidden = false;
  if (deliveredHomes.size === 5) {
    showEnding();
  }
}
function nearbyHome() {
  return deliveryTargets.filter(target => !deliveredHomes.has(target))
    .sort((a, b) => distanceToHome(a) - distanceToHome(b))[0];
}

// pick the nearest object under the mouse; if it is the ground, walk there
function click(mx, my) {
  if (finishedTime !== null) return;
  if (pendingDelivery) return;
  if (minimap.contains(mx, my)) {             // a click on the minimap: walk there
    walkTarget = minimap.toWorld(mx, my);
    stuck = 0;
    sound.play('move');
    return;
  }
  const ray = mouseRay(mx, my, innerWidth, innerHeight, camera);
  let best = null, bestT = Infinity;
  const pickable = [...props, ...groundGifts.values(), { obj: d.obj, box: new THREE.Box3().setFromObject(d.obj) }];
  for (const it of pickable) {
    const t = rayAABB(ray, it.box);
    if (t !== null && t < bestT) { best = it.obj; bestT = t; }
  }
  const tg = rayGround(ray);
  if (tg !== null && tg < bestT) {
    walkTarget = ray.at(tg, new THREE.Vector3()).setY(0);
    stuck = 0;
    select(null);
    sound.play('move');
  } else if (best && groundGifts.has(best.userData.giftId)) {
    if (!player.balance.locked && Math.hypot(best.position.x - player.pos.x, best.position.z - player.pos.z) <= pickupRadius) {
      walkTarget = null;
      takeGift(best);
    } else {
      walkTarget = best.position.clone().setY(0);
      stuck = 0;
    }
  } else if (best && deliveryTargets.some(target => target.obj === best)) {
    const target = deliveryTargets.find(home => home.obj === best);
    if (!deliverTo(target) && !deliveredHomes.has(target)) {
      walkTarget = new THREE.Vector3(target.obj.position.x, 0,
        target.box[target.obj.position.z < 0 ? 'max' : 'min'].z + (target.obj.position.z < 0 ? 1 : -1));
      stuck = 0;
    }
  } else {
    select(best);
    sound.play('select');
  }
}

// ------------------------------------------------------------ follow camera
const cam = { yaw: THREE.MathUtils.degToRad(data.camera?.yaw ?? 0), pitch: 0.35, dist: 9,
              target: player.pos.clone().add(new THREE.Vector3(0, 1.4, 0)) };
if (params.get('cam')) {
  const [y, pt, r] = params.get('cam').split(',').map(Number);
  Object.assign(cam, { yaw: THREE.MathUtils.degToRad(y), pitch: pt, dist: r });
}
const camForward = () => new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
function updateCamera(dt) {
  const goal = player.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
  cam.target.lerp(goal, 1 - Math.exp(-10 * dt));
  const cp = Math.cos(cam.pitch);
  camera.position.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp)
    .multiplyScalar(cam.dist).add(cam.target);
  camera.lookAt(cam.target);
  camera.updateMatrixWorld();
  // keep the shadow camera centred on the player
  sun.target.position.copy(player.pos);
  sun.position.copy(player.pos).addScaledVector(sunDir, -60);
}

// ------------------------------------------------------------ spike test helpers
function setCarry(n) {
  while (player.carry < n && groundGifts.size) takeGift(groundGifts.values().next().value.obj);
  while (player.carry > n) {
    const gift = player.gifts.removeTop(scene);
    scene.remove(gift);
    spawnGift(gift.userData.giftId);
  }
}
let iceIndex = 0;
const debugIceShortcut = new URLSearchParams(location.search).get('debug') === '1';
document.getElementById('ice-shortcut').hidden = !debugIceShortcut;
const previewEnding = document.getElementById('preview-ending');
previewEnding.hidden = !debugIceShortcut;
previewEnding.addEventListener('click', () => {
  sound.resume();
  showEnding();
});

function teleportToIce() {
  const pt = ICE_PATCHES[iceIndex++ % ICE_PATCHES.length];
  player.pos.set(pt.c[0] - pt.h[0] - 4, 0, pt.c[1]);      // 4 m west of the patch, facing it
  player.obj.rotation.y = Math.PI / 2;
  player.body.vel.x = player.body.vel.z = 0;
  walkTarget = null;
}

// ------------------------------------------------------------ input
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.code.startsWith('Arrow')) e.preventDefault();
  if (finishedTime !== null) return;
  keys.add(e.code);
  if (e.code === 'KeyB') colliderView.visible = !colliderView.visible;
  if (e.code === 'KeyF' && !e.repeat) player.throw(ball, camForward());
  if (e.code === 'KeyE' && !e.repeat) player.wave();
  if (e.code === 'KeyM' && !e.repeat) { sound.toggleMute(); endingMusic.muted = sound.muted; }
  // ---- spike test keys (remove or hide before submission)
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat && !player.balance.locked) {
      const gift = nearbyGift();
      if (gift) takeGift(gift);
      else deliverTo(nearbyHome());
    }
  }
  if (debugIceShortcut && /^Digit[0-5]$/.test(e.code) && !e.repeat) setCarry(Number(e.code.slice(5)));   // carry 0..5 gifts
  if (debugIceShortcut && e.code === 'KeyP' && !e.repeat) showEnding(); // preview the real ending without five deliveries
  if (e.code === 'KeyI' && !e.repeat) document.getElementById('icemode').textContent = ice.cycle();   // ice shader terms
  if (debugIceShortcut && e.code === 'KeyT' && !e.repeat) teleportToIce();                                // jump next to an ice patch
  if (e.code === 'F12') {
    e.preventDefault();
    const a = document.createElement('a');
    a.href = renderer.domElement.toDataURL('image/png');
    a.download = `shot_${Date.now()}.png`;
    a.click();
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
let dragged = 0;
renderer.domElement.addEventListener('pointerdown', () => { dragged = 0; });
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!(e.buttons & 1)) return;
  dragged += Math.abs(e.movementX) + Math.abs(e.movementY);
  if (dragged >= CLICK_PIXELS) {
    cam.yaw -= e.movementX * 0.005;
    cam.pitch = THREE.MathUtils.clamp(cam.pitch + e.movementY * 0.005, 0.05, 1.35);
  }
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button === 0 && dragged < CLICK_PIXELS) click(e.clientX, e.clientY);
});
addEventListener('wheel', (e) => {
  cam.dist = THREE.MathUtils.clamp(cam.dist * 0.9 ** (-Math.sign(e.deltaY)), 3, 30);
});

function moveInput() {
  const fwd = camForward();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const pressed = (letter, arrow) => Number(keys.has(letter) || keys.has(arrow));
  const m = new THREE.Vector3()
    .addScaledVector(fwd, pressed('KeyW', 'ArrowUp') - pressed('KeyS', 'ArrowDown'))
    .addScaledVector(right, pressed('KeyD', 'ArrowRight') - pressed('KeyA', 'ArrowLeft'));
  if (m.lengthSq() > 0) walkTarget = null;              // keys override click-to-move
  else if (walkTarget) {
    m.subVectors(walkTarget, player.pos).setY(0);
    if (m.length() < 0.2) { walkTarget = null; m.set(0, 0, 0); }
  }
  return m.lengthSq() > 0 ? m.normalize() : m;
}

// ------------------------------------------------------------ scripted demo (?demo=demo.json)
// same format as python/main.py Demo: {"t": 0, "walk": [x, z]}, {"throw": [x, z]}, {"click": [x, y, z]} ...
let demo = null, camGoal = null;
if (params.get('demo')) demo = (await (await fetch(params.get('demo'))).json()).sort((a, b) => a.t - b.t);
function demoStep(t, dt) {
  while (demo.length && demo[0].t <= t) {
    const e = demo.shift();
    if (e.walk) { walkTarget = new THREE.Vector3(e.walk[0], 0, e.walk[1]); stuck = 0; }
    if (e.throw) player.throw(ball, new THREE.Vector3(e.throw[0], 0, e.throw[1]));
    if (e.click) {
      const c = new THREE.Vector3(...e.click).project(camera);
      click((c.x + 1) / 2 * innerWidth, (1 - c.y) / 2 * innerHeight);
    }
    if (e.mapclick) {                                   // click the minimap where that ground point is drawn
      const r = minimap.rect(), [x, z] = e.mapclick;
      click(r.left + (x - minimap.center.x + RANGE) / (2 * RANGE) * SIZE,
        r.top + (z - minimap.center.z + RANGE) / (2 * RANGE) * SIZE);
    }
    if (e.cam) {
      camGoal = [THREE.MathUtils.degToRad(e.cam[0]), e.cam[1], e.cam[2]];
      if (e.cut) [cam.yaw, cam.pitch, cam.dist] = camGoal;
    }
    if ('boxes' in e) colliderView.visible = e.boxes;
    if (e.deselect) select(null);
  }
  if (camGoal) {                                        // ease the camera toward the goal
    const k = 1 - Math.exp(-2.5 * dt);
    let dy = (camGoal[0] - cam.yaw + Math.PI) % (2 * Math.PI);
    if (dy < 0) dy += 2 * Math.PI;
    cam.yaw += (dy - Math.PI) * k;
    cam.pitch += (camGoal[1] - cam.pitch) * k;
    cam.dist += (camGoal[2] - cam.dist) * k;
  }
}

// ------------------------------------------------------------ loop
let simT = 0;
if (params.get('soundlog')) sound.log = [];
function step(dt) {
  if (finishedTime !== null) return;
  simT += dt;
  sound.time = simT;
  if (demo) demoStep(simT, dt);
  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const before = player.pos.clone();
  player.update(dt, pendingDelivery ? new THREE.Vector3() : moveInput(), pendingDelivery ? false : sprint);
  if (pendingDelivery) {
    const delivery = pendingDelivery;
    delivery.time += dt;
    const progress = Math.min(1, Math.max(0, (delivery.time - 1) / 0.9));
    const ease = progress * progress * (3 - 2 * progress);
    const towardDoor = delivery.finish.clone().sub(player.pos);
    player.obj.rotation.y = turnToward(player.obj.rotation.y, headingOf(towardDoor), Player.TURN, dt);
    const reach = Math.min(1, delivery.time / 0.25);
    const release = Math.min(1, Math.max(0, (2.1 - delivery.time) / 0.2));
    const motion = reach * release;
    delivery.arm.rotation.x = delivery.armStartX - 0.55 * motion;
    if (delivery.time < 1) {
      const extend = Math.min(1, delivery.time / 0.25);
      delivery.gift.position.lerpVectors(delivery.start, delivery.handoff, extend);
    } else {
      delivery.gift.position.lerpVectors(delivery.handoff, delivery.finish, ease);
      delivery.gift.position.y += 0.12 * Math.sin(Math.PI * progress);
    }
    if (delivery.time >= 2.1) {
      finishDelivery(delivery);
      pendingDelivery = null;
    }
  }
  if (deliveryNoticeTime > 0) {
    deliveryNoticeTime -= dt;
    if (deliveryNoticeTime <= 0) deliveryNotice.hidden = true;
  }
  if (walkTarget) {                                     // blocked by a wall for a while: give up
    const moved = Math.hypot(player.pos.x - before.x, player.pos.z - before.z);
    stuck = moved < 0.3 * Player.WALK * dt ? stuck + dt : 0;
    if (stuck > 0.6) walkTarget = null;
  }
  dog.update(dt, player.pos);
  ball.update(dt, colliders);
  marker.visible = walkTarget !== null;
  if (walkTarget) marker.position.copy(walkTarget).setY(0.02);
  const targetGlow = 0.75 + 0.25 * Math.sin(simT * 3);
  glowGroundMaterial.uniforms.uGlow.value = targetGlow;
  for (const { light } of targetMarkers) light.intensity = 32 * targetGlow;
  updateCamera(dt);
  // third-person games put the ears on the character and turn them with the camera
  sound.setListener(up(player.pos, 1.4), camera.quaternion);
  minimap.update({ player, dog, ball, walkTarget, mainCamera: camera, camYaw: cam.yaw });
}

function renderFrame() {
  renderer.render(scene, camera);
  minimap.render(renderer);                   // HUD, drawn last on top
}

const hudDog = document.getElementById('dogstate');
const hudBal = document.getElementById('balance');
function updateHud() {
  hudDog.textContent = dog.state;
  const loadWarning = player.carry >= 3 ? ' · 선물 휘청임' : '';
  hudBal.textContent = `${player.onIce ? 'ICE' : 'snow'} · ${player.body.speed.toFixed(1)} m/s · ${player.balance.state}`
    + ` · 들고 있는 선물 ${player.carry}/5${loadWarning} · 트리 아래 ${groundGifts.size} · 배달 ${deliveredHomes.size}/5`
    + ` · 시간 ${formatTime(finishedTime ?? (performance.now() - startedAt) / 1000)}`
    + ` · recovered ${player.balance.recovered} / fell ${player.balance.fell}`;
}
const hudFps = document.getElementById('fps');
const clock = new THREE.Clock();
let frames = 0, fpsTime = 0;
updateCamera(0);

if (params.get('t')) {
  // test mode: simulate a fixed number of 1/60 s steps, then keep showing that frame
  const n = Math.round(Number(params.get('t')) * 60);
  for (let i = 0; i < n; i++) step(1 / 60);
  renderer.setAnimationLoop(renderFrame);
  updateHud();
  if (sound.log) document.body.dataset.sounds = JSON.stringify(sound.log.map(([t, r]) => [Math.round(t * 100) / 100, r]));
  document.title = 'READY';
} else {
  renderer.setAnimationLoop(() => {
    const frameTime = clock.getDelta();
    step(Math.min(frameTime, 0.05));
    renderFrame();
    updateHud();
    frames++; fpsTime += frameTime;
    if (fpsTime > 0.5) { hudFps.textContent = `${Math.round(frames / fpsTime)} fps`; frames = 0; fpsTime = 0; }
  });
}
