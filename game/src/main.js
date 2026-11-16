// DUSTLINE boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. This file owns shooting (hitscan against bodies, headshots worth more),
// tracers and impacts, grenades, the planted charge's visuals, the camera, and the
// deterministic ?shot= captures: ?shot=menu|mid|site|win with &seed=N sets up a frame,
// renders it twice, freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './map.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS, damageAt, spreadFor } from './weapons.js';
import { createBots } from './bots.js';
import { createGame, DETONATE_SECONDS } from './game.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#241c14');
scene.fog = new THREE.Fog(new THREE.Color('#2a2018'), 30, 95);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud(world);
const game = createGame(random);
const bots = createBots(scene, world, random);
const player = createPlayer(world.colliders, -4, 18, 0);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 120;

// --- Player state ------------------------------------------------------------
const you = {
  health: 100,
  armor: 0,
  alive: true,
  grenades: 0,
  defuseT: 0,
  spectate: null,
  stepT: 0,
  shake: 0,
};
const weapons = {
  pistol: createWeapon(camera, WEAPONS.pistol),
  primary: null,
};
let current = weapons.pistol;
let adsAmount = 0;

function equip(id) {
  const def = WEAPONS[id];
  if (!def) return;
  if (id === 'pistol') {
    current.model.visible = false;
    if (weapons.primary) weapons.primary.model.visible = false;
    current = weapons.pistol;
    weapons.pistol.model.visible = true;
    return;
  }
  if (!weapons.primary || weapons.primary.def.id !== id) {
    if (weapons.primary) {
      camera.remove(weapons.primary.model);
      weapons.primary = null;
    }
    weapons.primary = createWeapon(camera, def);
    weapons.primary.state.mag = def.mag;
    weapons.primary.state.reserve = def.reserve;
  }
  weapons.pistol.model.visible = false;
  weapons.primary.model.visible = true;
  current = weapons.primary;
}

// --- Effects: tracers, impacts, explosions -----------------------------------
const tracerPool = [];
for (let i = 0; i < 24; i += 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf0a830, transparent: true, opacity: 0 }));
  line.frustumCulled = false;
  scene.add(line);
  tracerPool.push({ line, life: 0 });
}
let tracerIdx = 0;
function spawnTracer(from, to, color) {
  const t = tracerPool[tracerIdx];
  tracerIdx = (tracerIdx + 1) % tracerPool.length;
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.line.material.color.setHex(color);
  t.line.material.opacity = 0.9;
  t.life = 0.07;
}

const sparkPool = [];
for (let i = 0; i < 40; i += 1) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.06, 0.06),
    new THREE.MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0 }),
  );
  m.visible = false;
  scene.add(m);
  sparkPool.push({ mesh: m, vel: new THREE.Vector3(), life: 0 });
}
let sparkIdx = 0;
function spawnSparks(point, normal) {
  for (let i = 0; i < 6; i += 1) {
    const s = sparkPool[sparkIdx];
    sparkIdx = (sparkIdx + 1) % sparkPool.length;
    s.mesh.visible = true;
    s.mesh.position.copy(point);
    s.vel.set(
      normal.x * 2 + (random() - 0.5) * 3,
      1.5 + random() * 2.5,
      normal.z * 2 + (random() - 0.5) * 3,
    );
    s.life = 0.35 + random() * 0.2;
    s.mesh.material.opacity = 1;
  }
}

// --- Line of sight: slab test against the world's boxes (cheap, no meshes). ---
const losRay = new THREE.Ray();
const losTmp = new THREE.Vector3();
const losHit = new THREE.Vector3();
function losClear(a, b) {
  losTmp.subVectors(b, a);
  const dist = losTmp.length();
  if (dist < 0.01) return true;
  losRay.origin.copy(a);
  losRay.direction.copy(losTmp).divideScalar(dist);
  for (const box of world.colliders) {
    // Ignore the floor: it never blocks a sightline between two standing fighters.
    if (box.max.y < 0.1) continue;
    const hit = losRay.intersectBox(box, losHit);
    if (hit && a.distanceTo(hit) < dist - 0.05) return false;
  }
  return true;
}

// --- Damage ------------------------------------------------------------------
// killer: { team, name, head } or null for the environment (a grenade blast).
function damagePlayer(amount, killer) {
  if (!you.alive || game.state.phase !== 'live') return;
  // Captures never kill the player: the frame needs its hero alive.
  if (shot && you.health - amount < 45) amount = Math.max(0, you.health - 45);
  let rest = amount;
  if (you.armor > 0) {
    const absorbed = Math.min(you.armor, rest * 0.5);
    you.armor -= absorbed;
    rest -= absorbed;
  }
  you.health -= rest;
  hud.damageFlash();
  audio.hurt();
  if (you.health <= 0) {
    you.health = 0;
    you.alive = false;
    game.onPlayerDeath();
    const alive = bots.alive('vanguard');
    you.spectate = alive.length ? alive[0] : null;
    hud.showHint('You are down — spectating a teammate. The round plays on.');
    if (killer) game.onKill(killer.team, killer.name, 'vanguard', 'You', killer.head, aliveCount());
    else if (aliveCount().vanguard === 0) {
      if (game.state.planted) game.detonate();
      else game.endRound('ember', 'Vanguard team eliminated');
    }
  }
}

function aliveCount() {
  return { vanguard: bots.alive('vanguard').length + (you.alive ? 1 : 0), ember: bots.alive('ember').length };
}

// --- Shooting ----------------------------------------------------------------
const shootDir = new THREE.Vector3();
const shootOrigin = new THREE.Vector3();
const muzzleWorld = new THREE.Vector3();

function muzzlePosition() {
  camera.getWorldPosition(shootOrigin);
  camera.getWorldDirection(shootDir);
  muzzleWorld.copy(shootOrigin).addScaledVector(shootDir, 0.7);
  muzzleWorld.y -= 0.12;
  muzzleWorld.x += Math.cos(camera.rotation.y) * 0.18;
  return muzzleWorld;
}

// The player's hitscan shot: one ray against the world and every living bot.
function playerShoot() {
  const def = current.def;
  if (!current.takeRound()) {
    audio.dryFire();
    return;
  }
  const spread = spreadFor(def, player.groundSpeed(), input.state.ads, current.state.heat);
  camera.getWorldDirection(shootDir);
  shootDir.x += (random() * 2 - 1) * spread;
  shootDir.y += (random() * 2 - 1) * spread;
  shootDir.z += (random() * 2 - 1) * spread;
  shootDir.normalize();
  camera.getWorldPosition(shootOrigin);
  scene.updateMatrixWorld(true);
  raycaster.set(shootOrigin, shootDir);
  const targets = world.shootables.concat(bots.hitMeshes());
  const hits = raycaster.intersectObjects(targets, false);
  const muzzle = muzzlePosition().clone();
  let end = shootOrigin.clone().addScaledVector(shootDir, 90);
  let pelletsHit = 0;
  for (let p = 0; p < def.pellets; p += 1) {
    if (p > 0) {
      // Shotgun pellets fan out from the same ray with extra spread.
      const dir = shootDir.clone();
      dir.x += (random() * 2 - 1) * def.spreadStill * 2;
      dir.y += (random() * 2 - 1) * def.spreadStill * 2;
      dir.normalize();
      raycaster.set(shootOrigin, dir);
      const ph = raycaster.intersectObjects(targets, false)[0];
      if (ph) applyHit(ph, def, muzzle);
      if (ph) pelletsHit += 1;
      continue;
    }
    const hit = hits[0];
    if (hit) {
      end = hit.point.clone();
      applyHit(hit, def, muzzle);
      if (hit.object.userData.bot) pelletsHit += 1;
    }
  }
  if (def.pellets === 1) spawnTracer(muzzle, end, def.tracer);
  else spawnTracer(muzzle, end, def.tracer);
  audio.shot(0, def.id === 'dmr' || def.id === 'shotgun');
  player.recoil(def.kick * (0.9 + random() * 0.25), (random() * 2 - 1) * def.kick * 0.4);
  noiseAt(shootOrigin, 30);
  hud.setAmmo(current.state.mag, current.state.reserve, current.def.name);
  return pelletsHit;
}

function applyHit(hit, def, muzzle) {
  const bot = hit.object.userData.bot;
  const dist = hit.distance;
  if (bot) {
    const head = hit.object.userData.part === 'head';
    const dmg = damageAt(def, dist, head);
    const killed = bots.damage(bot, dmg, 'You');
    hud.hitMarker(killed, shot ? 4000 : 90);
    audio.hit(killed);
    if (killed) {
      game.onKill('vanguard', 'You', bot.team, bot.name, head, aliveCount());
      if (game.state.planted && bot.team === 'ember' && bot.isCarrier) {
        // The carrier is down; the charge stays where it was planted, if planted.
      }
    }
  } else if (hit.face) {
    spawnSparks(hit.point, hit.face.normal.clone().transformDirection(hit.object.matrixWorld));
  }
}

// A bot's shot at its target: blocked by walls, then a hit chance from distance, aim
// time and how fast the target is moving.
function botShoot(bot, target) {
  const eye = bots.eyePos(bot);
  const aimErr = Math.max(0.12, 0.55 - Math.min(1, bot.aimTime / 1.5) * 0.35) + target.dist * 0.012;
  const aim = target.pos.clone();
  aim.x += (random() * 2 - 1) * aimErr;
  aim.y += (random() * 2 - 1) * aimErr * 0.7;
  aim.z += (random() * 2 - 1) * aimErr;
  const dir = aim.clone().sub(eye).normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(eye, dir);
  const worldHits = raycaster.intersectObjects(world.shootables, false);
  const blocked = worldHits.length && worldHits[0].distance < target.dist - 0.2;
  const muzzle = eye.clone().addScaledVector(dir, 0.6);
  let end = eye.clone().addScaledVector(dir, target.dist + 6);
  let hitSomething = false;
  if (!blocked) {
    if (target.kind === 'player') {
      const speed = player.groundSpeed();
      const p = Math.max(0.1, Math.min(0.8, 0.72 - target.dist * 0.007 - speed * 0.03 - (bot.aimTime < 0.4 ? 0.25 : 0)));
      if (random() < p) {
        const head = random() < 0.12;
        damagePlayer(damageAt(bot.def, target.dist, head), { team: bot.team, name: bot.name, head });
        end = new THREE.Vector3(player.body.position.x, player.body.position.y + 1.25, player.body.position.z);
        hitSomething = true;
      }
    } else {
      const other = target.ref;
      const hits = raycaster.intersectObjects([other.torso, other.head], false);
      if (hits.length && hits[0].distance < target.dist + 1.5) {
        const head = hits[0].object.userData.part === 'head';
        const killed = bots.damage(other, damageAt(bot.def, target.dist, head), bot.name);
        end = hits[0].point.clone();
        hitSomething = true;
        if (killed) game.onKill(bot.team, bot.name, other.team, other.name, head, aliveCount());
      }
    }
  }
  spawnTracer(muzzle, end, bot.def.tracer);
  const distToPlayer = eye.distanceTo(player.body.position);
  audio.shot(distToPlayer, bot.def.id === 'dmr');
  noiseAt(eye, 30);
  knownEnemies.set(bot.id, { x: bot.mover.body.position.x, z: bot.mover.body.position.z, at: performance.now() });
  return hitSomething;
}

// --- Grenades ----------------------------------------------------------------
const grenades = [];
function throwGrenade() {
  if (you.grenades <= 0 || game.state.phase !== 'live') return;
  you.grenades -= 1;
  game.state.loadout.grenades = you.grenades;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2c323a, roughness: 0.5, metalness: 0.6 }),
  );
  camera.getWorldDirection(shootDir);
  mesh.position.copy(camera.position).addScaledVector(shootDir, 0.5);
  scene.add(mesh);
  grenades.push({
    mesh,
    vel: shootDir.clone().multiplyScalar(15).add(new THREE.Vector3(0, 4.5, 0)),
    fuse: 2.2,
    prev: mesh.position.clone(),
  });
  audio.bounce();
}

const explodeLight = new THREE.PointLight(new THREE.Color(0xff8c2e), 0, 18);
scene.add(explodeLight);
function explode(g) {
  const pos = g.mesh.position;
  scene.remove(g.mesh);
  explodeLight.position.copy(pos);
  explodeLight.position.y += 0.5;
  explodeLight.intensity = 60;
  setTimeout(() => { explodeLight.intensity = 0; }, 120);
  audio.explosion();
  noiseAt(pos, 40);
  const R = 6.5;
  const hurt = (p, health) => {
    const d = Math.hypot(p.x - pos.x, p.z - pos.z) + Math.abs(p.y - pos.y) * 0.5;
    if (d > R) return 0;
    return Math.round(120 * (1 - d / R) + 10);
  };
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const dmg = hurt(bot.mover.body.position, bot.health);
    if (dmg > 0) {
      const killed = bots.damage(bot, dmg, 'You');
      if (killed) game.onKill('vanguard', 'You', bot.team, bot.name, false, aliveCount());
    }
  }
  const pdmg = hurt(player.body.position, you.health);
  if (pdmg > 0 && you.alive) {
    damagePlayer(pdmg, { team: 'vanguard', name: 'Your grenade', head: false });
    you.shake = Math.max(you.shake, 0.5);
  }
  for (let i = 0; i < 14; i += 1) {
    const s = sparkPool[sparkIdx];
    sparkIdx = (sparkIdx + 1) % sparkPool.length;
    s.mesh.visible = true;
    s.mesh.position.copy(pos);
    s.vel.set((random() - 0.5) * 8, 2 + random() * 6, (random() - 0.5) * 8);
    s.life = 0.5 + random() * 0.3;
    s.mesh.material.opacity = 1;
  }
}

// --- Noise: gunfire other bots can hear ---------------------------------------
let lastNoise = null;
function noiseAt(pos, radius) {
  lastNoise = { x: pos.x, z: pos.z, radius, at: performance.now() };
}

const knownEnemies = new Map();

// --- Planted charge visuals ---------------------------------------------------
let chargeMesh = null;
let chargeLight = null;
function showCharge(center) {
  hideCharge();
  chargeMesh = new THREE.Group();
  const bodyMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.22, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x2c323a, roughness: 0.5, metalness: 0.4 }),
  );
  bodyMesh.position.y = 0.11;
  const blink = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
  );
  blink.position.set(0.18, 0.26, 0);
  chargeMesh.add(bodyMesh, blink);
  chargeMesh.position.set(center.x, 0, center.z);
  scene.add(chargeMesh);
  chargeLight = new THREE.PointLight(new THREE.Color(0xff2a1a), 0, 6);
  chargeLight.position.set(center.x, 0.6, center.z);
  scene.add(chargeLight);
}
function hideCharge() {
  if (chargeMesh) { scene.remove(chargeMesh); chargeMesh = null; }
  if (chargeLight) { scene.remove(chargeLight); chargeLight = null; }
}

// --- Round flow ---------------------------------------------------------------
let lastPhase = game.state.phase;
function resetRoundPositions() {
  const spawn = world.spawns.vanguard[0];
  player.body.position.set(spawn[0], 0, spawn[1]);
  player.body.velocity.set(0, 0, 0);
  player.body.yaw = 0;
  player.body.pitch = 0;
  you.health = 100;
  you.armor = game.state.loadout.armor;
  you.grenades = game.state.loadout.grenades;
  you.alive = true;
  you.spectate = null;
  you.defuseT = 0;
  bots.resetRound(game.state.attackSite);
  for (const w of Object.values(weapons)) if (w) w.refill();
  equip(game.state.loadout.primary ?? 'pistol');
  hideCharge();
  knownEnemies.clear();
  hud.hideBuy();
  hud.setProgress(null, 0);
}

function onPhaseChange(phase) {
  if (phase === 'buy') {
    resetRoundPositions();
    hud.showBuy(game.buyList(), game.state.money);
    hud.showBanner(`Round ${game.state.round}`, `Ember is pushing Site ${game.state.attackSite} — buy up (B)`);
    audio.sting(true);
  } else if (phase === 'live') {
    hud.hideBuy();
    hud.showHint('Defend both sites. Hold E at the charge to defuse it.');
  } else if (phase === 'roundEnd') {
    hud.hideBuy();
    hud.setProgress(null, 0);
    audio.sting(game.state.roundWinner === 'vanguard');
    if (game.state.roundWinner) hud.showBanner(game.state.roundWinner === 'vanguard' ? 'Round won' : 'Round lost', game.state.roundReason, 4200);
    if (document.pointerLockElement) document.exitPointerLock();
  } else if (phase === 'matchEnd') {
    hud.showOverlay(
      game.state.matchWinner === 'vanguard' ? 'Match won' : 'Match lost',
      `Final score ${game.state.wins.vanguard} – ${game.state.wins.ember} · ${game.kills} eliminations · $${game.state.money}`,
      'Play again',
    );
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

// --- The fixed step -----------------------------------------------------------
const body = player.body;
let elapsed = 0;
let frozen = false;
let started = false;

function step(dt) {
  elapsed += dt;
  const gs = game.state;

  // Phase transitions.
  if (gs.phase !== lastPhase) {
    onPhaseChange(gs.phase);
    lastPhase = gs.phase;
  }
  game.step(dt);

  // Player movement and look (frozen while spectating or dead).
  if (you.alive && (gs.phase === 'live' || gs.phase === 'buy')) {
    const look = input.takeLook();
    const sens = input.state.ads ? 0.0013 : 0.0022;
    player.look(look.x, look.y, sens);
    player.stepKeys(dt, input.state.keys);
    // Footsteps.
    const speed = player.groundSpeed();
    if (speed > 1 && player.body.onGround) {
      you.stepT -= dt * speed;
      if (you.stepT <= 0) {
        you.stepT = 2.2;
        audio.step();
      }
    }
  }

  // ADS: field of view and view-model centre.
  const wantAds = input.state.ads && you.alive ? 1 : 0;
  adsAmount += (wantAds - adsAmount) * Math.min(1, dt * 10);
  camera.fov = 74 - adsAmount * (74 - 74 / current.def.zoom);
  camera.updateProjectionMatrix();
  current.model.position.x = 0.24 - adsAmount * 0.24;
  current.model.position.y = -0.2 + adsAmount * 0.055;

  // Weapons.
  current.step(dt);
  if (weapons.pistol !== current) weapons.pistol.step(dt);
  if (weapons.primary && weapons.primary !== current) weapons.primary.step(dt);

  // Bots.
  const ctx = {
    player: { pos: body.position, alive: you.alive },
    phase: gs.phase,
    planted: gs.planted,
    losClear,
    noise: lastNoise && performance.now() - lastNoise.at < 1200 ? lastNoise : null,
    onBotShoot: (bot, target) => botShoot(bot, target),
    onPlant: (bot, site) => {
      if (game.plant(site, bot.name)) showCharge(site.center);
    },
    onDefuse: (bot) => game.defuse(bot.name),
  };
  bots.step(dt, elapsed, ctx);
  if (gs.planted && !chargeMesh) showCharge(gs.planted.center);
  if (!gs.planted && chargeMesh) hideCharge();

  // Planted charge beeps, faster as the fuse burns down.
  if (gs.planted) {
    gs.planted.beepT -= dt;
    if (gs.planted.beepT <= 0) {
      gs.planted.beepT = Math.max(0.22, gs.planted.fuse / DETONATE_SECONDS) * 0.9;
      audio.beep(gs.planted.fuse < 5);
      if (chargeLight) chargeLight.intensity = chargeLight.intensity > 1 ? 0 : 6;
    }
  }

  // Grenades.
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const g = grenades[i];
    g.fuse -= dt;
    g.vel.y -= 18 * dt;
    g.prev.copy(g.mesh.position);
    g.mesh.position.addScaledVector(g.vel, dt);
    const p = g.mesh.position;
    if (p.y < 0.09) {
      p.y = 0.09;
      if (Math.abs(g.vel.y) > 2) audio.bounce();
      g.vel.y *= -0.4;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
    }
    for (const box of world.colliders) {
      if (box.max.y < 0.1) continue;
      if (p.x > box.min.x - 0.09 && p.x < box.max.x + 0.09 && p.y > box.min.y - 0.09 && p.y < box.max.y + 0.09 && p.z > box.min.z - 0.09 && p.z < box.max.z + 0.09) {
        g.mesh.position.copy(g.prev);
        g.vel.multiplyScalar(-0.35);
        break;
      }
    }
    if (g.fuse <= 0) {
      explode(g);
      grenades.splice(i, 1);
    }
  }

  // Player firing / reload / weapon switch / grenade / defuse.
  if (you.alive && gs.phase === 'live' && !hud.isBuyOpen()) {
    if (input.state.firing && current.ready()) playerShoot();
    if (input.state.keys.has('KeyR') && current.reload()) audio.reload();
    // Defuse: hold E beside the planted charge.
    if (gs.planted && input.state.keys.has('KeyE')) {
      const d = Math.hypot(body.position.x - gs.planted.center.x, body.position.z - gs.planted.center.z);
      if (d < 2.4) {
        you.defuseT += dt;
        hud.setProgress('Defusing charge', you.defuseT / 5);
        if (you.defuseT >= 5) {
          you.defuseT = 0;
          game.defuse('You');
          hud.setProgress(null, 0);
        }
      } else {
        you.defuseT = Math.max(0, you.defuseT - dt * 2);
        hud.setProgress(null, 0);
      }
    } else {
      you.defuseT = Math.max(0, you.defuseT - dt * 2);
      if (you.defuseT === 0) hud.setProgress(null, 0);
    }
  }

  // One-shot keys.
  for (const code of input.takePressed()) {
    if (code === 'KeyM') {
      const muted = audio.toggleMute();
      hud.showHint(muted ? 'Sound muted (M)' : 'Sound on (M)');
    } else if (code === 'KeyB') {
      if (hud.isBuyOpen()) hud.hideBuy();
      else if (gs.phase === 'buy' || gs.phase === 'live') hud.showBuy(game.buyList(), gs.money);
    } else if (code === 'KeyG') {
      throwGrenade();
    } else if (hud.isBuyOpen() && /^Digit[1-6]$/.test(code)) {
      const items = game.buyList();
      const item = items[Number(code.slice(5)) - 1];
      if (item) doBuy(item.id);
    } else if (code === 'Digit1' && game.state.loadout.primary) {
      equip(game.state.loadout.primary);
      hud.setAmmo(current.state.mag, current.state.reserve, current.def.name);
    } else if (code === 'Digit2') {
      equip('pistol');
      hud.setAmmo(current.state.mag, current.state.reserve, current.def.name);
    }
  }

  // Tracers and sparks fade.
  for (const t of tracerPool) {
    if (t.life > 0) {
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
    }
  }
  for (const s of sparkPool) {
    if (s.life > 0) {
      s.life -= dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.vel.y -= 12 * dt;
      s.mesh.material.opacity = Math.max(0, s.life / 0.5);
      if (s.life <= 0) s.mesh.visible = false;
    }
  }
  you.shake = Math.max(0, you.shake - dt * 1.5);

  // HUD: drain the game's events into the killfeed, then push the numbers.
  for (const event of gs.events.splice(0)) {
    hud.feed(event.text, event.kind === 'kill' ? 'kill' : event.kind);
  }
  hud.setHealth(you.health, you.armor);
  hud.setAmmo(current.state.mag, current.state.reserve, current.def.name);
  hud.setMoney(gs.money);
  hud.setTimer(gs.timer, gs.timer < 10 && gs.phase === 'live');
  hud.setScore(gs.wins.vanguard, gs.wins.ember);
  const alive = aliveCount();
  hud.setAlive(alive.vanguard, alive.ember);
  hud.setObjective(gs.planted ? `Charge planted at Site ${gs.planted.site} — defuse it!` : gs.phase === 'buy' ? 'Buy phase — press B for the shop' : `Defend Sites A and B · Ember pushes ${gs.attackSite}`);
  const spreadPx = 4 + spreadFor(current.def, player.groundSpeed(), input.state.ads, current.state.heat) * 900;
  hud.setSpread(spreadPx);
  // Minimap: teammates always, enemies only when they fired recently or are in view.
  const now = performance.now();
  const known = [];
  for (const [id, k] of knownEnemies) {
    if (now - k.at < 4000) known.push(k);
    else knownEnemies.delete(id);
  }
  if (you.alive) {
    for (const bot of bots.bots) {
      if (bot.team !== 'ember' || !bot.alive) continue;
      const bp = bot.mover.body.position;
      const d = Math.hypot(bp.x - body.position.x, bp.z - body.position.z);
      if (d < 40) {
        const eye = new THREE.Vector3(body.position.x, body.position.y + body.eye, body.position.z);
        const chest = new THREE.Vector3(bp.x, bp.y + 1.25, bp.z);
        if (losClear(eye, chest)) known.push({ x: bp.x, z: bp.z });
      }
    }
  }
  hud.drawMinimap(
    { x: body.position.x, z: body.position.z, yaw: body.yaw },
    bots.alive('vanguard').map((b) => ({ x: b.mover.body.position.x, z: b.mover.body.position.z })),
    known,
    gs.planted,
  );
  if (gs.banner) {
    hud.showBanner(gs.banner.title, gs.banner.sub);
    gs.banner = null;
  }
}

function doBuy(id) {
  const result = game.buy(id);
  hud.showHint(result.message);
  if (result.ok) {
    audio.buy();
    if (WEAPONS[id]) {
      equip(id);
      hud.setAmmo(current.state.mag, current.state.reserve, current.def.name);
    }
    if (id === 'armor') you.armor = game.state.loadout.armor;
    if (id === 'grenade') you.grenades = game.state.loadout.grenades;
    hud.showBuy(game.buyList(), game.state.money);
  } else {
    audio.denied();
  }
}

hud.onBuy(doBuy);
hud.onPlay(() => {
  audio.unlock();
  if (game.state.phase === 'menu') {
    game.startMatch();
    started = true;
  } else if (game.state.phase === 'matchEnd') {
    game.startMatch();
    started = true;
  }
  if (!shot) input.requestLock();
});

// --- Camera ------------------------------------------------------------------
function syncCamera() {
  let shakeX = 0;
  let shakeY = 0;
  if (you.shake > 0) {
    shakeX = (random() - 0.5) * you.shake * 0.05;
    shakeY = (random() - 0.5) * you.shake * 0.05;
  }
  if (you.alive) {
    camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
    camera.rotation.set(body.pitch + shakeY, body.yaw + shakeX, 0, 'YXZ');
  } else if (you.spectate && you.spectate.alive) {
    const b = you.spectate.mover.body;
    camera.position.set(b.position.x, b.position.y + b.eye, b.position.z);
    camera.rotation.set(b.pitch, b.yaw, 0, 'YXZ');
  } else {
    camera.position.set(body.position.x, body.position.y + body.eye + 0.4, body.position.z);
    camera.rotation.set(-0.15, body.yaw, 0, 'YXZ');
  }
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (game.state.phase === 'live' || game.state.phase === 'buy') {
    hud.showOverlay('DUSTLINE', 'Paused — the round waits for no one. Click to resume.', 'Click to resume');
  } else if (game.state.phase === 'menu') {
    hud.showOverlay('DUSTLINE', 'A round-based tactical FPS. Five Vanguard hold Ember Yard against five Ember attackers and their charge.', 'Click to play');
  }
}

// --- Frame loop ---------------------------------------------------------------
let accumulator = 0;
let lastTime = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
  syncCamera();
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  try {
    if (name === 'menu') {
      game.startMatch();
      settle(5);
      body.position.set(-4, 0, 18);
      body.yaw = 0;
      body.pitch = 0;
      settle(10);
      hud.showBuy(game.buyList(), game.state.money);
    } else if (name === 'mid') {
      game.startMatch();
      settle(2); // let the buy phase run once: it resets positions and the bots
      hud.hideBuy();
      game.state.phase = 'live';
      game.state.timer = 98;
      lastPhase = 'live';
      body.position.set(0, 0, 12);
      body.yaw = 0;
      body.pitch = 0;
      const ember = bots.bots.filter((b) => b.team === 'ember');
      ember[0].mover.body.position.set(2, 0, -4);
      ember[0].path = [];
      ember[0].pathIdx = 0;
      ember[0].state = 'hold';
      ember[1].mover.body.position.set(-3, 0, -9);
      ember[1].path = [];
      ember[1].pathIdx = 0;
      ember[1].state = 'hold';
      settle(90);
      const target = new THREE.Vector3(ember[0].mover.body.position.x, 1.25, ember[0].mover.body.position.z);
      aimAt(target);
      playerShoot();
      settle(2);
      playerShoot();
      settle(1);
      hud.showBanner('Round 1', 'Mid control — Ember spotted', 60000);
    } else if (name === 'site') {
      game.startMatch();
      settle(2); // let the buy phase run once: it resets positions and the bots
      hud.hideBuy();
      game.state.phase = 'live';
      game.state.timer = 30;
      lastPhase = 'live';
      const siteA = world.sites[0];
      const carrier = bots.bots.find((b) => b.team === 'ember' && b.isCarrier);
      carrier.mover.body.position.set(siteA.center.x + 1, 0, siteA.center.z + 1);
      carrier.path = [];
      carrier.pathIdx = 0;
      carrier.state = 'hold';
      game.plant(siteA, carrier.name);
      showCharge(siteA.center);
      const ember2 = bots.bots.filter((b) => b.team === 'ember')[1];
      ember2.mover.body.position.set(siteA.center.x - 3, 0, siteA.center.z - 2);
      ember2.path = [];
      ember2.pathIdx = 0;
      ember2.state = 'hold';
      // Inside the pocket mouth, looking straight at the planted charge.
      body.position.set(-17, 0, -8);
      settle(45);
      aimAt(new THREE.Vector3(siteA.center.x, 0.6, siteA.center.z));
      hud.showBanner('Charge planted', 'Site A — defuse it before the fuse burns down', 60000);
    } else if (name === 'win') {
      game.startMatch();
      settle(2); // let the buy phase run once: it resets positions and the bots
      hud.hideBuy();
      game.state.phase = 'live';
      game.state.timer = 80;
      lastPhase = 'live';
      body.position.set(0, 0, 6);
      settle(30);
      const ember = bots.bots.filter((b) => b.team === 'ember');
      for (const bot of ember) {
        bots.damage(bot, 10000, 'You');
        game.onKill('vanguard', 'You', bot.team, bot.name, false, aliveCount());
      }
      // Lay two of the fallen where the camera can see them, south of the mid wall.
      ember[0].mover.body.position.set(2.5, 0, 0);
      ember[0].group.position.set(2.5, 0, 0);
      ember[1].mover.body.position.set(-1.5, 0, 1);
      ember[1].group.position.set(-1.5, 0, 1);
      settle(45);
      aimAt(new THREE.Vector3(2.5, 0.5, 0));
      hud.showBanner('Round won', 'Ember team eliminated', 60000);
    } else if (name === 'sim') {
      // Self-test, not a screenshot: play a scripted 60-second round and log the state.
      game.startMatch();
      settle(2);
      console.log('SIM buy ok:', JSON.stringify(game.buy('grenade')));
      game.state.phase = 'live';
      game.state.timer = 100;
      lastPhase = 'live';
      input.state.keys.add('KeyW');
      for (let i = 0; i < 3600; i += 1) {
        if (i === 900) throwGrenade();
        if (i % 240 === 0) {
          const foes = bots.bots.filter((b) => b.team === 'ember' && b.alive);
          if (foes.length) {
            const f = foes[0];
            aimAt(new THREE.Vector3(f.mover.body.position.x, 1.25, f.mover.body.position.z));
            playerShoot();
          }
        }
        step(FIXED_STEP);
        syncCamera();
      }
      input.state.keys.delete('KeyW');
      const gs = game.state;
      console.log('SIM done:', JSON.stringify({
        phase: gs.phase, round: gs.round, wins: gs.wins, money: gs.money,
        kills: gs.kills, deaths: gs.deaths, planted: !!gs.planted,
        alive: aliveCount(), playerHealth: you.health, grenades: you.grenades,
      }));
    }
    hud.setHealth(you.health, you.armor);
    hud.setAmmo(current.state.mag, current.state.reserve, current.def.name);
    hud.setMoney(game.state.money);
    hud.setScore(game.state.wins.vanguard, game.state.wins.ember);
  } catch (error) {
    window.__shotError = String(error && error.stack || error);
    console.error('SHOT ERROR', window.__shotError);
  }
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('error', (event) => {
  window.__shotError = String(event.message);
});

syncCamera();
hud.showOverlay('DUSTLINE', 'A round-based tactical FPS. Five Vanguard hold Ember Yard against five Ember attackers and their charge.', 'Click to play');
if (shot) runShot(shot);
else requestAnimationFrame(frame);
