import { emptyBoard, wall, neighbor, validateBoard } from "./engine.js";
import { assemble } from "./assembly.js";
function pick(items, rng) {
    if (!items.length) throw Error("没有可用的位置或目标。");
    return items[Math.floor(rng() * items.length)];
}
export function shuffled(items, rng = Math.random) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}
export function randomRobots(input, rng = Math.random) {
    const b = validateBoard(input),
        excluded = new Set([
            ...b.blocked,
            b.target.cell,
            ...(b.goals ?? []).map((g) => g.cell),
        ]),
        free = b.walls.map((_, p) => p).filter((p) => !excluded.has(p));
    if (free.length < b.robots.length)
        throw Error("可用格子不足，无法避开目标放置所有机器人。");
    b.robots = shuffled(free, rng).slice(0, b.robots.length);
    return validateBoard(b);
}
export function randomTarget(input, rng = Math.random) {
    const b = validateBoard(input);
    if (b.goals?.length) {
        const valid = b.goals.filter(
                (g) =>
                    g.robot < b.robots.length &&
                    (g.robot < 0
                        ? !b.robots.includes(g.cell)
                        : b.robots[g.robot] !== g.cell),
            ),
            others = valid.filter(
                (g) => g.cell !== b.target.cell || g.robot !== b.target.robot,
            );
        b.target = { ...pick(others.length ? others : valid, rng) };
    } else {
        const free = b.walls
                .map((_, p) => p)
                .filter((p) => !b.blocked.includes(p) && !b.robots.includes(p)),
            others = free.filter((p) => p !== b.target.cell);
        b.target = {
            cell: pick(others.length ? others : free, rng),
            robot: pick([...b.robots.map((_, i) => i), -1], rng),
        };
    }
    return validateBoard(b);
}
export function randomPhysical(tiles, previous, rng = Math.random) {
    const layout = shuffled(["A", "B", "C", "D"], rng).map(
        (group) =>
            pick(
                tiles.filter(
                    (t) =>
                        t.group === group &&
                        t.supported &&
                        !t.diagonal_walls.length,
                ),
                rng,
            ).id,
    );
    return randomTarget(assemble(layout, tiles, previous), rng);
}
export function connected(b) {
    const cells = b.walls
        .map((_, p) => p)
        .filter((p) => !b.blocked.includes(p));
    if (!cells.length) return false;
    const seen = new Set([cells[0]]),
        q = [cells[0]];
    for (let i = 0; i < q.length; i++)
        for (let d = 0; d < 4; d++)
            if (!(b.walls[q[i]] & (1 << d))) {
                const p = neighbor(q[i], d, b.size);
                if (p >= 0 && !b.blocked.includes(p) && !seen.has(p)) {
                    seen.add(p);
                    q.push(p);
                }
            }
    return seen.size === cells.length;
}
export function randomArtificial(previous, rng = Math.random) {
    const b = emptyBoard();
    if (previous) {
        b.rules = previous.rules ?? { requireTurn: false };
        if (previous.robots.every((p) => p < 256 && !b.blocked.includes(p)))
            b.robots = [...previous.robots];
        else
            b.robots = b.walls
                .map((_, p) => p)
                .filter((p) => !b.blocked.includes(p))
                .slice(0, previous.robots.length);
    } else b.rules = { requireTurn: false };
    const candidates = [];
    for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++)
            for (const d of [1, 2]) {
                const p = y * 16 + x,
                    q = neighbor(p, d, 16);
                if (q >= 0 && !b.blocked.includes(p) && !b.blocked.includes(q))
                    candidates.push([p, d]);
            }
    let added = 0;
    for (const [p, d] of shuffled(candidates, rng)) {
        if (added === 44) break;
        wall(b, p, d, true);
        if (connected(b)) added++;
        else wall(b, p, d, false);
    }
    return randomTarget(b, rng);
}
