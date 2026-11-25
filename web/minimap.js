// Minimap HUD: a second, top-down orthographic camera drawn into a corner viewport.
// Same idea as python/minimap.py:
//   - setViewport + setScissor restrict drawing (and clearing) to the corner rectangle
//   - the camera looks straight down with "up" = -Z, so north is up on the map
//   - three.js culls objects outside the camera frustum by itself
//   - icons live on layer 1, which only the minimap camera renders
//   - clicking the map makes the player walk to that spot
import * as THREE from 'three';

export const SIZE = 240;     // CSS pixels
export const MARGIN = 16;    // CSS pixels from the window corner
export const RANGE = 24;     // half width of the map square, m
const ICON_LAYER = 1;
const Y = 40;                // icons float above everything

function icon(geometry, color, order) {
  const m = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;      // lay the flat shape on the ground plane
  m.renderOrder = order;
  m.layers.set(ICON_LAYER);
  return m;
}

function arrowShape(size) {         // triangle pointing along +Y in shape space
  const s = new THREE.Shape();
  s.moveTo(0, size); s.lineTo(-0.7 * size, -0.6 * size); s.lineTo(0.7 * size, -0.6 * size); s.closePath();
  return new THREE.ShapeGeometry(s);
}

export class Minimap {
  constructor(scene) {
    this.scene = scene;
    this.camera = new THREE.OrthographicCamera(-RANGE, RANGE, RANGE, -RANGE, 1, 160);
    this.camera.up.set(0, 0, -1);
    this.camera.layers.enable(ICON_LAYER);
    this.center = new THREE.Vector3();
    const s = RANGE * 0.07;          // icon size in metres (about 8 px)
    this.icons = {
      playerBack: icon(arrowShape(s * 1.35), 0x1a1a1a, 20), player: icon(arrowShape(s), 0xffd91a, 21),
      dogBack: icon(new THREE.CircleGeometry(s * 0.75, 16), 0x1a1a1a, 20), dog: icon(new THREE.CircleGeometry(s * 0.6, 16), 0xf28c26, 21),
      ballBack: icon(new THREE.CircleGeometry(s * 0.55, 12), 0x1a1a1a, 20), ball: icon(new THREE.CircleGeometry(s * 0.4, 12), 0xe61a10, 21),
      target: icon(new THREE.RingGeometry(s * 0.45, s * 0.6, 20), 0x33ff66, 19),
    };
    const wedgeGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Array(12).fill(0), 3));
    this.wedge = new THREE.LineSegments(wedgeGeo, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
    this.wedge.renderOrder = 18;
    this.wedge.layers.set(ICON_LAYER);
    this.wedge.frustumCulled = false;
    for (const m of [...Object.values(this.icons), this.wedge]) scene.add(m);
  }

  rect() {   // window CSS pixels, origin top-left
    return { left: innerWidth - MARGIN - SIZE, top: MARGIN };
  }
  contains(mx, my) {
    const r = this.rect();
    return mx >= r.left && mx < r.left + SIZE && my >= r.top && my < r.top + SIZE;
  }
  toWorld(mx, my) {          // window pixel inside the map -> point on the ground
    const r = this.rect();
    const u = (mx - r.left) / SIZE, v = (my - r.top) / SIZE;
    return new THREE.Vector3(this.center.x - RANGE + 2 * RANGE * u, 0, this.center.z - RANGE + 2 * RANGE * v);
  }

  place(m, p, heading = null) {
    m.position.set(p.x, Y, p.z);
    if (heading !== null) m.rotation.set(-Math.PI / 2, 0, heading + Math.PI);   // shape +Y -> model +Z
  }

  update({ player, dog, ball, walkTarget, mainCamera, camYaw }) {
    this.center.set(player.pos.x, 0, player.pos.z);
    this.camera.position.set(this.center.x, 80, this.center.z);
    this.camera.lookAt(this.center);
    const I = this.icons;
    this.place(I.playerBack, player.pos, player.obj.rotation.y);
    this.place(I.player, player.pos, player.obj.rotation.y);
    this.place(I.dogBack, dog.pos); this.place(I.dog, dog.pos);
    const showBall = !ball.held || dog.state === 'RETURN';
    I.ball.visible = I.ballBack.visible = showBall;
    this.place(I.ballBack, ball.pos); this.place(I.ball, ball.pos);
    I.target.visible = walkTarget !== null;
    if (walkTarget) this.place(I.target, walkTarget);
    // what the main camera sees: a wedge of the horizontal field of view
    const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(mainCamera.fov) / 2) * mainCamera.aspect);
    const yaw = camYaw + Math.PI;       // camera forward heading
    const a = this.wedge.geometry.attributes.position;
    [yaw - half, yaw + half].forEach((h, k) => {
      a.setXYZ(2 * k, player.pos.x, Y, player.pos.z);
      a.setXYZ(2 * k + 1, player.pos.x + 12 * Math.sin(h), Y, player.pos.z + 12 * Math.cos(h));
    });
    a.needsUpdate = true;
  }

  render(renderer) {
    const r = this.rect();
    const x = r.left, y = innerHeight - r.top - SIZE;   // three.js viewports start at the bottom-left
    const border = 3;
    renderer.setScissorTest(true);
    renderer.setScissor(x - border, y - border, SIZE + 2 * border, SIZE + 2 * border);
    renderer.setClearColor(0x1f2924, 1);
    renderer.clear();
    renderer.setViewport(x, y, SIZE, SIZE);
    renderer.setScissor(x, y, SIZE, SIZE);
    const fog = this.scene.fog;
    this.scene.fog = null;                                // no fog from 80 m above
    renderer.render(this.scene, this.camera);
    this.scene.fog = fog;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, innerWidth, innerHeight);
  }
}
