import * as THREE from 'three';
import { Animator, turnToward } from './actors.js';
import { pushOut } from './physics.js';

const SPACING = 2;
const CLEARANCE = 0.95;

function clearPoint(x, z, colliders) {
  return colliders.every(collider => {
    if (collider.type === 'circle') {
      return Math.hypot(x - collider.c[0], z - collider.c[1]) > collider.r + CLEARANCE;
    }
    const nearX = Math.max(collider.lo[0], Math.min(x, collider.hi[0]));
    const nearZ = Math.max(collider.lo[1], Math.min(z, collider.hi[1]));
    return Math.hypot(x - nearX, z - nearZ) > CLEARANCE;
  });
}

function walkingGraph(colliders) {
  const nodes = new Map();
  for (let x = -58; x <= 58; x += SPACING) {
    for (let z = -42; z <= 42; z += SPACING) {
      if (clearPoint(x, z, colliders)) nodes.set(`${x},${z}`, { x, z, neighbors: [] });
    }
  }
  for (const node of nodes.values()) {
    for (const [dx, dz] of [[SPACING, 0], [-SPACING, 0], [0, SPACING], [0, -SPACING]]) {
      const next = nodes.get(`${node.x + dx},${node.z + dz}`);
      if (next && [0.25, 0.5, 0.75].every(t => clearPoint(node.x + dx * t, node.z + dz * t, colliders))) {
        node.neighbors.push(next);
      }
    }
  }
  return [...nodes.values()].filter(node => node.neighbors.length);
}

function routeFrom(start, blocked = new Set()) {
  // Search only the connected area, so a destination is always reachable.
  const previous = new Map([[start, null]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const next of queue[i].neighbors) {
      if (!blocked.has(next) && !previous.has(next)) {
        previous.set(next, queue[i]);
        queue.push(next);
      }
    }
  }
  const distant = queue.filter(node => Math.hypot(node.x - start.x, node.z - start.z) > 18);
  const candidates = distant.length ? distant : queue.slice(1);
  if (!candidates.length) return [];
  let target = candidates[Math.floor(Math.random() * candidates.length)];
  const route = [];
  while (target !== start) {
    route.push(target);
    target = previous.get(target);
  }
  return route.reverse();
}

export function createVillagers(props, colliders) {
  const nodes = walkingGraph(colliders);
  const agents = props.filter(prop => prop.obj.userData.ambient).map((prop, index) => {
    const animator = new Animator(prop.obj, prop.clips);
    const idle = prop.clips.find(clip => clip.name === 'idle');
    const walk = prop.clips.find(clip => clip.name === 'walk');
    if (idle) animator.play(idle.name);
    const agent = { prop, animator, idle, walk, route: [], wait: index * 0.13,
      speed: prop.obj.name.startsWith('character') ? 1 + index % 3 * 0.12 : 0.65 + index % 3 * 0.12 };
    if (!prop.obj.userData.perched && nodes.length) {
      agent.node = nodes.reduce((best, node) =>
        Math.hypot(node.x - prop.obj.position.x, node.z - prop.obj.position.z) <
        Math.hypot(best.x - prop.obj.position.x, best.z - prop.obj.position.z) ? node : best);
      const before = prop.obj.position.clone();
      prop.obj.position.set(agent.node.x, 0, agent.node.z);
      prop.box.translate(prop.obj.position.clone().sub(before));
    }
    return agent;
  });
  const displacement = new THREE.Vector3();
  return {
    update(dt) {
      for (const agent of agents) {
        agent.animator.update(dt);
        if (!agent.node) continue;
        if (agent.wait > 0) {
          agent.wait -= dt;
          continue;
        }
        if (!agent.route.length) agent.route = routeFrom(agent.node);
        const next = agent.route[0];
        if (!next) continue;
        const obj = agent.prop.obj;
        const dx = next.x - obj.position.x;
        const dz = next.z - obj.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.04) {
          agent.node = agent.route.shift();
          if (!agent.route.length) {
            agent.wait = 1.5 + Math.random() * 4;
            if (agent.idle) agent.animator.play(agent.idle.name);
          }
          continue;
        }
        if (agent.walk) agent.animator.play(agent.walk.name);
        const step = Math.min(distance, agent.speed * dt);
        const nextX = obj.position.x + dx / distance * step;
        const nextZ = obj.position.z + dz / distance * step;
        const obstacle = agents.find(other => other !== agent && other.node &&
          Math.hypot(nextX - other.prop.obj.position.x, nextZ - other.prop.obj.position.z) < 0.9);
        if (obstacle) {
          agent.blocked = (agent.blocked ?? 0) + dt;
          if (agent.blocked > 0.35) {
            agent.route = routeFrom(agent.node, new Set([next, obstacle.node]));
            agent.blocked = 0;
          }
          agent.wait = 0.08;
          if (agent.idle) agent.animator.play(agent.idle.name);
          continue;
        }
        agent.blocked = 0;
        displacement.copy(obj.position);
        obj.position.x = nextX;
        obj.position.z = nextZ;
        pushOut(obj.position, 0.45, colliders);
        displacement.sub(obj.position).negate();
        agent.prop.box.translate(displacement);
        obj.rotation.y = turnToward(obj.rotation.y, Math.atan2(dx, dz), 4, dt);
      }
    },
  };
}
