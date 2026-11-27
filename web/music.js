// One music element prevents title, play and ending tracks from overlapping.
export class Music {
  constructor(onError) {
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.audio.volume = 0.45;
    this.onError = onError;
    this.stage = 'title';
    this.track = null;
    this.audio.addEventListener('ended', () => {
      if (this.stage === 'game' && this.track === 'opening') this.play('loop');
    });
  }

  play(track) {
    const files = {
      title: 'silent-night-kevin-macleod.mp3',
      opening: 'we-wish-you-kevin-macleod.mp3',
      loop: 'deck-the-halls-b-kevin-macleod.mp3',
      ending: 'jingle-bells-kevin-macleod.mp3',
    };
    this.audio.pause();
    this.track = track;
    this.audio.src = '../assets/sounds/music/' + files[track];
    this.audio.loop = track === 'title' || track === 'loop';
    this.audio.volume = track === 'ending' ? 0.65 : 0.45;
    this.audio.play().catch(error => {
      if (this.track === track && error.name !== 'AbortError' && !(track === 'title' && error.name === 'NotAllowedError')) this.onError();
    });
  }

  preview() {
    if (this.stage === 'title') this.play('title');
  }

  start() {
    this.stage = 'game';
    this.play('opening');
  }

  finish() {
    this.stage = 'ending';
    this.play('ending');
  }

  setMuted(muted) {
    this.audio.muted = muted;
    if (!muted && this.track && this.audio.paused) {
      this.audio.play().catch(() => this.onError());
    }
  }
}
