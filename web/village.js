// Winter scenery shares the game's placement, collision and minimap pipeline.
import * as THREE from 'three';

export const GIFT_TREE_POSITIONS = [[0,0],[-8.2,-3.2],[6.7,-5.3],[8.5,5.5],[-6.3,7.2]];

const roadMaterials = new WeakMap();
export function winterRoadMaterial(base) {
  if (roadMaterials.has(base)) return roadMaterials.get(base);
  const material = base.clone();
  material.roughness = 1;
  material.metalness = 0;
  material.customProgramCacheKey = () => 'winter-road-color-white-2';
  material.onBeforeCompile = shader => {
    shader.uniforms.uWinterRoadTint={value:new THREE.Color('#f1f6fd')};
    shader.fragmentShader='uniform vec3 uWinterRoadTint;\n'+shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      // Recolor the atlas's blue path, keeping white banks and stone details.
      // Pale blue-white snow stays matte; ice retains its blue reflective material.
      float pathColor = smoothstep(0.015, 0.08, diffuseColor.b - diffuseColor.r);
      diffuseColor.rgb = mix(diffuseColor.rgb, uWinterRoadTint, pathColor);
    `);
  };
  roadMaterials.set(base, material);
  return material;
}

export function winterVillage(data) {
  let tree = 0, house = 0, car = 0;
  const karts = ['oobi', 'oodi', 'ooli', 'oopi', 'oozi'];
  const originalGiftTrees = [[0,0],[-5.4,-1.2],[5.4,-1.2],[5.25,4.6],[-5.4,4.3]];
  const props = data.props.filter(({ model }) => !/nature-kit\/(grass_|flower_|plant_|stump_)|planter|traffic-light|detail-parasol/.test(model)).map(desc => {
    const name = desc.model.split('/').pop();
    if (desc.model.startsWith('holiday-kit/tree-')) {
      const index = originalGiftTrees.findIndex(([x,z]) => Math.hypot(x-desc.pos[0],z-desc.pos[2]) < 0.1);
      if (index >= 0) return { ...desc, pos:[GIFT_TREE_POSITIONS[index][0],0,GIFT_TREE_POSITIONS[index][1]], giftTree:index };
    }
    if (/^(tree_|tree-small|tree-large)/.test(name)) {
      // This original oak overlaps the southeast gift tree and its pickup spot.
      if (Math.hypot(desc.pos[0] - 5.68, desc.pos[2] - 5.78) < 0.1) return null;
      const index = tree++;
      if (Math.abs(desc.pos[0]) < 18 && Math.abs(desc.pos[2]) < 11 && index % 4 === 1) {
        const height = 1.1 + (index % 3) * 0.45;
        return { ...desc, model: 'holiday-kit/snowman-hat.glb', scale: 1, size: [height * 0.65, height, height * 0.65] };
      }
      // Keep a loose, staggered grove instead of a rectangular park border.
      const pos = [...desc.pos];
      if (Math.abs(pos[0]) < 20 && Math.abs(pos[2]) < 12) {
        pos[0] += Math.sin(index * 2.1) * 2;
        pos[2] += Math.cos(index * 1.7) * 1.7;
        if (GIFT_TREE_POSITIONS.some(([x,z]) => Math.hypot(x-pos[0],z-pos[2]) < 3.3)) return null;
      }
      return { ...desc, pos, model: index % 3 === 0 ? 'platformer-kit/tree-pine-snow.glb' : 'holiday-kit/tree-snow-b.glb', scale: 1,
        size: [2.7, 4.5 + index % 3, 2.7] };
    }
    if (desc.model.startsWith('city-kit-roads/road-')) {
      const crossing = !name.startsWith('road-straight');
      return { ...desc, model: `tower-defense-kit/snow-tile-${crossing ? 'crossing' : 'wide-straight'}.glb`,
        scale: 1, size: [8.02, 0.09, 8.02], pos: [desc.pos[0], -0.025, desc.pos[2]], rotY:(desc.rotY??0)+90 };
    }
    if (desc.model === 'city-kit-roads/tile-low.glb') {
      if (desc.scale === 2) return null;
      return { ...desc, model:'tower-defense-kit/snow-tile-wide-straight.glb', scale:1,
        size:[4.02,0.09,4.02], pos:[desc.pos[0],-0.025,desc.pos[2]], rotY:desc.pos[0]===0?0:90 };
    }
    if (name.startsWith('driveway-')) return null;
    if (desc.model.startsWith('city-kit-commercial/building-')) {
      return { ...desc, winterHouse: desc.pos[2] === 0 ? 'fantasy' : 'cabin', scale: 1 };
    }
    if (name.startsWith('building-type-')) {
      const index = house++;
      const fantasy = (index % 4 === 0 || index % 4 === 3) && index % 3 === 0;
      const pos=[...desc.pos];
      pos[0]+=Math.sin(index*2.17+0.4)*1.5;
      pos[2]+=Math.cos(index*1.71+0.8)*1.6;
      return { ...desc, pos,rotY:(desc.rotY??0)+Math.sin(index*1.83+0.3)*14,
        winterHouse: fantasy ? 'fantasy' : 'cabin', scale: 1 };
    }
    if (desc.model.startsWith('car-kit/')) {
      car++;
      if (car > 7) return null;
      if (car <= karts.length) return { ...desc, model: `car-kit/kart-${karts[car - 1]}.glb`, scale: 1, size: [1.6, 1.5, 2.6] };
    }
    return desc;
  }).filter(Boolean);
  const add = (model, pos, size, rotY = 0, extra = {}) => props.push({ model, pos, size, rotY, scale: 1, ...extra });
  for (const home of props.filter(p => p.model.includes('building-type-'))) {
    const [x,,z] = home.pos;
    const side = Math.sign(z);
    const yaw=THREE.MathUtils.degToRad(home.rotY??0);
    const doorX=x+Math.sin(yaw)*2.9,doorZ=z+Math.cos(yaw)*2.9;
    // A broad entry followed by two rounded bends brings the path to the door.
    [[x+side*3,side*19,'wide-transition',0],[x+side*3,side*22,'wide-corner',side<0?90:270],
      [doorX,doorZ-side*1.2,'wide-corner',side<0?270:90]].forEach(([px,pz,tile,rotation]) => {
      add(`tower-defense-kit/snow-tile-${tile}.glb`,[px,-0.025,pz],[3.04,0.09,3.04],rotation);
    });
  }
  const rockGroups = [
    [-19,-4,1.4], [18,5,1.1], [-10,-12,0.8], [9,12,0.65],
    [-30,-12,0.8], [30,12,1.2], [-43,12,0.7], [43,-12,1],
    [-28,-30,1.35], [28,30,0.9], [-19,34,1.1], [19,-34,0.75],
    [-53,-5,1.7], [52,5,1.5], [-48,38,1.2], [45,-38,1.5],
  ];
  for (const [i, [x,z,height]] of rockGroups.entries()) {
    const rock = i % 3 === 0 ? 'large' : 'medium';
    add(`holiday-kit/rocks-${rock}.glb`, [x,0,z], [height * 1.8,height,height * 1.3], i * 43);
    if (i % 2 === 0) add('holiday-kit/rocks-small.glb', [x+1.5,0,z+0.9], [0.75,0.4,0.65], i * 27);
  }
  const snowBanks = [[-8,10],[8,-10],[-20,4],[20,-4],[-40,-11],[40,11],[-18,-31],[18,31],[-30,35],[30,-35],[-51,12],[51,-12]];
  snowBanks.forEach(([x,z], i) => {
    add(`holiday-kit/${i % 2 ? 'snow-flat-large' : 'snow-flat'}.glb`, [x,0.015,z], [2.4+i%3,0.12,1.8], i * 38);
    if (i % 3 === 0) add('holiday-kit/snow-pile.glb', [x+0.8,0,z+0.4], [1.6,0.35,1.3], i * 23);
  });
  const holidayFigures = [
    ['gingerbread-man',-8,-3,1.4], ['gingerbread-woman',8,2,1.25],
    ['nutcracker',-10,12,1.9], ['nutcracker',10,-12,2.1],
    ['gingerbread-woman',-30,9,1.2], ['gingerbread-man',30,-9,1.5],
    ['nutcracker',-42,-29,1.6], ['nutcracker',42,29,1.8],
  ];
  holidayFigures.forEach(([name,x,z,height], i) => {
    add(`holiday-kit/${name}.glb`, [x,0,z], [height*0.55,height,height*0.3], i%2? -20:20);
  });
  for (const [i, x] of [-48,-12,12,48].entries()) {
    const side = i % 2 ? 1 : -1;
    add('holiday-kit/bench.glb', [x-side*4.6,0,side*25.2], [1.8,1.1,0.85], side<0?0:180);
    // A small railway display beside the porch leaves the door approach open.
    add('holiday-kit/trainset-rail-corner.glb', [x+side*4.3,0.03,side*26.6], [1.25,0.045,1.25], i*90);
  }
  for (const x of [-15, 15]) {
    for (const z of [-9, 9]) {
      const height = x < 0 ? (z < 0 ? 1.2 : 1.8) : (z < 0 ? 2.3 : 1.5);
      add('holiday-kit/snowman-hat.glb', [x, 0, z], [height * 0.65, height, height * 0.65]);
      add('holiday-kit/bench.glb', [x + 2.3, 0, z], [2.4, 1.2, 1.1], z < 0 ? 0 : 180);
    }
  }
  for (const [i, x] of [-48,-36,-12,0,12,36,48].entries()) {
    for (const side of [-1, 1]) {
      const height = 0.85 + (i % 4) * 0.4;
      add('holiday-kit/snowman-hat.glb', [x + side * 4.8, 0, side * 24], [height * 0.65, height, height * 0.65], -side * 25);
    }
  }
  for (const [i, x] of [-44,-18,18,44].entries()) {
    const height = 1.1 + i * 0.22;
    add('holiday-kit/snowman-hat.glb', [x, 0, i % 2 ? -11 : 11], [height * 0.65,height,height * 0.65]);
  }
  const residents = [[-43,-20,140],[-33,20,30],[-9,-20,120],[9,20,210],[39,-20,180],[44,20,15],[-13,8,90],[17,-8,-90],
    [-52,-36,40],[-30,-36,80],[-8,-38,120],[15,-36,200],[42,-36,220],[-48,36,0],[-30,36,90],[0,36,180],
    [18,36,250],[45,36,300],[-28,2,90],[28,-2,270]];
  const characters = ['female-a','female-b','female-c','female-d','female-e','female-f',
    'male-a','male-b','male-c','male-d','male-e','male-f','male-g','alien','knight','raider','robot','soldier','worker','zombie'];
  characters.filter(name => `mini-characters/character-${name}.glb` !== data.player.model).forEach((name, index) => {
    const [x,z,rot] = residents[index];
    add(`mini-characters/character-${name}.glb`, [x,0,z], undefined, rot, {height:1.65,ambient:true});
  });
  const animals = [['penguin',-11,11,0.9],['penguin',-13,12,0.7],['deer',16,-10,1.5],['fox',-17,-8,0.8],['polar',46,35,1.7],['bunny',-18,9,0.45],
    ['penguin',28,34,0.75],['penguin',-28,-34,0.8],['deer',-46,35,1.3],['deer',40,-35,1.5],
    ['fox',-40,-35,0.75],['fox',36,33,0.85],['polar',-45,-36,1.6],['bunny',15,34,0.5]];
  animals.forEach(([name,x,z,height], i) => add(`cube-pets/animal-${name}.glb`, [x,0,z], [height,height,height], i * 55, { ambient: true }));
  // Four rounded bends lead out of the plaza into the north and south streets.
  for (const side of [-1, 1]) {
    [[8,8,'wide-corner',0],[12,8,'wide-corner',180],[12,12,'wide-straight',0]].forEach(([x,z,tile,rot]) => {
      add(`tower-defense-kit/snow-tile-${tile}.glb`, [x*side,-0.025,z*side], [4.02,0.09,4.02], rot + (side < 0 ? 180 : 0));
    });
  }
  for (const [index, prop] of props.filter(p => /\/(tree[^/]*|snowman-hat)\.glb$/.test(p.model)).entries()) {
    if (!prop.model.includes('snowman') && prop.giftTree === undefined && index % 2) continue;
    const mainTree = prop.giftTree === 0;
    const width = mainTree ? 7.2 : prop.model.includes('snowman') ? 1.8 + index % 3 * 0.3 : 2.5 + index % 4 * 0.4;
    add('holiday-kit/snow-flat-large.glb', [prop.pos[0],0.005,prop.pos[2]], [width,0.07,width*0.82], index*47);
    if (index % 3 === 0) add('holiday-kit/snow-pile.glb', [prop.pos[0]+width*0.3,0.06,prop.pos[2]-width*0.2], [0.8,0.22,0.7], index*31);
  }
  const railCorners = [[-2.1,-2.1,0],[-2.1,2.1,90],[2.1,2.1,180],[2.1,-2.1,270]];
  for (const [x,z,rotation] of railCorners) {
    add('holiday-kit/trainset-rail-corner.glb',[x,0.14,z],[1.4,0.06,1.4],rotation);
  }
  for (const [x,z,rotation] of [[0,-2.8,0],[0,2.8,0],[-2.8,0,90],[2.8,0,90]]) {
    add('holiday-kit/trainset-rail-straight.glb',[x,0.14,z],[2.8,0.06,0.25],rotation);
  }
  add('holiday-kit/train-locomotive.glb',[-0.5,0.2,-2.8],[0.5,0.6,0.9],90);
  return props;
}

export async function buildWinterHouse(desc, place) {
  const fantasy = desc.winterHouse === 'fantasy';
  const group = new THREE.Group();
  const wall = fantasy ? 'fantasy-town-kit/wall-wood.glb' : 'holiday-kit/cabin-wall.glb';
  const faces = [[0,2.6,0],[0,-2.6,180],[-2.6,0,-90],[2.6,0,90]];
  for (const [x,z,rotY] of faces) {
    const part = await place({ model: wall, pos: [x,0,z], rotY, size: [5.2,3.8,0.3], scale: 1 }, true);
    group.add(part.obj);
  }
  if (fantasy) {
    const roof = await place({model:'fantasy-town-kit/roof-gable.glb',pos:[0,3.8,0],size:[6.3,2.8,6.3],scale:1},true);
    group.add(roof.obj);
  } else {
    // Holiday roof pieces each contain one slope. Mirror the pair at the ridge.
    for (const side of [-1,1]) {
      const roof = await place({model:'holiday-kit/cabin-roof-snow.glb',pos:[side*1.55,3.8,0],
        size:[3.25,2.8,6.3],rotY:side<0?180:0,scale:1},true);
      group.add(roof.obj);
    }
    const triangle = new THREE.Shape();
    triangle.moveTo(-2.65,0);
    triangle.lineTo(2.65,0);
    triangle.lineTo(0,2.65);
    triangle.closePath();
    const gableMaterial = new THREE.MeshStandardMaterial({color:'#825133',roughness:0.9,side:THREE.DoubleSide});
    for (const z of [-2.63,2.63]) {
      const gable = new THREE.Mesh(new THREE.ShapeGeometry(triangle),gableMaterial);
      gable.position.set(0,3.8,z);
      gable.castShadow = gable.receiveShadow = true;
      group.add(gable);
    }
  }
  const wood = new THREE.MeshStandardMaterial({ color: fantasy ? '#8d5543' : '#825133', roughness: 0.9 });
  const trim = new THREE.MeshStandardMaterial({ color: fantasy ? '#633b2c' : '#4c624b', roughness: 0.85 });
  const addBeam = (size, position, material = trim) => {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    beam.position.set(...position);
    beam.castShadow = beam.receiveShadow = true;
    group.add(beam);
    return beam;
  };
  addBeam([5.5,0.3,5.5],[0,0.15,0],new THREE.MeshStandardMaterial({color:'#8b8b98',roughness:1}));
  for (const x of [-2.55,2.55]) addBeam([0.22,3.8,0.28],[x,1.9,2.82]);
  for (const y of [0.45,3.55]) addBeam([5.4,0.2,0.28],[0,y,2.82]);
  addBeam([0.25,1.6,0.3],[0,4.55,2.8]);
  const chimney = addBeam([0.65,2,0.65],[1.7,5.3,-0.8],new THREE.MeshStandardMaterial({color:'#877981',roughness:1}));
  addBeam([0.8,0.16,0.8],[chimney.position.x,6.35,chimney.position.z],new THREE.MeshStandardMaterial({color:'#eef5ff',roughness:1}));
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.1,2.2,0.15), wood);
  door.position.set(0,1.1,2.85);
  group.add(door);
  const doorway = await place({model:'holiday-kit/cabin-doorway.glb',pos:[0,0.2,2.93],size:[1.65,2.45,0.32],scale:1});
  group.add(doorway.obj);
  for (const x of [-2.6,2.6]) {
    const logs = await place({model:'holiday-kit/cabin-corner-logs.glb',pos:[x,0.3,2.63],size:[0.34,3.4,0.4],scale:1});
    group.add(logs.obj);
  }
  const windowMaterial = new THREE.MeshStandardMaterial({ color: '#ffdb8c', emissive: '#ffb94e', emissiveIntensity: 0.65 });
  for (const x of [-1.7,1.7]) {
    const window = new THREE.Mesh(new THREE.BoxGeometry(0.85,1,0.12), windowMaterial);
    window.position.set(x,2.1,2.85);
    group.add(window);
    for (const dx of [-0.51,0.51]) addBeam([0.12,1.2,0.16],[x+dx,2.1,2.93]);
    for (const y of [1.54,2.66]) addBeam([1.14,0.12,0.16],[x,y,2.93]);
    addBeam([0.07,1,0.18],[x,2.1,2.96]);
    addBeam([0.9,0.07,0.18],[x,2.1,2.96]);
  }
  for (const side of [-1,1]) {
    const window = await place({model:'holiday-kit/cabin-window-a.glb',pos:[side*2.86,1.4,0],rotY:side*90,size:[1.35,1.5,0.3],scale:1});
    group.add(window.obj);
  }
  group.position.set(...desc.pos);
  group.rotation.y = THREE.MathUtils.degToRad(desc.rotY ?? 0);
  group.name = desc.model.split('/').pop().replace('.glb','');
  group.userData.deliveryHome = true;
  return { obj: group, clips: [] };
}

// House variation is intentional; nearby parked props must leave its footprint clear.
export function clearHouseEdges(props) {
  const homes=props.filter(p=>p.obj.userData.deliveryHome);
  for(const home of homes)for(const prop of props){
    const tree=prop.obj.name.startsWith('tree');
    if(!tree&&!/^(kart-|car-|bench)/.test(prop.obj.name))continue;
    const loX=tree?prop.obj.position.x-0.35:prop.box.min.x;
    const hiX=tree?prop.obj.position.x+0.35:prop.box.max.x;
    const loZ=tree?prop.obj.position.z-0.35:prop.box.min.z;
    const hiZ=tree?prop.obj.position.z+0.35:prop.box.max.z;
    if(hiX<=home.box.min.x||loX>=home.box.max.x||hiZ<=home.box.min.z||loZ>=home.box.max.z)continue;
    const dx=prop.obj.position.x>=home.obj.position.x
      ?home.box.max.x+0.45-loX:home.box.min.x-0.45-hiX;
    const old=prop.obj.position.clone();
    prop.obj.position.x+=dx;
    prop.obj.updateMatrixWorld(true);prop.box.setFromObject(prop.obj);
    if(tree)for(const snow of props){
      if(snow.obj.name.startsWith('snow-flat')&&Math.hypot(snow.obj.position.x-old.x,snow.obj.position.z-old.z)<0.4){
        snow.obj.position.x+=dx;snow.obj.updateMatrixWorld(true);snow.box.setFromObject(snow.obj);
      }
    }
  }
}

export async function decorateVillage(scene, props, place) {
  const bulbs = [];
  const colors = ['#ffb96b','#ed6471','#77dfcb'];
  const sphere = new THREE.SphereGeometry(0.10, 8, 6);
  const trees = props.filter(({obj}) => obj.name.startsWith('tree') && Math.hypot(obj.position.x,obj.position.z)>1);
  const strings = [];
  const connected = new Set();
  const regions = [[-46,-34],[-14,-34],[15,-34],[46,-34],[-46,34],[-14,34],[15,34],[46,34],[-16,2],[15,1],[-40,-4],[40,4]];
  for (const [index, [x,z]] of regions.entries()) {
    const anchor = trees.reduce((best, tree) =>
      Math.hypot(tree.obj.position.x-x,tree.obj.position.z-z) < Math.hypot(best.obj.position.x-x,best.obj.position.z-z) ? tree : best);
    const candidates = trees.filter(tree => {
      const distance = tree.obj.position.distanceTo(anchor.obj.position);
      const pair = [trees.indexOf(anchor),trees.indexOf(tree)].sort((a,b)=>a-b).join(',');
      return distance > 4 && distance < 17 && !connected.has(pair);
    }).sort((a,b)=>a.obj.position.distanceTo(anchor.obj.position)-b.obj.position.distanceTo(anchor.obj.position));
    const neighbor = candidates[0];
    if (!neighbor) continue;
    connected.add([trees.indexOf(anchor),trees.indexOf(neighbor)].sort((a,b)=>a-b).join(','));
    const height = THREE.MathUtils.clamp(Math.min(anchor.box.max.y,neighbor.box.max.y)*0.6,2.7,4.2);
    strings.push({from:[anchor.obj.position.x,height,anchor.obj.position.z],to:[neighbor.obj.position.x,height,neighbor.obj.position.z],
      model:['colored','red','green'][index%3]});
  }
  for (const [index, string] of strings.entries()) {
    const from = new THREE.Vector3(...string.from);
    const to = new THREE.Vector3(...string.to);
    const middle = from.clone().lerp(to,0.5);
    const delta = to.clone().sub(from);
    const lights = await place({model:`holiday-kit/lights-${string.model}.glb`,pos:middle.toArray(),
      size:[delta.length(),0.55,0.16],rotY:THREE.MathUtils.radToDeg(-Math.atan2(delta.z,delta.x)),scale:1});
    lights.obj.traverse(mesh => {
      if (!mesh.isMesh) return;
      const illuminate = base => {
        const material = base.clone();
        material.emissive.set('#ffffff');
        material.emissiveMap = material.map;
        material.emissiveIntensity = 1.4;
        bulbs.push({material,phase:index*1.4});
        return material;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(illuminate) : illuminate(mesh.material);
    });
    if (index % 5 === 0) {
      const light = new THREE.PointLight('#ffd39a',3,7,2);
      light.position.copy(middle).add(new THREE.Vector3(0,-0.3,0));
      scene.add(light);
    }
  }
  const ornamentModels = ['wreath-decorated','snowflake-a','candy-cane-red','snowflake-b'];
  const ornamentTrees = trees.filter(({obj}) => !obj.name.includes('decorated'));
  const decoratedTrees = new Set();
  for (const [index, [x,z]] of [[-15,-6],[12,7],[-42,34],[42,-34]].entries()) {
    const tree = ornamentTrees.filter(candidate=>!decoratedTrees.has(candidate)).reduce((best,candidate)=>
      Math.hypot(candidate.obj.position.x-x,candidate.obj.position.z-z) < Math.hypot(best.obj.position.x-x,best.obj.position.z-z) ? candidate : best);
    decoratedTrees.add(tree);
    const center=tree.box.getCenter(new THREE.Vector3());
    const y=tree.box.min.y+(tree.box.max.y-tree.box.min.y)*0.46;
    // The canopy narrows upward: its overall AABB front floats away at this height.
    const ray=new THREE.Raycaster(new THREE.Vector3(center.x,y,tree.box.max.z+2),new THREE.Vector3(0,0,-1));
    const hit=ray.intersectObject(tree.obj,true)[0];
    const surfaceZ=hit?hit.point.z:tree.obj.position.z;
    const ornament=await place({model:`holiday-kit/${ornamentModels[index]}.glb`,
      pos:[center.x,y-0.32,surfaceZ+0.04],size:[0.52,0.64,0.12],scale:1});
    ornament.obj.name='tree-ornament-'+ornamentModels[index];
    tree.obj.attach(ornament.obj);
  }
  const perchTrees = props.filter(({obj}) => obj.name.startsWith('tree') && Math.abs(obj.position.x) > 12 && Math.abs(obj.position.z) < 11).slice(0, 4);
  for (const [index, {obj, box}] of perchTrees.entries()) {
    const side = index % 2 ? -1 : 1;
    const height = Math.min(2.5, (box.max.y - box.min.y) * 0.55);
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.5, 6), new THREE.MeshStandardMaterial({color:'#825638',roughness:1}));
    branch.rotation.z = Math.PI / 2;
    branch.position.set(obj.position.x + side * 0.8, height, obj.position.z + 0.5);
    scene.add(branch);
    const animal = await place({model:`cube-pets/animal-${index % 2 ? 'monkey' : 'beaver'}.glb`,
      pos:[obj.position.x + side * 1.3,height + 0.1,obj.position.z + 0.5],size:[0.55,0.65,0.55],rotY:side * 90,scale:1,ambient:true});
    animal.obj.userData.perched = true;
    animal.obj.updateMatrixWorld(true);
    animal.box = new THREE.Box3().setFromObject(animal.obj);
    props.push(animal);
  }
  for (const { obj } of props.filter(p => p.obj.userData.deliveryHome)) {
    const garland = new THREE.Group();
    for (let i = 0; i < 11; i++) {
      const material = new THREE.MeshStandardMaterial({ color: colors[i%3], emissive: colors[i%3], emissiveIntensity: 1.5 });
      const bulb = new THREE.Mesh(sphere, material);
      bulb.position.set(-2.8+i*0.56,3.7-0.35*Math.sin(i/10*Math.PI),3.05);
      garland.add(bulb);
      bulbs.push({ material, phase: i*0.7+obj.position.x });
    }
    obj.add(garland);
    const wreath = await place({ model: 'holiday-kit/wreath-decorated.glb', pos: [0,2.8,2.98], size: [0.8,0.8,0.18], scale:1 });
    obj.add(wreath.obj);
  }
  const lampMaterial = new THREE.MeshStandardMaterial({ color:'#ffe3aa', emissive:'#ffc475', emissiveIntensity:2 });
  for (const {obj,box} of props.filter(p => p.obj.name === 'light-square')) {
    const {x,z} = obj.position;
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.22,8,6),lampMaterial);
    glow.position.set(x,box.max.y-0.2,z);
    scene.add(glow);
    const light = new THREE.PointLight('#ffd29a',5,8,2);
    light.position.copy(glow.position);
    scene.add(light);
  }
  return { update(time) {
    for (const {material,phase} of bulbs) material.emissiveIntensity = 1.4+0.3*Math.sin(time*1.5+phase);
  }};
}
