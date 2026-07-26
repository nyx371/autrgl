# 🌀 RIFTFORGE

An automation defense roguelike for mobile web. Pure vanilla HTML/CSS/JS + canvas — no build step, no dependencies.

**Play:** https://nyx371.github.io/autrgl/

## The loop

Defend the Rift Spire at the center of the screen.

- 👾 **Enemies swarm in from the edges** and gnaw the Spire's shield, then its hull. Hull 0 = loss. **Survive 10 waves = win.**
- ⚡ **Tap enemies to zap them** — chained hits build a combo multiplier up to ×25.
- ⚙️ **Machines are bought from the build strip** under the battlefield (double-tap to confirm): Reactors (income), Turrets (auto-fire), Shield Gens (max shield + regen), Tesla Coils (chain lightning). Energy comes from kills + Reactors.
- 💥 **NOVA** (in the strip) blasts and knocks back every enemy on a cooldown — the panic button. A stats menu in the header shows live DPS, defense, and drafted cards.
- 🃏 **After every wave you draft 1 of 3 cards** (press-and-hold to confirm). Tags — 🔥 Overclock, 🛡 Aegis, ⚡ Storm, ⚙️ Auto — synergise and several cards scale with tag counts, pushing each run toward a build.
- 👾 **Enemy variety**: darts (fast fodder), splitters (burst into darts on death), brutes (tanks), one gold-ringed **elite** per wave (3× HP, 4× scrap), and **THE MAW** — the wave-10 boss that births darts while it lives.
- 💎 **Drops**: kills sometimes leave a scrap crystal (⚡) or aegis orb (shield refill) — tap them before they fade, or draft Magnet Drones.
- 🔶 **Overdrive**: kills charge a gold ring around the Spire; when full, tap the Spire for 6s of doubled firepower.
- 🔧 **Field repair**: a few hull points patched after every cleared wave.

Every symbol keeps one canonical color everywhere it appears (HUD, cards, world, popups) so color alone identifies the concept.

The core tension: spend energy on economy (Reactors) or defense (everything else), zap manually or trust the automation, and pick cards that compound.

## Development

It's static files. Open `index.html` in a browser, or:

```sh
python3 -m http.server
```

Deploys to GitHub Pages via `.github/workflows/deploy.yml`: on push to the dev branch, the workflow publishes the commit to `main`, which Pages serves (Settings → Pages → Deploy from a branch → main / root).

## Structure

- `index.html` — layout, overlays (intro / draft / end screens)
- `css/style.css` — mobile-first dark UI
- `js/icons.js` — inline SVG icons from [game-icons.net](https://game-icons.net) (Lorc, Delapouite & contributors, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/))
- `js/game.js` — game state, tick loop, card definitions, canvas rendering, tiny WebAudio sfx

All tuning constants (goal, heat cap, machine stats, card pool, draft triggers) live at the top of `js/game.js`.
