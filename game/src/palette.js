// DUSTLINE: a round-based tactical FPS in three.js. Original map, art, sounds and names.
// The look plan, in one place: dusk over a desert freight yard. Warm sand and rust, one cool
// teal for the player's team, one hot ember orange for the other. The same names are the CSS
// custom properties in index.html.
export const PALETTE = {
  canvas: '#191512', // dusk sky / fog
  surface: '#2a211a', // dark steel and shadowed walls
  hairline: '#4a3b2c', // crates and low cover
  ground: '#6b543a', // packed sand yard
  groundDark: '#54402c',
  container: '#7a4a2b', // rusted containers
  containerB: '#5d6b52', // moss-green containers
  ink: '#efe6d4', // warm off-white
  muted: '#a89a83', // dusty tan
  accent: '#e8a33d', // amber: UI highlight, tracers, muzzle
  teal: '#3fb8a6', // Vanguard (player team)
  ember: '#e0572e', // Ember (enemy team)
  danger: '#d93a2b', // damage, planted charge
};

export function shade(name) {
  return PALETTE[name];
}
