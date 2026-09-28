# The lab

A hall of machines you can take apart in your browser. Every one is built in code,
at full size, running on real physics, and every one can be cut open, pulled apart
and followed from the inside.

**Demo:** [airsuphq.github.io/airsup-lab](https://airsuphq.github.io/airsup-lab/)

| Machine | What you can do |
| --- | --- |
| Fusion reactor | Heat the plasma, watch the magnets and neutrons, follow the power to the grid |
| Raptor 3 | Follow the oxygen and methane through both turbopumps, throttle it, climb to vacuum |
| Turbopump | Spin it up, strobe it, make it cavitate |
| Production line | Find the bottleneck in a five station drone line |
| Cybertruck and drive unit | X-ray it, follow the energy from 1,344 cells to three motors, launch it |
| Humanoid | Load it up and watch every actuator take the weight |
| Black hole and wormhole | Light traced per pixel through curved spacetime, then dive in |
| Fighter jet engine | An F135 class turbofan: cut it open, follow the air, light the afterburner |
| F1 car | 2026 rules in a wind tunnel: air flow, pressure map, active aero, the power unit |
| Drone | An industrial quadcopter holding still against wind and gusts |

## Run it

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173. Jump straight to a machine with `?ex=`, for example
`?ex=f1`, `?ex=jet`, `?ex=hole`, `?ex=drone` or `?ex=hall`.

```bash
npm run build          # static site in dist/
BASE=/my-path/ npm run build   # to host it under a sub path
```

`dist/` is a plain static site: host it anywhere (GitHub Pages, Netlify, Vercel, S3).
The demo build linked above is `BASE=/airsup-lab/ npm run build` published to the
`gh-pages` branch.

## Make a film

Every machine has a scripted tour: camera shots, cursor moves and clicks on the real
UI. `tools/record.mjs` steps the simulation one frame at a time and encodes it, so a
slow machine still gives a perfect 60 fps video.

```bash
npm i -D playwright && npx playwright install chromium   # once, and you need ffmpeg
npm run dev                                                # in another terminal
npm run record -- f1 films/f1.mp4 60
```

Tours: `fusion`, `main` (Raptor), `pump`, `line`, `car`, `motor`, `robot`, `hole`,
`jet`, `f1`, `drone`, `hall` and `grand` (a flight through all of them).
Add `&clean=1` to the URL for frames without any UI.

## How it is built

Plain TypeScript and [three.js](https://threejs.org), no framework, no model files:
every part is generated from code when the page loads.

```
src/
  main.ts          builds the hall, runs the frame loop, wires state to the scene
  state.ts         the UI state for every exhibit, and URL routing
  camera.ts        named camera shots per exhibit
  director.ts      the scripted tours used for films
  brand.ts         name and share address, in one place
  core/
    geometry.ts    revolve, pipe, lofts and other procedural shapes
    materials.ts   the surface shader: detail noise, heat tint, streaks, bump
    cut.ts         section cuts with filled caps, straight or wedge shaped
    noise.ts       the shared 3D noise texture
  render/          the pipeline: ambient occlusion, bloom, depth of field, tone mapping
  scene/           the hall, its lights and decor
  fusion/ engine/ pump/ line/ car/ robot/ hole/ jet/ f1/ drone/
                   one folder per machine: its geometry, its physics, its flows
  ui/              panels, readouts, labels
```

A few ideas that run through all of it:

- **Cutaways.** `CutState` clips a machine against a plane and draws a cap where the
  plane opens a solid, so anything can be cut in half without modelling the inside
  twice. Thin skins are marked hollow so you see into them instead of a cap.
- **Flows.** Moving glow lines along curves (`glowLineMaterial`) show air, fuel, current
  and heat. Their speed and brightness follow the simulation.
- **Physics first.** Each machine computes the numbers it shows: momentum theory for the
  drone's rotors, ½ρv² for the F1 car, Bosch Hale reactivity for the plasma, null
  geodesics for the black hole. The help text of every exhibit says what is measured,
  what is estimated and where it comes from.
- **Deterministic time.** The simulation only advances through `step(dt)`, which is what
  makes frame perfect recording possible.

## Add a machine

1. Make a folder in `src/`, with a class that builds a `THREE.Group` (use `surf()` for
   materials and pass it a `CutState` if it should open up).
2. Give it a place in the hall in `src/scene/room.ts`, an entry in `EXHIBITS`, `PATHS`
   and `S` in `src/state.ts`, and a home shot in `src/camera.ts`.
3. Build it and step it in `src/main.ts` (search for an existing exhibit such as `drone`
   and follow the same pattern), add its panel to `index.html` and its text to
   `src/ui/ui.ts`.
4. Optional: a tour in `src/director.ts` so it can be filmed.

## Accuracy

These are teaching models drawn from public information, not engineering data. Where
a number is published it is used; where it is not, the help text says it is an
estimate. Corrections with a source are very welcome.

## License

Code: MIT, see [LICENSE](LICENSE). Product names belong to their owners, see
[NOTICE.md](NOTICE.md). Fonts: SIL Open Font License.
