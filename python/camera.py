"""Matrix helpers and a third-person follow camera.

All matrices are numpy row-major 4x4 and act on column vectors (M @ v).
renderer.py uploads them with transpose=GL_TRUE.
"""
import math

import numpy as np


def perspective(fovy_deg, aspect, near, far):
    f = 1.0 / math.tan(math.radians(fovy_deg) / 2)
    return np.array([[f / aspect, 0, 0, 0],
                     [0, f, 0, 0],
                     [0, 0, (far + near) / (near - far), 2 * far * near / (near - far)],
                     [0, 0, -1, 0]])


def ortho(l, r, b, t, n, f):
    return np.array([[2 / (r - l), 0, 0, -(r + l) / (r - l)],
                     [0, 2 / (t - b), 0, -(t + b) / (t - b)],
                     [0, 0, -2 / (f - n), -(f + n) / (f - n)],
                     [0, 0, 0, 1]])


def look_at(eye, target, up=(0, 1, 0)):
    eye, target, up = (np.asarray(v, float) for v in (eye, target, up))
    f = target - eye
    f /= np.linalg.norm(f)
    s = np.cross(f, up)
    s /= np.linalg.norm(s)
    u = np.cross(s, f)
    m = np.eye(4)
    m[0, :3], m[1, :3], m[2, :3] = s, u, -f
    m[:3, 3] = -m[:3, :3] @ eye
    return m


def translate(x, y, z):
    m = np.eye(4)
    m[:3, 3] = (x, y, z)
    return m


def rotate_y(rad):
    c, s = math.cos(rad), math.sin(rad)
    return np.array([[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]])


def scale(s):
    return np.diag([s, s, s, 1.0])


class FollowCamera:
    """Orbits around a target (the player). Drag the mouse to turn, wheel to zoom."""

    def __init__(self, yaw=0.0, pitch=0.35, dist=9.0):
        self.yaw, self.pitch, self.dist = yaw, pitch, dist
        self.target = np.zeros(3)
        self.fovy = 50.0

    def rotate(self, dx, dy):
        self.yaw -= dx * 0.005
        self.pitch = min(1.35, max(0.05, self.pitch + dy * 0.005))

    def zoom(self, steps):
        self.dist = min(30.0, max(3.0, self.dist * (0.9 ** steps)))

    def follow(self, p, dt, height=1.4):
        goal = np.asarray(p, float) + (0, height, 0)
        k = 1.0 - math.exp(-10.0 * dt)       # smooth, frame-rate independent
        self.target += (goal - self.target) * k

    @property
    def eye(self):
        cp = math.cos(self.pitch)
        offset = np.array([cp * math.sin(self.yaw), math.sin(self.pitch), cp * math.cos(self.yaw)])
        return self.target + self.dist * offset

    def forward_xz(self):
        """Unit vector on the ground the camera looks along (used for WASD)."""
        return np.array([-math.sin(self.yaw), 0.0, -math.cos(self.yaw)])

    def view(self):
        return look_at(self.eye, self.target)

    def proj(self, aspect):
        return perspective(self.fovy, aspect, 0.1, 300.0)
