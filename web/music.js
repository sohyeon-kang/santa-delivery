// Decode ahead and schedule on the audio clock: no network wait between songs.
const FILES = {
  title:'silent-night-kevin-macleod.mp3', opening:'we-wish-you-kevin-macleod.mp3',
  loop:'deck-the-halls-b-kevin-macleod.mp3', ending:'jingle-bells-kevin-macleod.mp3',
};

function audibleRange(buffer) {
  const stride=Math.max(1,Math.floor(buffer.sampleRate*0.01));
  const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
  const loud=start=>channels.some(channel=>{
    let energy=0,end=Math.min(start+stride,buffer.length);
    for(let i=start;i<end;i++)energy+=channel[i]*channel[i];
    return Math.sqrt(energy/(end-start))>0.0015;
  });
  let first=0,last=Math.max(0,buffer.length-stride);
  while(first<last&&!loud(first))first+=stride;
  while(last>first&&!loud(last))last-=stride;
  if(first>=last)return {start:0,end:buffer.duration};
  return {start:Math.max(0,(first-stride)/buffer.sampleRate),end:Math.min(buffer.duration,(last+2*stride)/buffer.sampleRate)};
}

export class Music {
  constructor(onError) {
    this.onError=onError;
    this.stage='title';this.track=null;this.muted=false;
    this.context=new AudioContext();
    this.master=this.context.createGain();
    this.master.connect(this.context.destination);
    this.sources=[];this.generation=0;this.buffers=new Map();
    for(const track of Object.keys(FILES))this.load(track).catch(()=>{});
    const owner=this;
    this.audio={get paused(){return owner.context.state!=='running'||!owner.sources.length;}};
  }

  load(track) {
    if(!this.buffers.has(track))this.buffers.set(track,(async()=>{
      const response=await fetch('../assets/sounds/music/'+FILES[track]);
      if(!response.ok)throw new Error('Music '+response.status);
      const buffer=await this.context.decodeAudioData(await response.arrayBuffer());
      return {buffer,...audibleRange(buffer)};
    })());
    return this.buffers.get(track);
  }

  schedule(track,clip,when,loop=false) {
    const source=this.context.createBufferSource(),gain=this.context.createGain();
    source.buffer=clip.buffer;source.loop=loop;
    source.loopStart=clip.start;source.loopEnd=clip.end;
    const volume=track==='ending'?0.65:0.45;
    gain.gain.setValueAtTime(0,when);
    gain.gain.linearRampToValueAtTime(volume,when+0.015);
    source.connect(gain).connect(this.master);
    this.sources.push(source);
    source.onended=()=>{source.disconnect();gain.disconnect();this.sources=this.sources.filter(s=>s!==source);};
    source.start(when,clip.start);
    if(!loop){
      const end=when+clip.end-clip.start;
      gain.gain.setValueAtTime(volume,Math.max(when+0.015,end-0.035));
      gain.gain.linearRampToValueAtTime(0,end);
      source.stop(end);
    }
    return source;
  }

  async play(track) {
    const generation=++this.generation;
    this.track=track;
    for(const source of this.sources)source.stop();
    this.sources=[];
    try{
      const [, ...clips]=await Promise.all([this.context.resume(),this.load(track),...(track==='opening'?[this.load('loop')]:[])]);
      if(generation!==this.generation)return;
      const when=this.context.currentTime+0.025;
      const source=this.schedule(track,clips[0],when,track==='title'||track==='loop');
      if(track==='opening'){
        this.schedule('loop',clips[1],when+clips[0].end-clips[0].start-0.035,true);
        const cleanup=source.onended;
        source.onended=()=>{cleanup();if(generation===this.generation)this.track='loop';};
      }
    }catch(error){
      if(generation===this.generation&&!(track==='title'&&error.name==='NotAllowedError'))this.onError();
    }
  }

  preview(){if(this.stage==='title')this.play('title');}
  start(){this.stage='game';this.play('opening');}
  finish(){this.stage='ending';this.play('ending');}
  setMuted(muted){this.muted=muted;this.master.gain.setTargetAtTime(muted?0:1,this.context.currentTime,0.01);}
}
