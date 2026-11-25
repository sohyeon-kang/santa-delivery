"""Sound effects with simple 3D placement (pygame.mixer).

Each sound plays at a world position and the listener is the camera:
  - distance attenuation, the "inverse" model of Web Audio / OpenAL:
        gain = ref / (ref + rolloff * (max(d, ref) - ref))
  - left/right panning from the angle to the camera's right vector (equal-power pan)
The three.js track gets the same from THREE.PositionalAudio (HRTF-free 'equalpower' panner).
Roles, files and gains are in assets/sounds/sounds.json. M mutes.
"""
import json
import math
import os
import random

import numpy as np
import pygame

from scene import ROOT

SOUNDS = os.path.join(ROOT, "assets", "sounds")
REF_DISTANCE = 3.0      # m, full volume inside this distance
ROLLOFF = 1.0
MAX_DISTANCE = 40.0     # m, silent beyond this


class Sound:
    def __init__(self):
        self.ok = True
        self.time = 0.0          # simulation time, set by the game loop
        self.log = None          # a list here records events instead of playing them (see write_mix)
        try:
            pygame.mixer.quit()                       # pygame.init() opened it with default settings
            pygame.mixer.init(44100, -16, 2, 512)
            pygame.mixer.set_num_channels(24)
        except pygame.error as e:          # no audio device: keep running silently
            print("sound off:", e)
            self.ok = False
        with open(os.path.join(SOUNDS, "sounds.json"), encoding="utf-8") as f:
            self.roles = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
        self.takes = {}
        if self.ok:
            for role, r in self.roles.items():
                self.takes[role] = [pygame.mixer.Sound(os.path.join(SOUNDS, n)) for n in r["files"]]
        self.muted = False
        self.ear = np.zeros(3)
        self.right = np.array([1.0, 0.0, 0.0])
        self.rng = random.Random(3)

    def listener(self, eye, right):
        """Call once per frame with the camera position and its right vector."""
        self.ear = np.asarray(eye, float)
        self.right = np.asarray(right, float)

    def play(self, role, pos=None, volume=1.0):
        """Play one take of `role` at world position `pos` (None = UI sound, no placement)."""
        if not self.ok or self.muted or role not in self.takes:
            return
        r = self.roles[role]
        g = r.get("gain", 1.0) * volume
        pan = 0.0
        if pos is not None and not r.get("ui"):
            v = np.asarray(pos, float) - self.ear
            d = float(np.linalg.norm(v))
            if d > MAX_DISTANCE:
                return
            g *= REF_DISTANCE / (REF_DISTANCE + ROLLOFF * (max(d, REF_DISTANCE) - REF_DISTANCE))
            if d > 1e-6:
                pan = float(np.dot(v / d, self.right))        # -1 left .. +1 right
        k = self.rng.randrange(len(r["files"]))
        a = (pan + 1) * math.pi / 4                            # equal-power pan law
        left, right = min(1.0, g * math.cos(a)), min(1.0, g * math.sin(a))
        if self.log is not None:
            self.log.append((self.time, role, r["files"][k], left, right))
            return
        ch = self.takes[role][k].play()
        if ch is not None:                                     # None: every channel is busy
            ch.set_volume(left, right)

    def write_mix(self, path, duration, sr=44100):
        """Mix the recorded events into a stereo WAV (used when recording the demo video)."""
        import wave
        out = np.zeros((int(duration * sr) + sr, 2), np.float32)
        cache = {}
        for t, role, name, left, right in self.log:
            if name not in cache:
                with wave.open(os.path.join(SOUNDS, name), "rb") as w:
                    s = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
                cache[name] = s
            s = cache[name]
            i = int(t * sr)
            n = min(len(s), len(out) - i)
            out[i:i + n, 0] += s[:n] * left
            out[i:i + n, 1] += s[:n] * right
        out = out[:int(duration * sr)]
        pcm = (np.clip(out, -1, 1) * 32767).astype(np.int16)
        with wave.open(path, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(pcm.tobytes())

    def toggle_mute(self):
        self.muted = not self.muted
        if self.ok and self.muted:
            pygame.mixer.stop()
