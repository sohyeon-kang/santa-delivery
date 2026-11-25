// The player character and a dog that greets the player and plays fetch.
// Same states and numbers as python/actors.py (W13 state machine):
//
//   WANDER --player within notice radius--> NOTICE --> APPROACH --close--> GREET --> FOLLOW
//      ^                                                                             |
//      +-------------------------- player farther than leave radius ------------------+
//
//   ball thrown (from any state, if the player is near) --> CHASE --> RETURN --> DROP --> FOLLOW
//
// Events use the observer pattern (W13): the dog calls onGreet when it starts a
// greeting, the player calls onThrow when the ball leaves the hand. main.js
// connects them: the player waves back, and the dog runs after the ball.
import * as THREE from 'three';
import { pushOut } from './physics.js';

export function turnToward(heading, target, rate, dt) {
  let d = (target - heading + Math.PI) % (2 * Math.PI);
  if (d < 0) d += 2 * Math.PI;
  d -= Math.PI;
  const step = rate * dt;
  return Math.abs(d) <= step ? target : heading + Math.sign(d) * step;
}

// heading whose forward (+Z of the model) points along v on the ground
export const headingOf = (v) => Math.atan2(v.x, v.z);
const forward = (h) => new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
const smoothstep = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Wraps an AnimationMixer so that play(name) cross-fades like python/gltf.py Animator.
export class Animator {
  constructor(root, clips) {
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    for (const c of clips) this.actions[c.name] = this.mixer.clipAction(c);
    this.current = null;
  }
  has(name) { return name in this.actions; }
  play(name, { fade = 0.2, loop = true, restart = false } = {}) {
    const next = this.actions[name];
    if (!next || (next === this.current && !restart)) return;
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.play();
    if (this.current && this.current !== next) this.current.crossFadeTo(next, fade, false);
    this.current = next;
  }
  duration(name) { return this.actions[name].getClip().duration; }
  update(dt) { this.mixer.update(dt); }
}

export class Player {
  static WALK = 2.2; static SPRINT = 5.0; static TURN = 10.0;
  static RADIUS = 0.35;                 // m, for collision
  static THROW_SPEED = [5.5, 3.5];      // m/s forward, up

  constructor(obj, anim, colliders = []) {
    this.obj = obj;
    this.anim = anim;
    this.colliders = colliders;
    this.anim.play('idle');
    this.emote = 0;          // seconds left in a one-shot emote
    this.lookAt = null;      // point to turn toward while standing still
    this.onThrow = [];       // observers: f(player)
    this.onStep = [];        // observers: f(player), once per footstep
    this.stride = 0;
  }
  get pos() { return this.obj.position; }

  oneShot(clip, repeat = 1) {
    if (!this.anim.has(clip)) return;
    this.anim.play(clip, { fade: 0.1, loop: false, restart: true });
    this.emote = this.anim.duration(clip) * repeat;
  }
  wave(toward = null) {
    this.oneShot('emote-yes', 2);
    this.lookAt = toward ? toward.clone() : null;
  }
  // turn to `direction` (ground vector) and throw the ball
  throw(ball, direction) {
    const d = direction.clone().setY(0).normalize();
    this.obj.rotation.y = headingOf(d);
    this.lookAt = null;
    this.oneShot('interact-right', 2);
    const start = this.pos.clone().addScaledVector(d, 0.4).add(new THREE.Vector3(0, 1.1, 0));
    ball.throw(start, d.clone().multiplyScalar(Player.THROW_SPEED[0]).setY(Player.THROW_SPEED[1]));
    for (const f of this.onThrow) f(this);
  }

  update(dt, move, sprint) {
    let speed = 0;
    if (move.lengthSq() > 1e-12) {
      speed = sprint ? Player.SPRINT : Player.WALK;
      const bx = this.obj.position.x, bz = this.obj.position.z;
      this.obj.position.addScaledVector(move, speed * dt);
      pushOut(this.obj.position, Player.RADIUS, this.colliders);
      this.stride += Math.hypot(this.obj.position.x - bx, this.obj.position.z - bz);
      if (this.stride > (sprint ? 1.25 : 0.75)) {          // metres between footsteps
        this.stride = 0;
        for (const f of this.onStep) f(this);
      }
      this.obj.rotation.y = turnToward(this.obj.rotation.y, headingOf(move), Player.TURN, dt);
      this.lookAt = null;
    } else if (this.lookAt) {
      const d = this.lookAt.clone().sub(this.obj.position);
      this.obj.rotation.y = turnToward(this.obj.rotation.y, headingOf(d), Player.TURN * 0.5, dt);
    }
    if (this.emote > 0) {
      this.emote -= dt;
      if (speed > 0) this.emote = 0;
    }
    if (this.emote <= 0) this.anim.play(speed === 0 ? 'idle' : sprint ? 'sprint' : 'walk');
    this.anim.update(dt);
  }
}

// small deterministic random numbers, so test runs repeat
function makeRng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export class Dog {
  static NOTICE_RADIUS = 6.0;    // starts paying attention inside this distance
  static GREET_DISTANCE = 1.5;   // stops this close to the player and greets
  static FOLLOW_DISTANCE = 2.4;  // in FOLLOW, catches up when the player is farther than this
  static LEAVE_RADIUS = 11.0;    // gives up and goes home beyond this distance
  static WALK = 1.0; static RUN = 4.2; static TURN = 7.0;
  static RADIUS = 0.3;           // m, for collision
  static HOP_TIME = 1.0;         // greeting part 1: three happy hops
  static SPIN_TIME = 1.2;        // greeting part 2: dance and spin once
  static GREET_TIME = 2.6;       // whole greeting, then FOLLOW
  static HOP_HEIGHT = 0.3;       // m
  static PICK_DISTANCE = 0.55;   // mouth reaches the ball within this distance
  static DROP_TIME = 1.0;        // wag after dropping the ball
  static MOUTH = [0.0, 0.42, 0.42];  // ball position in the dog's frame (right, up, forward), m

  constructor(obj, anim, home, wanderRadius = 4, colliders = [], seed = 1) {
    this.obj = obj;
    this.anim = anim;
    this.home = new THREE.Vector3(...home);
    this.wanderRadius = wanderRadius;
    this.colliders = colliders;
    this.rand = makeRng(seed);
    this.state = 'WANDER';
    this.timer = 0;
    this.goal = null;
    this.hop = 0;
    this.greeted = false;        // greet once per visit, not every time it catches up
    this.restFor = 2;
    this.greetHeading = 0;
    this.ball = null;            // the ball being chased or carried
    this.onGreet = [];           // observers: f(dog)
    this.onBark = [];            // observers: f(dog)
    this.anim.play('idle');
  }
  get pos() { return this.obj.position; }
  setState(s) {
    this.state = s; this.timer = 0;
    if (s === 'NOTICE' || s === 'DROP') this.bark();   // a bark when it spots you and when it brings the ball
  }
  bark() { for (const f of this.onBark) f(this); }

  mouth() {
    const f = forward(this.obj.rotation.y);
    const r = new THREE.Vector3(f.z, 0, -f.x);
    const [mr, mu, mf] = Dog.MOUTH;
    return this.obj.position.clone().addScaledVector(r, mr).add(new THREE.Vector3(0, mu, 0)).addScaledVector(f, mf);
  }

  moveTo(target, speed, dt, stop = 0.05) {
    const d = new THREE.Vector3().subVectors(target, this.obj.position).setY(0);
    const dist = d.length();
    if (dist <= stop + 0.05) return true;   // small tolerance: the target may be moving
    this.obj.rotation.y = turnToward(this.obj.rotation.y, headingOf(d), Dog.TURN, dt);
    // move mostly forward so the dog curves instead of sliding sideways
    const fwd = forward(this.obj.rotation.y);
    const step = Math.min(speed * dt, dist - stop);
    this.obj.position.addScaledVector(fwd, step * Math.max(0.2, fwd.dot(d.divideScalar(dist))));
    pushOut(this.obj.position, Dog.RADIUS, this.colliders);
    return false;
  }
  face(target, dt) {
    const d = new THREE.Vector3().subVectors(target, this.obj.position);
    this.obj.rotation.y = turnToward(this.obj.rotation.y, headingOf(d), Dog.TURN, dt);
  }
  startGreeting(playerPos) {
    this.setState('GREET');
    this.greetHeading = headingOf(playerPos.clone().sub(this.obj.position));
    this.anim.play('gesture-positive', { fade: 0.1 });
    this.bark();
    for (const f of this.onGreet) f(this);
  }
  // observer callback: the player threw the ball
  ballThrown(ball, playerPos) {
    if (flatDist(playerPos, this.obj.position) < Dog.LEAVE_RADIUS && !['CHASE', 'RETURN'].includes(this.state)) {
      this.ball = ball;
      this.greeted = true;       // playing counts as having said hello
      this.setState('CHASE');
    }
  }

  update(dt, playerPos) {
    this.timer += dt;
    const dist = flatDist(playerPos, this.obj.position);
    this.hop = 0;

    switch (this.state) {
      case 'WANDER':
        if (dist < Dog.NOTICE_RADIUS) { this.setState('NOTICE'); break; }
        if (this.goal === null && flatDist(this.obj.position, this.home) > this.wanderRadius + 1) {
          this.goal = this.home.clone();                // far from home: walk back first
        } else if (this.goal === null) {                // resting
          this.anim.play('idle');
          if (this.timer > this.restFor) {
            const a = this.rand() * 2 * Math.PI, r = this.wanderRadius * Math.sqrt(this.rand());
            this.goal = this.home.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
            this.timer = 0;
            this.restFor = 1.5 + 2 * this.rand();
          }
        } else {                                        // trotting to a random spot
          this.anim.play('walk');
          if (this.moveTo(this.goal, Dog.WALK, dt) || this.timer > 8) { this.goal = null; this.timer = 0; }
        }
        break;

      case 'NOTICE':                                    // stop, turn, look
        this.anim.play('idle', { fade: 0.1 });
        this.face(playerPos, dt);
        if (this.timer > 0.5) this.setState('APPROACH');
        break;

      case 'APPROACH':
        this.anim.play('run');
        if (dist > Dog.LEAVE_RADIUS) this.setState('WANDER');
        else if (this.moveTo(playerPos, Dog.RUN, dt, Dog.GREET_DISTANCE)) {
          if (this.greeted) this.setState('FOLLOW'); else this.startGreeting(playerPos);
        }
        break;

      case 'GREET': {
        const t = this.timer;
        if (t < Dog.HOP_TIME) {                         // three hops, wagging
          this.anim.play('gesture-positive', { fade: 0.1 });
          this.hop = Math.abs(Math.sin(Math.PI * 3 * t / Dog.HOP_TIME)) * Dog.HOP_HEIGHT;
          this.obj.rotation.y = this.greetHeading;
        } else if (t < Dog.HOP_TIME + Dog.SPIN_TIME) {  // dance and spin once
          if (t - dt < Dog.HOP_TIME) this.bark();       // one more happy bark as the spin starts
          this.anim.play('dance', { fade: 0.15 });
          this.obj.rotation.y = this.greetHeading + 2 * Math.PI * smoothstep((t - Dog.HOP_TIME) / Dog.SPIN_TIME);
        } else {                                        // sit still and look up
          this.anim.play('idle', { fade: 0.2 });
          this.obj.rotation.y = this.greetHeading;
        }
        if (t > Dog.GREET_TIME) { this.greeted = true; this.setState('FOLLOW'); }
        break;
      }

      case 'FOLLOW':
        if (dist > Dog.LEAVE_RADIUS) {
          this.greeted = false; this.goal = null; this.setState('WANDER');
        } else if (dist > Dog.FOLLOW_DISTANCE) {
          const fast = dist > 2 * Dog.FOLLOW_DISTANCE;
          this.anim.play(fast ? 'run' : 'walk');
          this.moveTo(playerPos, fast ? Dog.RUN : Dog.WALK * 2.2, dt, Dog.GREET_DISTANCE);
        } else {
          this.anim.play('idle');
          this.face(playerPos, dt);
        }
        break;

      case 'CHASE': {                                   // run to where the ball is now
        this.anim.play('run');
        const b = this.ball, d = flatDist(b.pos, this.obj.position);
        if (b.resting && d < Dog.PICK_DISTANCE) this.setState('RETURN');   // got it
        else this.moveTo(b.pos, d > 1.5 ? Dog.RUN : Dog.RUN * 0.6, dt, Dog.PICK_DISTANCE - 0.15);
        if (this.timer > 15) { this.ball = null; this.setState('FOLLOW'); }   // out of reach
        break;
      }

      case 'RETURN':                                    // carry it back
        this.anim.play('run');
        if (this.moveTo(playerPos, Dog.RUN, dt, Dog.GREET_DISTANCE)) {
          this.setState('DROP');
          this.ball.dropAt(this.mouth());
          this.anim.play('gesture-positive', { fade: 0.1 });
        }
        break;

      case 'DROP':                                      // proud wiggle, then follow
        this.face(playerPos, dt);
        this.hop = Math.abs(Math.sin(Math.PI * 2 * this.timer / Dog.DROP_TIME)) * Dog.HOP_HEIGHT * 0.5;
        if (this.timer > Dog.DROP_TIME) { this.ball = null; this.setState('FOLLOW'); }
        break;
    }
    this.obj.position.y = this.hop;
    if (this.state === 'RETURN') this.ball.holdAt(this.mouth());
    this.anim.update(dt);
  }
}
