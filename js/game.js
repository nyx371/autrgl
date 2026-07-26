'use strict';

/* =========================================================
   RIFTFORGE — an automation defense roguelike
   Defend the Rift Spire. Enemies fly in from the edges.
   Zap them yourself; build machines so the Spire fights back.
   ========================================================= */

// ---------- tuning ----------
const MAX_WAVE = 10;
const HULL_MAX = 100;
const BASE_SHIELD = 30;
const BASE_REGEN = 1.2;    // shield/s
const CALM_TIME = 3;       // seconds between waves
const ZAP_DMG = 4;
const ZAP_RANGE = 70;      // px around the tap that still hits
const NOVA_DMG = 16;
const NOVA_CD = 15;
const HOLD_TIME = 1;       // press-and-hold seconds to confirm a card
const OD_MAX = 100;        // overdrive charge
const OD_TIME = 6;         // seconds of overdrive
const WAVE_REPAIR = 4;     // hull repaired after each cleared wave

const ENEMY_TYPES = {
  dart:     { hp: 6,   speed: 38, spdVar: 14, dps: 4,  scrap: 3,   size: 7.5, color: '#ff9d4d' },
  splitter: { hp: 14,  speed: 28, spdVar: 6,  dps: 6,  scrap: 7,   size: 10,  color: '#b45cff' },
  brute:    { hp: 26,  speed: 21, spdVar: 5,  dps: 9,  scrap: 10,  size: 12,  color: '#ff5c4d' },
  boss:     { hp: 550, speed: 9,  spdVar: 1,  dps: 22, scrap: 250, size: 26,  color: '#ff2d6d' },
};

const MACHINES = {
  reactor: { name: 'Reactor',    icon: 'reactor', base: 20,  growth: 1.5,  desc: '+2[bolt]/s income' },
  turret:  { name: 'Turret',     icon: 'turret',  base: 30,  growth: 1.5,  desc: '1 shot/s · 4 dmg' },
  shield:  { name: 'Shield Gen', icon: 'shield',  base: 40,  growth: 1.5,  desc: '+15 max [shield] · +0.6/s' },
  tesla:   { name: 'Tesla Coil', icon: 'tesla',   base: 100, growth: 1.6,  desc: 'every 3s: chain 6 dmg ×2' },
};
const MACHINE_COLORS = { reactor: '#9d7cff', turret: '#ffd75c', shield: '#4dd8ff', tesla: '#b45cff' };

// replace [bolt]-style tokens with inline icons
const iconize = str => str.replace(/\[(\w+)\]/g, (_, n) => icon(n));

const TAGS = {
  OVER:   { icon: 'flame',  name: 'Overclock', blurb: 'Raw firepower. Kill faster than they arrive.' },
  AEGIS:  { icon: 'shield', name: 'Aegis',     blurb: 'The [shield] Shield holds while the guns work.' },
  STORM:  { icon: 'jolt',   name: 'Storm',     blurb: 'Lightning: your [jolt] Zap and [tesla] Tesla Coils.' },
  AUTO:   { icon: 'cog',    name: 'Auto',      blurb: 'The Spire acts without you. Stacks with itself.' },
};

const CARDS = [
  { id: 'overcharge',  name: 'Overcharge',      tags: ['OVER'],  desc: '[turret] Turrets +60% damage' },
  { id: 'rapidfire',   name: 'Rapid Fire',      tags: ['OVER'],  desc: '[turret] Turrets +50% fire rate' },
  { id: 'executioner', name: 'Executioner',     tags: ['OVER'],  desc: 'Any hit kills enemies below 20% HP', syn: 'Finish the tanky ones early.' },
  { id: 'stormzap',    name: 'Storm Zap',       tags: ['OVER', 'STORM'], desc: '[jolt] Zap +100% damage' },
  { id: 'bulwark',     name: 'Bulwark',         tags: ['AEGIS'], desc: '+40 max [shield] Shield' },
  { id: 'regenerator', name: 'Regenerator',     tags: ['AEGIS'], desc: '[shield] Shield regen +2/s' },
  { id: 'thorns',      name: 'Thorn Field',     tags: ['AEGIS'], desc: 'Enemies gnawing the Spire take 3 dmg/s', syn: 'Turns being hit into a weapon.' },
  { id: 'capacitor',   name: 'Capacitor',       tags: ['AEGIS', 'STORM'], desc: '[shield] Shield full: all damage +35%', syn: 'Rewards keeping the Shield topped up.' },
  { id: 'chain',       name: 'Chain Lightning', tags: ['STORM'], desc: '[tesla] Tesla hits +2 extra targets' },
  { id: 'static',      name: 'Static Field',    tags: ['STORM'], desc: '[jolt] Zap splashes 50% damage nearby' },
  { id: 'resonance',   name: 'Resonance',       tags: ['STORM'], desc: '[tesla] Tesla +20% damage per [jolt] STORM card', syn: 'Scales with every Storm pick.' },
  { id: 'scrap',       name: 'Scrap Magnet',    tags: ['AUTO'],  desc: '+50%[bolt] from kills' },
  { id: 'autoforge',   name: 'Auto-Forge',      tags: ['AUTO'],  desc: 'Every 8s: auto-buys the cheapest machine' },
  { id: 'gridmind',    name: 'Grid Mind',       tags: ['AUTO'],  desc: '+12% all damage per [cog] AUTO card', syn: 'Scales with every Auto pick.' },
  { id: 'fieldrepair', name: 'Field Repair',    tags: ['AEGIS'], desc: '+8 extra hull repaired after each wave' },
  { id: 'magnet',      name: 'Magnet Drones',   tags: ['AUTO'],  desc: 'Drops fly to the Spire on their own' },
  { id: 'odcore',      name: 'Overdrive Core',  tags: ['STORM'], desc: '[flux] Overdrive lasts 4s longer' },
];

// ---------- state ----------
let S;
const enemies = [];
function newRun() {
  S = {
    energy: 35, earned: 0, time: 0,
    hull: HULL_MAX, kills: 0,
    shield: BASE_SHIELD,
    wave: 1, phase: 'calm', calmT: CALM_TIME,
    spawnLeft: 0, spawnT: 0,
    counts: { reactor: 0, turret: 1, shield: 0, tesla: 0 }, // start with 1 turret so the Spire fights back immediately
    cards: [],
    combo: 0, comboT: 0, bestCombo: 0,
    novaCd: 0, teslaT: 0, turretAcc: 0, autoT: 0, thornT: 0, hitT: 0,
    od: 0, odT: 0, odReadyPinged: false,
    queue: [],
    ending: null, endT: 0, endShown: false,
    paused: true, over: false,
  };
  enemies.length = 0;
  pickups.length = 0;
}
const pickups = [];

const has = id => S.cards.includes(id);
const tagCount = tag => S.cards.reduce((n, id) => n + (CARDS.find(c => c.id === id).tags.includes(tag) ? 1 : 0), 0);
const cost = key => Math.ceil(MACHINES[key].base * Math.pow(MACHINES[key].growth, S.counts[key]));

// ---------- derived rates ----------
function shieldMax() { return BASE_SHIELD + S.counts.shield * 15 + (has('bulwark') ? 40 : 0); }

function calc() {
  const od = S.odT > 0;
  let dmgMult = 1;
  if (has('gridmind')) dmgMult *= 1 + 0.12 * tagCount('AUTO');
  if (has('capacitor') && S.shield >= shieldMax() - 0.5) dmgMult *= 1.35;

  const turretDmg = 4 * (has('overcharge') ? 1.6 : 1) * dmgMult * (od ? 2 : 1);
  const turretRate = S.counts.turret * (has('rapidfire') ? 1.5 : 1) * (od ? 2 : 1);

  const zapDmg = ZAP_DMG * (has('stormzap') ? 2 : 1) * dmgMult * (od ? 2 : 1);

  let teslaDmg = 6 * dmgMult * (od ? 1.5 : 1);
  if (has('resonance')) teslaDmg *= 1 + 0.20 * tagCount('STORM');
  const teslaTargets = 2 + (has('chain') ? 2 : 0);

  const regen = BASE_REGEN + S.counts.shield * 0.6 + (has('regenerator') ? 2 : 0);

  return {
    income: S.counts.reactor * 2,
    turretDmg, turretRate,
    zapDmg,
    teslaDmg, teslaTargets,
    regen,
    killMult: has('scrap') ? 1.5 : 1,
    novaDmg: NOVA_DMG * dmgMult,
  };
}

// ---------- enemies ----------
function buildWave(w) {
  const q = [];
  if (w === MAX_WAVE) {
    for (let i = 0; i < 8; i++) q.push('dart');
    q.push('brute', 'brute', 'splitter');
    // shuffle escorts, boss enters last
    for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
    q.push('boss');
    return q;
  }
  for (let i = 0; i < 5 + 3 * (w - 1); i++) q.push('dart');
  if (w >= 3) for (let i = 0; i < Math.floor(w / 2); i++) q.push('brute');
  if (w >= 4) for (let i = 0; i < Math.floor((w - 2) / 2); i++) q.push('splitter');
  for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
  // one random enemy per wave arrives as an ELITE from wave 4
  if (w >= 4) q[Math.floor(Math.random() * q.length)] += '!';
  return q;
}

function spawnEnemy(type, opts) {
  opts = opts || {};
  const elite = type.endsWith('!');
  if (elite) type = type.slice(0, -1);
  const T = ENEMY_TYPES[type];
  const w = S.wave;
  let x = opts.x, y = opts.y;
  if (x === undefined) {
    const side = Math.floor(Math.random() * 4);
    if (side === 0) { x = -14; y = Math.random() * H; }
    else if (side === 1) { x = W + 14; y = Math.random() * H; }
    else if (side === 2) { x = Math.random() * W; y = -14; }
    else { x = Math.random() * W; y = H + 14; }
  }
  const scale = type === 'boss' ? 1 : Math.pow(1.22, w - 1);
  const hp = T.hp * scale * (opts.hpMult || 1) * (elite ? 3 : 1);
  enemies.push({
    x, y, type, elite,
    hp, max: hp,
    speed: T.speed + Math.random() * T.spdVar,
    dps: T.dps * (elite ? 1.5 : 1),
    scrap: T.scrap * (1 + w * 0.12) * (elite ? 4 : 1) * (opts.hpMult || 1),
    size: T.size * (elite ? 1.35 : 1),
    color: T.color,
    wob: Math.random() * 7, flash: 0, minionT: 0,
  });
}

function hurtEnemy(en, dmg, sourceColor) {
  en.hp -= dmg;
  if (has('executioner') && en.hp > 0 && en.hp < en.max * 0.2) en.hp = 0;
  en.flash = 0.12;
  if (en.hp <= 0) killEnemy(en, sourceColor);
}

function killEnemy(en, colorHint) {
  const i = enemies.indexOf(en);
  if (i < 0) return;
  enemies.splice(i, 1);
  S.kills++;
  const gain = en.scrap * calc().killMult;
  S.energy += gain;
  S.earned += gain;
  fx.burstAt(en.x, en.y, colorHint || en.color, en.type === 'dart' ? 7 : 14);
  const r = cv.getBoundingClientRect();
  popup(r.left + en.x, r.top + en.y, '+' + fmt(gain) + icon('bolt'), 'var(--energy)');
  sfx.kill(en.type !== 'dart');

  // overdrive charges off kills
  if (S.odT <= 0 && S.od < OD_MAX) {
    S.od = Math.min(OD_MAX, S.od + 5 + en.scrap * 0.12);
    if (S.od >= OD_MAX && !S.odReadyPinged) {
      S.odReadyPinged = true;
      sfx.chime();
      popup(r.left + W / 2, r.top + H / 2 - 60, iconize('[flux] OVERDRIVE READY — TAP THE SPIRE'), '#ffb75c');
    }
  }

  // splitters burst into darts
  if (en.type === 'splitter') {
    for (let k = 0; k < 3; k++) {
      spawnEnemy('dart', { x: en.x + (Math.random() - .5) * 30, y: en.y + (Math.random() - .5) * 30, hpMult: 0.5 });
    }
    fx.burstAt(en.x, en.y, '#b45cff', 10);
  }

  // bosses go out with a bang
  if (en.type === 'boss') {
    fx.flash('255,45,109', 0.5);
    fx.nova('#ff2d6d', 80);
    buzz([60, 40, 120]);
  }

  // drops: tap to collect (or Magnet Drones auto-collect)
  const roll = Math.random();
  if (roll < 0.10) pickups.push({ x: en.x, y: en.y, kind: 'scrap', t: 5, value: 12 + S.wave * 4 });
  else if (roll < 0.16) pickups.push({ x: en.x, y: en.y, kind: 'orb', t: 5 });
}

function collectPickup(pk) {
  const i = pickups.indexOf(pk);
  if (i < 0) return;
  pickups.splice(i, 1);
  const r = cv.getBoundingClientRect();
  if (pk.kind === 'scrap') {
    S.energy += pk.value;
    S.earned += pk.value;
    popup(r.left + pk.x, r.top + pk.y, '+' + fmt(pk.value) + icon('bolt'), 'var(--energy)');
    beep(1047, 0.1, 'triangle', 0.05);
  } else {
    S.shield = shieldMax();
    popup(r.left + pk.x, r.top + pk.y, icon('shield') + ' FULL', 'var(--charge)');
    beep(659, 0.12, 'triangle', 0.05);
    fx.ring('#4dd8ff', 3);
  }
  fx.burstAt(pk.x, pk.y, pk.kind === 'scrap' ? '#ffd75c' : '#4dd8ff', 6);
  buzz(10);
}

function nearestEnemy(x, y, maxDist) {
  let best = null, bd = maxDist === undefined ? Infinity : maxDist;
  for (const en of enemies) {
    const d = Math.hypot(en.x - x, en.y - y);
    if (d < bd) { bd = d; best = en; }
  }
  return best;
}

// ---------- tick ----------
function tick(dt) {
  if (!S || S.paused || S.over) return;
  S.time += dt;
  const R = calc();
  const cx = W / 2, cy = H / 2;
  const coreR = Math.min(W, H) * 0.13;

  // economy + shield regen
  S.energy += R.income * dt;
  S.earned += R.income * dt;
  S.shield = Math.min(shieldMax(), S.shield + R.regen * dt);

  // combo decay + cooldowns
  if (S.comboT > 0) { S.comboT -= dt; if (S.comboT <= 0) S.combo = 0; }
  if (armedT > 0) { armedT -= dt; if (armedT <= 0) armedKey = null; }
  S.novaCd = Math.max(0, S.novaCd - dt);
  if (S.hitT > 0) S.hitT -= dt;

  // overdrive burn-down
  if (S.odT > 0) {
    S.odT -= dt;
    if (S.odT <= 0) { S.od = 0; S.odReadyPinged = false; }
  }

  // pickups age out; Magnet Drones fly them home
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pk = pickups[i];
    pk.t -= dt;
    if (pk.t <= 0) { pickups.splice(i, 1); continue; }
    if (has('magnet') && pk.t < 4.4) {
      const dx = cx - pk.x, dy = cy - pk.y;
      const d = Math.hypot(dx, dy) || 1;
      pk.x += (dx / d) * 220 * dt;
      pk.y += (dy / d) * 220 * dt;
      if (d < coreR) collectPickup(pk);
    }
  }

  if (S.phase === 'calm') {
    S.calmT -= dt;
    if (S.calmT <= 0) {
      S.phase = 'combat';
      S.queue = buildWave(S.wave);
      S.spawnLeft = S.queue.length;
      S.spawnT = 0;
      sfx.wave();
      const r = cv.getBoundingClientRect();
      popup(r.left + W / 2, r.top + H * 0.25, 'WAVE ' + S.wave, 'var(--heat)');
      buzz([20, 40, 20]);
    }
  } else if (S.phase === 'combat') {
    // spawning from the wave's typed queue
    if (S.queue.length > 0) {
      S.spawnT -= dt;
      if (S.spawnT <= 0) {
        S.spawnT = Math.max(0.25, 0.9 - S.wave * 0.05);
        spawnEnemy(S.queue.shift());
        S.spawnLeft = S.queue.length;
      }
    }

    // movement + latched damage
    let latchedDps = 0;
    for (const en of enemies) {
      const dx = cx - en.x, dy = cy - en.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > coreR + en.size) {
        en.x += (dx / d) * en.speed * dt;
        en.y += (dy / d) * en.speed * dt;
        en.latched = false;
      } else {
        en.latched = true;
        latchedDps += en.dps;
      }
      if (en.flash > 0) en.flash -= dt;
      // the boss births darts while it lives
      if (en.type === 'boss') {
        en.minionT += dt;
        if (en.minionT >= 4) {
          en.minionT = 0;
          for (let k = 0; k < 2; k++) spawnEnemy('dart', { x: en.x + (Math.random() - .5) * 40, y: en.y + (Math.random() - .5) * 40 });
          fx.burstAt(en.x, en.y, '#ff2d6d', 8);
          beep(160, 0.15, 'sawtooth', 0.04);
        }
      }
    }
    if (latchedDps > 0) {
      let dmg = latchedDps * dt;
      const fromShield = Math.min(S.shield, dmg);
      S.shield -= fromShield;
      dmg -= fromShield;
      if (dmg > 0) {
        S.hull -= dmg;
        S.hitT = 0.15;
      }
      if (S.hull <= 0) { S.hull = 0; return lose(); }
    }

    // thorns burn latched enemies
    if (has('thorns')) {
      S.thornT += dt;
      if (S.thornT >= 0.5) {
        S.thornT = 0;
        for (const en of [...enemies]) if (en.latched) hurtEnemy(en, 1.5, '#5cff9d');
      }
    }

    // turrets: auto-fire at the enemy nearest the Spire
    S.turretAcc += R.turretRate * dt;
    while (S.turretAcc >= 1) {
      S.turretAcc--;
      const t = nearestEnemy(cx, cy);
      if (!t) { S.turretAcc = 0; break; }
      beams.push({ x1: cx, y1: cy, x2: t.x, y2: t.y, t: 0.1, max: 0.1, c: '#ffd75c' });
      hurtEnemy(t, R.turretDmg, '#ffd75c');
      sfx.shot();
    }

    // tesla coils: periodic chain lightning
    if (S.counts.tesla > 0) {
      S.teslaT += dt;
      const interval = 3 / S.counts.tesla;
      if (S.teslaT >= interval && enemies.length) {
        S.teslaT = 0;
        let px = cx, py = cy;
        const targets = [...enemies]
          .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))
          .slice(0, R.teslaTargets);
        for (const t of targets) {
          arcs.push({ x: px, y: py, tx: t.x, ty: t.y, t: 0.16, max: 0.16 });
          px = t.x; py = t.y;
        }
        for (const t of targets) hurtEnemy(t, R.teslaDmg, '#b45cff');
        sfx.tesla();
      }
    }

    // wave cleared?
    if (S.queue.length === 0 && enemies.length === 0) {
      if (S.wave >= MAX_WAVE) return win();
      S.wave++;
      S.phase = 'calm';
      S.calmT = CALM_TIME;
      // field crews patch the hull between waves
      const repair = WAVE_REPAIR + (has('fieldrepair') ? 8 : 0);
      const healed = Math.min(HULL_MAX - S.hull, repair);
      if (healed > 0.5) {
        S.hull += healed;
        const r = cv.getBoundingClientRect();
        popup(r.left + W / 2, r.top + H / 2 + 50, '+' + Math.round(healed) + ' ' + icon('rift'), 'var(--good)');
      }
      sfx.chime();
      fx.ring('#5cff9d', 5);
      buzz(20);
      openDraft();
    }
  }

  // auto-forge
  if (has('autoforge')) {
    S.autoT += dt;
    if (S.autoT >= 8) {
      S.autoT = 0;
      const cheapest = Object.keys(MACHINES).sort((a, b) => cost(a) - cost(b))[0];
      if (S.energy >= cost(cheapest)) buy(cheapest, true);
    }
  }
}

// ---------- juice ----------
function popup(x, y, html, color) {
  const el = document.createElement('div');
  el.className = 'float';
  el.innerHTML = html;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  if (color) el.style.color = color;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 850);
}
function popAt(e, el, html, color) {
  let x = e && e.clientX, y = e && e.clientY;
  if (!x && el) { const r = el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
  popup(x, y, html, color);
}
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (err) { /* unsupported */ } };

// ---------- actions ----------
function buy(key, silent, e) {
  const c = cost(key);
  if (S.energy < c) {
    if (!silent) {
      beep(160, 0.12, 'sawtooth', 0.04);
      buzz(5);
      popAt(e, $id('bs-' + key), fmt(c) + icon('bolt') + '?', 'var(--heat)');
    }
    return;
  }
  S.energy -= c;
  S.counts[key]++;
  if (key === 'shield') S.shield += 15; // new capacity arrives charged
  if (!silent) {
    sfx.buyTone(key);
    buzz(15);
    popAt(e, $id('bs-' + key), '+1' + icon(MACHINES[key].icon), MACHINE_COLORS[key]);
    fx.ring(MACHINE_COLORS[key], 3);
    const cnt = document.querySelector('#bs-' + key + ' .bs-count');
    if (cnt) { cnt.classList.remove('bump'); void cnt.offsetWidth; cnt.classList.add('bump'); }
  }
}

function zap(e) {
  if (S.paused || S.over) return;
  const r = cv.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const R = calc();
  const target = nearestEnemy(x, y, ZAP_RANGE);
  const cx = W / 2, cy = H / 2;
  if (!target) {
    // dry fire: tiny fizzle, no combo
    fx.burstAt(x, y, '#4dd8ff', 3);
    beep(300, 0.04, 'triangle', 0.02);
    return;
  }
  S.combo = Math.min(25, S.combo + 1);
  S.bestCombo = Math.max(S.bestCombo, S.combo);
  S.comboT = 1.1;
  const mult = 1 + (S.combo - 1) * 0.05;
  const dmg = R.zapDmg * mult;
  arcs.push({ x: cx, y: cy, tx: target.x, ty: target.y, t: 0.15, max: 0.15 });
  fx.burstAt(target.x, target.y, '#4dd8ff', 5);
  hurtEnemy(target, dmg, '#4dd8ff');
  if (has('static')) {
    for (const en of [...enemies]) {
      if (en !== target && Math.hypot(en.x - target.x, en.y - target.y) < 60) hurtEnemy(en, dmg * 0.5, '#4dd8ff');
    }
  }
  sfx.tap(S.combo);
  buzz(8);
  const color = S.combo >= 15 ? '#ffffff' : S.combo >= 5 ? '#ffb75c' : 'var(--charge)';
  popAt(e, cv, fmt(dmg) + (S.combo >= 5 ? ' ×' + S.combo : ''), color);
}

function nova(e) {
  if (S.paused || S.over || S.novaCd > 0) return;
  S.novaCd = NOVA_CD;
  const R = calc();
  const cx = W / 2, cy = H / 2;
  fx.flash('140,220,255', 0.3);
  fx.ring('#8ad8ff', 6);
  fx.nova('#8ad8ff', 50);
  for (const en of [...enemies]) {
    const dx = en.x - cx, dy = en.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    en.x += (dx / d) * 90;
    en.y += (dy / d) * 90;
    hurtEnemy(en, R.novaDmg, '#8ad8ff');
  }
  sfx.nova();
  buzz([20, 30, 50]);
  popAt(e, cv, icon('nova') + ' NOVA', 'var(--charge)');
}

function overdrive(e) {
  if (S.paused || S.over || S.od < OD_MAX || S.odT > 0) return;
  S.odT = OD_TIME + (has('odcore') ? 4 : 0);
  fx.flash('255,183,92', 0.35);
  fx.ring('#ffb75c', 6);
  fx.nova('#ffb75c', 40);
  sfx.nova();
  buzz([30, 40, 80]);
  popAt(e, cv, iconize('[flux] OVERDRIVE'), '#ffb75c');
}

// ---------- drafts (press-and-hold to confirm) ----------
let draftOffer = [];
function openDraft() {
  const pool = CARDS.filter(c => !has(c.id));
  if (pool.length === 0) return;
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  draftOffer = pool.slice(0, 3);
  S.paused = true;
  sfx.draft();

  const wrap = document.getElementById('draft-cards');
  wrap.innerHTML = '';
  let pickLock = false;
  draftOffer.forEach((card, ci) => {
    const btn = document.createElement('button');
    btn.className = 'card';
    btn.style.animationDelay = (ci * 90) + 'ms';
    const tags = card.tags.map(t => icon(TAGS[t].icon) + ' ' + TAGS[t].name).join(' · ');
    btn.innerHTML =
      `<div class="c-top"><div class="c-name">${card.name}</div><div class="c-tags">${tags}</div></div>` +
      `<div class="c-desc">${iconize(card.desc)}</div>` +
      (card.syn ? `<div class="c-syn">${icon('sparkles')} ${card.syn}</div>` : '');

    // press-and-hold to confirm — guards against accidental taps
    const fill = document.createElement('div');
    fill.className = 'hold-fill';
    btn.appendChild(fill);

    let raf = 0, t0 = 0, done = false, ticks = 0;
    const step = now => {
      if (done) return;
      const p = Math.min(1, (now - t0) / (HOLD_TIME * 1000));
      fill.style.width = (p * 100) + '%';
      const tk = Math.floor(p * 6);
      if (tk > ticks) { ticks = tk; sfx.hold(p); buzz(4); }
      if (p >= 1) return finish();
      raf = requestAnimationFrame(step);
    };
    const start = ev => {
      if (pickLock || done) return;
      try { btn.setPointerCapture(ev.pointerId); } catch (err) { /* not captureable */ }
      btn.classList.add('holding');
      t0 = performance.now();
      ticks = 0;
      buzz(8);
      raf = requestAnimationFrame(step);
    };
    const cancel = () => {
      if (done) return;
      cancelAnimationFrame(raf);
      btn.classList.remove('holding');
      fill.style.width = '0%';
    };
    const finish = () => {
      done = true;
      pickLock = true;
      cancelAnimationFrame(raf);
      fill.style.width = '100%';
      btn.classList.remove('holding');
      btn.classList.add('picked');
      buzz(30);
      setTimeout(() => pickCard(card.id), 220);
    };
    btn.addEventListener('pointerdown', ev => { if (ev.button) return; start(ev); });
    btn.addEventListener('pointerup', cancel);
    btn.addEventListener('pointercancel', cancel);
    wrap.appendChild(btn);
  });
  show('draft-panel');
}

function pickCard(id) {
  S.cards.push(id);
  hideOverlay();
  S.paused = false;
  sfx.pick();
  buzz(25);
  popup(window.innerWidth / 2, window.innerHeight / 2, icon('sparkles') + ' ' + CARDS.find(c => c.id === id).name, 'var(--good)');
  renderChips();
}

// ---------- build strip (double-tap to confirm a purchase) ----------
let armedKey = null, armedT = 0;

function buildStrip() {
  const strip = $id('buildstrip');
  strip.innerHTML = '';
  for (const [key, m] of Object.entries(MACHINES)) {
    const b = document.createElement('button');
    b.className = 'bs-btn';
    b.id = 'bs-' + key;
    b.style.setProperty('--mcol', MACHINE_COLORS[key]);
    b.innerHTML =
      `<span class="bs-count">×${S.counts[key]}</span>` +
      icon(m.icon) +
      `<span class="bs-cost">${fmt(cost(key))}${icon('bolt')}</span>` +
      `<span class="bs-confirm">AGAIN?</span>`;
    b.addEventListener('pointerdown', e => {
      if (e.button || !S || S.paused || S.over) return;
      if (armedKey === key) {
        armedKey = null;
        buy(key, false, e);
      } else {
        armedKey = key;
        armedT = 1.6;
        beep(520, 0.05, 'triangle', 0.03);
        buzz(5);
      }
    });
    strip.appendChild(b);
  }
  const nb = document.createElement('button');
  nb.className = 'bs-btn bs-nova';
  nb.id = 'bs-nova';
  nb.innerHTML =
    `<span class="bs-cd" id="bs-nova-cd"></span>` +
    icon('nova') +
    `<span class="bs-cost">NOVA</span>`;
  nb.addEventListener('pointerdown', e => { if (e.button) return; nova(e); });
  strip.appendChild(nb);
}

let lastNovaCd = 0;
function renderStrip() {
  for (const key of Object.keys(MACHINES)) {
    const b = $id('bs-' + key);
    if (!b) continue;
    const can = !S.paused && !S.over && S.energy >= cost(key);
    b.classList.toggle('can', can);
    b.classList.toggle('armed', armedKey === key);
    b.querySelector('.bs-count').textContent = '×' + S.counts[key];
    b.querySelector('.bs-cost').innerHTML = fmt(cost(key)) + icon('bolt');
  }
  const nb = $id('bs-nova');
  if (nb) {
    const ready = S.novaCd <= 0 && !S.paused && !S.over;
    nb.classList.toggle('can', ready);
    $id('bs-nova-cd').style.height = (S.novaCd / NOVA_CD * 100) + '%';
    if (lastNovaCd > 0 && S.novaCd <= 0 && !S.paused && !S.over) {
      nb.classList.add('ready');
      setTimeout(() => nb.classList.remove('ready'), 500);
      buzz(10);
    }
    lastNovaCd = S.novaCd;
  }
}

// ---------- stats menu ----------
function buildStats() {
  const R = calc();
  const row = (ic, name, val) =>
    `<div class="info-row">${icon(ic)}<div><b>${name}</b></div><em>${val}</em></div>`;
  const mins = Math.floor(S.time / 60), secs = Math.floor(S.time % 60);

  const cardList = S.cards.length
    ? S.cards.map(id => {
        const c = CARDS.find(k => k.id === id);
        return `<div class="info-row">${icon(TAGS[c.tags[0]].icon)}<div><b>${c.name}</b><span>${iconize(c.desc)}</span></div></div>`;
      }).join('')
    : '<p>None yet — clear a wave.</p>';

  $id('stats-body').innerHTML = `
    <div class="info-sec">
      <h3>${icon('hazard')} RUN</h3>
      ${row('hazard', 'Wave', Math.min(S.wave, MAX_WAVE) + '/' + MAX_WAVE + ' · ' + mins + ':' + String(secs).padStart(2, '0'))}
      ${row('skull', 'Kills', S.kills)}
      ${row('bolt', 'Energy earned', fmt(S.earned))}
      ${row('sparkles', 'Best combo', '×' + S.bestCombo)}
    </div>
    <div class="info-sec">
      <h3>${icon('flame')} FIREPOWER</h3>
      ${row('turret', 'Turret DPS', fmt(R.turretDmg * R.turretRate) + ' (' + fmt(R.turretRate) + '/s × ' + fmt(R.turretDmg) + ')')}
      ${row('jolt', 'Zap damage', fmt(R.zapDmg) + ' per tap')}
      ${row('tesla', 'Tesla', S.counts.tesla ? fmt(R.teslaDmg) + ' × ' + R.teslaTargets + ' targets / ' + (3 / S.counts.tesla).toFixed(1) + 's' : '—')}
      ${row('nova', 'Nova damage', fmt(R.novaDmg))}
      ${row('flux', 'Overdrive', S.odT > 0 ? 'ACTIVE ' + S.odT.toFixed(1) + 's' : Math.round(S.od) + '%')}
    </div>
    <div class="info-sec">
      <h3>${icon('shield')} DEFENSE</h3>
      ${row('rift', 'Hull', Math.ceil(S.hull) + '/' + HULL_MAX)}
      ${row('shield', 'Shield', Math.ceil(S.shield) + '/' + Math.ceil(shieldMax()) + ' · +' + R.regen.toFixed(1) + '/s')}
      ${row('rift', 'Repair/wave', '+' + (WAVE_REPAIR + (has('fieldrepair') ? 8 : 0)))}
      ${row('reactor', 'Income', '+' + fmt(R.income) + '/s · kills ×' + R.killMult)}
    </div>
    <div class="info-sec">
      <h3>${icon('cards')} CARDS (${S.cards.length})</h3>
      ${cardList}
    </div>`;
}

let statsResume = false;
function openStats() {
  buildStats();
  statsResume = S && !S.paused && !S.over;
  if (S) S.paused = true;
  show('stats-panel');
}
function closeStats() {
  if (statsResume) { hideOverlay(); S.paused = false; }
  else show(S && S.over ? 'end-panel' : 'intro-panel');
  statsResume = false;
}

// ---------- info / legend ----------
function buildInfo() {
  const row = (ic, name, text) =>
    `<div class="info-row">${icon(ic)}<div><b>${name}</b>${text ? '<span>' + iconize(text) + '</span>' : ''}</div></div>`;

  const machines = Object.values(MACHINES).map(m => row(m.icon, m.name, m.desc)).join('');
  const tags = Object.values(TAGS).map(t => row(t.icon, t.name, t.blurb)).join('');

  $id('info-body').innerHTML = `
    <div class="info-sec">
      <h3>${icon('rift')} GOAL</h3>
      <p>${iconize('Enemies fly in from the edges and gnaw on your [rift] Rift Spire. Survive all ' + MAX_WAVE + ' waves and you win. If the Spire hull hits 0, the run ends.')}</p>
    </div>
    <div class="info-sec">
      <h3>${icon('help')} SYMBOLS</h3>
      ${row('bolt', 'Energy', 'Scrap from kills plus [reactor] Reactor income. Buys machines.')}
      ${row('rift', 'Hull', 'The Spire life bar. No regen — protect it.')}
      ${row('shield', 'Shield', 'Absorbs damage first and regenerates over time.')}
      ${row('sparkles', 'Combo', 'Chained [jolt] Zap hits multiply damage, up to ×25.')}
    </div>
    <div class="info-sec">
      <h3>${icon('jolt')} CONTROLS</h3>
      ${row('jolt', 'Tap an enemy', 'Zaps it from the Spire. Tap fast to build a combo.')}
      ${row('cog', 'Double-tap a build button', 'First tap arms it, second tap buys. It glows when affordable.')}
      ${row('nova', 'Tap NOVA', 'Blasts and knocks back every enemy. ' + NOVA_CD + 's cooldown.')}
    </div>
    <div class="info-sec">
      <h3>${icon('cog')} MACHINES</h3>
      ${machines}
    </div>
    <div class="info-sec">
      <h3>${icon('skull')} THREATS</h3>
      ${row('hazard', 'Darts', '<span style="color:#ff9d4d">Orange</span>, fast, fragile. The swarm.')}
      ${row('hazard', 'Splitters', '<span style="color:#b45cff">Purple diamonds</span> — burst into 3 darts when killed.')}
      ${row('hazard', 'Brutes', '<span style="color:#ff5c4d">Red pentagons</span> — slow, tanky, heavy hitters.')}
      ${row('sparkles', 'Elites', 'One per wave arrives <span style="color:#ffd75c">gold-ringed</span>: 3× HP, 4×[bolt].')}
      ${row('skull', 'THE MAW', 'The <span style="color:#ff2d6d">wave-10 boss</span>. Births darts while it lives.')}
    </div>
    <div class="info-sec">
      <h3>${icon('bolt')} DROPS &amp; OVERDRIVE</h3>
      ${row('bolt', 'Scrap Crystal', 'Sometimes drops from kills. Tap it before it fades: bonus [bolt].')}
      ${row('shield', 'Aegis Orb', 'Rarer drop. Tap it: [shield] Shield instantly refills.')}
      ${row('flux', 'Overdrive', 'Kills charge the gold ring around the Spire. When it pulses, tap the Spire: ' + OD_TIME + 's of doubled firepower.')}
      ${row('rift', 'Field Repair', '+' + WAVE_REPAIR + ' hull patched after every cleared wave.')}
    </div>
    <div class="info-sec">
      <h3>${icon('cards')} CARD TAGS</h3>
      <p>${iconize('After every wave you draft 1 of 3 [cards] Cards. Cards share tags, and several scale with how many of a tag you own — commit to a build.')}</p>
      ${tags}
    </div>`;
}

let infoResume = false;
function openInfo() {
  buildInfo();
  infoResume = S && !S.paused && !S.over;
  if (S) S.paused = true;
  show('info-panel');
}
function closeInfo() {
  if (infoResume) { hideOverlay(); S.paused = false; }
  else show(S && S.over ? 'end-panel' : 'intro-panel');
  infoResume = false;
}

// ---------- win / lose ----------
function endStats() {
  const mins = Math.floor(S.time / 60), secs = Math.floor(S.time % 60);
  return `
    <div>Time <span>${mins}:${String(secs).padStart(2, '0')}</span></div>
    <div>${icon('hazard')} waves survived <span>${S.ending === 'win' ? MAX_WAVE : S.wave - 1}/${MAX_WAVE}</span></div>
    <div>${icon('skull')} kills <span>${S.kills}</span></div>
    <div>${icon('bolt')} earned <span>${fmt(S.earned)}</span></div>
    <div>${icon('cards')} cards <span>${S.cards.length}</span></div>
    <div>${icon('cog')} machines <span>${Object.values(S.counts).reduce((a, b) => a + b, 0)}</span></div>`;
}

function prepEnd(title, cls, desc) {
  const t = document.getElementById('end-title');
  t.innerHTML = title;
  t.className = cls;
  document.getElementById('end-desc').textContent = desc;
  document.getElementById('end-stats').innerHTML = endStats();
}

function win() {
  if (S.ending) return;
  S.ending = 'win';
  S.over = true;
  sfx.win();
  buzz([40, 60, 40, 60, 140]);
  fx.flash('180,240,255', 0.75);
  fx.ring('#4dd8ff', 6); fx.ring('#ffffff', 3);
  fx.nova('#4dd8ff', 130);
  prepEnd(icon('rift') + ' SPIRE STANDS', 'win', 'Ten waves broke against your machines.');
}

function lose() {
  if (S.ending) return;
  S.ending = 'lose';
  S.over = true;
  sfx.lose();
  buzz([80, 50, 80, 50, 220]);
  fx.flash('255,60,30', 0.85);
  fx.nova('#ff5c4d', 90);
  prepEnd(icon('skull') + ' SPIRE FALLS', 'lose', 'The swarm chewed through the hull on wave ' + S.wave + '.');
}

// ---------- UI ----------
const $id = id => document.getElementById(id);

function show(panelId) {
  $id('overlay').classList.remove('hidden');
  ['intro-panel', 'draft-panel', 'end-panel', 'info-panel', 'stats-panel'].forEach(p =>
    $id(p).classList.toggle('hidden', p !== panelId));
}
function hideOverlay() { $id('overlay').classList.add('hidden'); }

function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return n >= 100 ? Math.floor(n).toString() : (Math.floor(n * 10) / 10).toString();
}

function renderChips() {
  const el = $id('tagchips');
  el.innerHTML = '';
  for (const [tag, t] of Object.entries(TAGS)) {
    const n = tagCount(tag);
    if (n === 0) continue;
    const chip = document.createElement('span');
    chip.className = 'chip hot';
    chip.innerHTML = `${icon(t.icon)}${n}`;
    el.appendChild(chip);
  }
}

function renderHUD(R) {
  $id('energy').textContent = fmt(S.energy);
  $id('eps').textContent = fmt(R.income);

  $id('hullfill').style.width = (S.hull / HULL_MAX * 100) + '%';
  $id('hullval').textContent = Math.ceil(S.hull);
  document.querySelector('.hullbar').classList.toggle('crit', S.hull < 30 && !S.over);

  const sm = shieldMax();
  $id('shieldfill').style.width = (S.shield / sm * 100) + '%';
  $id('shieldval').textContent = Math.ceil(S.shield) + '/' + Math.ceil(sm);
  $id('shieldrate').textContent = '+' + R.regen.toFixed(1) + '/s';

  const mins = Math.floor(S.time / 60), secs = Math.floor(S.time % 60);
  $id('clock').textContent = 'W' + Math.min(S.wave, MAX_WAVE) + '/' + MAX_WAVE + ' · ' + mins + ':' + String(secs).padStart(2, '0');

  const warn = $id('meltwarn');
  if (S.hull < 30 && !S.over) {
    warn.classList.remove('hidden');
    $id('meltcount').textContent = Math.ceil(S.hull);
  } else {
    warn.classList.add('hidden');
  }
}

/* =========================================================
   Canvas — the Spire and the swarm
   ========================================================= */
const cv = $id('rift');
const ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  const r = cv.parentElement.getBoundingClientRect();
  W = r.width; H = r.height;
  cv.width = W * DPR; cv.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);

const particles = [];
const arcs = [];   // lightning: from (x,y) to (tx,ty)
const beams = [];  // straight turret shots
const rings = [];
let flashFx = null;
let spawnAcc = 0;

function spawn(x, y, vx, vy, life, c, mode, size) {
  if (particles.length > 400) return;
  particles.push({ x, y, vx, vy, life, max: life, c, mode, size: size || 3 });
}

const fx = {
  ring(c, lw) { rings.push({ t: 1, c, lw: lw || 3 }); },
  flash(rgb, a) { flashFx = { c: rgb, a }; },
  burstAt(x, y, c, n) {
    for (let i = 0; i < (n || 8); i++) {
      const a = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 80;
      spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.55, c, 'out');
    }
  },
  nova(c, n) {
    const cx = W / 2, cy = H / 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 260;
      spawn(cx, cy, Math.cos(a) * sp, Math.sin(a) * sp, 0.9 + Math.random() * 0.8, Math.random() < 0.3 ? '#ffffff' : c, 'out', 2 + Math.random() * 3);
    }
  },
};

// canvas rendering of the SVG icon set via Path2D
const iconPaths = {};
function pathsFor(name) {
  if (!iconPaths[name]) {
    iconPaths[name] = [...ICONS[name].matchAll(/ d="([^"]+)"/g)].map(m => new Path2D(m[1]));
  }
  return iconPaths[name];
}
function drawIcon(name, x, y, size, color, alpha) {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 512, size / 512);
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  for (const path of pathsFor(name)) ctx.fill(path);
  ctx.restore();
  ctx.globalAlpha = 1;
}

function jagged(x1, y1, x2, y2, alpha) {
  const segs = 7, dx = x2 - x1, dy = y2 - y1;
  const dist = Math.hypot(dx, dy), nx = -dy / (dist || 1), ny = dx / (dist || 1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  for (let i = 1; i < segs; i++) {
    const f = i / segs, j = (Math.random() - 0.5) * dist * 0.18 * (1 - f);
    ctx.lineTo(x1 + dx * f + nx * j, y1 + dy * f + ny * j);
  }
  ctx.lineTo(x2, y2);
  ctx.globalAlpha = alpha * 0.35;
  ctx.strokeStyle = '#4dd8ff';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#e8fbff';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawEnemy(en, t) {
  const cx = W / 2, cy = H / 2;
  const ang = Math.atan2(cy - en.y, cx - en.x) + Math.sin(t * 3 + en.wob) * 0.1;
  ctx.save();
  ctx.translate(en.x, en.y);
  ctx.rotate(ang);
  const s = en.size;
  if (en.elite) {
    ctx.shadowColor = '#ffd75c';
    ctx.shadowBlur = 12;
  }
  ctx.beginPath();
  if (en.type === 'brute') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * s, Math.sin(a) * s);
    }
  } else if (en.type === 'splitter') {
    // diamond that visibly wants to come apart
    ctx.moveTo(s, 0); ctx.lineTo(0, s * 0.8); ctx.lineTo(-s, 0); ctx.lineTo(0, -s * 0.8);
  } else if (en.type === 'boss') {
    // spiked maw
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const rr = i % 2 ? s * 0.7 : s;
      ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
    }
  } else {
    // dart pointing at the Spire
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.8, s * 0.65);
    ctx.lineTo(-s * 0.4, 0);
    ctx.lineTo(-s * 0.8, -s * 0.65);
  }
  ctx.closePath();
  ctx.fillStyle = en.flash > 0 ? '#ffffff' : en.color;
  ctx.fill();
  if (en.elite) {
    ctx.strokeStyle = '#ffd75c';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  if (en.type === 'boss') {
    // inner eye
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = '#07070f';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = '#ff2d6d';
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.restore();

  // hp sliver once damaged
  if (en.hp < en.max) {
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(en.x - s, en.y - s - 6, s * 2, 3);
    ctx.fillStyle = '#5cff9d';
    ctx.fillRect(en.x - s, en.y - s - 6, s * 2 * Math.max(0, en.hp / en.max), 3);
  }
}

function drawRift(dt) {
  ctx.clearRect(0, 0, W, H);
  if (!S) return;
  const cx = W / 2, cy = H / 2;
  const coreR = Math.min(W, H) * 0.13;
  const t = performance.now() / 1000;
  const hullFrac = S.hull / HULL_MAX;
  const shieldFrac = S.shield / shieldMax();

  // shake when taking hull damage or during the lose sequence
  let shake = 0;
  if (S.hitT > 0) shake = 5;
  if (S.ending === 'lose' && S.endT < 1) shake = 12 * (1 - S.endT);
  ctx.save();
  ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);

  // danger glow grows as hull drops
  if (hullFrac < 0.6) {
    const g = ctx.createRadialGradient(cx, cy, coreR, cx, cy, Math.max(W, H) * 0.8);
    g.addColorStop(0, `rgba(255,60,30,${(0.6 - hullFrac) * 0.5})`);
    g.addColorStop(1, 'rgba(255,60,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-10, -10, W + 20, H + 20);
  }

  // Spire core
  const spin = 1 + (1 - hullFrac) + (S.ending === 'win' ? S.endT * 6 : 0);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    const rr = coreR * (0.72 + i * 0.16);
    const off = t * (0.6 + i * 0.35) * spin * (i % 2 ? -1 : 1);
    ctx.arc(cx, cy, rr, off, off + Math.PI * (1.1 + 0.3 * Math.sin(t + i)));
    ctx.strokeStyle = `rgba(124,92,255,${0.5 - i * 0.12})`;
    ctx.lineWidth = 2.5 - i * 0.5;
    ctx.stroke();
  }
  const beat = 1 + Math.sin(t * 2.5) * 0.04;
  const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * beat);
  g2.addColorStop(0, `rgba(124,92,255,${0.3 + hullFrac * 0.4})`);
  g2.addColorStop(1, 'rgba(124,92,255,0)');
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR * beat, 0, Math.PI * 2);
  ctx.fill();
  drawIcon('rift', cx, cy, coreR * 0.9, `rgba(200,180,255,${0.5 + hullFrac * 0.5})`);

  // shield bubble: arc coverage = shield fraction
  if (shieldFrac > 0.01) {
    const bub = coreR * 1.45;
    ctx.beginPath();
    ctx.arc(cx, cy, bub, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * shieldFrac);
    ctx.strokeStyle = `rgba(77,216,255,${0.5 + 0.3 * Math.sin(t * 4)})`;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, bub, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(77,216,255,0.12)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // wave countdown during calm
  if (S.phase === 'calm' && !S.paused && !S.over) {
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(232,232,245,0.8)';
    ctx.fillText('WAVE ' + S.wave + ' IN ' + Math.ceil(S.calmT), cx, cy - coreR * 2);
  }

  // overdrive: gold charge ring around the Spire; pulses when ready
  if (S.od > 0 || S.odT > 0) {
    const odR = coreR * 1.7;
    const frac = S.odT > 0 ? S.odT / (OD_TIME + (has('odcore') ? 4 : 0)) : S.od / OD_MAX;
    const ready = S.od >= OD_MAX && S.odT <= 0;
    ctx.beginPath();
    ctx.arc(cx, cy, odR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.strokeStyle = ready ? `rgba(255,183,92,${0.7 + 0.3 * Math.sin(t * 8)})` : (S.odT > 0 ? '#ffb75c' : 'rgba(255,183,92,0.45)');
    ctx.lineWidth = ready ? 4 : 2.5;
    ctx.lineCap = 'round';
    ctx.stroke();
    if (ready) {
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(255,183,92,${0.6 + 0.4 * Math.sin(t * 8)})`;
      ctx.fillText('TAP', cx, cy + odR + 14);
    }
  }

  // pickups: tap to collect before they fade
  for (const pk of pickups) {
    const fade = Math.min(1, pk.t);
    ctx.save();
    ctx.translate(pk.x, pk.y);
    ctx.globalAlpha = fade;
    if (pk.kind === 'scrap') {
      ctx.rotate(t * 2);
      ctx.shadowColor = '#ffd75c';
      ctx.shadowBlur = 10;
      drawIcon('bolt', 0, 0, 20 + Math.sin(t * 5) * 3, '#ffd75c');
    } else {
      ctx.shadowColor = '#4dd8ff';
      ctx.shadowBlur = 10;
      drawIcon('shield', 0, 0, 20 + Math.sin(t * 5) * 3, '#4dd8ff');
    }
    ctx.shadowBlur = 0;
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // enemies
  for (const en of enemies) drawEnemy(en, t);

  // boss health bar
  const boss = enemies.find(en => en.type === 'boss');
  if (boss) {
    const bw = W * 0.6;
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(W / 2 - bw / 2, 14, bw, 8);
    ctx.fillStyle = '#ff2d6d';
    ctx.fillRect(W / 2 - bw / 2, 14, bw * Math.max(0, boss.hp / boss.max), 8);
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff8fb3';
    ctx.fillText('THE MAW', W / 2, 34);
  }

  // overdrive screen tint
  if (S.odT > 0) {
    ctx.fillStyle = `rgba(255,183,92,${0.05 + 0.03 * Math.sin(t * 10)})`;
    ctx.fillRect(-10, -10, W + 20, H + 20);
  }

  // reactor income made visible: motes rise from the build strip to the Spire
  if (!S.paused && !S.over && S.counts.reactor > 0) {
    spawnAcc += dt * Math.min(20, 1 + S.counts.reactor);
    while (spawnAcc >= 1) {
      spawnAcc--;
      spawn(W * (0.05 + Math.random() * 0.2), H + 4, 0, -30, 2.2, '#ffd75c', 'seek');
    }
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    if (p.mode === 'seek') {
      const dx = cx - p.x, dy = cy - p.y;
      const dist = Math.hypot(dx, dy) || 1;
      p.vx += (dx / dist) * 140 * dt;
      p.vy += (dy / dist) * 140 * dt;
      if (dist < coreR * 0.6) p.life = Math.min(p.life, 0.15);
    } else if (p.mode === 'out') {
      p.vx *= 1 - 1.6 * dt;
      p.vy *= 1 - 1.6 * dt;
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    ctx.globalAlpha = Math.min(1, p.life / p.max * 2);
    ctx.fillStyle = p.c;
    const sz = p.size;
    ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
  }
  ctx.globalAlpha = 1;

  // turret beams
  for (let i = beams.length - 1; i >= 0; i--) {
    const b = beams[i];
    b.t -= dt;
    if (b.t <= 0) { beams.splice(i, 1); continue; }
    ctx.globalAlpha = b.t / b.max;
    ctx.strokeStyle = b.c;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // lightning arcs (zap + tesla)
  for (let i = arcs.length - 1; i >= 0; i--) {
    const a = arcs[i];
    a.t -= dt;
    if (a.t <= 0) { arcs.splice(i, 1); continue; }
    jagged(a.x, a.y, a.tx, a.ty, a.t / a.max);
  }


  // feedback rings
  for (let i = rings.length - 1; i >= 0; i--) {
    const rg = rings[i];
    rg.t -= dt * 1.8;
    if (rg.t <= 0) { rings.splice(i, 1); continue; }
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * (1 + (1 - rg.t) * 3.2), 0, Math.PI * 2);
    ctx.strokeStyle = rg.c;
    ctx.globalAlpha = rg.t;
    ctx.lineWidth = rg.lw;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (flashFx) {
    flashFx.a -= dt * 1.6;
    if (flashFx.a <= 0) flashFx = null;
    else {
      ctx.fillStyle = `rgba(${flashFx.c},${flashFx.a})`;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
  }

  ctx.restore();
}

/* =========================================================
   Tiny synth sfx (WebAudio, no assets)
   ========================================================= */
let AC = null;
function beep(freq, dur, type, vol) {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.06, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
    o.connect(g).connect(AC.destination);
    o.start();
    o.stop(AC.currentTime + dur);
  } catch (e) { /* audio unavailable — fine */ }
}
const PENTA = [0, 2, 4, 7, 9];
const sfx = {
  tap: combo => {
    const st = PENTA[(combo - 1) % 5] + 12 * Math.min(2, Math.floor((combo - 1) / 5));
    beep(392 * Math.pow(2, st / 12), 0.07, 'square', 0.045);
  },
  shot: () => beep(880, 0.04, 'square', 0.02),
  kill: brute => beep(brute ? 180 : 240, 0.12, 'sawtooth', 0.05),
  tesla: () => { beep(700, 0.08, 'sawtooth', 0.04); setTimeout(() => beep(500, 0.08, 'sawtooth', 0.03), 60); },
  nova: () => { beep(200, 0.4, 'sawtooth', 0.07); setTimeout(() => beep(300, 0.3, 'triangle', 0.05), 100); },
  wave: () => { beep(330, 0.15, 'square', 0.05); setTimeout(() => beep(262, 0.2, 'square', 0.05), 150); },
  buyTone: key => {
    const f = { reactor: 494, turret: 392, shield: 659, tesla: 587 }[key] || 520;
    beep(f, 0.09, 'triangle', 0.06);
    setTimeout(() => beep(f * 1.5, 0.08, 'triangle', 0.05), 70);
  },
  chime: () => { beep(880, 0.12); setTimeout(() => beep(1318, 0.2), 100); },
  hold: p => beep(300 + p * 500, 0.05, 'triangle', 0.03),
  draft: () => { beep(440, 0.12); setTimeout(() => beep(660, 0.12), 110); },
  pick: () => { beep(523, 0.1); setTimeout(() => beep(784, 0.15), 90); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.25), i * 140)),
  lose: () => [330, 262, 196, 131].forEach((f, i) => setTimeout(() => beep(f, 0.3, 'sawtooth'), i * 180)),
};

/* =========================================================
   Main loop & wiring
   ========================================================= */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  tick(dt);
  if (S && S.ending && !S.endShown) {
    S.endT += dt;
    if (S.endT > 1.2) { S.endShown = true; show('end-panel'); }
  }
  if (S) { renderHUD(calc()); renderStrip(); }
  drawRift(dt);
  requestAnimationFrame(frame);
}

cv.addEventListener('pointerdown', e => {
  if (e.button || !S || S.paused || S.over) return;
  const r = cv.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  for (const pk of pickups) {
    if (Math.hypot(pk.x - x, pk.y - y) < 30) return collectPickup(pk);
  }
  const coreR = Math.min(W, H) * 0.13;
  if (S.od >= OD_MAX && S.odT <= 0 && Math.hypot(x - W / 2, y - H / 2) < coreR * 1.6) return overdrive(e);
  zap(e);
});

// block pinch-zoom, double-tap zoom, long-press menus and the iOS text magnifier.
// Game controls fire on pointerdown (dispatched before touchstart's default),
// so cancelling touchstart outside overlay panels is safe.
document.addEventListener('touchstart', e => {
  if (!e.target.closest('.panel') || e.target.closest('.card')) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener('dblclick', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());

$id('statsbtn').addEventListener('click', openStats);
$id('statsclose').addEventListener('click', closeStats);
$id('statsback').addEventListener('click', closeStats);
$id('infobtn').addEventListener('click', openInfo);
$id('introinfo').addEventListener('click', openInfo);
$id('infoclose').addEventListener('click', closeInfo);
$id('infoback').addEventListener('click', closeInfo);
$id('startbtn').addEventListener('click', () => {
  hideOverlay();
  S.paused = false;
  sfx.pick();
});
$id('restartbtn').addEventListener('click', () => {
  newRun();
  renderChips();
  hideOverlay();
  S.paused = false;
  sfx.pick();
});

// inject static icons declared as <i data-icon="..."> in the HTML
document.querySelectorAll('[data-icon]').forEach(el => {
  el.outerHTML = icon(el.dataset.icon, el.className);
});
document.getElementById('favicon').href = 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="#7c5cff">${ICONS.rift}</svg>`);

newRun();
buildStrip();
renderChips();
show('intro-panel');
resize();
requestAnimationFrame(frame);
