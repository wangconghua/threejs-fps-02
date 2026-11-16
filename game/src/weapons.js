// The armoury: every weapon is one row of numbers. Damage falls off with range, headshots
// multiply body damage, and spread grows with movement and with sustained fire, so stopping
// to aim pays. Prices are the buy menu's; the match (game.js) owns the money.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// damage: body damage at point blank. headMult: headshot multiplier. falloff: [near, far]
// metres; beyond far the damage is halved. spread: radians, still / moving. adsMult: how
// much aiming down sights tightens the spread. kick: recoil pitch per shot.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', short: 'P9', price: 0, damage: 34, headMult: 4,
    falloff: [8, 30], mag: 12, reserve: 48, auto: false, gap: 0.16, reload: 1.3,
    spreadStill: 0.004, spreadMove: 0.02, adsMult: 0.45, kick: 0.011, zoom: 1.15,
    pellets: 1, tracer: 0xd8c9a8,
  },
  smg: {
    id: 'smg', name: 'VK-9 Ripper', short: 'VK-9', price: 1500, damage: 26, headMult: 4,
    falloff: [6, 22], mag: 30, reserve: 120, auto: true, gap: 0.075, reload: 2.0,
    spreadStill: 0.007, spreadMove: 0.03, adsMult: 0.5, kick: 0.007, zoom: 1.25,
    pellets: 1, tracer: 0xe8c25a,
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Carbine', short: 'AR-77', price: 2700, damage: 33, headMult: 4,
    falloff: [10, 45], mag: 30, reserve: 90, auto: true, gap: 0.1, reload: 2.2,
    spreadStill: 0.003, spreadMove: 0.026, adsMult: 0.4, kick: 0.01, zoom: 1.35,
    pellets: 1, tracer: 0xf0a830,
  },
  dmr: {
    id: 'dmr', name: 'Lancer DMR', short: 'DMR', price: 3800, damage: 70, headMult: 4,
    falloff: [15, 80], mag: 10, reserve: 30, auto: false, gap: 0.5, reload: 2.8,
    spreadStill: 0.0008, spreadMove: 0.02, adsMult: 0.25, kick: 0.03, zoom: 2.2,
    pellets: 1, tracer: 0xffd27a,
  },
  shotgun: {
    id: 'shotgun', name: 'Breacher-12', short: 'B-12', price: 1700, damage: 9, headMult: 3,
    falloff: [4, 14], mag: 6, reserve: 24, auto: false, gap: 0.85, reload: 2.6,
    spreadStill: 0.032, spreadMove: 0.045, adsMult: 0.6, kick: 0.035, zoom: 1.15,
    pellets: 8, tracer: 0xf0b060,
  },
};

export const ARMOR_PRICE = 650;
export const GRENADE_PRICE = 300;
export const GRENADE_MAX = 2;

export function damageAt(def, distance, head) {
  const [near, far] = def.falloff;
  const t = Math.max(0, Math.min(1, (distance - near) / Math.max(1, far - near)));
  const base = def.damage * (1 - 0.5 * t);
  return base * (head ? def.headMult : 1);
}

// Spread in radians for one shot: stillness and aiming help, movement and heat hurt.
export function spreadFor(def, speed, ads, heat) {
  const move = Math.min(1, speed / 5.2);
  let spread = def.spreadStill + (def.spreadMove - def.spreadStill) * move;
  if (ads) spread *= def.adsMult;
  return spread * (1 + heat * 0.9);
}

// One view model per weapon, built from boxes: a receiver, a barrel, a stock and a sight.
// The camera carries it, so it never needs a world position.
export function createWeapon(camera, def) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#6b6156'), roughness: 0.55, metalness: 0.35 });
  const mid = new THREE.MeshStandardMaterial({ color: new THREE.Color('#9a8a70'), roughness: 0.7, metalness: 0.2 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });
  const model = new THREE.Group();
  const scale = def.id === 'pistol' ? 0.8 : def.id === 'shotgun' ? 1.15 : def.id === 'dmr' ? 1.25 : 1;
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42 * scale), dark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4 * scale), mid);
  barrel.position.set(0, 0.025, -0.38 * scale);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), mid);
  stock.position.set(0, -0.02, 0.3);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.06), mid);
  sight.position.set(0, 0.07, -0.05);
  model.add(receiver, barrel, stock, sight);
  if (def.id === 'shotgun') {
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.34), mid);
    tube.position.set(0, -0.03, -0.3);
    model.add(tube);
  }
  if (def.id === 'dmr') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), dark);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.1, -0.02);
    model.add(scope);
  }
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);

  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = 64;
  flashCanvas.height = 64;
  const fctx = flashCanvas.getContext('2d');
  const fgrad = fctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  fgrad.addColorStop(0, 'rgba(255,240,200,1)');
  fgrad.addColorStop(0.35, 'rgba(240,168,48,0.9)');
  fgrad.addColorStop(1, 'rgba(240,120,20,0)');
  fctx.fillStyle = fgrad;
  fctx.fillRect(0, 0, 64, 64);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(flashCanvas), transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  // The flash and its light ride on the view model, so hiding or removing the model
  // takes them with it.
  flash.position.set(0, 0.03, -0.42 - 0.42 * scale);
  flash.visible = false;
  model.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0, 0.04, -0.18);
  model.add(flashLight);
  model.scale.setScalar(0.8);
  model.rotation.y = 0.07;

  const state = { mag: def.mag, reserve: def.reserve, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, heat: 0 };

  return {
    def,
    state,
    model,
    step(dt) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      state.flash = Math.max(0, state.flash - dt);
      state.heat = Math.max(0, state.heat - dt * 1.4);
      state.kick += (0 - state.kick) * Math.min(1, dt * 14);
      model.position.z = -0.42 + state.kick;
      model.rotation.x = state.kick * 2.4;
      flash.visible = state.flash > 0;
      if (state.flash > 0) flash.rotation.z = state.flash * 40;
      flashLight.intensity = state.flash > 0 ? 20 : 0;
      if (state.reloadLeft > 0) {
        state.reloadLeft = Math.max(0, state.reloadLeft - dt);
        if (state.reloadLeft === 0 && state.reserve > 0) {
          const need = def.mag - state.mag;
          const take = Math.min(need, state.reserve);
          state.mag += take;
          state.reserve -= take;
        }
      }
    },
    ready() {
      return state.cooldown <= 0 && state.reloadLeft <= 0;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      state.cooldown = def.gap;
      state.flash = 0.06;
      state.kick = 0.09;
      state.heat = Math.min(1, state.heat + (def.auto ? 0.09 : 0.16));
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag >= def.mag || state.reserve <= 0) return false;
      state.reloadLeft = def.reload;
      return true;
    },
    refill() {
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.reloadLeft = 0;
      state.cooldown = 0;
    },
  };
}
