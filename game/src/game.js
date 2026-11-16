// The match: rounds, money, the charge, and the score. One state object, one step.
// Vanguard (the player's team) defends the two sites; Ember attacks with the charge.
// A round ends by elimination, by detonation, by defusal, or by the clock. First to five
// rounds takes the match. Money: kills pay, wins pay more, losses pay a streak bonus.
import { WEAPONS, ARMOR_PRICE, GRENADE_PRICE, GRENADE_MAX } from './weapons.js';

export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const DETONATE_SECONDS = 35;
export const ROUNDS_TO_WIN = 5;
export const MAX_ROUNDS = 9;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const LOSS_STREAK_BONUS = 500;
export const MAX_LOSS_REWARD = 3400;
export const PLANT_REWARD = 300;

export function createGame(rng) {
  const game = {
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    round: 0,
    wins: { vanguard: 0, ember: 0 },
    timer: 0,
    money: 800,
    lossStreak: 0,
    planted: null, // { site, center, plantedAt, fuse }
    attackSite: 'A',
    loadout: { primary: null, armor: 0, grenades: 0 },
    kills: 0,
    deaths: 0,
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    events: [], // { kind, text, at } drained by main.js for the killfeed
    banner: null, // { title, sub, at } drained by the HUD
  };

  function log(kind, text) {
    game.events.push({ kind, text, at: performance.now() });
  }

  function showBanner(title, sub) {
    game.banner = { title, sub };
  }

  function startMatch() {
    game.round = 0;
    game.wins = { vanguard: 0, ember: 0 };
    game.money = 800;
    game.lossStreak = 0;
    game.kills = 0;
    game.deaths = 0;
    game.matchWinner = null;
    game.loadout = { primary: null, armor: 0, grenades: 0 };
    startRound();
  }

  function startRound() {
    game.round += 1;
    game.attackSite = rng() < 0.5 ? 'A' : 'B';
    game.planted = null;
    game.roundWinner = null;
    game.roundReason = '';
    game.phase = 'buy';
    game.timer = BUY_SECONDS;
    showBanner(`Round ${game.round}`, `Ember is pushing Site ${game.attackSite} — buy up (B)`);
  }

  function startLive() {
    game.phase = 'live';
    game.timer = ROUND_SECONDS;
  }

  function endRound(winner, reason) {
    if (game.phase === 'roundEnd' || game.phase === 'matchEnd') return;
    game.phase = 'roundEnd';
    game.timer = 5;
    game.roundWinner = winner;
    game.roundReason = reason;
    game.wins[winner] += 1;
    const playerWon = winner === 'vanguard';
    if (playerWon) {
      game.money += WIN_REWARD;
      game.lossStreak = 0;
      showBanner('Round won', reason);
    } else {
      game.lossStreak += 1;
      game.money += Math.min(MAX_LOSS_REWARD, LOSS_REWARD + (game.lossStreak - 1) * LOSS_STREAK_BONUS);
      showBanner('Round lost', reason);
    }
    log('round', playerWon ? `Round ${game.round} — Vanguard takes it: ${reason}` : `Round ${game.round} — Ember takes it: ${reason}`);
    if (game.wins[winner] >= ROUNDS_TO_WIN || game.round >= MAX_ROUNDS) {
      game.matchWinner = game.wins.vanguard > game.wins.ember ? 'vanguard' : 'ember';
    }
  }

  function plant(site, byName) {
    if (game.planted || game.phase !== 'live') return false;
    game.planted = { site: site.id, center: site.center, fuse: DETONATE_SECONDS, beepT: 0 };
    game.timer = DETONATE_SECONDS; // the round clock becomes the fuse
    log('plant', `${byName} planted the charge at Site ${site.id}`);
    showBanner('Charge planted', `Site ${site.id} — defuse it before the fuse burns down`);
    return true;
  }

  function defuse(byName) {
    if (!game.planted) return false;
    game.planted = null;
    log('defuse', `${byName} defused the charge`);
    endRound('vanguard', 'charge defused');
    return true;
  }

  function detonate() {
    game.planted = null;
    endRound('ember', 'charge detonated');
  }

  // Called when a fighter dies; resolves elimination wins, honouring a planted charge.
  function onKill(killerTeam, killerName, victimTeam, victimName, headshot, aliveCount) {
    log('kill', `${killerName} ${headshot ? '◉ ' : ''}▸ ${victimName}`);
    if (killerTeam === 'vanguard' && killerName === 'You') {
      game.money += KILL_REWARD;
      game.kills += 1;
    }
    if (game.phase !== 'live') return;
    if (aliveCount.ember === 0 && !game.planted) endRound('vanguard', 'Ember team eliminated');
    else if (aliveCount.vanguard === 0 && !game.planted) endRound('ember', 'Vanguard team eliminated');
    else if (aliveCount.vanguard === 0 && game.planted) detonate();
  }

  function onPlayerDeath() {
    game.deaths += 1;
  }

  function step(dt) {
    if (game.phase === 'buy') {
      game.timer -= dt;
      if (game.timer <= 0) startLive();
    } else if (game.phase === 'live') {
      game.timer -= dt;
      if (game.planted) {
        game.planted.fuse -= dt;
        if (game.planted.fuse <= 0) detonate();
      } else if (game.timer <= 0) {
        endRound('vanguard', 'time expired — sites held');
      }
    } else if (game.phase === 'roundEnd') {
      game.timer -= dt;
      if (game.timer <= 0) {
        if (game.matchWinner) {
          game.phase = 'matchEnd';
          showBanner(
            game.matchWinner === 'vanguard' ? 'Match won — Dustline is yours' : 'Match lost — Ember takes Dustline',
            `Final score ${game.wins.vanguard} – ${game.wins.ember} · ${game.kills} eliminations`,
          );
        } else startRound();
      }
    }
  }

  // --- The buy menu ---------------------------------------------------------
  function buyList() {
    const items = [
      { id: 'smg', name: WEAPONS.smg.name, price: WEAPONS.smg.price, owned: game.loadout.primary === 'smg' },
      { id: 'shotgun', name: WEAPONS.shotgun.name, price: WEAPONS.shotgun.price, owned: game.loadout.primary === 'shotgun' },
      { id: 'rifle', name: WEAPONS.rifle.name, price: WEAPONS.rifle.price, owned: game.loadout.primary === 'rifle' },
      { id: 'dmr', name: WEAPONS.dmr.name, price: WEAPONS.dmr.price, owned: game.loadout.primary === 'dmr' },
      { id: 'armor', name: 'Kevlar vest (+100 armour)', price: ARMOR_PRICE, owned: game.loadout.armor > 0 },
      { id: 'grenade', name: 'Frag grenade', price: GRENADE_PRICE, owned: false, count: game.loadout.grenades },
    ];
    return items;
  }

  // Returns { ok, message } and applies the purchase to the loadout.
  function buy(id) {
    if (game.phase !== 'buy' && game.phase !== 'live') return { ok: false, message: 'Buy only between rounds' };
    if (id === 'armor') {
      if (game.loadout.armor >= 100) return { ok: false, message: 'Armour already full' };
      if (game.money < ARMOR_PRICE) return { ok: false, message: 'Not enough money' };
      game.money -= ARMOR_PRICE;
      game.loadout.armor = 100;
      return { ok: true, message: 'Kevlar vest equipped' };
    }
    if (id === 'grenade') {
      if (game.loadout.grenades >= GRENADE_MAX) return { ok: false, message: 'Carrying the maximum grenades' };
      if (game.money < GRENADE_PRICE) return { ok: false, message: 'Not enough money' };
      game.money -= GRENADE_PRICE;
      game.loadout.grenades += 1;
      return { ok: true, message: 'Frag grenade bought' };
    }
    const def = WEAPONS[id];
    if (!def) return { ok: false, message: 'Unknown item' };
    if (game.loadout.primary === id) return { ok: false, message: 'Already owned' };
    if (game.money < def.price) return { ok: false, message: 'Not enough money' };
    game.money -= def.price;
    game.loadout.primary = id;
    return { ok: true, message: `${def.name} bought` };
  }

  return {
    state: game,
    startMatch,
    startRound,
    startLive,
    endRound,
    plant,
    defuse,
    detonate,
    onKill,
    onPlayerDeath,
    step,
    buyList,
    buy,
    log,
    showBanner,
  };
}
