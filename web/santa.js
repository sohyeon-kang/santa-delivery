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
import { SlideBody, Balance } from './slide.js?v=details-20261128-4';
import { iceSurface } from './ice.js?v=park-ice-20261128-4';

export const SANTA_SCALE = 1.0;
const GIFT_SCALE = 2.0;

// Visible models are scaled independently of the gift hierarchy.
const giftSizes = [[0.48, 0.22, 0.36], [0.30, 0.36, 0.28],
  [0.40, 0.18, 0.30], [0.26, 0.30, 0.24], [0.32, 0.24, 0.26]];
let giftModels;
export function setGiftModels(models) { giftModels = models; }

export function makeGift(i) {
  const index = i % giftModels.length;
  const model = giftModels[index].clone(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  const [width, height, depth] = giftSizes[index].map(size => size * GIFT_SCALE);
  const visual = new THREE.Group();
  model.position.sub(centre);
  visual.add(model);
  visual.scale.set(width / size.x, height / size.y, depth / size.z);
  model.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  const gift = new THREE.Group();
  gift.add(visual);
  gift.userData.halfHeight = height / 2;
  return gift;
}

export class GiftStack {
  static BASE = new THREE.Vector3(0, 0.69, 0.68).multiplyScalar(SANTA_SCALE);   // bottom of stack, in the tilt frame (m)
  constructor(grip) { this.grip = grip; this.boxes = []; }
  get count() { return this.boxes.length; }
  add(g) {
    g.position.set(0, 0, 0);
    g.rotation.set(0, 0, 0);
    const parent = this.boxes.length ? this.boxes[this.boxes.length - 1] : this.grip;
    if (this.boxes.length) {
      g.position.y = parent.userData.halfHeight + g.userData.halfHeight;
    } else {
      g.position.copy(GiftStack.BASE);
      g.position.y += g.userData.halfHeight;
      // Keep the back edge at the hands as the parcel grows forward.
      g.position.z += 0.18 * (GIFT_SCALE - SANTA_SCALE);
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
    this.onBalance = [];      // observers: f(player, event) with event 'wobble' 'recover' 'fall' 'getup' 'drop'
    this.onGiftBreak = [];    // observers: f(player, position, giftId)
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
    const iceType = iceSurface(pos.x, pos.z);
    this.onIce = iceType !== 'snow';
    const desired = { x: move.x, z: move.z };

    // 1. balance first: it decides whether the legs still obey
    const b = this.balance.update(dt, {
      iceType, sprint, speed: this.body.speed, turnCos: this.body.turnCos(desired), carry: this.carry,
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
    pushOut(pos, Player.RADIUS * SANTA_SCALE, this.colliders);
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
    if (this.balance.state === 'FALLEN') {
      const fade = Math.max(0, 1 - this.balance.timer / Balance.FALL_TIME);
      this.obj.rotation.y += this.spinDirection * this.body.speed * fade * dt;
    } else if (hasInput && !locked) {
      this.obj.rotation.y = turnToward(this.obj.rotation.y, headingOf(move), Player.TURN, dt);
      this.lookAt = null;
    }

    // 4. tilt around the feet + the gift tower
    this.tilt.rotation.set(b.pitchX, 0, b.swayZ);
    this.gifts.update(this.balance.clock, b.swayZ);

    // 5. gifts in the air
    this.falling = this.falling.filter((fg) => {
      const r = fg.update(dt);
      if (r === 'hit') for (const f of this.onGiftBreak) f(this, fg.mesh.position.clone(), fg.mesh.userData.giftId);
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
