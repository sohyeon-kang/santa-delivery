// The apprentice Santa: slides on ice, wobbles, falls, and carries a stack of gifts.
//
// Scene graph (W08L1: hierarchical transforms, each child inherits its parent's matrix):
//
//   rig            position on the ground + heading (rotation.y)        = Player.obj
//   └─ tilt        rotation.x / rotation.z only, origin at the FEET
//      ├─ model    the skinned mini character (animations play here)
//      └─ gift 0   held in front of the chest
//         └─ gift 1   sits on gift 0 (its matrix = gift 0's matrix x its own)
//            └─ gift 2 ...
//
// Rotating `tilt` turns the body around the feet, not around the belly. Written as
// matrices that is T(c) R(θ) T(-c) with c = the feet: the pivot trick from W08L1.
// Because the gifts are children of children, a small sway per gift adds up toward the top.
import * as THREE from 'three';
import { Player, turnToward, headingOf } from './actors.js';
import { pushOut } from './physics.js';
import { SlideBody, Balance } from './slide.js';
import { onIce } from './ice.js';

// Dimensions in metres. Scale only the visible box so stacked children keep their own size.
const gifts = [
  [0.48, 0.22, 0.36, '#d7263d'],
  [0.30, 0.36, 0.28, '#1b998b'],
  [0.40, 0.18, 0.30, '#f4b400'],
  [0.26, 0.30, 0.24, '#3f51b5'],
  [0.32, 0.24, 0.26, '#e8e8f0'],
].map(([width, height, depth, color]) => ({
  width, height, depth, material: new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
}));
const giftGeo = new THREE.BoxGeometry(1, 1, 1);
const ribbonGeoA = new THREE.BoxGeometry(1.02, 1.02, 0.18);
const ribbonGeoB = new THREE.BoxGeometry(0.18, 1.02, 1.02);
const ribbonMat = new THREE.MeshStandardMaterial({ color: '#fff3c4', roughness: 0.4 });

export function makeGift(i) {
  const { width, height, depth, material } = gifts[i % gifts.length];
  const gift = new THREE.Group();
  const box = new THREE.Mesh(giftGeo, material);
  box.scale.set(width, height, depth);
  box.add(new THREE.Mesh(ribbonGeoA, ribbonMat), new THREE.Mesh(ribbonGeoB, ribbonMat));
  box.traverse((o) => { o.castShadow = true; });
  gift.add(box);
  gift.userData.halfHeight = height * 1.02 / 2;   // include the ribbon
  return gift;
}

// a bright "!" above the head while wobbling (shape + colour, not colour alone)
function makeAlert() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffd35c'; g.strokeStyle = '#1a1a1a'; g.lineWidth = 10;
  g.beginPath(); g.moveTo(64, 8); g.lineTo(122, 116); g.lineTo(6, 116); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#1a1a1a'; g.font = 'bold 76px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('!', 64, 106);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.setScalar(0.55);
  s.position.y = 2.35;
  s.renderOrder = 10;
  s.visible = false;
  return s;
}

export class GiftStack {
  static BASE = new THREE.Vector3(0, 0.69, 0.68);   // bottom of stack, in the tilt frame (m)
  constructor(grip) { this.grip = grip; this.boxes = []; this.made = 0; }
  get count() { return this.boxes.length; }
  add() {
    const g = makeGift(this.made++);
    const parent = this.boxes.length ? this.boxes[this.boxes.length - 1] : this.grip;
    if (this.boxes.length) {
      g.position.y = parent.userData.halfHeight + g.userData.halfHeight;
    } else {
      g.position.copy(GiftStack.BASE);
      g.position.y += g.userData.halfHeight;
    }
    parent.add(g);
    this.boxes.push(g);
  }
  // detach the top gift and keep its world pose (scene.attach), so it can fall on its own
  removeTop(scene) {
    const g = this.boxes.pop();
    if (!g) return null;
    scene.attach(g);
    return g;
  }
  update(clock, sway) {
    // each gift leans a little on the one under it; through the hierarchy the angles add up
    this.boxes.forEach((g, i) => {
      g.rotation.z = (i === 0 ? 0 : sway * 0.5) + (this.count >= 3 ? 0.03 * Math.sin(clock * 6 + i) : 0);
    });
  }
}

// a gift that left the stack: falls, and breaks when it hits the ground
class FallingGift {
  constructor(mesh, vel) { this.mesh = mesh; this.vel = vel; this.broken = 0; }
  update(dt) {
    if (this.broken > 0) {                         // squash and fade out
      this.broken += dt;
      const k = Math.max(0, 1 - this.broken / 0.4);
      this.mesh.scale.set(1 + (1 - k), Math.max(0.05, k), 1 + (1 - k));
      return this.broken < 0.4;
    }
    this.vel.y -= 9.8 * dt;
    this.mesh.position.addScaledVector(this.vel, dt);
    this.mesh.rotation.x += 4 * dt;
    if (this.mesh.position.y < this.mesh.userData.halfHeight) { this.mesh.position.y = this.mesh.userData.halfHeight; this.broken = 1e-6; return 'hit'; }
    return true;
  }
}

// Keep the full stride, replacing only the tracks animated by the holding pose.
export function withCarryClips(clips) {
  const hold = clips.find(clip => clip.name === 'holding-both');
  const heldTracks = new Set(hold.tracks.map(track => track.name));
  const locomotion = clips.filter(clip => clip.name === 'walk' || clip.name === 'sprint');
  return clips.concat(locomotion.map(clip => {
    const steps = clip.tracks.filter(track => !heldTracks.has(track.name));
    return new THREE.AnimationClip('carry-' + clip.name, clip.duration, steps.concat(hold.tracks));
  }));
}

export class SantaPlayer extends Player {
  constructor(rig, tilt, anim, colliders, scene) {
    super(rig, anim, colliders);
    this.tilt = tilt;
    this.scene = scene;
    this.body = new SlideBody();
    this.balance = new Balance();
    this.spinDirection = 1;
    // Preserve the stack's metre-based rest frame while following the animated chest.
    const grip = new THREE.Group();
    tilt.add(grip);
    tilt.getObjectByName('torso').attach(grip);
    this.gifts = new GiftStack(grip);
    this.falling = [];
    this.onIce = false;
    this.alert = makeAlert();
    rig.add(this.alert);
    this.onBalance = [];      // observers: f(player, event) with event 'wobble' 'recover' 'fall' 'getup' 'drop'
    this.onGiftBreak = [];    // observers: f(player, position)
  }
  get carry() { return this.gifts.count; }

  dropTop() {
    const g = this.gifts.removeTop(this.scene);
    if (!g) return;
    const fwd = new THREE.Vector3(Math.sin(this.obj.rotation.y), 0, Math.cos(this.obj.rotation.y));
    this.falling.push(new FallingGift(g, fwd.multiplyScalar(1.2).add(new THREE.Vector3(this.body.vel.x * 0.5, 1.0, this.body.vel.z * 0.5))));
  }

  update(dt, move, sprint) {
    const pos = this.obj.position;
    this.onIce = onIce(pos.x, pos.z);
    const desired = { x: move.x, z: move.z };

    // 1. balance first: it decides whether the legs still obey
    const b = this.balance.update(dt, {
      onIce: this.onIce, sprint, speed: this.body.speed, turnCos: this.body.turnCos(desired), carry: this.carry,
    });
    for (const e of b.events) {
      if (e === 'wobble') {
        const velocity = this.body.vel;
        this.spinDirection = Math.sign(velocity.z * desired.x - velocity.x * desired.z) || 1;
      }
      if (e === 'fall' || e === 'drop') this.dropTop();
      for (const f of this.onBalance) f(this, e);
    }

    // 2. sliding movement
    const locked = this.balance.locked;
    const step = this.body.update(dt, desired, sprint ? Player.SPRINT : Player.WALK, this.onIce, locked);
    const bx = pos.x, bz = pos.z;
    pos.x += step.x; pos.z += step.z;
    pushOut(pos, Player.RADIUS, this.colliders);
    const mx = pos.x - bx, mz = pos.z - bz;
    if (dt > 0 && Math.hypot(mx - step.x, mz - step.z) > 1e-6) {   // hit a wall: keep only the sliding part
      this.body.vel.x = mx / dt; this.body.vel.z = mz / dt;
    }
    const moved = Math.hypot(mx, mz);
    this.stride += moved;
    // footsteps only while the legs move (gliding on ice with no input is silent)
    if (!locked && move.lengthSq() > 1e-12 && this.stride > (sprint ? 1.25 : 0.75)) {
      this.stride = 0;
      for (const f of this.onStep) f(this);
    }

    // 3. facing: turn toward the input (the body may still slide the other way on ice)
    const hasInput = move.lengthSq() > 1e-12;
    if (this.balance.state === 'FALLEN' && this.onIce) {
      const fade = Math.max(0, 1 - this.balance.timer / Balance.FALL_TIME);
      this.obj.rotation.y += this.spinDirection * this.body.speed * fade * dt;
    } else if (hasInput && !locked) {
      this.obj.rotation.y = turnToward(this.obj.rotation.y, headingOf(move), Player.TURN, dt);
      this.lookAt = null;
    }

    // 4. tilt around the feet + the gift tower
    this.tilt.rotation.set(b.pitchX, 0, b.swayZ);
    this.gifts.update(this.balance.clock, b.swayZ);
    this.alert.visible = this.balance.state === 'WOBBLE' || this.carry >= 4;

    // 5. gifts in the air
    this.falling = this.falling.filter((fg) => {
      const r = fg.update(dt);
      if (r === 'hit') for (const f of this.onGiftBreak) f(this, fg.mesh.position.clone());
      if (!r) this.scene.remove(fg.mesh);
      return r;
    });

    // 6. animation
    const speed = this.body.speed;
    let clip;
    if (locked) clip = 'fall';
    else if (hasInput && speed > 0.3) {
      clip = sprint ? 'sprint' : 'walk';
      if (this.carry > 0) clip = 'carry-' + clip;
    }
    else clip = this.carry > 0 ? 'holding-both' : 'idle';   // sliding with no input: stand still and glide
    if (this.emote > 0) { this.emote -= dt; if (hasInput) this.emote = 0; }
    if (this.emote <= 0) this.anim.play(clip);
    this.anim.update(dt);
  }
}
