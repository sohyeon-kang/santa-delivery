"""Minimap HUD: a second, top-down orthographic camera drawn into a corner viewport.

  - glViewport + glScissor restrict drawing (and glClear) to the corner rectangle
  - the camera looks straight down with "up" = -Z, so north is up on the map
  - only objects whose AABB overlaps the map square are drawn (simple culling)
  - icons (player arrow, view wedge, dog, ball, walk target) are flat shapes on top
  - clicking the map makes the player walk to that spot
The three.js track does the same in web/minimap.js.
"""
import math

import numpy as np
from OpenGL.GL import GL_LINES, GL_TRIANGLES

from camera import look_at, ortho

SIZE = 240        # pixels
MARGIN = 16       # pixels from the window corner
RANGE = 24.0      # half width of the map square, m


def disc(c, r, n=12, y=0.0):
    """Triangles of a filled circle on the ground plane."""
    out = []
    for k in range(n):
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        out += [(c[0], y, c[2]), (c[0] + r * math.cos(a0), y, c[2] + r * math.sin(a0)),
                (c[0] + r * math.cos(a1), y, c[2] + r * math.sin(a1))]
    return out


def arrow(p, heading, size, y=0.0):
    """Triangle pointing along heading (model +Z)."""
    f = np.array([math.sin(heading), 0, math.cos(heading)])
    r = np.array([f[2], 0, -f[0]])
    base = np.array([p[0], y, p[2]])
    return [base + f * size, base - f * size * 0.6 + r * size * 0.7, base - f * size * 0.6 - r * size * 0.7]


class Minimap:
    def __init__(self, width, height):
        self.width, self.height = width, height
        self.left, self.top = width - MARGIN - SIZE, MARGIN     # window pixels, origin top-left
        self.center = np.zeros(3)

    def contains(self, mx, my):
        return self.left <= mx < self.left + SIZE and self.top <= my < self.top + SIZE

    def to_world(self, mx, my):
        """Window pixel inside the map -> point on the ground."""
        u = (mx - self.left) / SIZE
        v = (my - self.top) / SIZE
        return np.array([self.center[0] - RANGE + 2 * RANGE * u, 0.0,
                         self.center[2] - RANGE + 2 * RANGE * v])   # screen down = +Z (south)

    def camera(self):
        c = self.center
        view = look_at(c + (0, 80, 0), c, up=(0, 0, -1))
        proj = ortho(-RANGE, RANGE, -RANGE, RANGE, 1.0, 160.0)
        return view, proj

    def visible(self, inst):
        lo, hi = inst.aabb()
        c = self.center
        return not (hi[0] < c[0] - RANGE or lo[0] > c[0] + RANGE or
                    hi[2] < c[2] - RANGE or lo[2] > c[2] + RANGE)

    def draw(self, game):
        r = game.renderer
        p = game.player
        self.center = p.pos.copy()
        self.center[1] = 0
        view, proj = self.camera()
        r.begin_inset(self.left, self.height - self.top - SIZE, SIZE, SIZE)
        shown = [i for i in game.everything if i is game.scene.ground or self.visible(i)]
        r.minimap_scene(shown, view, proj, self.center + (0, 80, 0))

        s = RANGE * 0.07                                   # icon size in metres (about 8 px)
        y = 40.0
        # what the main camera sees: a wedge of the horizontal field of view
        half = math.atan(math.tan(math.radians(game.cam.fovy) / 2) * self.width / self.height)
        yaw = math.atan2(*game.cam.forward_xz()[[0, 2]])
        wedge = []
        for a in (yaw - half, yaw + half):
            wedge += [(p.pos[0], y, p.pos[2]), (p.pos[0] + 12 * math.sin(a), y, p.pos[2] + 12 * math.cos(a))]
        r.draw_shapes(wedge, GL_LINES, view, proj, (1.0, 1.0, 1.0))
        if game.walk_target is not None:
            t = game.walk_target
            ring = []
            for k in range(16):
                a0, a1 = 2 * math.pi * k / 16, 2 * math.pi * (k + 1) / 16
                ring += [(t[0] + s * 0.6 * math.cos(a0), y, t[2] + s * 0.6 * math.sin(a0)),
                         (t[0] + s * 0.6 * math.cos(a1), y, t[2] + s * 0.6 * math.sin(a1))]
            r.draw_shapes(ring, GL_LINES, view, proj, (0.2, 1.0, 0.4))
        if not game.ball.held or game.dog.state == "RETURN":
            b = game.ball.pos
            r.draw_shapes(disc(b, s * 0.55, y=y), GL_TRIANGLES, view, proj, (0.1, 0.1, 0.1))
            r.draw_shapes(disc(b, s * 0.4, y=y), GL_TRIANGLES, view, proj, (0.9, 0.1, 0.06))
        d = game.dog.pos
        r.draw_shapes(disc(d, s * 0.75, y=y), GL_TRIANGLES, view, proj, (0.1, 0.1, 0.1))
        r.draw_shapes(disc(d, s * 0.6, y=y), GL_TRIANGLES, view, proj, (0.95, 0.55, 0.15))
        r.draw_shapes(arrow(p.pos, p.inst.heading, s * 1.35, y), GL_TRIANGLES, view, proj, (0.1, 0.1, 0.1))
        r.draw_shapes(arrow(p.pos, p.inst.heading, s, y), GL_TRIANGLES, view, proj, (1.0, 0.85, 0.1))
        r.end_inset()
