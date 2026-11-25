"""P3 Starter: walk around a Kenney town with a dog that greets you and plays fetch.

Controls
  W A S D        move (relative to the camera)      Shift   sprint
  F              throw the ball                     E       wave
  Left click     select an object / walk to a spot on the ground or on the minimap
  Left drag      turn the camera                    Wheel   zoom
  B              show colliders                     F12     screenshot
  M              mute sound
  Esc            quit
"""
import json
import math
import os
import subprocess
import time

import OpenGL
OpenGL.ERROR_CHECKING = False   # PyOpenGL checks glGetError after every call; off = about 2x faster.
                                # Turn it back on (True) while debugging a GL error.
import numpy as np
import pygame
from OpenGL.GL import GL_RGB, GL_UNSIGNED_BYTE, glReadPixels

from actors import Dog, Player
from camera import FollowCamera
from minimap import RANGE, Minimap
from minimap import SIZE as MAP_SIZE
from physics import Ball, mouse_ray, ray_aabb, ray_ground
from renderer import Renderer
from scene import Instance, Scene, SphereModel
from sound import Sound

W, H = 1280, 720
CLICK_PIXELS = 5        # a press that moves less than this is a click, not a camera drag


def setup_window():
    pygame.init()
    pygame.display.gl_set_attribute(pygame.GL_CONTEXT_MAJOR_VERSION, 3)
    pygame.display.gl_set_attribute(pygame.GL_CONTEXT_MINOR_VERSION, 3)
    pygame.display.gl_set_attribute(pygame.GL_CONTEXT_PROFILE_MASK, pygame.GL_CONTEXT_PROFILE_CORE)
    pygame.display.gl_set_attribute(pygame.GL_CONTEXT_FLAGS, pygame.GL_CONTEXT_FORWARD_COMPATIBLE_FLAG)  # macOS
    pygame.display.gl_set_attribute(pygame.GL_MULTISAMPLEBUFFERS, 1)
    pygame.display.gl_set_attribute(pygame.GL_MULTISAMPLESAMPLES, 4)
    flags = pygame.OPENGL | pygame.DOUBLEBUF
    if os.environ.get("CG_SHOT") or os.environ.get("CG_REC"):
        flags |= pygame.HIDDEN
    pygame.display.set_mode((W, H), flags, vsync=1)


def read_frame():
    return glReadPixels(0, 0, W, H, GL_RGB, GL_UNSIGNED_BYTE)


def screenshot(path):
    img = pygame.image.frombytes(read_frame(), (W, H), "RGB", True)   # GL rows start at the bottom
    pygame.image.save(img, path)
    print("saved", path)


def collider_boxes(colliders):
    """Colliders as 3D boxes, for drawing."""
    boxes = []
    for c in colliders:
        h = c[3]
        if c[0] == "box":
            boxes.append((np.array([c[1][0], 0, c[1][1]]), np.array([c[2][0], h, c[2][1]])))
        else:
            (x, z), r = c[1], c[2]
            boxes.append((np.array([x - r, 0, z - r]), np.array([x + r, h, z + r])))
    return boxes


class Game:
    def __init__(self):
        self.scene = scene = Scene()
        self.renderer = Renderer(W, H)
        self.renderer.set_environment(scene.sun)
        d = scene.data
        self.player = Player(scene.make(d["player"]), scene.colliders)
        self.dog = Dog(scene.make(d["dog"]), d["dog"].get("home", d["dog"]["pos"]),
                       d["dog"].get("wanderRadius", 4.0), scene.colliders)
        self.ball = Ball(Instance(SphereModel(Ball.RADIUS, (0.85, 0.08, 0.06))))
        # observers: the player waves back when greeted, the dog chases a thrown ball
        self.dog.on_greet.append(lambda dg: self.player.wave(toward=dg.pos.copy()))
        self.player.on_throw.append(lambda pl: self.dog.ball_thrown(self.ball, pl.pos))
        # sound effects are observers too: they react to the same events
        self.sound = snd = Sound()
        self.player.on_step.append(lambda pl: snd.play("step_" + scene.surface(pl.pos), pl.pos))
        self.player.on_throw.append(lambda pl: snd.play("throw", pl.pos + (0, 1.2, 0)))
        self.ball.on_hit.append(lambda b, kind, v: snd.play("bounce" if kind == "ground" else "wall",
                                                            b.pos, min(1.0, v / 5.0)))
        self.dog.on_bark.append(lambda dg: snd.play("bark", dg.pos + (0, 0.5, 0)))

        self.everything = [scene.ground] + scene.props + [self.player.inst, self.dog.inst, self.ball.inst]
        for inst in self.everything:
            self.renderer.upload(inst.model)
        self.pickable = scene.props + [self.dog.inst]

        self.cam = FollowCamera(yaw=math.radians(d.get("camera", {}).get("yaw", 0)))
        self.cam.target = self.player.pos + (0, 1.4, 0)
        self.selected = None        # picked Instance
        self.walk_target = None     # click-to-move goal on the ground
        self.stuck = 0.0
        self.show_boxes = False
        self.minimap = Minimap(W, H)

    # -- input -------------------------------------------------------------
    def click(self, mx, my):
        """Pick the nearest object under the mouse; if it is the ground, walk there."""
        if self.minimap.contains(mx, my):             # a click on the minimap: walk there
            self.walk_target = self.minimap.to_world(mx, my)
            self.stuck = 0.0
            self.sound.play("move")
            return
        o, d = mouse_ray(mx, my, W, H, self.cam.view(), self.cam.proj(W / H))
        best, best_t = None, math.inf
        for inst in self.pickable:
            t = ray_aabb(o, d, *inst.aabb())
            if t is not None and t < best_t:
                best, best_t = inst, t
        tg = ray_ground(o, d)
        if tg is not None and tg < best_t:
            self.walk_target = o + d * tg
            self.walk_target[1] = 0.0
            self.stuck = 0.0
            self.selected = None
            self.sound.play("move")
        else:
            self.selected = best
            self.sound.play("select")
        if self.selected is not None:
            print("selected", self.selected.name)

    def throw(self):
        self.player.throw(self.ball, self.cam.forward_xz())

    def move_input(self, keys):
        fwd = self.cam.forward_xz()
        right = np.array([-fwd[2], 0, fwd[0]])
        move = (fwd * (keys[pygame.K_w] - keys[pygame.K_s])
                + right * (keys[pygame.K_d] - keys[pygame.K_a])).astype(float)
        if np.linalg.norm(move) > 0:
            self.walk_target = None                   # keys override click-to-move
        elif self.walk_target is not None:
            move = self.walk_target - self.player.pos
            move[1] = 0
            if np.linalg.norm(move) < 0.2:
                self.walk_target = None
                move[:] = 0
        n = np.linalg.norm(move)
        return move / n if n > 0 else move

    # -- frame -------------------------------------------------------------
    def update(self, dt, move, sprint):
        before = self.player.pos.copy()
        self.player.update(dt, move, sprint)
        if self.walk_target is not None:              # blocked by a wall for a while: give up
            moved = np.linalg.norm((self.player.pos - before)[[0, 2]])
            self.stuck = self.stuck + dt if moved < 0.3 * Player.WALK * dt else 0.0
            if self.stuck > 0.6:
                self.walk_target = None
        self.dog.update(dt, self.player.pos)
        self.ball.update(dt, self.scene.colliders)
        self.cam.follow(self.player.pos, dt)
        # third-person games put the ears on the character and turn them with the camera
        f = self.cam.forward_xz()
        self.sound.listener(self.player.pos + (0, 1.4, 0), np.array([-f[2], 0.0, f[0]]))

    def draw(self):
        view, proj = self.cam.view(), self.cam.proj(W / H)
        self.renderer.render(self.everything, view, proj, self.cam.eye, self.player.pos, self.selected)
        if self.show_boxes:
            self.renderer.draw_boxes(collider_boxes(self.scene.colliders), view, proj, (1.0, 0.25, 0.2))
        if self.walk_target is not None:
            p = self.walk_target
            self.renderer.draw_boxes([(p - (0.25, 0, 0.25), p + (0.25, 0.05, 0.25))], view, proj, (0.2, 1.0, 0.4))
        self.minimap.draw(self)                       # HUD, drawn last on top


class Demo:
    """CG_DEMO=demo.json plays timed actions (used to record the demo video):
    {"t": 0, "walk": [x, z]}  {"t": 5, "throw": [x, z]}  {"t": 9, "click": [x, y, z]}
    {"t": 12, "cam": [yaw_deg, pitch, dist]}  {"t": 20, "boxes": true}  {"t": 30, "end": true}
    {"t": 25, "mapclick": [x, z]} clicks the minimap where that ground point is drawn"""

    def __init__(self, path, game):
        with open(path, encoding="utf-8") as f:
            self.events = sorted(json.load(f), key=lambda e: e["t"])
        self.game = game
        self.cam_goal = None
        self.done = False

    def step(self, t, dt):
        g = self.game
        while self.events and self.events[0]["t"] <= t:
            e = self.events.pop(0)
            if "walk" in e:
                g.walk_target = np.array([e["walk"][0], 0.0, e["walk"][1]])
                g.stuck = 0.0
            if "throw" in e:
                g.player.throw(g.ball, np.array([e["throw"][0], 0.0, e["throw"][1]]))
            if "click" in e:                           # click where a world point appears on screen
                c = g.cam.proj(W / H) @ g.cam.view() @ np.array([*e["click"], 1.0])
                g.click((c[0] / c[3] + 1) / 2 * W, (1 - c[1] / c[3]) / 2 * H)
            if "mapclick" in e:
                m = g.minimap
                x, z = e["mapclick"]
                c = g.player.pos
                u = (x - c[0] + RANGE) / (2 * RANGE)
                v = (z - c[2] + RANGE) / (2 * RANGE)
                g.click(m.left + u * MAP_SIZE, m.top + v * MAP_SIZE)
            if "cam" in e:
                y, p, r = e["cam"]
                self.cam_goal = (math.radians(y), p, r)
                if e.get("cut"):
                    g.cam.yaw, g.cam.pitch, g.cam.dist = self.cam_goal
            if "boxes" in e:
                g.show_boxes = e["boxes"]
            if e.get("deselect"):
                g.selected = None
            if e.get("end"):
                self.done = True
        if self.cam_goal:                              # ease the camera toward the goal
            k = 1 - math.exp(-2.5 * dt)
            c = g.cam
            c.yaw += ((self.cam_goal[0] - c.yaw + math.pi) % (2 * math.pi) - math.pi) * k
            c.pitch += (self.cam_goal[1] - c.pitch) * k
            c.dist += (self.cam_goal[2] - c.dist) * k


def main():
    setup_window()
    game = Game()
    cam = game.cam
    if os.environ.get("CG_CAM"):
        y, p, r = (float(v) for v in os.environ["CG_CAM"].split(","))
        cam.yaw, cam.pitch, cam.dist = math.radians(y), p, r
    demo = Demo(os.environ["CG_DEMO"], game) if os.environ.get("CG_DEMO") else None
    shot = os.environ.get("CG_SHOT")
    shot_sec = float(os.environ.get("CG_SHOT_SEC", "1.0"))
    rec = None
    if os.environ.get("CG_REC"):           # pipe frames to ffmpeg (30 fps H.264)
        rec = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                                "-s", f"{W}x{H}", "-r", "30", "-i", "-", "-vf", "vflip",
                                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "21",
                                "-movflags", "+faststart", os.environ["CG_REC"]],
                               stdin=subprocess.PIPE)
    fixed_step = bool(shot or rec)
    if rec:
        game.sound.log = []                 # record sound events, mixed into the video afterwards

    clock = pygame.time.Clock()
    sim_t, fps_t, frame = 0.0, 0.0, 0
    press, dragged = None, 0
    print(__doc__)
    running = True
    while running:
        dt = min(clock.tick(60) / 1000.0, 0.05)
        if fixed_step:
            dt = 1 / 60                     # fixed step so test shots and videos are repeatable
        sim_t += dt
        game.sound.time = sim_t
        for e in pygame.event.get():
            if e.type == pygame.QUIT or (e.type == pygame.KEYDOWN and e.key == pygame.K_ESCAPE):
                running = False
            elif e.type == pygame.KEYDOWN:
                if e.key == pygame.K_b:
                    game.show_boxes = not game.show_boxes
                elif e.key == pygame.K_f:
                    game.throw()
                elif e.key == pygame.K_e:
                    game.player.wave()
                elif e.key == pygame.K_m:
                    game.sound.toggle_mute()
                elif e.key == pygame.K_F12:
                    screenshot(f"shot_{time.strftime('%H%M%S')}.png")
            elif e.type == pygame.MOUSEBUTTONDOWN and e.button == 1:
                press, dragged = e.pos, 0
            elif e.type == pygame.MOUSEMOTION and e.buttons[0]:
                dragged += abs(e.rel[0]) + abs(e.rel[1])
                if dragged >= CLICK_PIXELS:
                    cam.rotate(*e.rel)
            elif e.type == pygame.MOUSEBUTTONUP and e.button == 1:
                if press is not None and dragged < CLICK_PIXELS:
                    game.click(*e.pos)
                press = None
            elif e.type == pygame.MOUSEWHEEL:
                cam.zoom(e.y)

        keys = pygame.key.get_pressed()
        if demo:
            demo.step(sim_t, dt)
            running = running and not demo.done
        game.update(dt, game.move_input(keys), keys[pygame.K_LSHIFT] or keys[pygame.K_RSHIFT])
        game.draw()

        if rec and frame % 2 == 0:
            rec.stdin.write(read_frame())
        frame += 1
        if shot and sim_t >= shot_sec:
            screenshot(shot)
            print("dog state:", game.dog.state, "dog pos:", np.round(game.dog.pos, 2))
            running = False
        pygame.display.flip()

        fps_t += dt
        if fps_t > 0.5:
            fps_t = 0
            sel = f"  |  selected: {game.selected.name}" if game.selected else ""
            pygame.display.set_caption(f"P3 Starter  |  {clock.get_fps():.0f} fps  |  dog: {game.dog.state}{sel}")
    if rec:
        rec.stdin.close()
        rec.wait()
        # mix the logged sound events and put them into the video
        wav = os.environ["CG_REC"] + ".wav"
        game.sound.write_mix(wav, sim_t)
        tmp = os.environ["CG_REC"] + ".tmp.mp4"
        os.replace(os.environ["CG_REC"], tmp)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-i", wav, "-c:v", "copy",
                        "-af", "loudnorm=I=-20:TP=-1.5:LRA=11", "-ar", "44100", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart",
                        os.environ["CG_REC"]], check=True)
        os.remove(tmp)
    pygame.quit()


if __name__ == "__main__":
    main()
