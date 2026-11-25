"""Minimal GLB (binary glTF 2.0) loader written for teaching.

Reads only what the Kenney kits use:
  - node hierarchy (TRS or matrix)
  - meshes with POSITION, NORMAL, TEXCOORD_0, JOINTS_0, WEIGHTS_0
  - materials: baseColorFactor and baseColorTexture
  - skins (inverse bind matrices)
  - animations (translation, rotation, scale; LINEAR and STEP)

There is no OpenGL code here. renderer.py uploads the arrays to the GPU.
Spec: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
"""
import json
import os
import struct

import numpy as np

COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16,
             5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


# ---------------------------------------------------------------- math
def quat_to_mat3(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def trs_matrix(t, r, s):
    m = np.eye(4)
    m[:3, :3] = quat_to_mat3(r) * s  # columns scaled by s
    m[:3, 3] = t
    return m


def slerp(q0, q1, a):
    d = float(np.dot(q0, q1))
    if d < 0.0:          # take the short way around
        q1, d = -q1, -d
    if d > 0.9995:       # almost equal: linear blend is fine
        q = q0 + a * (q1 - q0)
    else:
        th = np.arccos(d)
        q = (np.sin((1 - a) * th) * q0 + np.sin(a * th) * q1) / np.sin(th)
    return q / np.linalg.norm(q)


# ---------------------------------------------------------------- data
class Primitive:
    def __init__(self):
        self.position = self.normal = self.uv = None
        self.joints = self.weights = None
        self.indices = None
        self.material = None
        self.gpu = None  # filled in by renderer.py


class Clip:
    """One animation: a list of channels (node, path, times, values, interp)."""

    def __init__(self, name):
        self.name = name
        self.channels = []
        self.duration = 0.0


class Model:
    def __init__(self, path):
        self.path = path
        self.name = os.path.splitext(os.path.basename(path))[0]
        with open(path, "rb") as f:
            data = f.read()
        magic, version, _ = struct.unpack_from("<III", data, 0)
        assert magic == 0x46546C67 and version == 2, "not a GLB 2.0 file"
        off, self.bin = 12, b""
        while off < len(data):
            length, ctype = struct.unpack_from("<II", data, off)
            chunk = data[off + 8: off + 8 + length]
            if ctype == 0x4E4F534A:      # 'JSON'
                self.json = json.loads(chunk)
            elif ctype == 0x004E4942:    # 'BIN'
                self.bin = chunk
            off += 8 + length
        self._read_nodes()
        self._read_materials()
        self._read_meshes()
        self._read_skins()
        self._read_animations()
        self.bounds = self.compute_bounds()

    # -- accessors ------------------------------------------------------
    def accessor(self, i):
        acc = self.json["accessors"][i]
        view = self.json["bufferViews"][acc["bufferView"]]
        dtype = np.dtype(COMPONENT[acc["componentType"]])
        n = NCOMP[acc["type"]]
        start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        stride = view.get("byteStride", 0)
        count = acc["count"]
        if stride and stride != n * dtype.itemsize:
            raw = np.frombuffer(self.bin, np.uint8, stride * (count - 1) + n * dtype.itemsize, start)
            rows = np.lib.stride_tricks.as_strided(raw, (count, n * dtype.itemsize), (stride, 1))
            arr = np.ascontiguousarray(rows).view(dtype).reshape(count, n)
        else:
            arr = np.frombuffer(self.bin, dtype, count * n, start).reshape(count, n)
        if acc.get("normalized"):
            arr = arr.astype(np.float32) / np.iinfo(dtype).max
        return arr if n > 1 else arr[:, 0]

    # -- parts -----------------------------------------------------------
    def _read_nodes(self):
        self.nodes = []
        for n in self.json["nodes"]:
            node = {"name": n.get("name", ""), "children": n.get("children", []),
                    "mesh": n.get("mesh"), "skin": n.get("skin"), "parent": None}
            if "matrix" in n:   # glTF stores matrices column-major
                m = np.array(n["matrix"], float).reshape(4, 4).T
                node["t"] = m[:3, 3].copy()
                sx, sy, sz = np.linalg.norm(m[:3, :3], axis=0)
                node["s"] = np.array([sx, sy, sz])
                node["r"] = mat3_to_quat(m[:3, :3] / node["s"])
            else:
                node["t"] = np.array(n.get("translation", [0, 0, 0]), float)
                node["r"] = np.array(n.get("rotation", [0, 0, 0, 1]), float)
                node["s"] = np.array(n.get("scale", [1, 1, 1]), float)
            self.nodes.append(node)
        for i, n in enumerate(self.nodes):
            for c in n["children"]:
                self.nodes[c]["parent"] = i
        self.roots = [i for i, n in enumerate(self.nodes) if n["parent"] is None]
        # parents before children, so one pass computes world matrices
        self.order = []
        stack = list(reversed(self.roots))
        while stack:
            i = stack.pop()
            self.order.append(i)
            stack.extend(reversed(self.nodes[i]["children"]))

    def _read_materials(self):
        self.materials = []
        base = os.path.dirname(self.path)
        for m in self.json.get("materials", []):
            pbr = m.get("pbrMetallicRoughness", {})
            mat = {"name": m.get("name", ""),
                   "color": np.array(pbr.get("baseColorFactor", [1, 1, 1, 1]), np.float32),
                   "image": None}
            tex = pbr.get("baseColorTexture")
            if tex is not None:
                img = self.json["images"][self.json["textures"][tex["index"]]["source"]]
                if "uri" in img:      # Kenney: Textures/colormap.png next to the .glb
                    mat["image"] = ("file", os.path.join(base, img["uri"]))
                else:                 # image stored inside the GLB
                    v = self.json["bufferViews"][img["bufferView"]]
                    o = v.get("byteOffset", 0)
                    mat["image"] = ("bytes", self.bin[o:o + v["byteLength"]])
            self.materials.append(mat)
        if not self.materials:
            self.materials.append({"name": "default", "color": np.ones(4, np.float32), "image": None})

    def _read_meshes(self):
        self.meshes = []
        for m in self.json.get("meshes", []):
            prims = []
            for p in m["primitives"]:
                a = p["attributes"]
                pr = Primitive()
                pr.position = self.accessor(a["POSITION"]).astype(np.float32)
                n = len(pr.position)
                pr.normal = self.accessor(a["NORMAL"]).astype(np.float32) if "NORMAL" in a else np.tile([0, 1, 0], (n, 1)).astype(np.float32)
                pr.uv = self.accessor(a["TEXCOORD_0"]).astype(np.float32) if "TEXCOORD_0" in a else np.zeros((n, 2), np.float32)
                if "JOINTS_0" in a:
                    pr.joints = self.accessor(a["JOINTS_0"]).astype(np.float32)
                    pr.weights = self.accessor(a["WEIGHTS_0"]).astype(np.float32)
                pr.indices = (self.accessor(p["indices"]).astype(np.uint32)
                              if "indices" in p else np.arange(n, dtype=np.uint32))
                pr.material = p.get("material", 0)
                prims.append(pr)
            self.meshes.append(prims)

    def _read_skins(self):
        self.skins = []
        for s in self.json.get("skins", []):
            joints = s["joints"]
            if "inverseBindMatrices" in s:
                ib = self.accessor(s["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
            else:
                ib = np.tile(np.eye(4), (len(joints), 1, 1))
            self.skins.append({"joints": joints, "inv_bind": ib.astype(float)})

    def _read_animations(self):
        self.clips = {}
        for k, a in enumerate(self.json.get("animations", [])):
            clip = Clip(a.get("name", f"clip{k}"))
            for ch in a["channels"]:
                tgt = ch["target"]
                if "node" not in tgt or tgt["path"] not in ("translation", "rotation", "scale"):
                    continue
                smp = a["samplers"][ch["sampler"]]
                times = self.accessor(smp["input"]).astype(float)
                vals = self.accessor(smp["output"]).astype(float)
                interp = smp.get("interpolation", "LINEAR")
                if interp == "CUBICSPLINE":   # keep only the value, drop tangents
                    vals = vals.reshape(len(times), 3, -1)[:, 1]
                    interp = "LINEAR"
                clip.channels.append((tgt["node"], tgt["path"][0], times, vals, interp))
                clip.duration = max(clip.duration, float(times[-1]))
            self.clips[clip.name] = clip

    # -- pose ---------------------------------------------------------------
    def rest_pose(self):
        """Copy of every node's local (t, r, s)."""
        return [[n["t"].copy(), n["r"].copy(), n["s"].copy()] for n in self.nodes]

    def world_matrices(self, pose):
        world = [None] * len(self.nodes)
        for i in self.order:
            t, r, s = pose[i]
            local = trs_matrix(t, r, s)
            p = self.nodes[i]["parent"]
            world[i] = local if p is None else world[p] @ local
        return world

    def joint_matrices(self, skin, world):
        sk = self.skins[skin]
        return [world[j] @ sk["inv_bind"][k] for k, j in enumerate(sk["joints"])]

    def compute_bounds(self):
        """Axis-aligned box of the model in its rest pose (model space)."""
        world = self.world_matrices(self.rest_pose())
        lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
        for i, n in enumerate(self.nodes):
            if n["mesh"] is None:
                continue
            for pr in self.meshes[n["mesh"]]:
                p = np.c_[pr.position, np.ones(len(pr.position))]
                if n["skin"] is not None and pr.joints is not None:
                    jm = np.array(self.joint_matrices(n["skin"], world))
                    m = np.einsum("vk,vkab->vab", pr.weights, jm[pr.joints.astype(int)])
                    q = np.einsum("vab,vb->va", m, p)[:, :3]
                else:
                    q = (p @ world[i].T)[:, :3]
                lo, hi = np.minimum(lo, q.min(0)), np.maximum(hi, q.max(0))
        return lo, hi


def mat3_to_quat(m):
    tr = m[0, 0] + m[1, 1] + m[2, 2]
    if tr > 0:
        s = np.sqrt(tr + 1.0) * 2
        q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]
    return np.array(q, float)


# ---------------------------------------------------------------- animation
def sample_clip(clip, t, pose):
    """Write the clip's values at time t into pose (list of [t, r, s])."""
    slot = {"t": 0, "r": 1, "s": 2}
    for node, path, times, vals, interp in clip.channels:
        if t <= times[0]:
            v = vals[0]
        elif t >= times[-1]:
            v = vals[-1]
        else:
            k = int(np.searchsorted(times, t)) - 1
            if interp == "STEP":
                v = vals[k]
            else:
                a = (t - times[k]) / (times[k + 1] - times[k])
                v = slerp(vals[k], vals[k + 1], a) if path == "r" else vals[k] + a * (vals[k + 1] - vals[k])
        pose[node][slot[path]] = np.array(v, float)


class Animator:
    """Plays one clip at a time and cross-fades to the next one."""

    def __init__(self, model, clip=None):
        self.model = model
        self.clip, self.time = None, 0.0
        self.prev, self.prev_time = None, 0.0
        self.fade, self.fade_len = 0.0, 0.0
        self.loop = True
        self.speed = 1.0
        if clip:
            self.play(clip)

    def has(self, name):
        return name in self.model.clips

    def play(self, name, fade=0.2, loop=True, restart=False):
        if name not in self.model.clips:
            return
        clip = self.model.clips[name]
        if clip is self.clip and not restart:
            return
        self.prev, self.prev_time = self.clip, self.time
        self.clip, self.time, self.loop = clip, 0.0, loop
        self.fade_len = fade if self.prev is not None else 0.0
        self.fade = 0.0

    @property
    def finished(self):
        return (not self.loop) and self.clip is not None and self.time >= self.clip.duration

    def update(self, dt):
        if self.clip is None:
            return
        self.time += dt * self.speed
        if self.loop and self.clip.duration > 0:
            self.time %= self.clip.duration
        if self.prev is not None:
            self.prev_time += dt * self.speed
            if self.prev.duration > 0:
                self.prev_time %= self.prev.duration
            self.fade += dt

    def pose(self):
        pose = self.model.rest_pose()
        if self.clip is None:
            return pose
        sample_clip(self.clip, min(self.time, self.clip.duration), pose)
        if self.prev is not None and self.fade < self.fade_len:
            old = self.model.rest_pose()
            sample_clip(self.prev, self.prev_time, old)
            a = self.fade / self.fade_len
            for i in range(len(pose)):
                pose[i][0] = old[i][0] + a * (pose[i][0] - old[i][0])
                pose[i][1] = slerp(old[i][1], pose[i][1], a)
                pose[i][2] = old[i][2] + a * (pose[i][2] - old[i][2])
        return pose


if __name__ == "__main__":
    import sys
    for p in sys.argv[1:]:
        m = Model(p)
        lo, hi = m.bounds
        print(f"{m.name}: size {np.round(hi - lo, 2)}  min {np.round(lo, 2)}  "
              f"clips {[(c.name, round(c.duration, 2)) for c in m.clips.values()]}")
