// Sliding movement on ice and the balance state machine.
// Pure math on plain {x, z} objects (no three.js), so dev/test_spike.mjs can test it in Node.
//
// SlideBody: the velocity no longer jumps to "input x speed". It eases toward it,
//   v += (target - v) * (1 - e^(-k dt))
// with a large k on snow (grip, feels like the starter pack) and a small k on ice
// (inertia: you keep sliding, turning takes time).
//
// Balance (state machine, same pattern as the Dog in actors.js):
//
//   STEADY --sharp turn while sprinting--> WOBBLE --Shift released in time--> STEADY
//                                                   |
//                                                   +--window over, still sprinting--> FALLEN --> GETUP --> STEADY
//
//   carrying 3 gifts: constant small sway, and WOBBLE starts more easily
//   carrying 4 or more: big sway, and every OVERLOAD_TIME the top gift falls off ('drop' event)

export const GRIP = { snow: 2.2, snowStop: 0.9, ice: 0.9, iceStop: 0.23, fallen: 2.0 };   // 1/s

export class SlideBody {
  static ICE_SPEED_FACTOR = 1.2;

  constructor() { this.vel = { x: 0, z: 0 }; }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  // desired: unit {x, z} or {0, 0}; returns the displacement for this frame
  update(dt, desired, maxSpeed, onIce, locked = false) {
    const hasInput = !locked && (desired.x !== 0 || desired.z !== 0);
    const targetSpeed = onIce ? maxSpeed * SlideBody.ICE_SPEED_FACTOR : maxSpeed;
    const tx = hasInput ? desired.x * targetSpeed : 0;
    const tz = hasInput ? desired.z * targetSpeed : 0;
    let k;
    if (locked) k = onIce ? GRIP.iceStop : GRIP.fallen;
    else if (onIce) k = hasInput ? GRIP.ice : GRIP.iceStop;
    else k = hasInput ? GRIP.snow : GRIP.snowStop;
    const a = 1 - Math.exp(-k * dt);
    this.vel.x += (tx - this.vel.x) * a;
    this.vel.z += (tz - this.vel.z) * a;
    if (!hasInput && this.speed < 0.02) { this.vel.x = 0; this.vel.z = 0; }
    return { x: this.vel.x * dt, z: this.vel.z * dt };
  }

  // cosine of the angle between where we are sliding and where the player wants to go
  // (1 = same way, 0 = 90° turn, -1 = U-turn). null when there is nothing to compare.
  turnCos(desired) {
    const s = this.speed;
    if (s < 0.1 || (desired.x === 0 && desired.z === 0)) return null;
    return (this.vel.x * desired.x + this.vel.z * desired.z) / s;
  }
}

export class Balance {
  // [minimum speed m/s, turn cosine limit] that starts a wobble, by how many gifts are carried
  static FALL_TIME = 4.0;
  static SURFACE_TRIGGER = { snow: [4.5, -0.3], white: [3.5, 0.2], colored: [2.5, 0.7] };
  static SURFACE_WINDOW = { snow: 1.2, white: 0.8, colored: 0.5 };
  static GETUP_TIME = 0.5;
  static OVERLOAD_TIME = 1.5;                   // s between drops when carrying 4 or more
  static SWAY = { 0: 0, 3: 0.07, 4: 0.14 };     // rad, idle sway amplitude by load
  static WOBBLE_SWAY = 0.35;                    // rad
  static FALL_ANGLE = 1.35;                     // rad, lying forward

  constructor() {
    this.state = 'STEADY';
    this.timer = 0;
    this.clock = 0;
    this.overload = 0;
    this.recovered = 0;       // counters for the success criteria (10 tries)
    this.fell = 0;
    this.wobbleWindow = Balance.SURFACE_WINDOW.snow;
  }
  get locked() { return this.state === 'FALLEN' || this.state === 'GETUP'; }
  setState(s) { this.state = s; this.timer = 0; }

  // returns { swayZ, pitchX, events } ; events: 'wobble', 'recover', 'fall', 'drop', 'getup'
  update(dt, { iceType = 'snow', sprint, speed, turnCos, carry }) {
    this.clock += dt;
    this.timer += dt;
    const events = [];
    const heavy = carry >= 3;
    const surface = Balance.SURFACE_TRIGGER[iceType] ? iceType : 'snow';

    switch (this.state) {
      case 'STEADY': {
        const [baseSpeed, baseCos] = Balance.SURFACE_TRIGGER[surface];
        const minSpeed = baseSpeed - (heavy ? 0.5 : 0);
        const cosLimit = Math.min(0.95, baseCos + (heavy ? 0.15 : 0));
        if (sprint && speed > minSpeed && turnCos !== null && turnCos < cosLimit) {
          this.wobbleWindow = Balance.SURFACE_WINDOW[surface] * (heavy ? 0.8 : 1);
          this.setState('WOBBLE');
          events.push('wobble');
        }
        break;
      }
      case 'WOBBLE':
        if (!sprint) {
          this.setState('STEADY');
          this.recovered++;
          events.push('recover');
        } else if (this.timer > this.wobbleWindow) { this.setState('FALLEN'); this.fell++; events.push('fall'); }
        break;
      case 'FALLEN':
        if (this.timer > Balance.FALL_TIME) { this.setState('GETUP'); events.push('getup'); }
        break;
      case 'GETUP':
        if (this.timer > Balance.GETUP_TIME) this.setState('STEADY');
        break;
    }

    // too many gifts: the top one slips off every OVERLOAD_TIME seconds
    if (carry >= 4 && !this.locked) {
      this.overload += dt;
      if (this.overload > Balance.OVERLOAD_TIME) { this.overload = 0; events.push('drop'); }
    } else this.overload = 0;

    // tilt of the body around the feet (applied in santa.js as a rotation of the pivot group)
    const idleAmp = Balance.SWAY[carry >= 4 ? 4 : carry >= 3 ? 3 : 0];
    let swayZ = idleAmp * Math.sin(this.clock * 5.0);
    let pitchX = 0;
    if (this.state === 'WOBBLE') {
      swayZ = Balance.WOBBLE_SWAY * Math.sin(this.clock * 11.0);
      pitchX = 0.12 * Math.sin(this.clock * 7.0);
    } else if (this.state === 'FALLEN') {
      pitchX = Balance.FALL_ANGLE * smooth(this.timer / 0.35);
      swayZ = 0;
    } else if (this.state === 'GETUP') {
      pitchX = Balance.FALL_ANGLE * (1 - smooth(this.timer / Balance.GETUP_TIME));
      swayZ = 0;
    }
    return { swayZ, pitchX, events };
  }
}

function smooth(x) { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }
