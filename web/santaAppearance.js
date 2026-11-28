import * as THREE from 'three';

export function dressSanta(model, { beard = false } = {}) {
  // Clone only this player's atlas: villagers keep their original clothing.
  const body=model.getObjectByName('body-mesh');
  if(body?.material.map){
    const original=body.material.map,canvas=document.createElement('canvas');
    canvas.width=original.image.width;canvas.height=original.image.height;
    const context=canvas.getContext('2d');context.drawImage(original.image,0,0);
    const pixels=context.getImageData(0,0,canvas.width,canvas.height);
    for(let i=0;i<pixels.data.length;i+=4){
      const [r,g,b]=pixels.data.subarray(i,i+3);
      const trousers=b>r+30&&b>g+50;
      const coat=g-b>50&&r-g<65&&r>150;
      if(coat||trousers){
        const shade=Math.max(r,g,b)/255;
        pixels.data[i]=235*shade;pixels.data[i+1]=35*shade;pixels.data[i+2]=48*shade;
      }
    }
    context.putImageData(pixels,0,0);
    const atlas=new THREE.CanvasTexture(canvas);
    atlas.flipY=original.flipY;atlas.colorSpace=original.colorSpace;
    atlas.magFilter=THREE.NearestFilter;atlas.minFilter=original.minFilter;
    body.material=body.material.clone();body.material.map=atlas;body.material.needsUpdate=true;
  }

  const head=model.getObjectByName('head'),mesh=model.getObjectByName('head-mesh');
  if(!head||!mesh)return;
  model.updateWorldMatrix(true,true);
  model.updateMatrixWorld(true);
  mesh.computeBoundingBox();
  const bounds=new THREE.Box3().setFromObject(mesh);
  const size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  const scale=head.getWorldScale(new THREE.Vector3()).x;
  const radius=Math.min(size.x,size.z)/scale*0.43;
  const hat=new THREE.Group();hat.name='santa-hat';
  hat.position.copy(head.worldToLocal(new THREE.Vector3(center.x,bounds.max.y-0.06,center.z)));
  const red=new THREE.MeshStandardMaterial({color:'#c92335',roughness:0.85});
  const white=new THREE.MeshStandardMaterial({color:'#fff6e7',roughness:1});
  const torso=model.getObjectByName('torso');
  if(torso){
    const trim=new THREE.Group();trim.name='santa-coat-trim';
    const hem=new THREE.Mesh(new THREE.BoxGeometry(0.29,0.035,0.205),white);
    hem.position.set(0,0.028,0.018);trim.add(hem);
    const front=new THREE.Mesh(new THREE.BoxGeometry(0.028,0.10,0.022),white);
    front.position.set(0,0.10,0.12);trim.add(front);
    for(const y of [0.075,0.11,0.145]){
      const button=new THREE.Mesh(new THREE.SphereGeometry(0.012,8,5),white);
      button.position.set(0.043,y,0.128);trim.add(button);
    }
    torso.add(trim);
  }
  const brim=new THREE.Mesh(new THREE.TorusGeometry(radius,radius*0.17,6,16),white);
  brim.rotation.x=Math.PI/2;hat.add(brim);
  const curve=new THREE.CatmullRomCurve3([
    new THREE.Vector3(0,0,0),new THREE.Vector3(0,radius*0.52,0),
    new THREE.Vector3(radius*0.4,radius*1.05,0),new THREE.Vector3(radius*0.85,radius*0.96,0),
  ]);
  const positions=[],indices=[],rings=12,sides=12;
  for(let i=0;i<=rings;i++){
    const t=i/rings,c=curve.getPoint(t),r=radius*(1-t)*0.98;
    for(let j=0;j<=sides;j++){
      const a=j/sides*Math.PI*2;positions.push(c.x+Math.cos(a)*r,c.y,c.z+Math.sin(a)*r);
      if(i&&j){const k=i*(sides+1)+j;indices.push(k,k-sides-2,k-1,k,k-sides-1,k-sides-2);}
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  hat.add(new THREE.Mesh(geometry,red));
  const pom=new THREE.Mesh(new THREE.SphereGeometry(radius*0.23,10,7),white);
  pom.position.copy(curve.getPoint(1));hat.add(pom);
  hat.traverse(o=>{if(o.isMesh)o.castShadow=true;});
  head.add(hat);
  if (beard) {
    const beardMesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.72, 12, 8), white);
    beardMesh.scale.set(1, 1.15, 0.45);
    beardMesh.position.set(hat.position.x, hat.position.y - radius * 1.45, hat.position.z + radius * 0.65);
    head.add(beardMesh);
    for (const side of [-1, 1]) {
      const moustache = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.32, 10, 7), white);
      moustache.scale.set(1.2, 0.45, 0.5);
      moustache.position.set(hat.position.x + side * radius * 0.29,
        hat.position.y - radius * 1.1, hat.position.z + radius * 0.88);
      head.add(moustache);
    }
  }
}
