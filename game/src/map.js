// Ember Yard: an original desert freight yard at dusk. Vanguard spawns south, Ember north;
// Site A is a walled warehouse pocket in the north-west, Site B a container yard in the
// north-east. Three lanes join them: A-long along the west wall, mid through the yard, and
// B-long along the east wall. Every box is a collider and a bullet stop. The nav graph is
// the bots' road map: nodes at junctions and site mouths, edges along the lanes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const MAP_BOUNDS = { minX: -30, maxX: 30, minZ: -22, maxZ: 22 };

export const SITES = [
  { id: 'A', name: 'Site A', center: new THREE.Vector3(-22, 0, -13), radius: 5.5 },
  { id: 'B', name: 'Site B', center: new THREE.Vector3(22, 0, -13), radius: 5.5 },
];

export const SPAWNS = {
  vanguard: [
    [-4, 18], [0, 19], [4, 18], [-2, 16], [2, 16],
  ],
  ember: [
    [-4, -18], [0, -19], [4, -18], [-2, -16], [2, -16],
  ],
};

// Nav nodes: [x, z]. Edges join neighbours a bot may walk between.
const NAV_NODES = [
  [-4, 18], [0, 19], [4, 18], // 0-2 Vanguard spawn
  [-14, 12], [0, 10], [14, 12], // 3-5 south junctions
  [-26, 10], [26, 10], // 6-7 long south
  [-26, -2], [26, -2], // 8-9 long mid
  [-10, 0], [0, 2], [10, 0], // 10-12 mid
  [0, -6], [-10, -8], [10, -8], // 13-15 mid north
  [-20, -6], [20, -6], // 16-17 site mouths
  [-22, -13], [22, -13], // 18-19 sites
  [-4, -18], [0, -19], [4, -18], // 20-22 Ember spawn
  [-14, -16], [14, -16], // 23-24 north junctions
  [-26, -12], [26, -12], // 25-26 long north
];
const NAV_EDGES = [
  [0, 3], [1, 4], [2, 5], [3, 4], [4, 5], [3, 6], [5, 7],
  [6, 8], [7, 9], [8, 10], [9, 12], [10, 11], [11, 12], [11, 13],
  [10, 14], [12, 15], [13, 14], [13, 15], [14, 16], [15, 17],
  [16, 18], [17, 19], [8, 25], [9, 26], [25, 18], [26, 19],
  [25, 23], [26, 24], [23, 20], [24, 22], [20, 21], [21, 22],
  [23, 14], [24, 15], [14, 13], [15, 13], [16, 10], [17, 12],
  [3, 10], [5, 12], [6, 3], [7, 5], [0, 4], [2, 4],
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];
  const footprints = [];
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: name === 'container' || name === 'containerB' ? 0.25 : 0.03,
    });
  }
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });

  function box(w, h, d, x, y, z, material, { collider = true, glow = false } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glow ? glowMat : materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collider) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
      footprints.push({ x, z, w, d, color: PALETTE[material] });
    }
    return mesh;
  }

  // Ground: packed sand with darker yard patches.
  box(61, 0.4, 45, 0, -0.2, 0, 'ground');
  box(20, 0.06, 14, -20, 0.03, -12, 'groundDark', { collider: false });
  box(20, 0.06, 14, 20, 0.03, -12, 'groundDark', { collider: false });
  box(14, 0.06, 10, 0, 0.03, 14, 'groundDark', { collider: false });

  // Perimeter walls, 5 m, open sky above.
  box(61, 5, 0.6, 0, 2.5, -22.3, 'surface');
  box(61, 5, 0.6, 0, 2.5, 22.3, 'surface');
  box(0.6, 5, 45, -30.3, 2.5, 0, 'surface');
  box(0.6, 5, 45, 30.3, 2.5, 0, 'surface');

  // Site A warehouse pocket: north-west walls with two mouths (south and east).
  box(0.6, 3.6, 12, -14, 1.8, -16, 'surface'); // east wall of the pocket
  box(16, 3.6, 0.6, -22, 1.8, -6, 'surface'); // south wall of the pocket
  // Site A props: stacked crates and a low wall to plant behind.
  box(2.4, 2.4, 2.4, -26, 1.2, -16, 'hairline');
  box(1.2, 1.2, 1.2, -26, 3.0, -16, 'hairline');
  box(1.2, 1.1, 3.6, -18, 0.55, -16, 'hairline');
  box(3.6, 1.1, 1.2, -24, 0.55, -9, 'hairline');

  // Site B container yard: two big rusted containers and crate stacks.
  box(6, 2.4, 2.4, 18, 1.2, -16, 'container');
  box(6, 2.4, 2.4, 18, 3.6, -16, 'containerB');
  box(2.4, 2.4, 6, 26, 1.2, -10, 'containerB');
  box(1.2, 1.1, 1.2, 22, 0.55, -18, 'hairline');
  box(2.4, 1.1, 1.2, 24, 0.55, -16, 'hairline');

  // Mid: a low wall with a doorway gap, and the yard's central pillars.
  box(3, 2.6, 0.8, -2.5, 1.3, 2, 'surface');
  box(3, 2.6, 0.8, 2.5, 1.3, 2, 'surface');
  box(1.2, 3.4, 1.2, -6, 1.7, -4, 'hairline');
  box(1.2, 3.4, 1.2, 6, 1.7, -4, 'hairline');

  // Lane cover: crates and container corners worth crouching behind.
  box(1.2, 1.1, 1.2, -27, 0.55, 4, 'hairline');
  box(1.2, 1.1, 3.6, -27, 0.55, -4, 'hairline');
  box(2.4, 1.1, 1.2, -26, 0.55, 12, 'hairline');
  box(1.2, 1.1, 1.2, 27, 0.55, 4, 'hairline');
  box(1.2, 1.1, 3.6, 27, 0.55, -4, 'hairline');
  box(2.4, 1.1, 1.2, 26, 0.55, 12, 'hairline');
  box(1.2, 1.1, 1.2, -8, 0.55, 6, 'hairline');
  box(1.2, 2.2, 1.2, -8, 1.1, 6, 'hairline');
  box(1.2, 1.1, 1.2, 8, 0.55, 6, 'hairline');
  box(2.4, 1.1, 1.2, -12, 0.55, -6, 'hairline');
  box(2.4, 1.1, 1.2, 12, 0.55, -6, 'hairline');
  box(1.2, 1.1, 1.2, -4, 0.55, -12, 'hairline');
  box(1.2, 1.1, 1.2, 4, 0.55, -12, 'hairline');

  // Spawn cover.
  box(2.4, 1.1, 1.2, -8, 0.55, 16, 'hairline');
  box(2.4, 1.1, 1.2, 8, 0.55, 16, 'hairline');
  box(2.4, 1.1, 1.2, -8, 0.55, -16, 'hairline');
  box(2.4, 1.1, 1.2, 8, 0.55, -16, 'hairline');

  // Silo drums at the corners (visual anchors, solid).
  for (const [x, z] of [[-28, -20], [28, -20], [-28, 20], [28, 20]]) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 6, 14), materials.container);
    drum.position.set(x, 3, z);
    drum.castShadow = true;
    drum.receiveShadow = true;
    group.add(drum);
    colliders.push(new THREE.Box3().setFromObject(drum));
    shootables.push(drum);
    footprints.push({ x, z, w: 3.2, d: 3.2, color: PALETTE.container });
  }

  // Distant skyline silhouettes outside the walls, for the dusk horizon.
  const skyline = new THREE.MeshStandardMaterial({ color: new THREE.Color('#33261a'), roughness: 1 });
  for (let i = 0; i < 14; i += 1) {
    const h = 8 + ((i * 37) % 14);
    const m = new THREE.Mesh(new THREE.BoxGeometry(6, h, 6), skyline);
    m.position.set(-70 + i * 11, h / 2 - 1, -46 - ((i * 13) % 8));
    group.add(m);
  }

  // Amber strip lights along the walls, and the site markers.
  for (const [x, z, w] of [[-15, -22, 8], [15, -22, 8], [-30, 0, 8], [30, 0, 8]]) {
    box(w, 0.12, 0.12, x, 4.4, z, 'accent', { collider: false, glow: true });
  }
  for (const site of SITES) {
    const marker = new THREE.Mesh(
      new THREE.CylinderGeometry(site.radius, site.radius, 0.08, 28),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.14, depthWrite: false }),
    );
    marker.position.set(site.center.x, 0.05, site.center.z);
    group.add(marker);
  }

  // Light: low amber sun from the west, cool dusk fill, warm sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color('#f2c98a'), new THREE.Color('#5a4630'), 1.15);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb45e'), 2.8);
  sun.position.set(-38, 20, 12);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -36;
  sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7a86a8'), 0.5);
  fill.position.set(20, 16, 22);
  scene.add(fill);

  // Dusk sky dome: a vertical gradient painted on a canvas, so the horizon glows amber
  // and the zenith stays deep blue. No texture file, no network request.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4;
  skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext('2d');
  const gradient = skyCtx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#232c3e');
  gradient.addColorStop(0.45, '#5c4a38');
  gradient.addColorStop(0.62, '#c97e35');
  gradient.addColorStop(0.72, '#e8a33d');
  gradient.addColorStop(1, '#3a2a1c');
  skyCtx.fillStyle = gradient;
  skyCtx.fillRect(0, 0, 4, 256);
  const skyTexture = new THREE.CanvasTexture(skyCanvas);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(150, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, fog: false }),
  );
  scene.add(dome);

  const nav = {
    nodes: NAV_NODES.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    edges: NAV_EDGES,
  };
  return { colliders, shootables, footprints, group, nav, sites: SITES, spawns: SPAWNS };
}
