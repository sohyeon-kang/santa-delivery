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

const GIFT = 0.3;                                   // m, box edge
const GIFT_COLORS = ['#d7263d', '#1b998b', '#f4b400', '#3f51b5', '#e8e8f0'];
const giftGeo = new THREE.BoxGeometry(GIFT, GIFT, GIFT);
const ribbonGeoA = new THREE.BoxGeometry(GIFT * 1.02, GIFT * 1.02, GIFT * 0.18);
const ribbonGeoB = new THREE.BoxGeometry(GIFT * 0.18, GIFT * 1.02, GIFT * 1.02);
const ribbonMat = new THREE.MeshStandardMaterial({ color: '#fff3c4', roughness: 0.4 });

export function makeGift(i) {
  const g = new THREE.Mesh(giftGeo, new THREE.MeshStandardMaterial({ color: GIFT_COLORS[i % GIFT_COLORS.length], roughness: 0.6 }));
  g.add(new THREE.Mesh(ribbonGeoA, ribbonMat), new THREE.Mesh(ribbonGeoB, ribbonMat));
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
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
  static BASE = new THREE.Vector3(0, 0.95, 0.36);   // first gift, in the tilt frame (m)
  constructor(tilt) { this.tilt = tilt; this.boxes = []; this.made = 0; }
  get count() { return this.boxes.length; }
  add() {
    const g = makeGift(this.made++);
    const parent = this.boxes.length ? this.boxes[this.boxes.length - 1] : this.tilt;
    if (this.boxes.length) g.position.set(0, GIFT, 0); else g.position.copy(GiftStack.BASE);
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
    if (this.mesh.position.y < GIFT / 2) { this.mesh.position.y = GIFT / 2; this.broken = 1e-6; return 'hit'; }
    return true;
  }
}

export class SantaPlayer extends Player {
  constructor(rig, tilt, anim, colliders, scene) {
    super(rig, anim, colliders);
    this.tilt = tilt;
    this.scene = scene;
    this.body = new SlideBody();
    this.balance = new Balance();
    this.gifts = new GiftStack(tilt);
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
    if (hasInput && !locked) {
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
    else if (hasInput && speed > 0.3) clip = sprint ? 'sprint' : 'walk';
    else clip = this.carry > 0 ? 'holding-both' : 'idle';   // sliding with no input: stand still and glide
    if (this.emote > 0) { this.emote -= dt; if (hasInput) this.emote = 0; }
    if (this.emote <= 0) this.anim.play(clip);
    this.anim.update(dt);
  }
}
