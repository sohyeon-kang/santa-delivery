"""OpenGL 3.3 core renderer: Blinn-Phong + hemisphere ambient, shadow map with PCF,
GPU skinning, fog, and AABB debug lines."""
import ctypes
import io

import numpy as np
import pygame
from OpenGL.GL import *  # noqa: F401,F403

from camera import look_at, ortho

MAX_JOINTS = 32
SHADOW_SIZE = 2048

VS = """
#version 330 core
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_normal;
layout(location=2) in vec2 a_uv;
layout(location=3) in vec4 a_joints;
layout(location=4) in vec4 a_weights;
uniform mat4 u_model, u_view, u_proj, u_light_vp;
uniform mat4 u_joints[%d];
uniform bool u_skinned;
out vec3 v_world, v_normal;
out vec2 v_uv;
out vec4 v_light;
void main() {
    mat4 skin = mat4(1.0);
    if (u_skinned) {
        skin = a_weights.x * u_joints[int(a_joints.x)] + a_weights.y * u_joints[int(a_joints.y)]
             + a_weights.z * u_joints[int(a_joints.z)] + a_weights.w * u_joints[int(a_joints.w)];
    }
    mat4 m = u_model * skin;
    vec4 w = m * vec4(a_pos, 1.0);
    v_world = w.xyz;
    v_normal = mat3(transpose(inverse(m))) * a_normal;
    v_uv = a_uv;
    v_light = u_light_vp * w;
    gl_Position = u_proj * u_view * w;
}
""" % MAX_JOINTS

FS = """
#version 330 core
in vec3 v_world, v_normal;
in vec2 v_uv;
in vec4 v_light;
uniform sampler2D u_tex;
uniform sampler2DShadow u_shadow;
uniform vec4 u_color;
uniform vec3 u_sun_dir, u_sun_color, u_sky, u_ground, u_eye, u_fog;
uniform float u_fog_density;
uniform vec3 u_highlight;      // selection glow color, zero when not selected
out vec4 frag;

float shadow_factor(vec3 n) {
    vec3 p = v_light.xyz / v_light.w * 0.5 + 0.5;
    if (p.z > 1.0) return 1.0;
    float bias = max(0.0015 * (1.0 - dot(n, -u_sun_dir)), 0.0004);
    float s = 0.0;
    vec2 texel = 1.0 / vec2(textureSize(u_shadow, 0));
    for (int x = -1; x <= 1; ++x)          // 3x3 PCF; each tap is also
        for (int y = -1; y <= 1; ++y)      // a 2x2 hardware comparison
            s += texture(u_shadow, vec3(p.xy + vec2(x, y) * texel, p.z - bias));
    return s / 9.0;
}

void main() {
    vec4 tex = texture(u_tex, v_uv);
    vec3 albedo = pow(tex.rgb, vec3(2.2)) * u_color.rgb;   // sRGB texture -> linear
    vec3 n = normalize(v_normal);
    vec3 l = -u_sun_dir;
    vec3 v = normalize(u_eye - v_world);
    vec3 h = normalize(l + v);
    float sh = shadow_factor(n);
    vec3 ambient = mix(u_ground, u_sky, n.y * 0.5 + 0.5) * albedo;
    vec3 diffuse = max(dot(n, l), 0.0) * u_sun_color * albedo;
    vec3 spec = pow(max(dot(n, h), 0.0), 48.0) * 0.12 * u_sun_color;
    vec3 c = ambient + sh * (diffuse + spec);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 2.0);       // bright edges facing away from us
    c += u_highlight * (0.25 + 1.5 * rim);
    float d = length(u_eye - v_world);
    c = mix(u_fog, c, exp(-pow(d * u_fog_density, 2.0)));
    c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);  // ACES tone map
    frag = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);              // linear -> sRGB
}
"""

DEPTH_FS = """
#version 330 core
void main() {}
"""

LINE_VS = """
#version 330 core
layout(location=0) in vec3 a_pos;
uniform mat4 u_vp;
void main() { gl_Position = u_vp * vec4(a_pos, 1.0); }
"""
LINE_FS = """
#version 330 core
uniform vec3 u_color;
out vec4 frag;
void main() { frag = vec4(u_color, 1.0); }
"""


def compile_program(vs, fs):
    def stage(src, kind):
        s = glCreateShader(kind)
        glShaderSource(s, src)
        glCompileShader(s)
        if not glGetShaderiv(s, GL_COMPILE_STATUS):
            raise RuntimeError(glGetShaderInfoLog(s).decode())
        return s
    p = glCreateProgram()
    glAttachShader(p, stage(vs, GL_VERTEX_SHADER))
    glAttachShader(p, stage(fs, GL_FRAGMENT_SHADER))
    glLinkProgram(p)
    if not glGetProgramiv(p, GL_LINK_STATUS):
        raise RuntimeError(glGetProgramInfoLog(p).decode())
    return p


class Program:
    def __init__(self, vs, fs):
        self.id = compile_program(vs, fs)
        self.loc = {}

    def u(self, name):
        if name not in self.loc:
            self.loc[name] = glGetUniformLocation(self.id, name)
        return self.loc[name]

    def mat4(self, name, m):
        glUniformMatrix4fv(self.u(name), 1, GL_TRUE, np.asarray(m, np.float32))

    def mat4_array(self, name, ms):
        a = np.asarray(ms, np.float32)
        glUniformMatrix4fv(self.u(name), len(a), GL_TRUE, a)

    def vec3(self, name, v):
        glUniform3f(self.u(name), *[float(x) for x in v])

    def vec4(self, name, v):
        glUniform4f(self.u(name), *[float(x) for x in v])

    def i(self, name, v):
        glUniform1i(self.u(name), int(v))

    def f(self, name, v):
        glUniform1f(self.u(name), float(v))


class Renderer:
    def __init__(self, width, height):
        self.width, self.height = width, height
        self.main = Program(VS, FS)
        self.depth = Program(VS, DEPTH_FS)
        self.lines = Program(LINE_VS, LINE_FS)
        self.textures = {}
        self.white = self._texture_from_rgba(np.full((1, 1, 4), 255, np.uint8))
        self._make_shadow_map()
        self.line_vao = glGenVertexArrays(1)
        self.line_vbo = glGenBuffers(1)
        glEnable(GL_DEPTH_TEST)
        glEnable(GL_CULL_FACE)
        # scene look; overwritten from scene.json in set_environment()
        self.sun_dir = np.array([-0.4, -1.0, -0.3]) / np.linalg.norm([-0.4, -1.0, -0.3])
        self.sun_color = np.array([1.0, 0.95, 0.85]) * 2.0
        self.sky = np.array([0.55, 0.72, 0.95])
        self.ground_ambient = np.array([0.30, 0.27, 0.22])
        self.fog = np.array([0.72, 0.84, 0.97])
        self.fog_density = 0.012

    def set_environment(self, sun):
        d = np.array(sun.get("direction", self.sun_dir), float)
        self.sun_dir = d / np.linalg.norm(d)
        if "color" in sun:
            self.sun_color = np.array(sun["color"], float) * sun.get("intensity", 2.0)

    # -- resources ---------------------------------------------------------
    def _texture_from_rgba(self, rgba):
        h, w = rgba.shape[:2]
        tex = glGenTextures(1)
        glBindTexture(GL_TEXTURE_2D, tex)
        glPixelStorei(GL_UNPACK_ALIGNMENT, 1)
        # glTF uv (0,0) is the top-left corner and the rows below start at the top,
        # so the image is uploaded without flipping.
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, rgba)
        glGenerateMipmap(GL_TEXTURE_2D)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST)  # crisp color atlas
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_REPEAT)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_REPEAT)
        return tex

    def texture(self, image):
        if image is None:
            return self.white
        kind, src = image
        key = src if kind == "file" else id(src)
        if key not in self.textures:
            surf = pygame.image.load(src if kind == "file" else io.BytesIO(src))
            w, h = surf.get_size()
            rgba = np.frombuffer(pygame.image.tobytes(surf, "RGBA", False), np.uint8).reshape(h, w, 4)
            self.textures[key] = self._texture_from_rgba(rgba)
        return self.textures[key]

    def upload(self, model):
        """Create a VAO for every primitive of the model (once per model)."""
        for prims in model.meshes:
            for pr in prims:
                if pr.gpu is not None:
                    continue
                n = len(pr.position)
                joints = pr.joints if pr.joints is not None else np.zeros((n, 4), np.float32)
                weights = pr.weights if pr.weights is not None else np.zeros((n, 4), np.float32)
                data = np.hstack([pr.position, pr.normal, pr.uv, joints, weights]).astype(np.float32)
                vao = glGenVertexArrays(1)
                glBindVertexArray(vao)
                vbo, ebo = glGenBuffers(2)
                glBindBuffer(GL_ARRAY_BUFFER, vbo)
                glBufferData(GL_ARRAY_BUFFER, data.nbytes, data, GL_STATIC_DRAW)
                stride = data.shape[1] * 4
                off = 0
                for loc, size in enumerate((3, 3, 2, 4, 4)):
                    glEnableVertexAttribArray(loc)
                    glVertexAttribPointer(loc, size, GL_FLOAT, GL_FALSE, stride, ctypes.c_void_p(off))
                    off += size * 4
                glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo)
                glBufferData(GL_ELEMENT_ARRAY_BUFFER, pr.indices.nbytes, pr.indices, GL_STATIC_DRAW)
                glBindVertexArray(0)
                mat = model.materials[pr.material]
                pr.gpu = {"vao": vao, "count": len(pr.indices), "tex": self.texture(mat["image"]),
                          "color": mat["color"]}

    def _make_shadow_map(self):
        self.shadow_tex = glGenTextures(1)
        glBindTexture(GL_TEXTURE_2D, self.shadow_tex)
        glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE, 0,
                     GL_DEPTH_COMPONENT, GL_FLOAT, None)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_BORDER)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_BORDER)
        glTexParameterfv(GL_TEXTURE_2D, GL_TEXTURE_BORDER_COLOR, [1.0, 1.0, 1.0, 1.0])
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_COMPARE_MODE, GL_COMPARE_REF_TO_TEXTURE)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_COMPARE_FUNC, GL_LEQUAL)
        self.shadow_fbo = glGenFramebuffers(1)
        glBindFramebuffer(GL_FRAMEBUFFER, self.shadow_fbo)
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, self.shadow_tex, 0)
        glDrawBuffer(GL_NONE)
        glReadBuffer(GL_NONE)
        glBindFramebuffer(GL_FRAMEBUFFER, 0)

    # -- drawing -----------------------------------------------------------
    def light_view_proj(self, center, extent=24.0):
        """Orthographic sun camera that covers a square around `center`."""
        # snap to shadow texels so shadows do not shimmer while the player moves
        texel = 2 * extent / SHADOW_SIZE
        c = np.floor(np.asarray(center, float) / texel) * texel
        eye = c - self.sun_dir * 60.0
        up = (0, 0, 1) if abs(self.sun_dir[1]) > 0.99 else (0, 1, 0)
        return ortho(-extent, extent, -extent, extent, 1.0, 140.0) @ look_at(eye, c, up)

    def _draw_instances(self, prog, instances, selected=None):
        for inst in instances:
            if prog is self.main:
                prog.vec3("u_highlight", (0.9, 0.7, 0.1) if inst is selected else (0, 0, 0))
            m = inst.model
            world = inst.node_world()
            base = inst.matrix()
            for i, node in enumerate(m.nodes):
                if node["mesh"] is None:
                    continue
                if node["skin"] is not None:
                    prog.i("u_skinned", 1)
                    prog.mat4_array("u_joints", m.joint_matrices(node["skin"], world))
                    prog.mat4("u_model", base)          # glTF: skinned mesh ignores its node transform
                else:
                    prog.i("u_skinned", 0)
                    prog.mat4("u_model", base @ world[i])
                for pr in m.meshes[node["mesh"]]:
                    g = pr.gpu
                    if prog is self.main:
                        glBindTexture(GL_TEXTURE_2D, g["tex"])
                        prog.vec4("u_color", g["color"])
                    glBindVertexArray(g["vao"])
                    glDrawElements(GL_TRIANGLES, g["count"], GL_UNSIGNED_INT, None)
        glBindVertexArray(0)

    def render(self, instances, view, proj, eye, shadow_center, selected=None):
        light_vp = self.light_view_proj(shadow_center)
        # 1) shadow pass: depth from the sun
        glBindFramebuffer(GL_FRAMEBUFFER, self.shadow_fbo)
        glViewport(0, 0, SHADOW_SIZE, SHADOW_SIZE)
        glClear(GL_DEPTH_BUFFER_BIT)
        glDisable(GL_CULL_FACE)                 # thin Kenney parts cast from both sides
        glEnable(GL_POLYGON_OFFSET_FILL)
        glPolygonOffset(2.0, 4.0)
        p = self.depth
        glUseProgram(p.id)
        p.mat4("u_view", light_vp)
        p.mat4("u_proj", np.eye(4))
        p.mat4("u_light_vp", np.eye(4))
        self._draw_instances(p, instances)
        glDisable(GL_POLYGON_OFFSET_FILL)
        glEnable(GL_CULL_FACE)
        glBindFramebuffer(GL_FRAMEBUFFER, 0)
        self.light_vp = light_vp          # the minimap reuses this frame's shadow map

        # 2) main pass
        glViewport(0, 0, self.width, self.height)
        glClearColor(*self.fog, 1.0)
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)
        self._scene_pass(instances, view, proj, eye, self.fog_density, selected)

    def _scene_pass(self, instances, view, proj, eye, fog_density, selected=None):
        light_vp = self.light_vp
        p = self.main
        glUseProgram(p.id)
        p.mat4("u_view", view)
        p.mat4("u_proj", proj)
        p.mat4("u_light_vp", light_vp)
        p.vec3("u_sun_dir", self.sun_dir)
        p.vec3("u_sun_color", self.sun_color)
        p.vec3("u_sky", self.sky * 0.9)
        p.vec3("u_ground", self.ground_ambient)
        p.vec3("u_eye", eye)
        p.vec3("u_fog", self.fog ** 2.2)
        p.f("u_fog_density", fog_density)
        p.i("u_tex", 0)
        p.i("u_shadow", 1)
        glActiveTexture(GL_TEXTURE1)
        glBindTexture(GL_TEXTURE_2D, self.shadow_tex)
        glActiveTexture(GL_TEXTURE0)
        self._draw_instances(p, instances, selected)

    def begin_inset(self, x, y, w, h, border=3, border_color=(0.12, 0.16, 0.14)):
        """Start drawing into a small rectangle of the window (pixels, origin bottom-left).
        The scissor test keeps glClear inside the rectangle."""
        glEnable(GL_SCISSOR_TEST)
        glScissor(x - border, y - border, w + 2 * border, h + 2 * border)
        glClearColor(*border_color, 1.0)
        glClear(GL_COLOR_BUFFER_BIT)
        glScissor(x, y, w, h)
        glClearColor(*self.fog, 1.0)
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)
        glViewport(x, y, w, h)

    def end_inset(self):
        glDisable(GL_SCISSOR_TEST)
        glViewport(0, 0, self.width, self.height)

    def minimap_scene(self, instances, view, proj, eye):
        """Second camera: same scene from above, no fog, inside the current inset."""
        self._scene_pass(instances, view, proj, eye, 0.0)

    def draw_shapes(self, verts, mode, view, proj, color, depth=False):
        """Flat-colored triangles (GL_TRIANGLES) or lines (GL_LINES) in world space."""
        data = np.asarray(verts, np.float32).reshape(-1, 3)
        if not len(data):
            return
        if not depth:
            glDisable(GL_DEPTH_TEST)
        glDisable(GL_CULL_FACE)
        glUseProgram(self.lines.id)
        self.lines.mat4("u_vp", proj @ view)
        self.lines.vec3("u_color", color)
        glBindVertexArray(self.line_vao)
        glBindBuffer(GL_ARRAY_BUFFER, self.line_vbo)
        glBufferData(GL_ARRAY_BUFFER, data.nbytes, data, GL_STREAM_DRAW)
        glEnableVertexAttribArray(0)
        glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 12, None)
        glDrawArrays(mode, 0, len(data))
        glBindVertexArray(0)
        glEnable(GL_CULL_FACE)
        glEnable(GL_DEPTH_TEST)

    def draw_boxes(self, boxes, view, proj, color=(1.0, 0.2, 0.2)):
        """Wireframe AABBs, for debugging collision and picking."""
        if not boxes:
            return
        segs = []
        for lo, hi in boxes:
            c = [np.array([x, y, z]) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
            for a, b in ((0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7),
                         (0, 4), (1, 5), (2, 6), (3, 7)):
                segs += [c[a], c[b]]
        data = np.array(segs, np.float32)
        glUseProgram(self.lines.id)
        self.lines.mat4("u_vp", proj @ view)
        self.lines.vec3("u_color", color)
        glBindVertexArray(self.line_vao)
        glBindBuffer(GL_ARRAY_BUFFER, self.line_vbo)
        glBufferData(GL_ARRAY_BUFFER, data.nbytes, data, GL_STREAM_DRAW)
        glEnableVertexAttribArray(0)
        glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 12, None)
        glDrawArrays(GL_LINES, 0, len(data))
        glBindVertexArray(0)
