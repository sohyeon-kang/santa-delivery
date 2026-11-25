"""Scene description (scene.json, shared with the three.js track) and instances."""
import json
import math
import os

import numpy as np

import gltf
from camera import rotate_y, scale, translate
from physics import make_collider

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, "assets", "models")

_cache = {}


def srgb_hex_to_linear(h):
    """'#7cb85a' -> linear RGB floats (colors in scene.json are written as sRGB hex)."""
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def load_model(rel):
    """Each .glb is read once; instances share it."""
    if rel not in _cache:
        _cache[rel] = gltf.Model(os.path.join(MODELS, rel))
    return _cache[rel]


class Instance:
    """One placed copy of a model: position, heading (rotY) and scale."""

    def __init__(self, model, pos=(0, 0, 0), rot_y_deg=0.0, s=1.0, clip=None):
        self.model = model
        self.name = model.name
        self.pos = np.array(pos, float)
        self.heading = math.radians(rot_y_deg)   # radians around +Y
        self.scale = s
        self.animator = gltf.Animator(model, clip) if model.clips else None
        self._static_world = model.world_matrices(model.rest_pose())

    def matrix(self):
        key = (*self.pos, self.heading, self.scale)
        if key != getattr(self, "_key", None):       # recompute only after a change
            self._key = key
            self._matrix = translate(*self.pos) @ rotate_y(self.heading) @ scale(self.scale)
        return self._matrix

    def node_world(self):
        """World matrix of every node in model space (animated if it has an animator)."""
        if self.animator is None:
            return self._static_world
        return self.model.world_matrices(self.animator.pose())

    def aabb(self):
        """World-space axis-aligned box from the rest-pose bounds.
        A starting point for collision, picking, or a BVH (W10, W11)."""
        lo, hi = self.model.bounds
        corners = np.array([[x, y, z, 1] for x in (lo[0], hi[0])
                            for y in (lo[1], hi[1]) for z in (lo[2], hi[2])])
        w = (corners @ self.matrix().T)[:, :3]
        return w.min(0), w.max(0)


class PlaneModel(gltf.Model):
    """A flat square on y = 0, built in code instead of read from a file."""

    def __init__(self, size, color):
        h = size / 2
        pr = gltf.Primitive()
        pr.position = np.array([[-h, 0, -h], [h, 0, -h], [h, 0, h], [-h, 0, h]], np.float32)
        pr.normal = np.tile(np.float32([0, 1, 0]), (4, 1))
        pr.uv = np.zeros((4, 2), np.float32)
        pr.indices = np.array([0, 2, 1, 0, 3, 2], np.uint32)
        pr.material = 0
        self.path, self.name = "", "ground"
        self.nodes = [{"name": "ground", "children": [], "mesh": 0, "skin": None, "parent": None,
                       "t": np.zeros(3), "r": np.array([0, 0, 0, 1.0]), "s": np.ones(3)}]
        self.roots, self.order = [0], [0]
        self.meshes = [[pr]]
        self.materials = [{"name": "ground", "color": np.array([*color, 1], np.float32), "image": None}]
        self.skins, self.clips = [], {}
        self.bounds = (np.array([-h, 0, -h]), np.array([h, 0, h]))


class SphereModel(PlaneModel):
    """A UV sphere built in code (used for the ball)."""

    def __init__(self, radius, color, seg=16):
        super().__init__(1.0, color)
        self.name = "ball"
        th = np.linspace(0, np.pi, seg + 1)
        ph = np.linspace(0, 2 * np.pi, 2 * seg + 1)
        t, p = np.meshgrid(th, ph, indexing="ij")
        n = np.stack([np.sin(t) * np.cos(p), np.cos(t), np.sin(t) * np.sin(p)], -1).reshape(-1, 3)
        pr = self.meshes[0][0]
        pr.position = (n * radius).astype(np.float32)
        pr.normal = n.astype(np.float32)
        pr.uv = np.zeros((len(n), 2), np.float32)
        w = 2 * seg + 1
        idx = []
        for i in range(seg):
            for j in range(2 * seg):
                a, b = i * w + j, (i + 1) * w + j
                idx += [a, a + 1, b, a + 1, b + 1, b]
        pr.indices = np.array(idx, np.uint32)
        self.bounds = (np.full(3, -radius), np.full(3, radius))


class Scene:
    def __init__(self, path=None):
        # CG_SCENE=other.json runs another scene file (path relative to the pack folder)
        path = path or os.path.join(ROOT, os.environ.get("CG_SCENE", "scene.json"))
        with open(path, encoding="utf-8") as f:
            self.data = json.load(f)
        self.kit_scale = self.data.get("kitScale", {})
        self.props = [self.make(p) for p in self.data["props"]]
        # ground-plane colliders for walking and for the ball (see physics.py)
        self.colliders = [c for c in (make_collider(i.name, *i.aabb(), i.pos) for i in self.props) if c]
        # hard ground (roads, pavements, plazas) for footstep sounds: footprints of road and tile pieces
        self.hard_ground = [(i.aabb()[0][[0, 2]], i.aabb()[1][[0, 2]]) for i in self.props
                            if "road" in i.name or "tile" in i.name]
        g = self.data.get("ground", {"size": 80, "color": "#7cb85a"})
        # 2 cm below y = 0, so road tiles (surface at y = 0) never fight with the grass
        self.ground = Instance(PlaneModel(g["size"], srgb_hex_to_linear(g["color"])), (0, -0.02, 0))
        self.sun = self.data.get("sun", {"direction": [-0.4, -1.0, -0.3]})

    def surface(self, p):
        """'hard' on roads and paving, 'grass' elsewhere."""
        for lo, hi in self.hard_ground:
            if lo[0] <= p[0] <= hi[0] and lo[1] <= p[2] <= hi[1]:
                return "hard"
        return "grass"

    def make(self, desc):
        """desc = {"model": "kit/name.glb", "pos": [x, y, z], "rotY": deg, "scale": s}"""
        model = load_model(desc["model"])
        kit = desc["model"].split("/")[0]
        s = desc.get("scale", 1.0) * self.kit_scale.get(kit, 1.0)
        return Instance(model, desc.get("pos", (0, 0, 0)), desc.get("rotY", 0.0), s)
