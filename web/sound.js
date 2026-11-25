// Sound effects with 3D placement (Web Audio through three.js), same idea as python/sound.py:
//   - THREE.AudioListener sits on an "ears" object at the player's head, turned like the camera
//   - each placed sound is a THREE.PositionalAudio: 'inverse' distance model, equal-power panning
//   - roles, files and gains come from assets/sounds/sounds.json; M mutes
// Browsers start audio only after the first click or key press, so main.js calls resume() then.
import * as THREE from 'three';

const SOUNDS = '../assets/sounds/';
const REF_DISTANCE = 3.0;    // m, full volume inside this distance
const ROLLOFF = 1.0;
const MAX_DISTANCE = 40.0;   // m, silent beyond this
const VOICES = 16;           // positional sounds that can play at the same time

export class Sound {
  constructor(scene) {
    this.ears = new THREE.Object3D();
    this.listener = new THREE.AudioListener();
    this.ears.add(this.listener);
    scene.add(this.ears);
    this.voices = [];
    for (let i = 0; i < VOICES; i++) {
      const v = new THREE.PositionalAudio(this.listener);
      v.setDistanceModel('inverse');
      v.setRefDistance(REF_DISTANCE);
      v.setRolloffFactor(ROLLOFF);
      v.setMaxDistance(MAX_DISTANCE);
      v.panner.panningModel = 'equalpower';
      scene.add(v);
      this.voices.push(v);
    }
    this.next = 0;
    this.roles = {};
    this.buffers = {};
    this.muted = false;
    this.time = 0;           // simulation time, set by main.js
    this.log = null;         // an array here records every play() call (used by tests)
  }

  async load() {
    const roles = await (await fetch(SOUNDS + 'sounds.json')).json();
    const loader = new THREE.AudioLoader();
    for (const [role, r] of Object.entries(roles)) {
      if (role.startsWith('_')) continue;
      this.roles[role] = r;
      this.buffers[role] = await Promise.all(r.files.map((f) => loader.loadAsync(SOUNDS + f)));
    }
  }

  resume() {
    if (this.listener.context.state !== 'running') this.listener.context.resume();
  }

  // call once per frame: ears at the player's head, facing where the camera faces
  setListener(position, cameraQuaternion) {
    this.ears.position.copy(position);
    this.ears.quaternion.copy(cameraQuaternion);
  }

  // play one take of `role` at world position `pos` (null = UI sound, no placement)
  play(role, pos = null, volume = 1) {
    const r = this.roles[role], takes = this.buffers[role];
    if (this.log) this.log.push([this.time, role]);   // test mode: remember what would play
    if (this.muted || !r || !takes || this.listener.context.state !== 'running') return;
    const buffer = takes[Math.floor(Math.random() * takes.length)];
    const gain = (r.gain ?? 1) * volume;
    if (pos === null || r.ui) {
      const a = new THREE.Audio(this.listener);
      a.setBuffer(buffer);
      a.setVolume(gain);
      a.play();
      a.source.onended = () => a.disconnect();
      return;
    }
    const v = this.voices[this.next];
    this.next = (this.next + 1) % VOICES;
    if (v.isPlaying) v.stop();
    v.position.copy(pos);
    v.updateMatrixWorld();
    v.setBuffer(buffer);
    v.setVolume(gain);
    v.play();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) for (const v of this.voices) if (v.isPlaying) v.stop();
  }
}
