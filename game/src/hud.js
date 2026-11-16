// The DOM HUD: crosshair, hit marker, health and armour, ammo, money, timer, score, team
// pips, killfeed, a top-down minimap, banners and the buy menu. It never touches the
// simulation; main.js pushes numbers in and reads callbacks out. Minimap scale: the yard is
// 60 x 44 m, drawn on a 150 x 150 canvas.
import { PALETTE } from './palette.js';

const MINIMAP_SIZE = 150;
const WORLD_W = 60;
const WORLD_H = 44;

export function createHud(world) {
  const $ = (id) => document.getElementById(id);
  const el = {
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    vignette: $('damage-vignette'),
    healthNum: $('health-num'),
    healthFill: $('health-fill'),
    armorNum: $('armor-num'),
    armorFill: $('armor-fill'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    weaponName: $('weapon-name'),
    money: $('money'),
    timer: $('timer'),
    scoreV: $('score-v'),
    scoreE: $('score-e'),
    aliveV: $('alive-v'),
    aliveE: $('alive-e'),
    killfeed: $('killfeed'),
    minimap: $('minimap'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    objective: $('objective'),
    progress: $('progress'),
    progressFill: $('progress-fill'),
    progressLabel: $('progress-label'),
    buyMenu: $('buy-menu'),
    buyItems: $('buy-items'),
    buyMoney: $('buy-money'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    play: $('play'),
    hint: $('hint'),
  };
  const mapCtx = el.minimap.getContext('2d');
  let hitTimer = 0;
  let bannerTimer = 0;
  let last = {};
  let buyHandler = null;
  let playHandler = null;

  function toMap(x, z) {
    return [
      ((x - (-30)) / WORLD_W) * MINIMAP_SIZE,
      ((z - (-22)) / WORLD_H) * MINIMAP_SIZE,
    ];
  }

  function setText(node, key, value) {
    if (last[key] !== value) {
      last[key] = value;
      node.textContent = value;
    }
  }

  function drawMinimap(player, teammates, knownEnemies, planted) {
    const c = mapCtx;
    c.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    c.fillStyle = 'rgba(20,16,12,0.72)';
    c.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    // Walls and cover.
    for (const f of world.footprints) {
      const [x, y] = toMap(f.x - f.w / 2, f.z - f.d / 2);
      c.fillStyle = f.color;
      c.fillRect(x, y, (f.w / WORLD_W) * MINIMAP_SIZE, (f.d / WORLD_H) * MINIMAP_SIZE);
    }
    // Sites.
    for (const site of world.sites) {
      const [x, y] = toMap(site.center.x, site.center.z);
      c.strokeStyle = PALETTE.accent;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(x, y, (site.radius / WORLD_W) * MINIMAP_SIZE, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = PALETTE.accent;
      c.font = 'bold 9px system-ui';
      c.fillText(site.id, x - 3, y + 3);
    }
    // Planted charge.
    if (planted) {
      const [x, y] = toMap(planted.center.x, planted.center.z);
      c.fillStyle = PALETTE.danger;
      c.beginPath();
      c.arc(x, y, 5, 0, Math.PI * 2);
      c.fill();
    }
    const dot = (x, z, color, r = 3) => {
      const [mx, my] = toMap(x, z);
      c.fillStyle = color;
      c.beginPath();
      c.arc(mx, my, r, 0, Math.PI * 2);
      c.fill();
    };
    for (const t of teammates) dot(t.x, t.z, PALETTE.teal, 2.5);
    for (const e of knownEnemies) dot(e.x, e.z, PALETTE.ember, 3);
    // Player arrow.
    const [px, py] = toMap(player.x, player.z);
    c.save();
    c.translate(px, py);
    c.rotate(Math.atan2(-Math.sin(player.yaw), -Math.cos(player.yaw)) + Math.PI);
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(0, -6);
    c.lineTo(4, 5);
    c.lineTo(-4, 5);
    c.closePath();
    c.fill();
    c.restore();
  }

  function feed(text, kind) {
    const row = document.createElement('div');
    row.className = `feed-row ${kind || ''}`;
    row.textContent = text;
    el.killfeed.prepend(row);
    while (el.killfeed.children.length > 5) el.killfeed.lastChild.remove();
    setTimeout(() => { row.classList.add('fade'); }, 6000);
    setTimeout(() => { row.remove(); }, 7000);
  }

  return {
    setHealth(health, armor) {
      setText(el.healthNum, 'hp', String(Math.max(0, Math.ceil(health))));
      setText(el.armorNum, 'ar', String(Math.max(0, Math.ceil(armor))));
      el.healthFill.style.width = `${Math.max(0, health)}%`;
      el.armorFill.style.width = `${Math.max(0, armor)}%`;
      el.healthFill.classList.toggle('low', health <= 30);
    },
    setAmmo(mag, reserve, name) {
      setText(el.ammoMag, 'mag', String(mag));
      setText(el.ammoReserve, 'res', `/ ${reserve}`);
      setText(el.weaponName, 'wname', name);
      el.ammoMag.parentElement.classList.toggle('empty', mag === 0);
    },
    setMoney(value) {
      setText(el.money, 'money', `$${value}`);
    },
    setTimer(seconds, urgent) {
      const s = Math.max(0, Math.ceil(seconds));
      setText(el.timer, 'timer', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      el.timer.classList.toggle('urgent', !!urgent);
    },
    setScore(v, e) {
      setText(el.scoreV, 'sv', String(v));
      setText(el.scoreE, 'se', String(e));
    },
    setAlive(v, e) {
      setText(el.aliveV, 'av', '●'.repeat(v) + '○'.repeat(Math.max(0, 5 - v)));
      setText(el.aliveE, 'ae', '●'.repeat(e) + '○'.repeat(Math.max(0, 5 - e)));
    },
    setObjective(text) {
      setText(el.objective, 'obj', text);
    },
    setSpread(px) {
      el.crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      el.hitmarker.classList.add('on');
      if (killed) el.hitmarker.classList.add('kill');
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => el.hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      el.vignette.classList.add('on');
      setTimeout(() => el.vignette.classList.remove('on'), 180);
    },
    showBanner(title, sub, ms = 3200) {
      el.bannerTitle.textContent = title;
      el.bannerSub.textContent = sub;
      el.banner.classList.remove('hidden');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => el.banner.classList.add('hidden'), ms);
    },
    feed,
    setProgress(label, fraction) {
      if (label == null) {
        el.progress.classList.add('hidden');
        return;
      }
      el.progress.classList.remove('hidden');
      el.progressLabel.textContent = label;
      el.progressFill.style.width = `${Math.round(fraction * 100)}%`;
    },
    drawMinimap,
    showBuy(items, money) {
      el.buyMoney.textContent = `$${money}`;
      el.buyItems.innerHTML = '';
      items.forEach((item, i) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.dataset.id = item.id;
        const owned = item.owned ? ' — owned' : item.count ? ` — x${item.count}` : '';
        row.innerHTML = `<span class="buy-key">${i + 1}</span><span class="buy-name">${item.name}${owned}</span><span class="buy-price">$${item.price}</span>`;
        row.addEventListener('click', () => { if (buyHandler) buyHandler(item.id); });
        el.buyItems.appendChild(row);
      });
      el.buyMenu.classList.remove('hidden');
    },
    hideBuy() {
      el.buyMenu.classList.add('hidden');
    },
    isBuyOpen() {
      return !el.buyMenu.classList.contains('hidden');
    },
    onBuy(handler) {
      buyHandler = handler;
    },
    showOverlay(title, copy, action) {
      el.overlayTitle.textContent = title;
      el.overlayCopy.textContent = copy;
      el.play.textContent = action;
      el.overlay.classList.remove('hidden');
      el.play.focus();
    },
    hideOverlay() {
      el.overlay.classList.add('hidden');
    },
    onPlay(handler) {
      playHandler = handler;
      el.play.addEventListener('click', () => playHandler && playHandler());
    },
    showHint(text, ms = 5000) {
      el.hint.textContent = text;
      el.hint.classList.remove('hidden');
      setTimeout(() => el.hint.classList.add('hidden'), ms);
    },
  };
}
