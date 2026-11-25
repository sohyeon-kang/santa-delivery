"""Collision, a bouncing ball, and mouse picking with rays.

Colliders live on the ground plane (x, z), because characters only walk:
  ("box", lo, hi, height)       axis-aligned rectangle, from an AABB (houses, cars, fences)
  ("circle", center, r, height) a trunk (trees) or a small round thing
The three.js track (web/physics.js) uses the same rules and numbers.
"""
import math

import numpy as np

# models that never block anyone (flat or tiny)
SKIP = ("flower", "grass", "plant", "mushroom", "path", "driveway", "ground", "lily", "crop", "road", "tile")
# models where only a thin trunk or pole at the model origin blocks: (name part, radius in m)
POLES = (("tree", 0.35), ("light", 0.2), ("sign", 0.15), ("parasol", 0.15), ("pole", 0.2))


def make_collider(name, lo, hi, pos):
    """Pick a collider shape from the model name, its world AABB and its position."""
    height = hi[1] - lo[1]
    if any(k in name for k in SKIP) or height < 0.4:
        return None
    for part, r in POLES:                      # wide canopy or arm, only the pole blocks
        if part in name:
            return ("circle", np.array([pos[0], pos[2]]), r, height)
    return ("box", np.array([lo[0], lo[2]]), np.array([hi[0], hi[2]]), height)


def push_out(pos, radius, colliders):
    """Move a circle (pos.xz, radius) out of every collider. Sliding along walls
    comes for free: only the component into the wall is removed."""
    p = np.array([pos[0], pos[2]])
    for c in colliders:
        if c[0] == "box":
            lo, hi = c[1], c[2]
            q = np.clip(p, lo, hi)             # closest point of the box
            d = p - q
            dist = float(np.hypot(*d))
            if dist >= radius:
                continue
            if dist > 1e-9:                    # outside the box, but too close
                p = q + d / dist * radius
            else:                              # centre inside: leave by the nearest side
                gaps = [p[0] - lo[0], hi[0] - p[0], p[1] - lo[1], hi[1] - p[1]]
                k = int(np.argmin(gaps))
                if k == 0: p[0] = lo[0] - radius
                elif k == 1: p[0] = hi[0] + radius
                elif k == 2: p[1] = lo[1] - radius
                else: p[1] = hi[1] + radius
        else:
            center, r = c[1], c[2]
            d = p - center
            dist = float(np.hypot(*d))
            if dist < r + radius:
                n = d / dist if dist > 1e-9 else np.array([1.0, 0.0])
                p = center + n * (r + radius)
    pos[0], pos[2] = p[0], p[1]
    return pos


class Ball:
    RADIUS = 0.18            # m
    GRAVITY = 9.8            # m/s^2
    BOUNCE = 0.55            # restitution on the ground
    WALL_BOUNCE = 0.5        # restitution on walls
    ROLL_DRAG = 2.5          # 1/s, rolling friction while on the ground

    def __init__(self, inst):
        self.inst = inst         # the sphere instance that gets drawn
        self.vel = np.zeros(3)
        self.held = True         # in someone's hand or mouth: physics off
        self.on_hit = []         # observers: f(ball, kind, speed), kind is "ground" or "wall"
        self.inst.pos[:] = (0, -10, 0)

    @property
    def pos(self):
        return self.inst.pos

    @property
    def speed(self):
        return float(np.linalg.norm(self.vel))

    @property
    def resting(self):
        return not self.held and self.pos[1] <= self.RADIUS + 1e-3 and self.speed < 0.6

    def throw(self, start, velocity):
        self.inst.pos[:] = start
        self.vel = np.array(velocity, float)
        self.held = False

    def hold_at(self, p):
        self.held = True
        self.vel[:] = 0
        self.inst.pos[:] = p

    def drop_at(self, p):
        self.held = False
        self.vel[:] = 0
        self.inst.pos[:] = (p[0], self.RADIUS, p[2])

    def update(self, dt, colliders):
        if self.held:
            return
        # semi-implicit Euler: update velocity first, then position
        self.vel[1] -= self.GRAVITY * dt
        self.inst.pos += self.vel * dt
        p = self.inst.pos
        if p[1] < self.RADIUS:                         # ground
            p[1] = self.RADIUS
            if self.vel[1] < 0:
                if self.vel[1] < -0.8:
                    for f in self.on_hit:
                        f(self, "ground", -self.vel[1])
                self.vel[1] = -self.vel[1] * self.BOUNCE
                if self.vel[1] < 0.4:
                    self.vel[1] = 0.0
        if p[1] <= self.RADIUS + 1e-3:                 # rolling
            self.vel[[0, 2]] *= math.exp(-self.ROLL_DRAG * dt)
            if np.hypot(self.vel[0], self.vel[2]) < 0.05:
                self.vel[[0, 2]] = 0.0
        for c in colliders:                            # walls: push out and reflect
            if p[1] > c[3]:
                continue
            before = np.array([p[0], p[2]])
            push_out(p, self.RADIUS, [c])
            moved = np.array([p[0], p[2]]) - before
            n = float(np.hypot(*moved))
            if n > 1e-9:
                n2 = moved / n
                vn = self.vel[0] * n2[0] + self.vel[2] * n2[1]
                if vn < 0:
                    if vn < -0.8:
                        for f in self.on_hit:
                            f(self, "wall", -vn)
                    self.vel[0] -= (1 + self.WALL_BOUNCE) * vn * n2[0]
                    self.vel[2] -= (1 + self.WALL_BOUNCE) * vn * n2[1]


# ---------------------------------------------------------------- picking
def mouse_ray(mx, my, width, height, view, proj):
    """World-space ray through pixel (mx, my). Pixel y grows downward."""
    ndc = np.array([2 * mx / width - 1, 1 - 2 * my / height])
    inv = np.linalg.inv(proj @ view)
    near = inv @ np.array([ndc[0], ndc[1], -1, 1])
    far = inv @ np.array([ndc[0], ndc[1], 1, 1])
    near, far = near[:3] / near[3], far[:3] / far[3]
    d = far - near
    return near, d / np.linalg.norm(d)


def ray_aabb(o, d, lo, hi):
    """Slab method: distance to the first hit, or None."""
    with np.errstate(divide="ignore", invalid="ignore"):
        inv = 1.0 / d
        t1, t2 = (lo - o) * inv, (hi - o) * inv
    tmin = np.nanmax(np.minimum(t1, t2))
    tmax = np.nanmin(np.maximum(t1, t2))
    if tmax < max(tmin, 0.0):
        return None
    return float(tmin if tmin > 0 else tmax)


def ray_ground(o, d):
    """Distance to the plane y = 0, or None."""
    if abs(d[1]) < 1e-9:
        return None
    t = -o[1] / d[1]
    return t if t > 0 else None
