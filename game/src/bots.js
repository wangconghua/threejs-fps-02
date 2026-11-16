// The bots: nine soldiers, four Vanguard beside the player and five Ember against them.
// Each bot walks a nav-graph route to its site or hold, scans its lane, and when it sees an
// enemy it stops, aims for a reaction beat, then fires in bursts with an error that shrinks
// the longer it holds its aim. Attackers plant the charge; defenders rotate to the sound of
// gunfire and defuse it. Bots hear shots and react to them.
import * as THREE from 'three';
import { createMover } from './player.js';
import { WEAPONS } from './weapons.js';
import { PALETTE } from './palette.js';

const VANGUARD_NAMES = ['Ash', 'Bram', 'Cleo', 'Dara'];
const EMBER_NAMES = ['Rook', 'Vex', 'Hale', 'Mira', 'Sable'];
const BOT_SPEED = 4.3;
const REACT_MIN = 0.35;
const REACT_MAX = 0.7;
const PLANT_SECONDS = 4;
const DEFUSE_SECONDS = 5;

function nearestNode(nav, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < nav.nodes.length; i += 1) {
    const n = nav.nodes[i];
    const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function findPath(nav, from, to) {
  if (from === to) return [nav.nodes[to].clone()];
  const prev = new Array(nav.nodes.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    if (cur === to) break;
    for (const [a, b] of nav.edges) {
      const next = a === cur ? b : b === cur ? a : -1;
      if (next >= 0 && prev[next] === -1) { prev[next] = cur; queue.push(next); }
    }
  }
  if (prev[to] === -1) return [nav.nodes[to].clone()];
  const path = [];
  let cur = to;
  while (cur !== from) { path.unshift(nav.nodes[cur].clone()); cur = prev[cur]; }
  return path;
}

function makeHealthSprite(team) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 8;
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true, transparent: true }));
  sprite.scale.set(0.72, 0.09, 1);
  sprite.position.y = 1.95;
  return { canvas, texture, sprite, team };
}

function drawHealth(bar, health) {
  const ctx = bar.canvas.getContext('2d');
  ctx.clearRect(0, 0, 64, 8);
  ctx.fillStyle = 'rgba(10,8,6,0.8)';
  ctx.fillRect(0, 0, 64, 8);
  ctx.fillStyle = health > 50 ? '#7fc76a' : health > 25 ? '#e8a33d' : '#d93a2b';
  ctx.fillRect(1, 1, 62 * Math.max(0, health) / 100, 6);
  bar.texture.needsUpdate = true;
}

export function createBots(scene, world, rng) {
  const { nav } = world;
  const bots = [];
  const teamColor = { vanguard: PALETTE.teal, ember: PALETTE.ember };

  function buildBot(team, name, index, weaponId) {
    const spawn = world.spawns[team][index];
    const mover = createMover(world.colliders, spawn[0], spawn[1], team === 'ember' ? Math.PI : 0);
    const color = new THREE.Color(teamColor[team]);
    const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.8 });
    const group = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), cloth);
    torso.position.y = 1.08;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), cloth);
    head.position.y = 1.62;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.06), dark);
    visor.position.set(0, 1.64, -0.13);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.18), dark);
    legL.position.set(-0.12, 0.31, 0);
    const legR = legL.clone();
    legR.position.x = 0.12;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.62), dark);
    gun.position.set(0.2, 1.15, -0.25);
    group.add(torso, head, visor, legL, legR, gun);
    group.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
    scene.add(group);
    const bar = makeHealthSprite(team);
    group.add(bar.sprite);

    const bot = {
      id: `${team}-${index}`,
      team,
      name,
      mover,
      group,
      torso,
      head,
      bar,
      weaponId,
      def: WEAPONS[weaponId],
      mag: WEAPONS[weaponId].mag,
      reloadLeft: 0,
      cooldown: 0,
      health: 100,
      armor: 0,
      alive: true,
      state: 'hold', // move | hold | engage | plant | defuse | dead
      path: [],
      pathIdx: 0,
      goal: null,
      holdYaw: 0,
      scanT: 0,
      target: null, // {kind:'player'|'bot', ref, pos}
      seenAt: -10,
      reactAt: 0,
      aimTime: 0,
      burstLeft: 0,
      burstGap: 0,
      strafeDir: 1,
      strafeT: 0,
      actionT: 0, // plant/defuse channel progress
      site: null,
      isCarrier: false,
      heard: null,
      fall: 0,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    drawHealth(bar, 100);
    bots.push(bot);
    return bot;
  }

  VANGUARD_NAMES.forEach((name, i) => buildBot('vanguard', name, i, i === 3 ? 'smg' : 'rifle'));
  EMBER_NAMES.forEach((name, i) => buildBot('ember', name, i, i === 4 ? 'dmr' : i === 1 ? 'smg' : 'rifle'));

  function resetRound(attackSite) {
    // Attackers split: carrier + two to the called site, two to the other as a feint.
    const otherSite = attackSite === 'A' ? 'B' : 'A';
    const ember = bots.filter((b) => b.team === 'ember');
    ember.forEach((b, i) => {
      b.site = i < 3 ? attackSite : otherSite;
      b.isCarrier = i === 0;
    });
    const vanguard = bots.filter((b) => b.team === 'vanguard');
    vanguard.forEach((b, i) => {
      b.site = i < 2 ? 'A' : 'B';
      b.isCarrier = false;
    });
    for (const bot of bots) {
      const spawn = world.spawns[bot.team][bots.filter((x) => x.team === bot.team).indexOf(bot)];
      bot.mover.body.position.set(spawn[0], 0, spawn[1]);
      bot.mover.body.velocity.set(0, 0, 0);
      bot.mover.body.yaw = bot.team === 'ember' ? Math.PI : 0;
      bot.mover.body.pitch = 0;
      bot.health = 100;
      bot.armor = bot.team === 'ember' && rng() < 0.4 ? 50 : 0;
      bot.alive = true;
      bot.mag = bot.def.mag;
      bot.reloadLeft = 0;
      bot.cooldown = 0;
      bot.state = 'move';
      bot.target = null;
      bot.actionT = 0;
      bot.fall = 0;
      bot.group.rotation.set(0, 0, 0);
      bot.group.position.y = 0;
      bot.group.visible = true;
      drawHealth(bot.bar, 100);
      const site = world.sites.find((s) => s.id === bot.site);
      const goalNode = bot.team === 'ember'
        ? nearestNode(nav, site.center.x, site.center.z)
        : nearestNode(nav, site.center.x, site.center.z + (bot.site === 'A' ? 7 : 7));
      bot.goal = goalNode;
      bot.path = findPath(nav, nearestNode(nav, bot.mover.body.position.x, bot.mover.body.position.z), goalNode);
      bot.pathIdx = 0;
      bot.holdYaw = bot.team === 'ember' ? Math.PI : 0;
    }
  }

  function eyePos(bot) {
    const b = bot.mover.body;
    return new THREE.Vector3(b.position.x, b.position.y + b.eye, b.position.z);
  }

  function damage(bot, amount, killerName) {
    if (!bot.alive) return false;
    let rest = amount;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, rest * 0.5);
      bot.armor -= absorbed;
      rest -= absorbed;
    }
    bot.health -= rest;
    drawHealth(bot.bar, bot.health);
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.state = 'dead';
      bot.target = null;
      return true;
    }
    return false;
  }

  return {
    bots,
    resetRound,
    damage,
    eyePos,
    alive(team) {
      return bots.filter((b) => b.team === team && b.alive);
    },
    hitMeshes() {
      const out = [];
      for (const b of bots) if (b.alive) out.push(b.torso, b.head);
      return out;
    },
    // One fixed step of AI for every bot. ctx carries the live world: the player, the
    // line-of-sight test, the planted charge, and the callbacks that resolve shots.
    step(dt, time, ctx) {
      for (const bot of bots) {
        if (!bot.alive) {
          if (bot.fall < 1) {
            bot.fall = Math.min(1, bot.fall + dt * 2.4);
            bot.group.rotation.z = bot.fall * Math.PI * 0.5 * (bot.team === 'ember' ? 1 : -1);
            bot.group.position.y = -bot.fall * 0.25;
          }
          continue;
        }
        const body = bot.mover.body;
        bot.cooldown = Math.max(0, bot.cooldown - dt);
        if (bot.reloadLeft > 0) {
          bot.reloadLeft = Math.max(0, bot.reloadLeft - dt);
          if (bot.reloadLeft === 0) bot.mag = bot.def.mag;
        }

        // --- Perception: nearest visible enemy (player first, then bots). ---
        let seen = null;
        let seenDist = Infinity;
        const eye = eyePos(bot);
        const consider = (pos, dist, ref, kind) => {
          if (dist < seenDist && ctx.losClear(eye, pos)) {
            seen = { kind, ref, pos: pos.clone(), dist };
            seenDist = dist;
          }
        };
        if (ctx.player.alive && ctx.phase === 'live') {
          const p = new THREE.Vector3(ctx.player.pos.x, ctx.player.pos.y + 1.25, ctx.player.pos.z);
          const dist = eye.distanceTo(p);
          if (dist < 55) consider(p, dist, ctx.player, 'player');
        }
        for (const other of bots) {
          if (other === bot || !other.alive || other.team === bot.team) continue;
          const p = new THREE.Vector3(other.mover.body.position.x, other.mover.body.position.y + 1.25, other.mover.body.position.z);
          const dist = eye.distanceTo(p);
          if (dist < 55) consider(p, dist, other, 'bot');
        }
        if (seen) {
          if (!bot.target || bot.target.ref !== seen.ref) {
            bot.target = seen;
            bot.reactAt = time + REACT_MIN + rng() * (REACT_MAX - REACT_MIN) + seen.dist * 0.008;
            bot.aimTime = 0;
          } else {
            bot.target.pos.copy(seen.pos);
            bot.target.dist = seen.dist;
            bot.aimTime += dt;
          }
          bot.seenAt = time;
          bot.state = 'engage';
        } else if (bot.target && time - bot.seenAt < 1.2) {
          // Keep aiming at the last seen spot briefly, then give up.
          bot.aimTime += dt;
        } else {
          bot.target = null;
          if (bot.state === 'engage') bot.state = bot.pathIdx < bot.path.length ? 'move' : 'hold';
        }

        // --- Hearing: a loud noise nearby turns a holding bot toward it. ---
        if (ctx.noise && bot.state === 'hold') {
          const d = Math.hypot(ctx.noise.x - body.position.x, ctx.noise.z - body.position.z);
          if (d < 26) {
            bot.holdYaw = Math.atan2(-(ctx.noise.x - body.position.x), -(ctx.noise.z - body.position.z));
            bot.heard = ctx.noise;
          }
        }

        // --- Objective: plant / defuse channels. ---
        if (ctx.phase === 'live' && bot.state !== 'engage' && bot.state !== 'dead') {
          if (bot.team === 'ember' && bot.isCarrier && !ctx.planted) {
            const site = world.sites.find((s) => s.id === bot.site);
            const d = Math.hypot(body.position.x - site.center.x, body.position.z - site.center.z);
            if (d < site.radius && bot.pathIdx >= bot.path.length) {
              bot.state = 'plant';
              bot.actionT += dt;
              if (bot.actionT >= PLANT_SECONDS) {
                bot.actionT = 0;
                bot.state = 'hold';
                ctx.onPlant(bot, site);
              }
            }
          }
          if (bot.team === 'vanguard' && ctx.planted) {
            const d = Math.hypot(body.position.x - ctx.planted.center.x, body.position.z - ctx.planted.center.z);
            if (d < 2.2 && bot.pathIdx >= bot.path.length) {
              bot.state = 'defuse';
              bot.actionT += dt;
              if (bot.actionT >= DEFUSE_SECONDS) {
                bot.actionT = 0;
                bot.state = 'hold';
                ctx.onDefuse(bot);
              }
            }
          }
        }
        if (bot.state === 'plant' || bot.state === 'defuse') {
          // Channeling: stand still, face the objective.
          const target = bot.state === 'plant'
            ? world.sites.find((s) => s.id === bot.site).center
            : ctx.planted.center;
          body.yaw = Math.atan2(-(target.x - body.position.x), -(target.z - body.position.z));
          bot.mover.step(dt, null, {});
          bot.group.position.copy(body.position);
          bot.group.rotation.y = body.yaw;
          continue;
        }

        // --- Combat: burst fire at the target once the reaction beat has passed. ---
        if (bot.state === 'engage' && bot.target) {
          const t = bot.target;
          const dx = t.pos.x - body.position.x;
          const dz = t.pos.z - body.position.z;
          const wantYaw = Math.atan2(-dx, -dz);
          let dyaw = wantYaw - body.yaw;
          while (dyaw > Math.PI) dyaw -= Math.PI * 2;
          while (dyaw < -Math.PI) dyaw += Math.PI * 2;
          body.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, dyaw));
          const dy = t.pos.y - (body.position.y + body.eye);
          const dist = Math.hypot(dx, dy, dz) || 1;
          body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / dist))) * 0.9;
          // Strafe while fighting, so the bot is not a standing target.
          bot.strafeT -= dt;
          if (bot.strafeT <= 0) {
            bot.strafeT = 0.7 + rng() * 0.9;
            bot.strafeDir = rng() < 0.5 ? -1 : 1;
            if (rng() < 0.25) bot.strafeDir = 0;
          }
          const strafe = new THREE.Vector3(Math.cos(body.yaw) * bot.strafeDir, 0, -Math.sin(body.yaw) * bot.strafeDir);
          bot.mover.step(dt, bot.strafeDir === 0 ? null : strafe, { crouch: rng() < 0.002 });
          if (time >= bot.reactAt && bot.reloadLeft <= 0) {
            if (bot.burstLeft <= 0) {
              if (bot.cooldown <= 0) {
                bot.burstLeft = 3 + Math.floor(rng() * 3);
                bot.burstGap = 0;
              }
            } else if (bot.burstGap <= 0) {
              if (bot.mag <= 0) {
                bot.reloadLeft = bot.def.reload;
              } else {
                bot.mag -= 1;
                bot.burstLeft -= 1;
                bot.burstGap = bot.def.gap;
                bot.cooldown = bot.def.gap;
                ctx.onBotShoot(bot, t);
              }
            } else bot.burstGap -= dt;
          }
          bot.group.position.copy(body.position);
          bot.group.rotation.y = body.yaw;
          continue;
        }

        // --- Movement: walk the path; hold and scan at the end of it. ---
        if (bot.state === 'move' && bot.pathIdx < bot.path.length) {
          const goal = bot.path[bot.pathIdx];
          const dx = goal.x - body.position.x;
          const dz = goal.z - body.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 0.6) {
            bot.pathIdx += 1;
            if (bot.pathIdx >= bot.path.length) {
              bot.state = 'hold';
              bot.holdYaw = bot.team === 'ember'
                ? Math.atan2(-(world.sites.find((s) => s.id === bot.site).center.x - body.position.x), -(world.sites.find((s) => s.id === bot.site).center.z - body.position.z))
                : Math.PI + (rng() - 0.5) * 1.2;
              // Defenders spread a little once they arrive, so they do not stack.
              if (bot.team === 'vanguard') bot.holdYaw += (rng() - 0.5) * 1.6;
            }
          } else {
            const dir = new THREE.Vector3(dx / dist, 0, dz / dist);
            const wantYaw = Math.atan2(-dx, -dz);
            let dyaw = wantYaw - body.yaw;
            while (dyaw > Math.PI) dyaw -= Math.PI * 2;
            while (dyaw < -Math.PI) dyaw += Math.PI * 2;
            body.yaw += Math.max(-4 * dt, Math.min(4 * dt, dyaw));
            bot.mover.step(dt, dir, {});
          }
        } else if (bot.state === 'hold') {
          // Scan the lane: slow yaw sweep around the hold direction.
          bot.scanT += dt;
          body.yaw = bot.holdYaw + Math.sin(bot.scanT * 0.55) * 0.5;
          bot.mover.step(dt, null, {});
          // After the charge is planted, defenders rotate toward the site.
          if (ctx.planted && bot.team === 'vanguard' && bot.pathIdx >= bot.path.length) {
            const site = ctx.planted;
            const d = Math.hypot(body.position.x - site.center.x, body.position.z - site.center.z);
            if (d > 3) {
              bot.path = findPath(nav, nearestNode(nav, body.position.x, body.position.z), nearestNode(nav, site.center.x, site.center.z));
              bot.pathIdx = 0;
              bot.state = 'move';
            }
          }
        }
        bot.group.position.copy(body.position);
        bot.group.rotation.y = body.yaw;
      }
    },
  };
}
