# Ricochet Robots

A browser version of the board game **Ricochet Robots** (碰撞机器人) for one player, with a built-in solver. The interface is in Chinese.

## Play

1. A round starts with a target and a target robot. The target robot is selected, and dashed outlines show where it stops in each direction.
2. Tap a dashed outline, tap any cell in that line, or drag the robot in a direction. On a keyboard, focus the board, press 1–5 to select a robot and press an arrow key to move it.
3. Reach the target to finish the round. The page then shows your move count and the optimal move count.
4. **下一局** keeps the robots where they are and draws a new target, as in the board game.

During a round, **撤销** takes back one move, **重来** returns to the start, **提示** shows the next optimal move from the current position, and **看答案** replays the optimal route step by step.

The solver runs in a browser Web Worker when a round starts. Difficult positions can exhaust the time limit (10 seconds, 30 seconds or 2 minutes, set under **规则与求解**). A timeout does not prove that a position has no solution.

## Set up a position

**局面设置** holds the board tools: assemble a physical board from its tiles, generate a random board, edit walls, place robots, choose a printed or custom target, and import or export the board as JSON. Choosing a placement tool enters editing; **完成编辑** starts a new round from the edited position.

## Run locally

The app is static HTML, CSS, and JavaScript; no package installation or backend service is required. Serve the repository over HTTP because it loads JavaScript modules and JSON assets.

```sh
git clone https://github.com/Tsukellow/ricochet-robots-solver.git
cd ricochet-robots-solver
python3 -m http.server 8000 --bind 127.0.0.1
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in a modern browser. Keep the server running while using the app.

## Source map

- [app.js](app.js): game flow, board rendering and interaction.
- [assembly.js](assembly.js): board assembly.
- [engine.js](engine.js) and [worker.js](worker.js): search implementation and worker.
- [trajectory.js](trajectory.js): route drawing.
- [round.js](round.js): next-round target selection.
- [tiles.json](tiles.json): board tile data.

## Credits and licenses

This project builds on the work of:

- **[John Noel — johnnoel/ricochet-robots-solver](https://github.com/johnnoel/ricochet-robots-solver)**: the original project baseline, solver heuristic ideas, and board examples. This repository provides a native JavaScript browser application derived from that work.
- **[Coding Zeal — CodingZeal/robots](https://github.com/CodingZeal/robots)**: the board tile definitions, converted from `lib/robots/tiles.rb` into this application's tile data.

Both source projects are MIT-licensed. Their copyright and license notices are preserved in [LICENSE.txt](LICENSE.txt) and [LICENSE-tiles.txt](LICENSE-tiles.txt).
