# Ricochet Robots Solver

A browser tool for assembling **Ricochet Robots** boards, finding minimum-move solutions, and replaying the route. The interface is in Chinese.

## Use it

1. Assemble the board using the board controls, or start with the supplied layout.
2. Set the robot positions and choose an existing or custom target.
3. Choose a search budget: 10 seconds, 30 seconds, or 2 minutes.
4. Select **计算最少步数** to search.
5. Use the replay slider and previous/next controls to inspect the route.

**重新随机局面** keeps the board and randomizes the robot positions and target. Board assembly also provides face selection and rotation controls.

Search runs in a browser Web Worker. Difficult positions can exhaust the selected time budget; a timeout does not prove that a position has no solution. Read the result status before treating a route as an established minimum.

## Run locally

The app is static HTML, CSS, and JavaScript; no package installation or backend service is required. Serve the repository over HTTP because it loads JavaScript modules and JSON assets.

```sh
git clone https://github.com/Tsukellow/ricochet-robots-solver.git
cd ricochet-robots-solver
python3 -m http.server 8000 --bind 127.0.0.1
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in a modern browser. Keep the server running while using the app.

## Source map

- [app.js](app.js): application UI and interaction.
- [assembly.js](assembly.js): board assembly.
- [engine.js](engine.js) and [worker.js](worker.js): search implementation and worker.
- [trajectory.js](trajectory.js): route handling.
- [tiles.json](tiles.json): board tile data.

## Credits and licenses

This project builds on the work of:

- **[John Noel — johnnoel/ricochet-robots-solver](https://github.com/johnnoel/ricochet-robots-solver)**: the original project baseline, solver heuristic ideas, and board examples. This repository provides a native JavaScript browser application derived from that work.
- **[Coding Zeal — CodingZeal/robots](https://github.com/CodingZeal/robots)**: the board tile definitions, converted from `lib/robots/tiles.rb` into this application's tile data.

Both source projects are MIT-licensed. Their copyright and license notices are preserved in [LICENSE.txt](LICENSE.txt) and [LICENSE-tiles.txt](LICENSE-tiles.txt).
