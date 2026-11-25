// P3 Starter (three.js): walk around a Kenney town with a dog that greets you and plays fetch.
// Run a local server in the P3-Starter-Pack folder:  python -m http.server 8000
// then open http://localhost:8000/web/
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Animator, Dog, Player } from './actors.js';
import { Ball, makeCollider, mouseRay, rayAABB, rayGround } from './physics.js';
import { Minimap, RANGE, SIZE } from './minimap.js';
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
const sky = new THREE.Color('#b8d6f7');
scene.background = sky;
scene.fog = new THREE.FogExp2(sky, 0.012);

// image-based ambient light from an HDRI (Poly Haven, CC0)
const hdr = await new RGBELoader().loadAsync('../assets/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(hdr).texture;
scene.environmentIntensity = 0.6;
hdr.dispose();

// sun with a shadow camera that follows the player
const sunDir = new THREE.Vector3(...data.sun.direction).normalize();
const sun = new THREE.DirectionalLight(new THREE.Color(...data.sun.color), data.sun.intensity * 1.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 140 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(data.ground.size, data.ground.size),
  new THREE.MeshStandardMaterial({ color: data.ground.color, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;     // 2 cm below y = 0, so road tiles never fight with the grass
ground.receiveShadow = true;
scene.add(ground);

// ------------------------------------------------------------ models
const loader = new GLTFLoader();
const cache = new Map();
function loadGLB(rel) {
  if (!cache.has(rel)) cache.set(rel, loader.loadAsync(MODELS + rel));
  return cache.get(rel);
}

async function place(desc) {
  const gltf = await loadGLB(desc.model);
  const kit = desc.model.split('/')[0];
  // SkeletonUtils.clone also copies bones, so skinned characters can be instanced
  const obj = SkeletonUtils.clone(gltf.scene);
  obj.name = desc.model.split('/').pop().replace('.glb', '');
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.receiveShadow = true;
      if (o.material.map) o.material.map.magFilter = THREE.NearestFilter;   // crisp color atlas
    }
  });
  obj.position.set(...(desc.pos ?? [0, 0, 0]));
  obj.rotation.y = THREE.MathUtils.degToRad(desc.rotY ?? 0);
  obj.scale.setScalar((desc.scale ?? 1) * (data.kitScale[kit] ?? 1));
  scene.add(obj);
  return { obj, clips: gltf.animations };
}

const props = await Promise.all(data.props.map(place));
// world-space AABBs (rest pose): picking, and ground-plane colliders (see physics.js)
for (const p of props) { p.obj.updateMatrixWorld(true); p.box = new THREE.Box3().setFromObject(p.obj); }
const colliders = props.map((p) => makeCollider(p.obj.name, p.box, p.obj.position)).filter(Boolean);

const p = await place(data.player);
const player = new Player(p.obj, new Animator(p.obj, p.clips), colliders);
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
const hardGround = props.filter((p) => p.obj.name.includes('road') || p.obj.name.includes('tile')).map((p) => p.box);
const surface = (q) => (hardGround.some((b) => q.x >= b.min.x && q.x <= b.max.x && q.z >= b.min.z && q.z <= b.max.z) ? 'hard' : 'grass');
const up = (q, h) => q.clone().add(new THREE.Vector3(0, h, 0));
player.onStep.push((pl) => sound.play('step_' + surface(pl.pos), pl.pos.clone()));
player.onThrow.push((pl) => sound.play('throw', up(pl.pos, 1.2)));
ball.onHit.push((b, kind, v) => sound.play(kind === 'ground' ? 'bounce' : 'wall', b.pos.clone(), Math.min(1, v / 5)));
dog.onBark.push((dg) => sound.play('bark', up(dg.pos, 0.5)));
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

function setHighlight(obj, on) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    if (on) {               // materials are shared between copies: give this one its own
      o.userData.baseMaterial ??= o.material;
      o.material = o.material.clone();
      o.material.emissive = new THREE.Color(0.55, 0.42, 0.05);
    } else if (o.userData.baseMaterial) {
      o.material.dispose();
      o.material = o.userData.baseMaterial;
    }
  });
}
function select(obj) {
  if (selected) setHighlight(selected, false);
  selected = obj;
  if (selected) setHighlight(selected, true);
  document.getElementById('selected').textContent = selected ? selected.name : '-';
}

const minimap = new Minimap(scene);

// pick the nearest object under the mouse; if it is the ground, walk there
function click(mx, my) {
  if (minimap.contains(mx, my)) {             // a click on the minimap: walk there
    walkTarget = minimap.toWorld(mx, my);
    stuck = 0;
    sound.play('move');
    return;
  }
  const ray = mouseRay(mx, my, innerWidth, innerHeight, camera);
  let best = null, bestT = Infinity;
  const pickable = [...props, { obj: d.obj, box: new THREE.Box3().setFromObject(d.obj) }];
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

// ------------------------------------------------------------ input
const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyB') colliderView.visible = !colliderView.visible;
  if (e.code === 'KeyF' && !e.repeat) player.throw(ball, camForward());
  if (e.code === 'KeyE' && !e.repeat) player.wave();
  if (e.code === 'KeyM' && !e.repeat) sound.toggleMute();
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
  const m = new THREE.Vector3()
    .addScaledVector(fwd, (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0))
    .addScaledVector(right, (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0));
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
      click(r.left + (x - player.pos.x + RANGE) / (2 * RANGE) * SIZE, r.top + (z - player.pos.z + RANGE) / (2 * RANGE) * SIZE);
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
  simT += dt;
  sound.time = simT;
  if (demo) demoStep(simT, dt);
  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const before = player.pos.clone();
  player.update(dt, moveInput(), sprint);
  if (walkTarget) {                                     // blocked by a wall for a while: give up
    const moved = Math.hypot(player.pos.x - before.x, player.pos.z - before.z);
    stuck = moved < 0.3 * Player.WALK * dt ? stuck + dt : 0;
    if (stuck > 0.6) walkTarget = null;
  }
  dog.update(dt, player.pos);
  ball.update(dt, colliders);
  marker.visible = walkTarget !== null;
  if (walkTarget) marker.position.copy(walkTarget).setY(0.02);
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
const hudFps = document.getElementById('fps');
const clock = new THREE.Clock();
let frames = 0, fpsTime = 0;
updateCamera(0);

if (params.get('t')) {
  // test mode: simulate a fixed number of 1/60 s steps, then keep showing that frame
  const n = Math.round(Number(params.get('t')) * 60);
  for (let i = 0; i < n; i++) step(1 / 60);
  renderer.setAnimationLoop(renderFrame);
  hudDog.textContent = dog.state;
  if (sound.log) document.body.dataset.sounds = JSON.stringify(sound.log.map(([t, r]) => [Math.round(t * 100) / 100, r]));
  document.title = 'READY';
} else {
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    step(dt);
    renderFrame();
    hudDog.textContent = dog.state;
    frames++; fpsTime += dt;
    if (fpsTime > 0.5) { hudFps.textContent = `${Math.round(frames / fpsTime)} fps`; frames = 0; fpsTime = 0; }
  });
}
