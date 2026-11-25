"""The player character and a dog that greets the player and plays fetch.

The dog is a small state machine (W13 Game Programming Patterns):

    WANDER --player within notice radius--> NOTICE --> APPROACH --close--> GREET --> FOLLOW
       ^                                                                             |
       +-------------------------- player farther than leave radius ------------------+

    ball thrown (from any state, if the player is near) --> CHASE --> RETURN --> DROP --> FOLLOW

Events use the observer pattern (W13): the dog calls on_greet when it starts a
greeting, the player calls on_throw when the ball leaves the hand. main.py
connects them: the player waves back, and the dog runs after the ball.

The three.js track (web/actors.js) implements the same states and numbers.
"""
import math
import random

import numpy as np

from physics import push_out


def turn_toward(heading, target, rate, dt):
    """Rotate heading (radians) toward target by at most rate*dt, the short way."""
    d = (target - heading + math.pi) % (2 * math.pi) - math.pi
    step = rate * dt
    return target if abs(d) <= step else heading + math.copysign(step, d)


def heading_of(v):
    """Heading whose forward (+Z of the model) points along v on the ground."""
    return math.atan2(v[0], v[2])


def forward(heading):
    return np.array([math.sin(heading), 0.0, math.cos(heading)])


def smoothstep(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


class Player:
    WALK, SPRINT = 2.2, 5.0          # m/s
    TURN = 10.0                      # rad/s
    RADIUS = 0.35                    # m, for collision
    THROW_SPEED = (5.5, 3.5)         # m/s forward, up

    def __init__(self, inst, colliders=()):
        self.inst = inst
        self.anim = inst.animator
        self.anim.play("idle")
        self.colliders = colliders
        self.emote = 0.0             # seconds left in a one-shot emote
        self.look_at = None          # point to turn toward while standing still
        self.on_throw = []           # observers: f(player)
        self.on_step = []            # observers: f(player), once per footstep
        self._stride = 0.0

    @property
    def pos(self):
        return self.inst.pos

    def _one_shot(self, clip, repeat=1):
        if self.anim.has(clip):
            self.anim.play(clip, fade=0.1, loop=False, restart=True)
            self.emote = self.anim.model.clips[clip].duration * repeat

    def wave(self, toward=None):
        self._one_shot("emote-yes", 2)
        self.look_at = None if toward is None else np.array(toward, float)

    def throw(self, ball, direction):
        """Turn to `direction` (ground vector) and throw the ball."""
        d = np.array(direction, float)
        d[1] = 0
        d /= np.linalg.norm(d)
        self.inst.heading = heading_of(d)
        self.look_at = None
        self._one_shot("interact-right", 2)
        start = self.pos + d * 0.4 + (0, 1.1, 0)
        ball.throw(start, d * self.THROW_SPEED[0] + (0, self.THROW_SPEED[1], 0))
        for f in self.on_throw:
            f(self)

    def update(self, dt, move, sprint):
        """move: desired direction on the ground (unit or zero vector)."""
        speed = 0.0
        if np.linalg.norm(move) > 1e-6:
            speed = self.SPRINT if sprint else self.WALK
            before = self.inst.pos.copy()
            self.inst.pos += move * speed * dt
            push_out(self.inst.pos, self.RADIUS, self.colliders)
            self._stride += float(np.linalg.norm((self.inst.pos - before)[[0, 2]]))
            if self._stride > (1.25 if sprint else 0.75):        # metres between footsteps
                self._stride = 0.0
                for f in self.on_step:
                    f(self)
            self.inst.heading = turn_toward(self.inst.heading, heading_of(move), self.TURN, dt)
            self.look_at = None
        elif self.look_at is not None:
            self.inst.heading = turn_toward(self.inst.heading, heading_of(self.look_at - self.pos),
                                            self.TURN * 0.5, dt)
        if self.emote > 0:
            self.emote -= dt
            if speed > 0:            # moving cancels the emote
                self.emote = 0
        if self.emote <= 0:
            self.anim.play("idle" if speed == 0 else "sprint" if sprint else "walk")
        self.anim.update(dt)


class Dog:
    NOTICE_RADIUS = 6.0      # starts paying attention inside this distance
    GREET_DISTANCE = 1.5     # stops this close to the player and greets
    FOLLOW_DISTANCE = 2.4    # in FOLLOW, catches up when the player is farther than this
    LEAVE_RADIUS = 11.0      # gives up and goes home beyond this distance
    WALK, RUN = 1.0, 4.2     # m/s
    TURN = 7.0               # rad/s
    RADIUS = 0.3             # m, for collision
    HOP_TIME = 1.0           # greeting part 1: three happy hops
    SPIN_TIME = 1.2          # greeting part 2: dance and spin once
    GREET_TIME = 2.6         # whole greeting, then FOLLOW
    HOP_HEIGHT = 0.3         # m
    PICK_DISTANCE = 0.55     # mouth reaches the ball within this distance
    DROP_TIME = 1.0          # wag after dropping the ball
    MOUTH = (0.0, 0.42, 0.42)  # ball position in the dog's frame (right, up, forward), m

    def __init__(self, inst, home, wander_radius=4.0, colliders=(), seed=1):
        self.inst = inst
        self.anim = inst.animator
        self.home = np.array(home, float)
        self.wander_radius = wander_radius
        self.colliders = colliders
        self.rng = random.Random(seed)
        self.state = "WANDER"
        self.timer = 0.0
        self.goal = None
        self.hop = 0.0
        self.greeted = False         # greet once per visit, not every time it catches up
        self.rest_for = 2.0
        self.greet_heading = 0.0
        self.ball = None             # the ball being chased or carried
        self.on_greet = []           # observers: f(dog)
        self.on_bark = []            # observers: f(dog)
        self.anim.play("idle")

    @property
    def pos(self):
        return self.inst.pos

    def set_state(self, s):
        self.state, self.timer = s, 0.0
        if s in ("NOTICE", "DROP"):                  # a bark when it spots you and when it brings the ball
            self.bark()

    def bark(self):
        for f in self.on_bark:
            f(self)

    def mouth(self):
        f = forward(self.inst.heading)
        r = np.array([f[2], 0, -f[0]])
        m = self.MOUTH
        return self.inst.pos + r * m[0] + np.array([0, m[1], 0]) + f * m[2]

    def _move_to(self, target, speed, dt, stop=0.05):
        d = target - self.inst.pos
        d[1] = 0
        dist = float(np.linalg.norm(d))
        if dist <= stop + 0.05:          # small tolerance: the target may be moving
            return True
        self.inst.heading = turn_toward(self.inst.heading, heading_of(d), self.TURN, dt)
        # move mostly forward so the dog curves instead of sliding sideways
        fwd = forward(self.inst.heading)
        step = min(speed * dt, dist - stop)
        self.inst.pos += fwd * step * max(0.2, float(np.dot(fwd, d / dist)))
        push_out(self.inst.pos, self.RADIUS, self.colliders)
        return False

    def _face(self, target, dt):
        d = target - self.inst.pos
        self.inst.heading = turn_toward(self.inst.heading, heading_of(d), self.TURN, dt)

    def _start_greeting(self, player_pos):
        self.set_state("GREET")
        self.greet_heading = heading_of(player_pos - self.inst.pos)
        self.anim.play("gesture-positive", fade=0.1)
        self.bark()
        for f in self.on_greet:
            f(self)

    def ball_thrown(self, ball, player_pos):
        """Observer callback: the player threw the ball."""
        near = np.linalg.norm((player_pos - self.inst.pos)[[0, 2]]) < self.LEAVE_RADIUS
        if near and self.state not in ("CHASE", "RETURN"):
            self.ball = ball
            self.greeted = True              # playing counts as having said hello
            self.set_state("CHASE")

    def update(self, dt, player_pos):
        self.timer += dt
        to_player = player_pos - self.inst.pos
        to_player[1] = 0
        dist = float(np.linalg.norm(to_player))
        self.hop = 0.0

        if self.state == "WANDER":
            if dist < self.NOTICE_RADIUS:
                self.set_state("NOTICE")
            elif self.goal is None and np.linalg.norm((self.inst.pos - self.home)[[0, 2]]) > self.wander_radius + 1:
                self.goal = self.home.copy()             # far from home: walk back first
            elif self.goal is None:                      # resting
                self.anim.play("idle")
                if self.timer > self.rest_for:
                    a = self.rng.uniform(0, 2 * math.pi)
                    r = self.wander_radius * math.sqrt(self.rng.random())
                    self.goal = self.home + np.array([math.cos(a) * r, 0, math.sin(a) * r])
                    self.timer = 0
                    self.rest_for = self.rng.uniform(1.5, 3.5)
            else:                                        # trotting to a random spot
                self.anim.play("walk")
                if self._move_to(self.goal, self.WALK, dt) or self.timer > 8:
                    self.goal, self.timer = None, 0

        elif self.state == "NOTICE":                     # stop, turn, look
            self.anim.play("idle", fade=0.1)
            self._face(player_pos, dt)
            if self.timer > 0.5:
                self.set_state("APPROACH")

        elif self.state == "APPROACH":
            self.anim.play("run")
            if dist > self.LEAVE_RADIUS:
                self.set_state("WANDER")
            elif self._move_to(player_pos, self.RUN, dt, stop=self.GREET_DISTANCE):
                if self.greeted:
                    self.set_state("FOLLOW")
                else:
                    self._start_greeting(player_pos)

        elif self.state == "GREET":
            t = self.timer
            if t < self.HOP_TIME:                        # three hops, wagging
                self.anim.play("gesture-positive", fade=0.1)
                self.hop = abs(math.sin(math.pi * 3 * t / self.HOP_TIME)) * self.HOP_HEIGHT
                self.inst.heading = self.greet_heading
            elif t < self.HOP_TIME + self.SPIN_TIME:     # dance and spin once
                if t - dt < self.HOP_TIME:
                    self.bark()                          # one more happy bark as the spin starts
                self.anim.play("dance", fade=0.15)
                a = smoothstep((t - self.HOP_TIME) / self.SPIN_TIME)
                self.inst.heading = self.greet_heading + 2 * math.pi * a
            else:                                        # sit still and look up
                self.anim.play("idle", fade=0.2)
                self.inst.heading = self.greet_heading
            if t > self.GREET_TIME:
                self.greeted = True
                self.set_state("FOLLOW")

        elif self.state == "FOLLOW":
            if dist > self.LEAVE_RADIUS:
                self.greeted = False                     # next visit gets a new greeting
                self.goal = None
                self.set_state("WANDER")
            elif dist > self.FOLLOW_DISTANCE:
                fast = dist > 2 * self.FOLLOW_DISTANCE
                self.anim.play("run" if fast else "walk")
                self._move_to(player_pos, self.RUN if fast else self.WALK * 2.2, dt,
                              stop=self.GREET_DISTANCE)
            else:
                self.anim.play("idle")
                self._face(player_pos, dt)

        elif self.state == "CHASE":                      # run to where the ball is now
            self.anim.play("run")
            b = self.ball
            d = float(np.linalg.norm((b.pos - self.inst.pos)[[0, 2]]))
            if b.resting and d < self.PICK_DISTANCE:
                self.set_state("RETURN")                 # got it
            else:                                        # slow down near the ball
                self._move_to(b.pos, self.RUN if d > 1.5 else self.RUN * 0.6, dt,
                              stop=self.PICK_DISTANCE - 0.15)
            if self.timer > 15:                          # ball out of reach: give up
                self.ball = None
                self.set_state("FOLLOW")

        elif self.state == "RETURN":                     # carry it back, tail up
            self.anim.play("run")
            if self._move_to(player_pos, self.RUN, dt, stop=self.GREET_DISTANCE):
                self.set_state("DROP")
                self.ball.drop_at(self.mouth())
                self.anim.play("gesture-positive", fade=0.1)

        elif self.state == "DROP":                       # proud wiggle, then follow
            self._face(player_pos, dt)
            self.hop = abs(math.sin(math.pi * 2 * self.timer / self.DROP_TIME)) * self.HOP_HEIGHT * 0.5
            if self.timer > self.DROP_TIME:
                self.ball = None
                self.set_state("FOLLOW")

        self.inst.pos[1] = self.hop
        if self.state == "RETURN":
            self.ball.hold_at(self.mouth())
        self.anim.update(dt)
