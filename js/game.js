'use strict';

/* =========================================================
   RIFTFORGE — an automation defense roguelike
   Defend the Rift Spire. Enemies fly in from the edges.
   Zap them yourself; build machines so the Spire fights back.
   ========================================================= */

// ---------- tuning ----------
const MAX_WAVE = 25;
const BOSS_WAVES = [10, 18, 25]; // mid-bosses + finale
const HP_GROWTH = 1.17;    // enemy hp multiplier per wave
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
const OD_TIME = 5;         // seconds of overdrive
const WAVE_REPAIR = 2;     // hull repaired after each cleared wave

const ENEMY_TYPES = {
  dart:     { hp: 6,   speed: 38, spdVar: 14, dps: 5,  scrap: 3,   size: 7.5, color: '#ff9d4d' },
  splitter: { hp: 14,  speed: 28, spdVar: 6,  dps: 7,  scrap: 7,   size: 10,  color: '#b45cff' },
  brute:    { hp: 26,  speed: 21, spdVar: 5,  dps: 11, scrap: 10,  size: 12,  color: '#ff5c4d' },
  spitter:  { hp: 11,  speed: 30, spdVar: 6,  dps: 0,  scrap: 8,   size: 9,   color: '#63e0b8' },
  phantom:  { hp: 9,   speed: 34, spdVar: 8,  dps: 6,  scrap: 9,   size: 8.5, color: '#9fb8d8' },
  bomber:   { hp: 13,  speed: 47, spdVar: 8,  dps: 0,  scrap: 6,   size: 9,   color: '#ffb75c' },
  healer:   { hp: 16,  speed: 24, spdVar: 4,  dps: 3,  scrap: 13,  size: 10,  color: '#7dff9a' },
  boss:     { hp: 500, speed: 9,  spdVar: 1,  dps: 26, scrap: 200, size: 26,  color: '#ff2d6d' },
};
const BOMB_DMG = 12;       // + wave scaling on detonation
const SPIT_INTERVAL = 2.6;  // seconds between spitter shots
const SPIT_DMG = 6;
const INTEREST_RATE = 0.10; // share of banked energy paid after each wave
const interestCap = w => 20 + 10 * w;

// wave modifiers: ~half of waves from 3 on roll one, announced during the calm
const MODS = {
  swarm:    { name: 'SWARM',     color: '#ff9d4d', desc: '+60% enemies, −30% HP' },
  rush:     { name: 'RUSH',      color: '#ff5c4d', desc: 'enemies +40% speed' },
  goldrush: { name: 'GOLD RUSH', color: '#ffd75c', desc: '2× [bolt] from kills' },
  jammer:   { name: 'JAMMER',    color: '#b45cff', desc: '[shield] regen −60%' },
  titans:   { name: 'TITANS',    color: '#ff2d6d', desc: 'brutes +60% HP, +1 elite' },
};
const modIs = k => S.mod === k;

const MACHINES = {
  reactor: { name: 'Reactor',    icon: 'reactor', base: 25,  growth: 1.5,  desc: '+2[bolt]/s income' },
  turret:  { name: 'Turret',     icon: 'turret',  base: 35,  growth: 1.5,  desc: '1 shot/s · 4 dmg' },
  shield:  { name: 'Shield Gen', icon: 'shield',  base: 40,  growth: 1.5,  desc: '+15 max [shield] · +0.6/s' },
  tesla:   { name: 'Tesla Coil', icon: 'tesla',   base: 120, growth: 1.6,  desc: 'every 3s: chain 6 dmg ×2' },
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
  { id: 'compound',    name: 'Compound Core',   tags: ['AUTO'],  desc: 'Wave interest 10% → 25% of banked [bolt]', syn: 'Rewards saving up.' },
  { id: 'crit',        name: 'Killspike',       tags: ['OVER'],  desc: '15% of all hits crit for 3× damage' },
  { id: 'siege',       name: 'Siegebreaker',    tags: ['OVER'],  desc: '+50% damage to brutes & bosses', syn: 'The tanky ones stop being tanky.' },
  { id: 'piercer',     name: 'Piercing Rounds', tags: ['OVER'],  desc: '[turret] shots jump to a 2nd enemy at 50%' },
  { id: 'frost',       name: 'Frost Zap',       tags: ['STORM'], desc: '[jolt] Zap slows the target 45% for 2s' },
  { id: 'emp',         name: 'EMP Nova',        tags: ['STORM'], desc: 'NOVA stuns all survivors for 2s' },
  { id: 'arcbattery',  name: 'Arc Battery',     tags: ['STORM'], desc: '[jolt] Zaps trigger a free [tesla] bolt 30% of the time' },
  { id: 'overflow',    name: 'Overflow Coils',  tags: ['AEGIS', 'AUTO'], desc: 'Full [shield]: regen converts to +[bolt]', syn: 'Wasted regen becomes income.' },
  { id: 'salvager',    name: 'Salvage Rigs',    tags: ['AUTO'],  desc: 'Drops appear twice as often' },
  { id: 'warmachine',  name: 'War Machine',     tags: ['OVER', 'AUTO'], desc: 'Every purchase emits a 25 dmg shockwave' },
  { id: 'bounty',      name: 'Bounty Marks',    tags: ['AUTO'],  desc: 'Elites always drop a crystal and pay +50%' },
];

// ---------- meta progression (persists between runs) ----------
const META_KEY = 'riftforge-meta';
const META_UPGRADES = {
  hullplate: { name: 'Hull Plating',   icon: 'rift',    max: 5, base: 8,  desc: '+10 max hull per level' },
  stipend:   { name: 'Stipend',        icon: 'bolt',    max: 4, base: 6,  desc: '+15 starting [bolt] per level' },
  primeturret:{ name: 'Prime Turret',  icon: 'turret',  max: 2, base: 20, desc: 'Start with +1 [turret] Turret per level' },
  zapcoils:  { name: 'Zap Coils',      icon: 'jolt',    max: 5, base: 8,  desc: '+10% [jolt] Zap damage per level' },
  firecontrol:{ name: 'Fire Control',  icon: 'flame',   max: 5, base: 10, desc: '+8% [turret] Turret damage per level' },
  aegiscore: { name: 'Aegis Core',     icon: 'shield',  max: 4, base: 8,  desc: '+10 starting max [shield] per level' },
  refinery:  { name: 'Scrap Refinery', icon: 'cog',     max: 4, base: 10, desc: '+8% [bolt] from kills per level' },
  novachamber:{ name: 'Nova Chamber',  icon: 'nova',    max: 3, base: 12, desc: '−1.5s NOVA cooldown per level' },
};

let META = { shards: 0, up: {} };
function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) {
      const m = JSON.parse(raw);
      if (m && typeof m.shards === 'number' && m.up) META = m;
    }
  } catch (e) { /* private mode etc — meta just won't persist */ }
}
function saveMeta() {
  try { localStorage.setItem(META_KEY, JSON.stringify(META)); } catch (e) { /* ignore */ }
}
const metaLvl = id => META.up[id] || 0;
const metaCost = id => Math.ceil(META_UPGRADES[id].base * Math.pow(1.7, metaLvl(id)));

function shardsForRun() {
  return Math.max(1, (S.wave - 1) + S.bossKills * 5 + (S.ending === 'win' ? 30 : 0));
}

// ---------- state ----------
let S;
const enemies = [];
function newRun() {
  S = {
    energy: 25 + metaLvl('stipend') * 15, earned: 0, time: 0,
    hull: HULL_MAX + metaLvl('hullplate') * 10, kills: 0, bossKills: 0,
    shield: BASE_SHIELD + metaLvl('aegiscore') * 10,
    wave: 1, phase: 'calm', calmT: CALM_TIME,
    spawnLeft: 0, spawnT: 0,
    counts: { reactor: 0, turret: 1 + metaLvl('primeturret'), shield: 0, tesla: 0 }, // start with 1 turret so the Spire fights back immediately
    cards: [],
    combo: 0, comboT: 0, bestCombo: 0,
    novaCd: 0, teslaT: 0, turretAcc: 0, autoT: 0, thornT: 0, hitT: 0,
    od: 0, odT: 0, odReadyPinged: false, shieldHitT: 0,
    queue: [], mod: null, waveTotal: 1,
    ending: null, endT: 0, endShown: false,
    paused: true, over: false,
  };
  enemies.length = 0;
  pickups.length = 0;
  shots.length = 0;
  healRings.length = 0;
}
const pickups = [];
const shots = []; // spitter projectiles
const healRings = []; // healer pulse visuals

const has = id => S.cards.includes(id);
const tagCount = tag => S.cards.reduce((n, id) => n + (CARDS.find(c => c.id === id).tags.includes(tag) ? 1 : 0), 0);
const cost = key => Math.ceil(MACHINES[key].base * Math.pow(MACHINES[key].growth, S.counts[key]));

// ---------- derived rates ----------
function hullMax() { return HULL_MAX + metaLvl('hullplate') * 10; }
function shieldMax() { return BASE_SHIELD + metaLvl('aegiscore') * 10 + S.counts.shield * 15 + (has('bulwark') ? 40 : 0); }

function calc() {
  const od = S.odT > 0;
  let dmgMult = 1;
  if (has('gridmind')) dmgMult *= 1 + 0.12 * tagCount('AUTO');
  if (has('capacitor') && S.shield >= shieldMax() - 0.5) dmgMult *= 1.35;

  const turretDmg = 4 * (1 + metaLvl('firecontrol') * 0.08) * (has('overcharge') ? 1.6 : 1) * dmgMult * (od ? 2 : 1);
  const turretRate = S.counts.turret * (has('rapidfire') ? 1.5 : 1) * (od ? 2 : 1);

  const zapDmg = ZAP_DMG * (1 + metaLvl('zapcoils') * 0.10) * (has('stormzap') ? 2 : 1) * dmgMult * (od ? 2 : 1);

  let teslaDmg = 6 * dmgMult * (od ? 1.5 : 1);
  if (has('resonance')) teslaDmg *= 1 + 0.20 * tagCount('STORM');
  const teslaTargets = 2 + (has('chain') ? 2 : 0);

  let regen = BASE_REGEN + S.counts.shield * 0.6 + (has('regenerator') ? 2 : 0);
  if (S.mod === 'jammer') regen *= 0.4;

  return {
    income: S.counts.reactor * 2,
    turretDmg, turretRate,
    zapDmg,
    teslaDmg, teslaTargets,
    regen,
    killMult: (1 + metaLvl('refinery') * 0.08) * (has('scrap') ? 1.5 : 1) * (S.mod === 'goldrush' ? 2 : 1),
    novaCdMax: Math.max(6, NOVA_CD - metaLvl('novachamber') * 1.5),
    novaDmg: NOVA_DMG * dmgMult,
  };
}

// ---------- enemies ----------
function buildWave(w) {
  const q = [];
  if (BOSS_WAVES.includes(w)) {
    for (let i = 0; i < Math.round(4 + w * 0.5); i++) q.push('dart');
    for (let i = 0; i < Math.floor(w / 6); i++) q.push('brute');
    for (let i = 0; i < Math.floor(w / 9); i++) q.push('splitter');
    for (let i = 0; i < Math.floor(w / 9); i++) q.push('spitter');
    if (w >= 18) q.push('healer', 'healer');
    if (w >= 18) q.push('bomber', 'bomber');
    // shuffle escorts, boss enters last
    for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
    q.push('boss');
    return q;
  }
  let darts = 5 + Math.round(2.2 * (w - 1));
  if (S.mod === 'swarm') darts = Math.round(darts * 1.6);
  for (let i = 0; i < darts; i++) q.push('dart');
  if (w >= 3) for (let i = 0; i < Math.floor(w / 2); i++) q.push('brute');
  if (w >= 4) for (let i = 0; i < Math.floor((w - 2) / 2); i++) q.push('splitter');
  if (w >= 5) for (let i = 0; i < Math.floor((w - 3) / 2); i++) q.push('spitter');
  if (w >= 6) for (let i = 0; i < 1 + Math.floor((w - 6) / 3); i++) q.push('phantom');
  if (w >= 7) for (let i = 0; i < 1 + Math.floor((w - 7) / 3); i++) q.push('bomber');
  if (w >= 8) for (let i = 0; i < 1 + Math.floor((w - 8) / 4); i++) q.push('healer');
  for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
  // one random enemy per wave arrives as an ELITE from wave 4; a second from wave 12 (and under TITANS)
  if (w >= 4) q[Math.floor(Math.random() * q.length)] += '!';
  if ((w >= 12 || S.mod === 'titans') && q.length > 1) q[Math.floor(Math.random() * q.length / 2)] += '!';
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
  const scale = type === 'boss' ? Math.pow(1.14, w - 1) : Math.pow(HP_GROWTH, w - 1);
  let hpMod = 1;
  if (S.mod === 'swarm') hpMod *= 0.7;
  if (S.mod === 'titans' && type === 'brute') hpMod *= 1.6;
  const hp = T.hp * scale * (opts.hpMult || 1) * (elite ? 3 : 1) * hpMod;
  enemies.push({
    x, y, type, elite,
    hp, max: hp,
    speed: (T.speed + Math.random() * T.spdVar) * (S.mod === 'rush' ? 1.4 : 1) * (1 + Math.min(0.3, (w - 1) * 0.013)),
    dps: T.dps * (elite ? 1.5 : 1),
    scrap: T.scrap * (1 + w * 0.12) * (elite ? 4 : 1) * (opts.hpMult || 1),
    size: T.size * (elite ? 1.35 : 1),
    color: T.color,
    wob: Math.random() * 7, flash: 0, minionT: 0,
    spitT: 1 + Math.random() * SPIT_INTERVAL,
    healT: 2 + Math.random() * 2, slow: 0, stun: 0,
  });
}

function hurtEnemy(en, dmg, sourceColor, autoFire) {
  // phantoms flicker out of phase and dodge automated fire; zaps always land
  if (autoFire && en.type === 'phantom' && Math.sin(performance.now() / 500 + en.wob) > 0 && Math.random() < 0.6) {
    fx.burstAt(en.x, en.y, '#9fb8d8', 2);
    return;
  }
  if (has('crit') && Math.random() < 0.15) {
    dmg *= 3;
    fx.burstAt(en.x, en.y, '#ffffff', 4);
  }
  if (has('siege') && (en.type === 'brute' || en.type === 'boss')) dmg *= 1.5;
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
  const gain = en.scrap * calc().killMult * (en.elite && has('bounty') ? 1.5 : 1);
  S.energy += gain;
  S.earned += gain;
  fx.burstAt(en.x, en.y, colorHint || en.color, en.type === 'dart' ? 7 : 14);
  const r = cv.getBoundingClientRect();
  popup(r.left + en.x, r.top + en.y, '+' + fmt(gain) + icon('bolt'), 'var(--energy)');
  sfx.kill(en.type !== 'dart');

  // overdrive charges off kills
  if (S.odT <= 0 && S.od < OD_MAX) {
    S.od = Math.min(OD_MAX, S.od + 4 + en.scrap * 0.10);
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
    S.bossKills++;
    fx.flash('255,45,109', 0.5);
    fx.nova('#ff2d6d', 80);
    buzz([60, 40, 120]);
  }

  // drops: tap to collect (or Magnet Drones auto-collect)
  const dropMult = has('salvager') ? 2 : 1;
  const roll = Math.random();
  if (en.elite && has('bounty')) pickups.push({ x: en.x, y: en.y, kind: 'scrap', t: 5, value: 12 + S.wave * 4 });
  else if (roll < 0.08 * dropMult) pickups.push({ x: en.x, y: en.y, kind: 'scrap', t: 5, value: 12 + S.wave * 4 });
  else if (roll < 0.13 * dropMult) pickups.push({ x: en.x, y: en.y, kind: 'orb', t: 5 });
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

function damageSpire(dmg) {
  const fromShield = Math.min(S.shield, dmg);
  S.shield -= fromShield;
  if (fromShield > 0) S.shieldHitT = 0.25;
  dmg -= fromShield;
  if (dmg > 0) {
    S.hull -= dmg;
    S.hitT = 0.15;
  }
  if (S.hull <= 0) { S.hull = 0; lose(); }
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
  const preShield = S.shield;
  S.shield = Math.min(shieldMax(), S.shield + R.regen * dt);
  if (has('overflow') && preShield >= shieldMax() - 0.01) {
    const overflow = R.regen * dt * 0.5;
    S.energy += overflow;
    S.earned += overflow;
  }

  // combo decay + cooldowns
  if (S.comboT > 0) { S.comboT -= dt; if (S.comboT <= 0) S.combo = 0; }
  if (armedT > 0) { armedT -= dt; if (armedT <= 0) disarm(); }
  S.novaCd = Math.max(0, S.novaCd - dt);
  if (S.hitT > 0) S.hitT -= dt;
  if (S.shieldHitT > 0) S.shieldHitT -= dt;

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
      S.waveTotal = S.queue.length;
      S.spawnLeft = S.queue.length;
      S.spawnT = 0;
      sfx.wave();
      const r = cv.getBoundingClientRect();
      popup(r.left + W / 2, r.top + H * 0.25, 'WAVE ' + S.wave, 'var(--heat)');
      if (S.mod) setTimeout(() => popup(r.left + W / 2, r.top + H * 0.25 + 30, MODS[S.mod].name, MODS[S.mod].color), 350);
      buzz([20, 40, 20]);
    }
  } else if (S.phase === 'combat') {
    // spawning from the wave's typed queue
    if (S.queue.length > 0) {
      S.spawnT -= dt;
      if (S.spawnT <= 0) {
        S.spawnT = Math.max(0.22, 0.9 - S.wave * 0.05);
        spawnEnemy(S.queue.shift());
        S.spawnLeft = S.queue.length;
      }
    }

    // movement + latched damage
    let latchedDps = 0;
    const standoff = Math.min(W, H) * 0.38;
    for (const en of [...enemies]) {
      if (en.stun > 0) { en.stun -= dt; en.latched = false; continue; }
      if (en.slow > 0) en.slow -= dt;
      const spd = en.slow > 0 ? 0.55 : 1;
      const dx = cx - en.x, dy = cy - en.y;
      const d = Math.hypot(dx, dy) || 1;
      if (en.type === 'bomber') {
        en.latched = false;
        en.x += (dx / d) * en.speed * spd * dt;
        en.y += (dy / d) * en.speed * spd * dt;
        if (d < coreR + en.size) {
          // kamikaze: detonates on the Spire, no scrap
          enemies.splice(enemies.indexOf(en), 1);
          damageSpire(BOMB_DMG + S.wave * 0.4);
          fx.burstAt(en.x, en.y, '#ffb75c', 16);
          fx.flash('255,183,92', 0.22);
          sfx.nova();
          buzz(30);
          if (S.over) return;
        }
        continue;
      }
      if (en.type === 'healer') {
        en.healT -= dt;
        if (en.healT <= 0) {
          en.healT = 3;
          let healed = false;
          for (const o of enemies) {
            if (o !== en && o.hp < o.max && Math.hypot(o.x - en.x, o.y - en.y) < 95) {
              o.hp = Math.min(o.max, o.hp + o.max * 0.08);
              healed = true;
            }
          }
          if (healed) {
            healRings.push({ x: en.x, y: en.y, t: 0.5 });
            beep(740, 0.08, 'sine', 0.03);
          }
        }
      }
      if (en.type === 'spitter') {
        en.latched = false;
        if (d > standoff) {
          en.x += (dx / d) * en.speed * spd * dt;
          en.y += (dy / d) * en.speed * spd * dt;
        } else {
          // strafe slowly and shell the Spire
          en.x += (-dy / d) * 12 * dt;
          en.y += (dx / d) * 12 * dt;
          en.spitT -= dt;
          if (en.spitT <= 0) {
            en.spitT = SPIT_INTERVAL;
            const sd = Math.hypot(cx - en.x, cy - en.y) || 1;
            shots.push({ x: en.x, y: en.y, vx: (cx - en.x) / sd * 95, vy: (cy - en.y) / sd * 95, dmg: SPIT_DMG + S.wave * 0.25 });
            beep(520, 0.06, 'sawtooth', 0.03);
          }
        }
      } else if (d > coreR + en.size) {
        en.x += (dx / d) * en.speed * spd * dt;
        en.y += (dy / d) * en.speed * spd * dt;
        en.latched = false;
      } else {
        en.latched = true;
        latchedDps += en.dps;
      }
      if (en.flash > 0) en.flash -= dt;
      // the boss births darts while it lives
      if (en.type === 'boss') {
        en.minionT += dt;
        if (en.minionT >= Math.max(2.5, 4 - S.wave * 0.05)) {
          en.minionT = 0;
          for (let k = 0; k < 2; k++) spawnEnemy('dart', { x: en.x + (Math.random() - .5) * 40, y: en.y + (Math.random() - .5) * 40 });
          fx.burstAt(en.x, en.y, '#ff2d6d', 8);
          beep(160, 0.15, 'sawtooth', 0.04);
        }
      }
    }
    if (latchedDps > 0) {
      damageSpire(latchedDps * dt);
      if (S.over) return;
    }

    // spitter shells fly at the Spire
    for (let i = shots.length - 1; i >= 0; i--) {
      const sh = shots[i];
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
      if (Math.hypot(sh.x - cx, sh.y - cy) < coreR) {
        shots.splice(i, 1);
        damageSpire(sh.dmg || SPIT_DMG);
        fx.burstAt(sh.x, sh.y, '#63e0b8', 6);
        beep(220, 0.08, 'sawtooth', 0.04);
        if (S.over) return;
      }
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
      hurtEnemy(t, R.turretDmg, '#ffd75c', true);
      if (has('piercer')) {
        const t2 = enemies.filter(e => e !== t).sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y))[0];
        if (t2 && Math.hypot(t2.x - t.x, t2.y - t.y) < 110) {
          beams.push({ x1: t.x, y1: t.y, x2: t2.x, y2: t2.y, t: 0.08, max: 0.08, c: '#ffd75c' });
          hurtEnemy(t2, R.turretDmg * 0.5, '#ffd75c', true);
        }
      }
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
        for (const t of targets) hurtEnemy(t, R.teslaDmg, '#b45cff', true);
        sfx.tesla();
      }
    }

    // wave cleared?
    if (S.queue.length === 0 && enemies.length === 0) {
      if (S.wave >= MAX_WAVE) return win();
      S.wave++;
      S.phase = 'calm';
      S.calmT = CALM_TIME;
      shots.length = 0;
      // roll the next wave's modifier (none before wave 3)
      S.mod = (S.wave >= 3 && Math.random() < 0.55)
        ? Object.keys(MODS)[Math.floor(Math.random() * Object.keys(MODS).length)]
        : null;
      // banked energy pays interest — save vs spend
      const rate = INTEREST_RATE * (has('compound') ? 2.5 : 1);
      const interest = Math.min(interestCap(S.wave), S.energy * rate);
      if (interest >= 1) {
        S.energy += interest;
        S.earned += interest;
        const ir = cv.getBoundingClientRect();
        popup(ir.left + W / 2, ir.top + H / 2 + 80, '+' + fmt(interest) + icon('bolt') + ' interest', 'var(--energy)');
      }
      // field crews patch the hull between waves
      const repair = WAVE_REPAIR + (has('fieldrepair') ? 8 : 0);
      const healed = Math.min(hullMax() - S.hull, repair);
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
    if (has('warmachine')) {
      for (const en of [...enemies]) hurtEnemy(en, 25, MACHINE_COLORS[key]);
      fx.ring('#ffffff', 5);
    }
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
  const mult = 1 + (S.combo - 1) * 0.04;
  const dmg = R.zapDmg * mult;
  arcs.push({ x: cx, y: cy, tx: target.x, ty: target.y, t: 0.15, max: 0.15 });
  fx.burstAt(target.x, target.y, '#4dd8ff', 5);
  if (has('frost')) target.slow = 2;
  hurtEnemy(target, dmg, '#4dd8ff');
  if (has('arcbattery') && Math.random() < 0.3 && enemies.length) {
    const t2 = nearestEnemy(cx, cy);
    if (t2) {
      arcs.push({ x: cx, y: cy, tx: t2.x, ty: t2.y, t: 0.14, max: 0.14 });
      hurtEnemy(t2, R.zapDmg * 0.8, '#b45cff');
      sfx.tesla();
    }
  }
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
  S.novaCd = calc().novaCdMax;
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
    if (has('emp')) en.stun = 2;
    hurtEnemy(en, R.novaDmg, '#8ad8ff');
  }
  for (const sh of shots) fx.burstAt(sh.x, sh.y, '#63e0b8', 4);
  shots.length = 0; // the blast wipes incoming shells
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
  if (pool.length === 0) {
    // deck exhausted: pay salvage instead
    const bonus = 20 + S.wave * 6;
    S.energy += bonus;
    S.earned += bonus;
    const r = cv.getBoundingClientRect();
    popup(r.left + W / 2, r.top + H / 2 - 30, '+' + fmt(bonus) + icon('bolt') + ' salvage', 'var(--energy)');
    sfx.chime();
    return;
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  draftOffer = pool.slice(0, 3);
  S.paused = true;
  sfx.draft();
  $id('draft-sub').innerHTML = 'WAVE ' + (S.wave - 1) + ' CLEARED · NEXT: ' +
    (S.mod ? '<b style="color:' + MODS[S.mod].color + '">' + MODS[S.mod].name + '</b>' : (BOSS_WAVES.includes(S.wave) ? '<b style="color:#ff2d6d">BOSS</b>' : 'WAVE ' + S.wave));

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

// ---------- build strip (tap to inspect, tap again to confirm) ----------
let armedKey = null, armedT = 0;

function disarm() {
  armedKey = null;
  armedT = 0;
  $id('buildtip').classList.add('hidden');
}

function showBuildTip(key) {
  const m = MACHINES[key];
  const tip = $id('buildtip');
  tip.style.setProperty('--mcol', MACHINE_COLORS[key]);
  tip.innerHTML =
    `<div class="bt-name">${icon(m.icon)} ${m.name} <span class="bt-owned">×${S.counts[key]} owned</span></div>` +
    `<div class="bt-desc">${iconize(m.desc)}</div>` +
    `<div class="bt-cost">Cost ${fmt(cost(key))}${icon('bolt')}${S.energy < cost(key) ? ' — <em>not enough</em>' : ''}</div>`;
  tip.classList.remove('hidden');
}

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
      `<span class="bs-confirm">CONFIRM</span>`;
    b.addEventListener('pointerdown', e => {
      if (e.button || !S || S.paused || S.over) return;
      if (armedKey === key) {
        disarm();
        buy(key, false, e);
      } else {
        armedKey = key;
        armedT = 5;
        showBuildTip(key);
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
  nb.addEventListener('pointerdown', e => { if (e.button) return; disarm(); nova(e); });
  strip.appendChild(nb);
}

let lastNovaCd = 0;
let lastTipRefresh = 0;
function renderStrip() {
  if (armedKey && performance.now() - lastTipRefresh > 250) {
    lastTipRefresh = performance.now();
    showBuildTip(armedKey);
  }
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
    nb.querySelector('.bs-cost').textContent = ready ? 'NOVA' : Math.ceil(S.novaCd) + 's';
    $id('bs-nova-cd').style.height = (S.novaCd / calc().novaCdMax * 100) + '%';
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
      ${row('rift', 'Hull', Math.ceil(S.hull) + '/' + hullMax())}
      ${row('shield', 'Shield', Math.ceil(S.shield) + '/' + Math.ceil(shieldMax()) + ' · +' + R.regen.toFixed(1) + '/s')}
      ${row('rift', 'Repair/wave', '+' + (WAVE_REPAIR + (has('fieldrepair') ? 8 : 0)))}
      ${row('reactor', 'Income', '+' + fmt(R.income) + '/s · kills ×' + R.killMult)}
      ${row('bolt', 'Interest', Math.round(INTEREST_RATE * (has('compound') ? 2.5 : 1) * 100) + '%/wave, cap ' + interestCap(S.wave))}
      ${row('hazard', 'Modifier', S.mod ? MODS[S.mod].name : '—')}
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

// ---------- the Forge (permanent upgrades between runs) ----------
function buildForge() {
  const body = $id('forge-body');
  let html = `<p class="forge-bank">${icon('shard')} <b>${META.shards}</b> shards</p>`;
  for (const [id, U] of Object.entries(META_UPGRADES)) {
    const lvl = metaLvl(id);
    const maxed = lvl >= U.max;
    const c = metaCost(id);
    const can = !maxed && META.shards >= c;
    const pips = Array.from({ length: U.max }, (_, i) => `<i class="pip${i < lvl ? ' on' : ''}"></i>`).join('');
    html += `
      <div class="forge-row">
        ${icon(U.icon)}
        <div class="forge-mid">
          <b>${U.name}</b>
          <span>${iconize(U.desc)}</span>
          <div class="pips">${pips}</div>
        </div>
        <button class="forge-buy${can ? ' can' : ''}" data-up="${id}" ${maxed || !can ? 'disabled' : ''}>
          ${maxed ? 'MAX' : c + '&thinsp;' + icon('shard')}
        </button>
      </div>`;
  }
  body.innerHTML = html;
  body.querySelectorAll('.forge-buy[data-up]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.up;
      const c = metaCost(id);
      if (metaLvl(id) >= META_UPGRADES[id].max || META.shards < c) return;
      META.shards -= c;
      META.up[id] = metaLvl(id) + 1;
      saveMeta();
      sfx.buyTone('shield');
      buzz(15);
      buildForge();
    });
  });
}

let forgeFrom = 'intro-panel';
function openForge(from) {
  forgeFrom = from;
  buildForge();
  show('forge-panel');
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
      ${row('cog', 'Buy machines', 'Tap a build button to see cost + effect, tap it again to CONFIRM. Tap anywhere else to cancel.')}
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
      ${row('hazard', 'Spitters', '<span style="color:#63e0b8">Teal lobbers</span> — hold at range and shell the Spire. Zap them.')}
      ${row('hazard', 'Phantoms', '<span style="color:#9fb8d8">Pale chevrons</span> that phase — turrets often miss them. Your [jolt] Zap never does.')}
      ${row('hazard', 'Bombers', '<span style="color:#ffb75c">Blinking orbs</span> — fast kamikazes. Kill them before they reach the Spire.')}
      ${row('hazard', 'Healers', '<span style="color:#7dff9a">Green crosses</span> that pulse-heal nearby enemies. Priority targets.')}
      ${row('sparkles', 'Elites', 'Gold-ringed: 3× HP, 4×[bolt]. One per wave from 4, two from 12.')}
      ${row('skull', 'Bosses', 'Waves ' + BOSS_WAVES.join('/') + ': a <span style="color:#ff2d6d">Maw</span> with a health bar that births darts while it lives.')}
    </div>
    <div class="info-sec">
      <h3>${icon('bolt')} DROPS &amp; OVERDRIVE</h3>
      ${row('bolt', 'Scrap Crystal', 'Sometimes drops from kills. Tap it before it fades: bonus [bolt].')}
      ${row('shield', 'Aegis Orb', 'Rarer drop. Tap it: [shield] Shield instantly refills.')}
      ${row('flux', 'Overdrive', 'Kills charge the gold ring around the Spire. When it pulses, tap the Spire: ' + OD_TIME + 's of doubled firepower.')}
      ${row('rift', 'Field Repair', '+' + WAVE_REPAIR + ' hull patched after every cleared wave.')}
      ${row('bolt', 'Interest', 'Each cleared wave pays +' + Math.round(INTEREST_RATE * 100) + '% of your banked [bolt] (capped). Saving has value.')}
    </div>
    <div class="info-sec">
      <h3>${icon('hazard')} WAVE MODIFIERS</h3>
      <p>${iconize('From wave 3, about half of waves roll a mutator, announced during the countdown:')}</p>
      ${Object.values(MODS).map(M => row('hazard', M.name, M.desc)).join('')}
    </div>
    <div class="info-sec">
      <h3>${icon('cards')} CARD TAGS</h3>
      <p>${iconize('After every wave you draft 1 of 3 [cards] Cards. Cards share tags, and several scale with how many of a tag you own — commit to a build.')}</p>
      ${tags}
    </div>
    <div class="info-sec">
      <h3>${icon('forge')} THE FORGE</h3>
      <p>${iconize('Every run pays [shard] Shards — 1 per wave survived, +5 per boss, +30 for a win. Spend them in the FORGE (intro or death screen) on permanent upgrades that persist in this browser.')}</p>
    </div>
    <div class="info-sec">
      <h3>${icon('rift')} VERSION</h3>
      <p><b>v${window.GAME_VERSION || 'dev'}</b> — ${window.GAME_TAGLINE || ''}</p>
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
    <div>${icon('cog')} machines <span>${Object.values(S.counts).reduce((a, b) => a + b, 0)}</span></div>
    <div class="shardrow">${icon('shard')} shards earned <span>+${lastShardGain}</span></div>
    <div>${icon('hazard')} best wave <span>${META.best || 0}${newBest ? ' — NEW BEST!' : ''}</span></div>`;
}

function prepEnd(title, cls, desc) {
  const t = document.getElementById('end-title');
  t.innerHTML = title;
  t.className = cls;
  document.getElementById('end-desc').textContent = desc;
  document.getElementById('end-stats').innerHTML = endStats();
}

let lastShardGain = 0, newBest = false;
function awardShards() {
  lastShardGain = shardsForRun();
  META.shards += lastShardGain;
  const reached = S.ending === 'win' ? MAX_WAVE : S.wave;
  newBest = reached > (META.best || 0);
  if (newBest) META.best = reached;
  saveMeta();
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
  awardShards();
  prepEnd(icon('rift') + ' SPIRE STANDS', 'win', 'Every wave broke against your machines.');
}

function lose() {
  if (S.ending) return;
  S.ending = 'lose';
  S.over = true;
  sfx.lose();
  buzz([80, 50, 80, 50, 220]);
  fx.flash('255,60,30', 0.85);
  fx.nova('#ff5c4d', 90);
  awardShards();
  prepEnd(icon('skull') + ' SPIRE FALLS', 'lose', 'The swarm chewed through the hull on wave ' + S.wave + '.');
}

// ---------- UI ----------
const $id = id => document.getElementById(id);

function show(panelId) {
  $id('overlay').classList.remove('hidden');
  ['intro-panel', 'draft-panel', 'end-panel', 'info-panel', 'stats-panel', 'forge-panel'].forEach(p =>
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

let dispEnergy = 0;
function renderHUD(R) {
  // energy rolls smoothly toward the real value
  const diff = S.energy - dispEnergy;
  dispEnergy = Math.abs(diff) < 1 ? S.energy : dispEnergy + diff * 0.15;
  $id('energy').textContent = fmt(dispEnergy);
  $id('eps').textContent = fmt(R.income);
  $id('shardchip').textContent = META.shards;

  // wave progress: whole-run bar that also fills within the active wave
  let frac = (S.wave - 1) / MAX_WAVE;
  if (S.phase === 'combat' && S.waveTotal > 0) {
    frac += (1 - Math.min(1, (S.queue.length + enemies.length) / S.waveTotal)) / MAX_WAVE;
  }
  if (S.ending === 'win') frac = 1;
  $id('waveprogfill').style.width = (frac * 100) + '%';

  document.querySelector('.hullbar').classList.toggle('hit', S.hitT > 0);
  document.querySelector('.shieldbar').classList.toggle('hit', S.shieldHitT > 0);

  $id('vignette').style.opacity = S.hull < 40 && !S.over ? ((40 - S.hull) / 40 * 0.85).toFixed(2) : 0;

  $id('hullfill').style.width = (S.hull / hullMax() * 100) + '%';
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
  if (en.type === 'phantom') {
    ctx.globalAlpha = 0.35 + 0.6 * Math.abs(Math.sin(performance.now() / 500 + en.wob));
  }
  if (en.stun > 0) ctx.globalAlpha = 0.5;
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
  } else if (en.type === 'bomber') {
    // round bomb, fuse blinks faster as it closes in
    ctx.arc(0, 0, s * 0.85, 0, Math.PI * 2);
  } else if (en.type === 'healer') {
    // plus-sign medic
    const w2 = s * 0.38;
    ctx.rect(-w2, -s, w2 * 2, s * 2);
    ctx.rect(-s, -w2, s * 2, w2 * 2);
  } else if (en.type === 'phantom') {
    // wispy chevron
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.6, s * 0.8);
    ctx.lineTo(-s * 0.1, 0);
    ctx.lineTo(-s * 0.6, -s * 0.8);
  } else if (en.type === 'spitter') {
    // three-lobed shell-lobber
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      ctx.moveTo(0, 0);
      ctx.arc(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.55, s * 0.5, 0, Math.PI * 2);
    }
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
  let bodyColor = en.flash > 0 ? '#ffffff' : en.color;
  if (en.type === 'bomber') {
    const cx2 = W / 2, cy2 = H / 2;
    const closeness = 1 - Math.min(1, Math.hypot(en.x - cx2, en.y - cy2) / (Math.min(W, H) * 0.5));
    if (Math.sin(t * (4 + closeness * 14) + en.wob) > 0.3) bodyColor = '#ffffff';
  }
  ctx.fillStyle = bodyColor;
  ctx.fill();
  if (en.slow > 0) {
    ctx.strokeStyle = '#8ad8ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
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
  ctx.globalAlpha = 1;
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
  const hullFrac = S.hull / hullMax();
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

  // wave countdown during calm (announces the modifier)
  if (S.phase === 'calm' && !S.paused && !S.over) {
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(232,232,245,0.8)';
    ctx.fillText('WAVE ' + S.wave + ' IN ' + Math.ceil(S.calmT), cx, cy - coreR * 2);
    if (S.mod) {
      const M = MODS[S.mod];
      ctx.fillStyle = M.color;
      ctx.fillText(M.name, cx, cy - coreR * 2 + 18);
      ctx.font = '10px monospace';
      ctx.fillStyle = 'rgba(232,232,245,0.6)';
      ctx.fillText(M.desc.replace(/\[\w+\]/g, ''), cx, cy - coreR * 2 + 32);
    }
  }
  // active modifier tag during combat
  if (S.phase === 'combat' && S.mod && !S.over) {
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = MODS[S.mod].color;
    ctx.fillText(MODS[S.mod].name, W / 2, enemies.find(e => e.type === 'boss') ? 46 : 16);
  }

  // healer pulses
  for (let i = healRings.length - 1; i >= 0; i--) {
    const hr = healRings[i];
    hr.t -= dt;
    if (hr.t <= 0) { healRings.splice(i, 1); continue; }
    ctx.beginPath();
    ctx.arc(hr.x, hr.y, 95 * (1 - hr.t / 0.5), 0, Math.PI * 2);
    ctx.strokeStyle = '#7dff9a';
    ctx.globalAlpha = hr.t;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // spitter shells
  for (const sh of shots) {
    ctx.beginPath();
    ctx.arc(sh.x, sh.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#63e0b8';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sh.x - sh.vx * 0.05, sh.y - sh.vy * 0.05, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(99,224,184,0.4)';
    ctx.fill();
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
    ctx.fillText(S.wave >= MAX_WAVE ? 'THE MAW' : 'MAW SPAWN', W / 2, 34);
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
  if (armedKey) return disarm(); // tapping outside closes the purchase confirm
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

$id('introforge').addEventListener('click', () => openForge('intro-panel'));
$id('endforge').addEventListener('click', () => openForge('end-panel'));
$id('forgeback').addEventListener('click', () => show(forgeFrom));
$id('statsbtn').addEventListener('pointerdown', e => { if (!e.button) openStats(); });
$id('statsclose').addEventListener('click', closeStats);
$id('statsback').addEventListener('click', closeStats);
$id('infobtn').addEventListener('pointerdown', e => { if (!e.button) openInfo(); });
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
  dispEnergy = S.energy;
  $id('introbank').innerHTML = icon('shard') + ' ' + META.shards + ' shards' + (META.best ? ' · best wave ' + META.best : '');
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

loadMeta();
$id('introbank').innerHTML = icon('shard') + ' ' + META.shards + ' shards' + (META.best ? ' · best wave ' + META.best : '');
$id('verline').textContent = 'v' + (window.GAME_VERSION || 'dev') + ' — ' + (window.GAME_TAGLINE || '');

newRun();
buildStrip();
renderChips();
show('intro-panel');
resize();
requestAnimationFrame(frame);
