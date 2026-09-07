// MIT; rewritten from the relaxed-distance search approach in John Noel's solver.
export const DIRS = [
    { name: "上", bit: 1, opposite: 4, dx: 0, dy: -1 },
    { name: "右", bit: 2, opposite: 8, dx: 1, dy: 0 },
    { name: "下", bit: 4, opposite: 1, dx: 0, dy: 1 },
    { name: "左", bit: 8, opposite: 2, dx: -1, dy: 0 },
];
export const COLORS = ["红", "蓝", "绿", "黄", "银"];
export function neighbor(p, d, n) {
    const x = (p % n) + DIRS[d].dx,
        y = Math.floor(p / n) + DIRS[d].dy;
    return x < 0 || y < 0 || x >= n || y >= n ? -1 : y * n + x;
}
export function wall(board, p, d, on = true) {
    const q = neighbor(p, d, board.size);
    if (on) board.walls[p] |= DIRS[d].bit;
    else board.walls[p] &= ~DIRS[d].bit;
    if (q >= 0) {
        if (on) board.walls[q] |= DIRS[d].opposite;
        else board.walls[q] &= ~DIRS[d].opposite;
    }
}
export function emptyBoard(size = 16, center = true) {
    const b = {
        version: 1,
        size,
        walls: Array(size * size).fill(0),
        blocked: [],
        robots: [0, size - 1, size * (size - 1), size * size - 1],
        target: { cell: size + 1, robot: 0 },
    };
    for (let p = 0; p < size * size; p++)
        for (let d = 0; d < 4; d++) if (neighbor(p, d, size) < 0) wall(b, p, d);
    if (center && size === 16) {
        b.blocked = [119, 120, 135, 136];
        for (const p of b.blocked) for (let d = 0; d < 4; d++) wall(b, p, d);
    }
    return b;
}
export function validateBoard(input) {
    if (
        !input ||
        input.version !== 1 ||
        !Number.isInteger(input.size) ||
        input.size < 2 ||
        input.size > 16
    )
        throw Error("棋盘格式不正确：需要 version 1，尺寸为 2–16。");
    if (input.mirrors?.length || input.prisms?.length)
        throw Error("当前求解器不支持镜面 / 棱镜规则。");
    const b = structuredClone(input),
        n = b.size,
        valid = (p) => Number.isInteger(p) && p >= 0 && p < n * n;
    if (
        b.rules !== undefined &&
        (!b.rules || typeof b.rules.requireTurn !== "boolean")
    )
        throw Error("转弯规则必须是布尔值。");
    if (
        b.goals !== undefined &&
        (!Array.isArray(b.goals) ||
            b.goals.length > 17 ||
            b.goals.some(
                (g) =>
                    !g ||
                    !valid(g.cell) ||
                    !Number.isInteger(g.robot) ||
                    g.robot < -1 ||
                    g.robot > 3 ||
                    !["circle", "triangle", "square", "hex", "vortex"].includes(
                        g.shape,
                    ) ||
                    typeof g.id !== "string" ||
                    !/^(red|green|blue|yellow|vortex)-(circle|triangle|square|hex|vortex)$/.test(
                        g.id,
                    ),
            ) ||
            new Set(b.goals.map((g) => g.id)).size !== b.goals.length)
    )
        throw Error("预设目标数据不正确。");
    if (
        b.layout !== undefined &&
        (!Array.isArray(b.layout) ||
            b.layout.length !== 4 ||
            b.layout.some(
                (id) => typeof id !== "string" || !/^[A-D][1-3]$/.test(id),
            ) ||
            new Set(b.layout.map((id) => id[0])).size !== 4)
    )
        throw Error("预设拼装数据不正确或含不支持的镜面板面。");
    if (
        !Array.isArray(b.walls) ||
        b.walls.length !== n * n ||
        b.walls.some((w) => !Number.isInteger(w) || w < 0 || w > 15)
    )
        throw Error("墙壁数据不正确。");
    if (
        !Array.isArray(b.blocked) ||
        b.blocked.some((p) => !valid(p)) ||
        new Set(b.blocked).size !== b.blocked.length
    )
        throw Error("禁入格数据不正确。");
    if (
        !Array.isArray(b.robots) ||
        b.robots.length < 1 ||
        b.robots.length > 5 ||
        b.robots.some((p) => !valid(p) || b.blocked.includes(p)) ||
        new Set(b.robots).size !== b.robots.length
    )
        throw Error("机器人必须在不同的可用格子中，数量为 1–5。");
    if (
        !b.target ||
        !valid(b.target.cell) ||
        b.blocked.includes(b.target.cell) ||
        !Number.isInteger(b.target.robot) ||
        b.target.robot < -1 ||
        b.target.robot >= b.robots.length
    )
        throw Error("目标位置或颜色不正确。");
    for (let p = 0; p < n * n; p++)
        for (let d = 0; d < 4; d++) {
            const q = neighbor(p, d, n),
                has = !!(b.walls[p] & DIRS[d].bit);
            if (q < 0 && !has) throw Error("棋盘外边界必须封闭。");
            if (q >= 0 && has !== !!(b.walls[q] & DIRS[d].opposite))
                throw Error("相邻格子的墙壁必须一致。");
            if (b.blocked.includes(p) && !has)
                throw Error("禁入格必须被墙壁包围。");
        }
    return b;
}
export function slide(b, robots, r, d) {
    let p = robots[r];
    while (!(b.walls[p] & DIRS[d].bit)) {
        const q = neighbor(p, d, b.size);
        if (q < 0 || robots.includes(q)) break;
        p = q;
    }
    return p;
}
export function isGoal(b, robots, turns = []) {
    return robots.some(
        (p, i) =>
            p === b.target.cell &&
            (b.target.robot < 0 || b.target.robot === i) &&
            (!b.rules?.requireTurn || turns[i] === 3),
    );
}
// 0: no movement, 1: vertical, 2: horizontal, 3: has changed axis at least once.
export function afterTurn(history, direction) {
    const axis = direction % 2 === 0 ? 1 : 2;
    return history === 3 || (history !== 0 && history !== axis) ? 3 : axis;
}
export function relaxedDistances(b) {
    const dist = Array(b.size * b.size).fill(Infinity),
        queue = [b.target.cell];
    dist[b.target.cell] = 0;
    for (let i = 0; i < queue.length; i++) {
        const p = queue[i];
        for (let d = 0; d < 4; d++) {
            let q = p;
            while (!(b.walls[q] & DIRS[d].bit)) {
                q = neighbor(q, d, b.size);
                if (q < 0) break;
                if (dist[q] === Infinity) {
                    dist[q] = dist[p] + 1;
                    queue.push(q);
                }
            }
        }
    }
    return dist;
}
// Target robot is distinguished; other colors are interchangeable without mirrors.
function stateKey(robots, target, turns, requireTurn) {
    let key = 0;
    const encoded = robots.map(
        (p, i) =>
            p * 4 +
            (requireTurn && (target < 0 || i === target) ? turns[i] : 0),
    );
    const helpers = encoded
        .filter((_, i) => i !== target)
        .sort((a, b) => a - b);
    if (target >= 0) key = encoded[target];
    for (const p of helpers) key = key * 1024 + p;
    return key;
}
export function solve(input, options = {}) {
    const b = validateBoard(input),
        start = performance.now(),
        maxMs = options.maxMs ?? 30000,
        maxDepth = options.maxDepth ?? 40,
        maxNodes = options.maxNodes ?? Infinity,
        maxEntries = options.maxEntries ?? 400000;
    const robots = [...b.robots],
        turns = robots.map(() => 0),
        dist = relaxedDistances(b),
        target = b.target.robot,
        path = [];
    let nodes = 0,
        aborted = false,
        answer = null;
    const h = () =>
        target < 0
            ? Math.min(...robots.map((p) => dist[p]))
            : dist[robots[target]];
    const initial = h();
    let lowerBound = initial;
    const result = (status, moves = null) => ({
        status,
        moves,
        lowerBound,
        nodes,
        elapsedMs: performance.now() - start,
    });
    if (isGoal(b, robots, turns)) {
        lowerBound = 0;
        return result("optimal", []);
    }
    if (initial === Infinity) return result("unsolvable");
    function search(remaining, seen) {
        if (isGoal(b, robots, turns)) {
            answer = path.map((m) => ({ ...m }));
            return true;
        }
        if (h() > remaining || remaining === 0) return false;
        nodes++;
        if (
            nodes > maxNodes ||
            ((nodes & 1023) === 0 && performance.now() - start >= maxMs)
        ) {
            aborted = true;
            return false;
        }
        const key = stateKey(robots, target, turns, b.rules?.requireTurn);
        if ((seen.get(key) ?? -1) >= remaining) return false;
        // Clearing reduces pruning only; it never discards unexplored paths.
        if (seen.size >= maxEntries) seen.clear();
        seen.set(key, remaining);
        const order =
            target < 0
                ? robots.map((_, i) => i)
                : [
                      target,
                      ...robots.map((_, i) => i).filter((i) => i !== target),
                  ];
        for (const r of order)
            for (let d = 0; d < 4; d++) {
                const from = robots[r],
                    to = slide(b, robots, r, d);
                if (to === from) continue;
                const oldTurn = turns[r];
                robots[r] = to;
                turns[r] = afterTurn(oldTurn, d);
                path.push({ robot: r, direction: d, from, to });
                const found = search(remaining - 1, seen);
                path.pop();
                robots[r] = from;
                turns[r] = oldTurn;
                if (found) return true;
                if (aborted) return false;
            }
        return false;
    }
    for (let bound = initial; bound <= maxDepth; bound++) {
        lowerBound = bound;
        options.onProgress?.({
            lowerBound,
            nodes,
            elapsedMs: performance.now() - start,
        });
        if (performance.now() - start >= maxMs) return result("limit");
        if (search(bound, new Map())) {
            lowerBound = answer.length;
            return result("optimal", answer);
        }
        if (aborted) return result("limit");
        lowerBound = bound + 1;
    }
    return result("limit");
}
