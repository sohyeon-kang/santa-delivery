// Collision, a bouncing ball, and mouse picking with rays.
// Same rules and numbers as python/physics.py.
//
// Colliders live on the ground plane (x, z), because characters only walk:
//   { type: 'box', lo: [x, z], hi: [x, z], height }      from an AABB (houses, cars, fences)
//   { type: 'circle', c: [x, z], r, height }            a trunk (trees)
import * as THREE from 'three';

// models that never block anyone (flat or tiny)
const SKIP = ['flower', 'grass', 'plant', 'mushroom', 'path', 'driveway', 'ground', 'lily', 'crop', 'road', 'tile'];
// models where only a thin trunk or pole at the model origin blocks: [name part, radius in m]
const POLES = [['tree', 0.35], ['light', 0.2], ['sign', 0.15], ['parasol', 0.15], ['pole', 0.2]];

export function makeCollider(name, box, pos) {
  const height = box.max.y - box.min.y;
  if (SKIP.some((k) => name.includes(k)) || height < 0.4) return null;
  for (const [part, r] of POLES) {             // wide canopy or arm, only the pole blocks
    if (name.includes(part)) return { type: 'circle', c: [pos.x, pos.z], r, height };
  }
  return { type: 'box', lo: [box.min.x, box.min.z], hi: [box.max.x, box.max.z], height };
}

// Move a circle (pos.xz, radius) out of every collider. Sliding along walls comes
// for free: only the component into the wall is removed.
export function pushOut(pos, radius, colliders) {
  let px = pos.x, pz = pos.z;
  for (const c of colliders) {
    if (c.type === 'box') {
      const qx = Math.min(Math.max(px, c.lo[0]), c.hi[0]);   // closest point of the box
      const qz = Math.min(Math.max(pz, c.lo[1]), c.hi[1]);
      const dx = px - qx, dz = pz - qz;
      const dist = Math.hypot(dx, dz);
      if (dist >= radius) continue;
      if (dist > 1e-9) {                        // outside the box, but too close
        px = qx + (dx / dist) * radius; pz = qz + (dz / dist) * radius;
      } else {                                  // centre inside: leave by the nearest side
        const gaps = [px - c.lo[0], c.hi[0] - px, pz - c.lo[1], c.hi[1] - pz];
        const k = gaps.indexOf(Math.min(...gaps));
        if (k === 0) px = c.lo[0] - radius;
        else if (k === 1) px = c.hi[0] + radius;
        else if (k === 2) pz = c.lo[1] - radius;
        else pz = c.hi[1] + radius;
      }
    } else {
      const dx = px - c.c[0], dz = pz - c.c[1];
      const dist = Math.hypot(dx, dz);
      if (dist < c.r + radius) {
        const nx = dist > 1e-9 ? dx / dist : 1, nz = dist > 1e-9 ? dz / dist : 0;
        px = c.c[0] + nx * (c.r + radius); pz = c.c[1] + nz * (c.r + radius);
      }
    }
  }
  pos.x = px; pos.z = pz;
  return pos;
}

export class Ball {
  static RADIUS = 0.18;      // m
  static GRAVITY = 9.8;      // m/s^2
  static BOUNCE = 0.55;      // restitution on the ground
  static WALL_BOUNCE = 0.5;  // restitution on walls
  static ROLL_DRAG = 2.5;    // 1/s, rolling friction while on the ground

  constructor(mesh) {
    this.mesh = mesh;          // the sphere that gets drawn
    this.vel = new THREE.Vector3();
    this.held = true;          // in someone's hand or mouth: physics off
    this.onHit = [];           // observers: f(ball, kind, speed), kind is 'ground' or 'wall'
    mesh.position.set(0, -10, 0);
  }
  get pos() { return this.mesh.position; }
  get speed() { return this.vel.length(); }
  get resting() { return !this.held && this.pos.y <= Ball.RADIUS + 1e-3 && this.speed < 0.6; }

  throw(start, velocity) { this.pos.copy(start); this.vel.copy(velocity); this.held = false; }
  holdAt(p) { this.held = true; this.vel.set(0, 0, 0); this.pos.copy(p); }
  dropAt(p) { this.held = false; this.vel.set(0, 0, 0); this.pos.set(p.x, Ball.RADIUS, p.z); }

  update(dt, colliders) {
    if (this.held) return;
    // semi-implicit Euler: update velocity first, then position
    this.vel.y -= Ball.GRAVITY * dt;
    this.pos.addScaledVector(this.vel, dt);
    const p = this.pos;
    if (p.y < Ball.RADIUS) {                       // ground
      p.y = Ball.RADIUS;
      if (this.vel.y < 0) {
        if (this.vel.y < -0.8) for (const f of this.onHit) f(this, 'ground', -this.vel.y);
        this.vel.y = -this.vel.y * Ball.BOUNCE;
        if (this.vel.y < 0.4) this.vel.y = 0;
      }
    }
    if (p.y <= Ball.RADIUS + 1e-3) {               // rolling
      const k = Math.exp(-Ball.ROLL_DRAG * dt);
      this.vel.x *= k; this.vel.z *= k;
      if (Math.hypot(this.vel.x, this.vel.z) < 0.05) { this.vel.x = 0; this.vel.z = 0; }
    }
    for (const c of colliders) {                   // walls: push out and reflect
      if (p.y > c.height) continue;
      const bx = p.x, bz = p.z;
      pushOut(p, Ball.RADIUS, [c]);
      const mx = p.x - bx, mz = p.z - bz, n = Math.hypot(mx, mz);
      if (n > 1e-9) {
        const nx = mx / n, nz = mz / n, vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) {
          if (vn < -0.8) for (const f of this.onHit) f(this, 'wall', -vn);
          this.vel.x -= (1 + Ball.WALL_BOUNCE) * vn * nx;
          this.vel.z -= (1 + Ball.WALL_BOUNCE) * vn * nz;
        }
      }
    }
  }
}

// ------------------------------------------------------------ picking
// World-space ray through pixel (mx, my). Pixel y grows downward.
export function mouseRay(mx, my, width, height, camera) {
  const ndc = new THREE.Vector2((2 * mx) / width - 1, 1 - (2 * my) / height);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  return ray.ray;
}

// Slab method: distance to the first hit, or null (THREE.Ray.intersectBox does the same).
export function rayAABB(ray, box) {
  const hit = ray.intersectBox(box, new THREE.Vector3());
  return hit ? hit.distanceTo(ray.origin) : null;
}

export function rayGround(ray) {
  if (Math.abs(ray.direction.y) < 1e-9) return null;
  const t = -ray.origin.y / ray.direction.y;
  return t > 0 ? t : null;
}
