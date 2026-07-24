# 🌀 RIFTFORGE

An automation roguelike for mobile web. Pure vanilla HTML/CSS/JS + canvas — no build step, no dependencies.

**Play:** https://nyx371.github.io/autrgl/

## The loop

You're powering up an unstable rift.

- ⚡ **Machines generate energy automatically.** Dynamos and Turbines make the numbers climb.
- 🌀 **Injectors channel energy into the rift.** Get the rift to **100% charge → you win.**
- 🔥 **Everything makes heat**, and ambient instability rises every minute. Sit at 100 heat for 4 seconds → **meltdown, you lose.** Coolers and the manual Vent button keep you alive.
- 🃏 **At milestones you draft 1 of 3 cards.** Cards carry synergy tags — 🔥 Overclock, ❄️ Cryo, 🌀 Flux, ⚙️ Auto — and several cards scale with how many of a tag you own, so runs push you toward committing to a build.

The core tension: production makes heat, cooling costs energy that could be production, and charging drains the energy you'd spend on both. Every run is a race between your charge rate and the rising instability.

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
