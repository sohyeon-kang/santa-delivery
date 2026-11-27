import * as THREE from 'three';

// Reuse one small particle pool for each handover, with no added light or shadow.
export class DeliveryEffects {
  constructor(scene) {
    this.positions = new Float32Array(64 * 3);
    this.velocities = new Float32Array(64 * 3);
    const colors = new Float32Array(64 * 3);
    const palette = ['#ffe4a0', '#ee7777', '#8fe3c2', '#ffffff'];
    for (let i = 0; i < 64; i++) new THREE.Color(palette[i % palette.length]).toArray(colors, i * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.material = new THREE.PointsMaterial({size:0.16,vertexColors:true,transparent:true,depthWrite:false});
    this.points = new THREE.Points(geometry,this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.age = 2;
    scene.add(this.points);
  }

  burst(position) {
    for (let i = 0; i < 64; i++) {
      const offset = i * 3;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 1.6;
      this.positions.set([position.x,position.y+1.4,position.z],offset);
      this.velocities.set([Math.cos(angle)*speed,2+Math.random()*2,Math.sin(angle)*speed],offset);
    }
    this.age = 0;
    this.material.opacity = 1;
    this.points.visible = true;
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  update(dt) {
    if (!this.points.visible) return;
    this.age += dt;
    this.points.visible = this.age < 1.8;
    this.material.opacity = Math.max(0,1-this.age/1.8);
    for (let i = 0; i < 64; i++) {
      const offset = i * 3;
      this.velocities[offset+1] -= 4.8 * dt;
      for (let axis = 0; axis < 3; axis++) this.positions[offset+axis] += this.velocities[offset+axis] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
