'use strict';

/* =========================================================
   RIFTFORGE — an automation roguelike prototype
   ========================================================= */

// ---------- tuning ----------
const GOAL = 3000;          // total rift charge to win
const HEAT_CAP = 100;
const BASE_DISSIPATION = 1.2; // heat/s removed passively
const AMBIENT_PER_MIN = 0.9;  // instability: +this much heat/s per minute elapsed
const MELT_TIME = 4;          // seconds at max heat before losing
const VENT_AMOUNT = 20;
const VENT_CD = 8;

const MACHINES = {
  dynamo:   { name: 'Dynamo',   icon: 'dynamo',   base: 15,  growth: 1.15, eps: 1.5,  heat: 0.35, desc: '+1.5[bolt] +0.35[flame]' },
  turbine:  { name: 'Turbine',  icon: 'turbine',  base: 130, growth: 1.18, eps: 10,   heat: 2.2,  desc: '+10[bolt] +2.2[flame]' },
  cooler:   { name: 'Cooler',   icon: 'cooler',   base: 60,  growth: 1.16, cool: 3,               desc: '−3[flame]' },
  injector: { name: 'Injector', icon: 'injector', base: 220, growth: 1.20, channel: 6, heat: 0.9, desc: '6[bolt]→[rift] +0.9[flame]' },
};

// replace [bolt]-style tokens with inline icons
const iconize = str => str.replace(/\[(\w+)\]/g, (_, n) => icon(n));

const TAGS = {
  OVER: { icon: 'flame', name: 'Overclock' },
  CRYO: { icon: 'snowflake', name: 'Cryo' },
  FLUX: { icon: 'flux', name: 'Flux' },
  AUTO: { icon: 'cog', name: 'Auto' },
};

// Cards can reference tag counts → visible synergies.
const CARDS = [
  { id: 'overclock', name: 'Overclock Coils', tags: ['OVER'], desc: 'Dynamos +100%[bolt], +50%[flame]' },
  { id: 'redline',   name: 'Redline Protocol', tags: ['OVER'], desc: '+6%[bolt] per 10 current [flame]', syn: 'Loves running hot.' },
  { id: 'turbo',     name: 'Turbo Manifold', tags: ['OVER'], desc: 'Turbines +75%[bolt]' },
  { id: 'embertap',  name: 'Ember Tap', tags: ['OVER'], desc: '+0.4[bolt]/s per current [flame]', syn: 'Heat becomes fuel.' },
  { id: 'supercon',  name: 'Superconductors', tags: ['CRYO'], desc: 'Coolers +80% effective' },
  { id: 'recycler',  name: 'Cryo Recycler', tags: ['CRYO'], desc: 'Vent grants 15[bolt] per [flame] vented', syn: 'Vent becomes a generator.' },
  { id: 'deepfreeze',name: 'Deep Freeze', tags: ['CRYO'], desc: 'Passive cooling +2[flame]/s' },
  { id: 'fluxcap',   name: 'Flux Capacitor', tags: ['FLUX'], desc: 'Injectors +80% faster' },
  { id: 'resonance', name: 'Resonance', tags: ['FLUX'], desc: '+12% charge per [flux] card', syn: 'Scales with every Flux pick.' },
  { id: 'coldfusion',name: 'Cold Fusion', tags: ['CRYO', 'FLUX'], desc: '[flame] below 40: charge +50%', syn: 'Rewards a cool forge.' },
  { id: 'surge',     name: 'Surge Channel', tags: ['FLUX'], desc: 'Injectors +4[bolt] but +0.5[flame] each' },
  { id: 'autofab',   name: 'Auto-Fabricator', tags: ['AUTO'], desc: 'Auto-buys a Dynamo every 6s' },
  { id: 'servovent', name: 'Servo Vents', tags: ['AUTO'], desc: 'Auto-vents 12[flame] above 75' },
  { id: 'gridmind',  name: 'Grid Mind', tags: ['AUTO'], desc: '+15%[bolt] per [cog] card', syn: 'Scales with every Auto pick.' },
];

// Draft triggers, checked in order. First two fire off lifetime energy earned,
// the rest off rift charge — so choices arrive all run long.
const DRAFT_TRIGGERS = [
  s => s.earned >= 150,
  s => s.earned >= 600,
  s => s.charge >= GOAL * 0.15,
  s => s.charge >= GOAL * 0.35,
  s => s.charge >= GOAL * 0.60,
  s => s.charge >= GOAL * 0.85,
];

// ---------- state ----------
let S;
function newRun() {
  S = {
    energy: 0, earned: 0, heat: 0, charge: 0, time: 0,
    counts: { dynamo: 1, turbine: 0, cooler: 0, injector: 0 }, // start with 1 dynamo so numbers move immediately
    cards: [],
    draftsDone: 0,
    ventCd: 0, servoCd: 0, autofabT: 0,
    melt: 0,
    totalVented: 0, jolts: 0,
    combo: 0, comboT: 0, milestone: 0,
    ending: null, endT: 0, endShown: false,
    paused: true, over: false,
  };
}

const has = id => S.cards.includes(id);
const tagCount = tag => S.cards.reduce((n, id) => n + (CARDS.find(c => c.id === id).tags.includes(tag) ? 1 : 0), 0);
const cost = key => Math.ceil(MACHINES[key].base * Math.pow(MACHINES[key].growth, S.counts[key]));

// ---------- derived rates (recomputed every tick) ----------
function calc() {
  const c = S.counts;
  let dynamoEps = c.dynamo * MACHINES.dynamo.eps;
  let dynamoHeat = c.dynamo * MACHINES.dynamo.heat;
  if (has('overclock')) { dynamoEps *= 2; dynamoHeat *= 1.5; }

  let turbineEps = c.turbine * MACHINES.turbine.eps;
  if (has('turbo')) turbineEps *= 1.75;

  let prodMult = 1;
  if (has('redline')) prodMult *= 1 + 0.006 * S.heat;
  if (has('gridmind')) prodMult *= 1 + 0.15 * tagCount('AUTO');

  let eps = (dynamoEps + turbineEps) * prodMult;
  if (has('embertap')) eps += 0.4 * S.heat;

  let channelPer = MACHINES.injector.channel + (has('surge') ? 4 : 0);
  let channel = c.injector * channelPer;
  if (has('fluxcap')) channel *= 1.8;

  let chargeMult = 1;
  if (has('resonance')) chargeMult *= 1 + 0.12 * tagCount('FLUX');
  if (has('coldfusion') && S.heat < 40) chargeMult *= 1.5;

  let injectorHeat = c.injector * (MACHINES.injector.heat + (has('surge') ? 0.5 : 0));
  const machineHeat = dynamoHeat + c.turbine * MACHINES.turbine.heat + injectorHeat;
  const ambient = (S.time / 60) * AMBIENT_PER_MIN;

  let cooling = c.cooler * MACHINES.cooler.cool * (has('supercon') ? 1.8 : 1);
  cooling += BASE_DISSIPATION + (has('deepfreeze') ? 2 : 0);

  return {
    eps, channel, chargeMult,
    heatIn: machineHeat + ambient,
    heatOut: cooling,
    ambient,
    joltAmt: 3 + eps * 0.15,
  };
}

// ---------- tick ----------
function tick(dt) {
  if (S.paused || S.over) return;
  S.time += dt;
  const R = calc();

  // production
  S.energy += R.eps * dt;
  S.earned += R.eps * dt;

  // channeling: injectors drain energy into the rift
  if (R.channel > 0 && S.energy > 0) {
    const drain = Math.min(R.channel * dt, S.energy);
    S.energy -= drain;
    S.charge += drain * R.chargeMult;
  }

  // heat
  S.heat = Math.max(0, S.heat + (R.heatIn - R.heatOut) * dt);

  // cooldowns & automation cards
  S.ventCd = Math.max(0, S.ventCd - dt);
  S.servoCd = Math.max(0, S.servoCd - dt);
  if (has('servovent') && S.heat > 75 && S.servoCd <= 0) {
    doVent(12);
    S.servoCd = 9;
    fx.pulse('#5cff9d');
  }
  if (has('autofab')) {
    S.autofabT += dt;
    if (S.autofabT >= 6) {
      S.autofabT = 0;
      if (S.energy >= cost('dynamo')) buy('dynamo', true);
    }
  }

  // combo decay
  if (S.comboT > 0) { S.comboT -= dt; if (S.comboT <= 0) S.combo = 0; }

  // charge milestone celebrations (every 10%)
  const ms = Math.floor(S.charge / GOAL * 10);
  if (ms > S.milestone && ms < 10) {
    S.milestone = ms;
    sfx.chime();
    buzz(15);
    fx.ring('#4dd8ff', 5);
    const r = cv.getBoundingClientRect();
    popup(r.left + r.width / 2, r.top + r.height / 2, ms * 10 + '%', 'var(--charge)');
  }

  // meltdown
  if (S.heat >= HEAT_CAP) {
    S.heat = HEAT_CAP;
    S.melt += dt;
    if (S.melt >= MELT_TIME) return lose();
  } else {
    S.melt = 0;
  }

  // win
  if (S.charge >= GOAL) return win();

  // drafts
  if (S.draftsDone < DRAFT_TRIGGERS.length && DRAFT_TRIGGERS[S.draftsDone](S)) {
    openDraft();
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
  // prefer tap point; fall back to the element's center
  let x = e && e.clientX, y = e && e.clientY;
  if (!x && el) { const r = el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
  popup(x, y, html, color);
}
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (err) { /* unsupported */ } };

// ---------- actions ----------
function buy(key, silent, e) {
  const c = cost(key);
  if (S.energy < c) return;
  S.energy -= c;
  S.counts[key]++;
  if (!silent) {
    sfx.buyTone(key);
    buzz(15);
    const col = { dynamo: '#7c5cff', turbine: '#ffd75c', cooler: '#4dd8ff', injector: '#b45cff' }[key];
    popAt(e, $id('shop-' + key), '+1' + icon(MACHINES[key].icon), col);
    fx.ring(col, 3);
    fx.burst(col);
  }
  renderShop(key);
}

function doVent(amount) {
  const vented = Math.min(S.heat, amount);
  S.heat -= vented;
  S.totalVented += vented;
  if (has('recycler')) {
    S.energy += vented * 15;
    S.earned += vented * 15;
  }
}

function jolt(e) {
  if (S.paused || S.over) return;
  S.combo = Math.min(25, S.combo + 1);
  S.comboT = 1.1;
  const mult = 1 + (S.combo - 1) * 0.05;
  const amt = calc().joltAmt * mult;
  S.energy += amt;
  S.earned += amt;
  S.jolts++;
  sfx.tap(S.combo);
  buzz(8);
  const color = S.combo >= 15 ? '#ffffff' : S.combo >= 5 ? '#ffb75c' : 'var(--energy)';
  popAt(e, $id('jolt'), '+' + fmt(amt) + icon('bolt') + (S.combo >= 5 ? ' ×' + S.combo : ''), color);
  // lightning strike on the rift — at the tap point if the canvas was tapped
  const r = cv.getBoundingClientRect();
  let x, y;
  if (e && e.target === cv) { x = e.clientX - r.left; y = e.clientY - r.top; }
  else { x = W * (0.25 + Math.random() * 0.5); y = H * 0.12; }
  fx.bolt(x, y);
  fx.burstAt(x, y, '#ffd75c', 6);
  const eb = document.querySelector('.energy-big');
  eb.classList.remove('pop'); void eb.offsetWidth; eb.classList.add('pop');
}

function vent(e) {
  if (S.paused || S.over || S.ventCd > 0) return;
  const before = S.heat;
  doVent(VENT_AMOUNT);
  const vented = before - S.heat;
  S.ventCd = VENT_CD;
  sfx.vent();
  buzz(20);
  popAt(e, $id('vent'), '−' + Math.round(vented) + icon('flame'), 'var(--charge)');
  if (has('recycler') && vented > 0) {
    setTimeout(() => popAt(null, $id('vent'), '+' + fmt(vented * 15) + icon('bolt'), 'var(--energy)'), 150);
  }
  fx.steam();
}

// ---------- drafts ----------
let draftOffer = [];
function openDraft() {
  const pool = CARDS.filter(c => !has(c.id));
  if (pool.length === 0) { S.draftsDone++; return; }
  // shuffle
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
    btn.addEventListener('click', () => {
      if (pickLock) return;
      pickLock = true;
      btn.classList.add('picked');
      setTimeout(() => pickCard(card.id), 220);
    });
    wrap.appendChild(btn);
  });
  show('draft-panel');
}

function pickCard(id) {
  S.cards.push(id);
  S.draftsDone++;
  hideOverlay();
  S.paused = false;
  sfx.pick();
  buzz(25);
  popup(window.innerWidth / 2, window.innerHeight / 2, icon('sparkles') + ' ' + CARDS.find(c => c.id === id).name, 'var(--good)');
  renderChips();
  renderShop();
}

// ---------- win / lose ----------
function endStats() {
  const mins = Math.floor(S.time / 60), secs = Math.floor(S.time % 60);
  return `
    <div>Time <span>${mins}:${String(secs).padStart(2, '0')}</span></div>
    <div>${icon('bolt')} generated <span>${fmt(S.earned)}</span></div>
    <div>${icon('rift')} charge <span>${Math.floor(S.charge / GOAL * 100)}%</span></div>
    <div>${icon('cards')} cards <span>${S.cards.length}</span></div>
    <div>${icon('cog')} machines <span>${Object.values(S.counts).reduce((a, b) => a + b, 0)}</span></div>
    <div>${icon('steam')} vented <span>${Math.floor(S.totalVented)}</span></div>`;
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
  prepEnd(icon('rift') + ' RIFT STABILIZED', 'win', 'The rift hums, tamed by your machines.');
}

function lose() {
  if (S.ending) return;
  S.ending = 'lose';
  S.over = true;
  sfx.lose();
  buzz([80, 50, 80, 50, 220]);
  fx.flash('255,60,30', 0.85);
  fx.nova('#ff5c4d', 90);
  prepEnd(icon('skull') + ' MELTDOWN', 'lose', 'The forge ran too hot.');
}

// ---------- UI ----------
const $id = id => document.getElementById(id);
let lastVentCd = 0;

function show(panelId) {
  $id('overlay').classList.remove('hidden');
  ['intro-panel', 'draft-panel', 'end-panel'].forEach(p =>
    $id(p).classList.toggle('hidden', p !== panelId));
}
function hideOverlay() { $id('overlay').classList.add('hidden'); }

function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return n >= 100 ? Math.floor(n).toString() : (Math.floor(n * 10) / 10).toString();
}

function renderShop(bumpKey) {
  const shop = $id('shop');
  if (!shop.dataset.built) {
    shop.dataset.built = '1';
    for (const key of Object.keys(MACHINES)) {
      const b = document.createElement('button');
      b.className = 'shop-btn';
      b.id = 'shop-' + key;
      b.addEventListener('pointerdown', e => { if (e.button) return; buy(key, false, e); });
      shop.appendChild(b);
    }
  }
  for (const [key, m] of Object.entries(MACHINES)) {
    const b = $id('shop-' + key);
    b.innerHTML =
      `<div class="s-name">${icon(m.icon)} ${m.name} <span class="s-count${key === bumpKey ? ' bump' : ''}">×${S.counts[key]}</span></div>` +
      `<div class="s-effect">${iconize(m.desc)}</div>` +
      `<div class="s-cost">${fmt(cost(key))}${icon('bolt')}</div>`;
  }
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
  $id('eps').textContent = fmt(R.eps);
  $id('joltamt').innerHTML = '+' + fmt(R.joltAmt) + icon('bolt');

  const heatNet = R.heatIn - R.heatOut;
  $id('heatfill').style.width = (S.heat / HEAT_CAP * 100) + '%';
  $id('heatval').textContent = Math.floor(S.heat);
  $id('heatnet').textContent = (heatNet >= 0 ? '+' : '') + heatNet.toFixed(1) + '/s';
  $id('heatnet').style.color = heatNet > 0 ? 'var(--heat)' : 'var(--good)';

  const pct = Math.min(100, S.charge / GOAL * 100);
  $id('chargefill').style.width = pct + '%';
  $id('chargeval').textContent = pct.toFixed(1) + '%';
  $id('chargerate').textContent = S.counts.injector > 0
    ? '· ' + fmt(Math.min(R.channel, R.eps) * R.chargeMult) + '/s'
    : '· build Injectors!';

  const ventBtn = $id('vent');
  ventBtn.disabled = S.ventCd > 0;
  $id('ventcd').style.width = (S.ventCd / VENT_CD * 100) + '%';
  $id('ventinfo').innerHTML = S.ventCd > 0 ? S.ventCd.toFixed(1) + 's' : '−' + VENT_AMOUNT + icon('flame');
  if (lastVentCd > 0 && S.ventCd === 0 && !S.paused && !S.over) {
    ventBtn.classList.add('ready');
    setTimeout(() => ventBtn.classList.remove('ready'), 500);
    buzz(10);
  }
  lastVentCd = S.ventCd;

  const mins = Math.floor(S.time / 60), secs = Math.floor(S.time % 60);
  $id('clock').textContent = mins + ':' + String(secs).padStart(2, '0');

  // affordability
  for (const key of Object.keys(MACHINES)) {
    const b = $id('shop-' + key);
    const can = S.energy >= cost(key);
    b.disabled = !can;
    b.classList.toggle('can', can);
  }

  document.querySelector('.heatbar').classList.toggle('crit', S.heat > 85 && !S.over);

  // meltdown warning
  const warn = $id('meltwarn');
  if (S.heat >= HEAT_CAP && !S.over) {
    warn.classList.remove('hidden');
    $id('meltcount').textContent = Math.max(0, MELT_TIME - S.melt).toFixed(1);
  } else {
    warn.classList.add('hidden');
  }
}

/* =========================================================
   Canvas — the rift
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
const arcs = [];   // lightning bolts: origin point, decaying life
const rings = [];  // expanding feedback rings
let flashFx = null; // fullscreen tint: { c: 'r,g,b', a }
let spawnAcc = 0, emberAcc = 0;

function spawn(x, y, vx, vy, life, c, mode, size) {
  if (particles.length > 400) return;
  particles.push({ x, y, vx, vy, life, max: life, c, mode, size: size || 3 });
}

const fx = {
  ring(c, lw) { rings.push({ t: 1, c, lw: lw || 3 }); },
  pulse(c) { this.ring(c, 3); },
  flash(rgb, a) { flashFx = { c: rgb, a }; },
  bolt(x, y) { arcs.push({ x, y, t: 0.18, max: 0.18 }); },
  burst(c) {
    const cx = W / 2, cy = H / 2;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 90;
      spawn(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30, Math.cos(a) * sp, Math.sin(a) * sp, 0.6, c || '#ffd75c', 'out');
    }
  },
  burstAt(x, y, c, n) {
    for (let i = 0; i < (n || 8); i++) {
      const a = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 80;
      spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.55, c, 'out');
    }
  },
  steam() {
    const cx = W / 2, cy = H / 2;
    this.ring('#8ad8ff', 4);
    this.flash('140,220,255', 0.18);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, sp = 90 + Math.random() * 130;
      spawn(cx, cy, Math.cos(a) * sp, Math.sin(a) * sp, 0.8, i % 3 ? '#dff4ff' : '#8ad8ff', 'out', 2 + Math.random() * 3);
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

function drawRift(dt) {
  ctx.clearRect(0, 0, W, H);
  if (!S) return;
  const R = calc();
  const cx = W / 2, cy = H / 2;
  const rad = Math.min(W, H) * 0.32;
  const t = performance.now() / 1000;
  const heatFrac = S.heat / HEAT_CAP;
  const chargeFrac = Math.min(1, S.charge / GOAL);
  const channeling = !S.paused && !S.over && S.counts.injector > 0 && S.energy > 1;

  // shake: meltdown countdown > high-heat tremor > lose sequence
  let shake = 0;
  if (S.melt > 0) shake = 8;
  else if (S.heat > 85 && !S.over) shake = (S.heat - 85) / 15 * 3;
  if (S.ending === 'lose' && S.endT < 1) shake = 12 * (1 - S.endT);
  ctx.save();
  ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);

  // heat glow background
  if (heatFrac > 0.05) {
    const g = ctx.createRadialGradient(cx, cy, rad * 0.2, cx, cy, Math.max(W, H) * 0.8);
    g.addColorStop(0, `rgba(255,60,30,${heatFrac * 0.35})`);
    g.addColorStop(1, 'rgba(255,60,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-10, -10, W + 20, H + 20);
  }

  // rift core: swirling arcs (spin faster as charge grows)
  const spin = 1 + chargeFrac * 1.6 + (S.ending === 'win' ? S.endT * 6 : 0);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    const rr = rad * (0.55 + i * 0.12);
    const off = t * (0.6 + i * 0.35) * spin * (i % 2 ? -1 : 1);
    ctx.arc(cx, cy, rr, off, off + Math.PI * (1.1 + 0.3 * Math.sin(t + i)));
    ctx.strokeStyle = `rgba(124,92,255,${0.5 - i * 0.12})`;
    ctx.lineWidth = 2.5 - i * 0.5;
    ctx.stroke();
  }

  // inner glow scales with charge; heartbeat pulse as it fills
  const beat = 1 + Math.sin(t * (2 + chargeFrac * 6)) * 0.05 * chargeFrac;
  const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad * 0.5 * beat);
  g2.addColorStop(0, `rgba(77,216,255,${0.25 + chargeFrac * 0.6})`);
  g2.addColorStop(1, 'rgba(77,216,255,0)');
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.arc(cx, cy, rad * 0.5 * beat, 0, Math.PI * 2);
  ctx.fill();

  // charge ring
  ctx.beginPath();
  ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * chargeFrac);
  ctx.strokeStyle = '#4dd8ff';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(77,216,255,0.15)';
  ctx.lineWidth = 4;
  ctx.stroke();

  // channeling: crackling arcs from the ring into the core
  if (channeling && Math.random() < dt * (2 + S.counts.injector)) {
    const a = Math.random() * Math.PI * 2;
    arcs.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad, t: 0.14, max: 0.14 });
  }
  for (let i = arcs.length - 1; i >= 0; i--) {
    const a = arcs[i];
    a.t -= dt;
    if (a.t <= 0) { arcs.splice(i, 1); continue; }
    jagged(a.x, a.y, cx, cy, a.t / a.max);
  }

  // ambient particles: spawn rate follows production — automation made visible
  if (!S.paused && !S.over) {
    spawnAcc += dt * Math.min(50, 2 + R.eps * 0.35);
    while (spawnAcc >= 1) {
      spawnAcc--;
      const a = Math.random() * Math.PI * 2;
      const d = rad * (1.4 + Math.random() * 0.8);
      spawn(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0, 0, 2.2,
        Math.random() < heatFrac * 0.6 ? '#ff5c4d' : '#ffd75c', 'seek');
    }
    // embers rise as the forge overheats
    if (S.heat > 55) {
      emberAcc += dt * ((S.heat - 55) / 45) * 22;
      while (emberAcc >= 1) {
        emberAcc--;
        spawn(Math.random() * W, H + 4, 0, -(30 + Math.random() * 60), 1.9, Math.random() < 0.5 ? '#ff5c4d' : '#ff9d4d', 'ember', 2);
      }
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
      if (dist < rad * 0.25) p.life = Math.min(p.life, 0.15);
    } else if (p.mode === 'out') {
      p.vx *= 1 - 1.6 * dt;
      p.vy *= 1 - 1.6 * dt;
    } else if (p.mode === 'ember') {
      p.vx = Math.sin(p.life * 5 + p.max * 9) * 14;
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    ctx.globalAlpha = Math.min(1, p.life / p.max * 2);
    ctx.fillStyle = p.c;
    const sz = p.size;
    ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
  }
  ctx.globalAlpha = 1;

  // feedback rings
  for (let i = rings.length - 1; i >= 0; i--) {
    const rg = rings[i];
    rg.t -= dt * 1.8;
    if (rg.t <= 0) { rings.splice(i, 1); continue; }
    ctx.beginPath();
    ctx.arc(cx, cy, rad * (0.5 + (1 - rg.t) * 1.4), 0, Math.PI * 2);
    ctx.strokeStyle = rg.c;
    ctx.globalAlpha = rg.t;
    ctx.lineWidth = rg.lw;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // fullscreen flash tint
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
  click: () => beep(660, 0.07, 'square', 0.04),
  tap: combo => {
    const st = PENTA[(combo - 1) % 5] + 12 * Math.min(2, Math.floor((combo - 1) / 5));
    beep(392 * Math.pow(2, st / 12), 0.07, 'square', 0.045);
  },
  buyTone: key => {
    const f = { dynamo: 494, turbine: 392, cooler: 659, injector: 587 }[key] || 520;
    beep(f, 0.09, 'triangle', 0.06);
    setTimeout(() => beep(f * 1.5, 0.08, 'triangle', 0.05), 70);
  },
  chime: () => { beep(880, 0.12); setTimeout(() => beep(1318, 0.2), 100); },
  vent: () => beep(220, 0.25, 'sawtooth', 0.05),
  draft: () => { beep(440, 0.12); setTimeout(() => beep(660, 0.12), 110); },
  pick: () => { beep(523, 0.1); setTimeout(() => beep(784, 0.15), 90); },
  alarm: () => beep(880, 0.15, 'square', 0.05),
  win: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.25), i * 140)),
  lose: () => [330, 262, 196, 131].forEach((f, i) => setTimeout(() => beep(f, 0.3, 'sawtooth'), i * 180)),
};

/* =========================================================
   Main loop & wiring
   ========================================================= */
let last = performance.now();
let alarmAcc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  tick(dt);
  if (S && S.melt > 0 && !S.over) {
    alarmAcc += dt;
    if (alarmAcc > 0.5) { alarmAcc = 0; sfx.alarm(); }
  }
  if (S && S.ending && !S.endShown) {
    S.endT += dt;
    if (S.endT > 1.2) { S.endShown = true; show('end-panel'); }
  }
  if (S) renderHUD(calc());
  drawRift(dt);
  requestAnimationFrame(frame);
}

$id('jolt').addEventListener('pointerdown', e => { if (e.button) return; jolt(e); });
cv.addEventListener('pointerdown', e => { if (e.button) return; jolt(e); });
$id('vent').addEventListener('pointerdown', e => { if (e.button) return; vent(e); });

// block pinch-zoom, double-tap zoom and long-press menus
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener('dblclick', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());
$id('startbtn').addEventListener('click', () => {
  hideOverlay();
  S.paused = false;
  sfx.pick();
});
$id('restartbtn').addEventListener('click', () => {
  newRun();
  renderShop();
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
renderShop();
renderChips();
show('intro-panel');
resize();
requestAnimationFrame(frame);
