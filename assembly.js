import { emptyBoard, wall, validateBoard } from "./engine.js";
export const GROUPS = {
    A: { name: "绿标", color: "#2a9776" },
    B: { name: "蓝标", color: "#397ac7" },
    C: { name: "黄标", color: "#c89316" },
    D: { name: "红标", color: "#da4d50" },
};
export const DEFAULT_LAYOUT = ["A1", "B1", "C1", "D1"];
export const SLOT_NAMES = ["左上", "右上", "右下", "左下"];
export const SHAPES = {
    circle: "圆形",
    triangle: "三角",
    square: "方形",
    hex: "六角",
    vortex: "漩涡",
};
const robotIndex = { red: 0, blue: 1, green: 2, yellow: 3, vortex: -1 };
export function rotateCell(cell, size = 16) {
    return (cell % size) * size + (size - 1 - Math.floor(cell / size));
}
export function tilePoint(row, column, slot) {
    let p = row * 16 + column;
    for (let i = 0; i < slot; i++) p = rotateCell(p);
    return p;
}
export function validateLayout(layout, tiles) {
    if (!Array.isArray(layout) || layout.length !== 4)
        throw Error("请选择四个板面。");
    const picked = layout.map((id) => tiles.find((t) => t.id === id));
    if (picked.some((t) => !t)) throw Error("未知板面。");
    if (picked.some((t) => !t.supported || t.diagonal_walls.length))
        throw Error("带镜面的板面尚未支持，不能忽略镜面求解。");
    if (new Set(picked.map((t) => t.group)).size !== 4)
        throw Error("每组颜色标记只能选择一个板面。");
    return picked;
}
export function assemble(layout, tiles, previous = null) {
    const picked = validateLayout(layout, tiles),
        b = emptyBoard();
    b.goals = [];
    b.layout = [...layout];
    b.rules = { requireTurn: false };
    for (const [slot, t] of picked.entries()) {
        for (const [row, col] of t.vertical_walls)
            wall(b, tilePoint(row, col, slot), (1 + slot) % 4);
        for (const [row, col] of t.horizontal_walls)
            wall(b, tilePoint(row, col, slot), (2 + slot) % 4);
        for (const [row, col, color, shape] of t.targets)
            b.goals.push({
                id: `${color}-${shape ?? "vortex"}`,
                cell: tilePoint(row, col, slot),
                robot: robotIndex[color],
                shape: shape ?? "vortex",
            });
    }
    if (previous) {
        b.robots = previous.robots.every(
            (p) => p < 256 && !b.blocked.includes(p),
        )
            ? [...previous.robots]
            : b.walls
                  .map((_, p) => p)
                  .filter((p) => !b.blocked.includes(p))
                  .slice(0, previous.robots.length);
        b.rules = previous.rules ?? b.rules;
    }
    const selected =
        b.goals.find(
            (g) => g.id === previous?.target?.id && g.robot < b.robots.length,
        ) ?? b.goals.find((g) => g.robot < b.robots.length);
    b.target = { ...selected };
    return validateBoard(b);
}
export function replaceTile(layout, slot, id, tiles) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 3)
        throw Error("无效板块位置。");
    const t = tiles.find((t) => t.id === id);
    if (!t) throw Error("未知板面。");
    const next = [...layout],
        other = next.findIndex((v) => v[0] === t.group);
    if (other !== slot) next[other] = next[slot];
    next[slot] = id;
    validateLayout(next, tiles);
    return next;
}
export function rotateBoard(board) {
    const b = structuredClone(board);
    if (b.size !== 16) throw Error("拼装旋转仅适用于 16×16 棋盘。");
    b.walls = Array(256).fill(0);
    for (let p = 0; p < 256; p++)
        for (let d = 0; d < 4; d++)
            if (board.walls[p] & (1 << d))
                b.walls[rotateCell(p)] |= 1 << (d + 1) % 4;
    b.blocked = board.blocked.map((p) => rotateCell(p));
    b.robots = board.robots.map((p) => rotateCell(p));
    b.target.cell = rotateCell(board.target.cell);
    if (b.goals)
        b.goals = b.goals.map((g) => ({ ...g, cell: rotateCell(g.cell) }));
    if (b.layout)
        b.layout = [b.layout[3], b.layout[0], b.layout[1], b.layout[2]];
    return validateBoard(b);
}
// Target shapes as SVG geometry centred on (x, y); k scales them from the 40-unit board cell.
export function targetShape(shape, x, y, color, opacity = 1, k = 1) {
    const f = (v) => +v.toFixed(2),
        attrs = `fill="${color}" opacity="${opacity}" pointer-events="none"`,
        ring = (n, r, start) =>
            Array.from({ length: n }, (_, i) => {
                const a = start + (i * 2 * Math.PI) / n;
                return `${f(x + r * k * Math.cos(a))},${f(y + r * k * Math.sin(a))}`;
            }).join(" ");
    if (shape === "triangle")
        return `<polygon points="${f(x)},${f(y - 7.5 * k)} ${f(x + 8.5 * k)},${f(y + 7 * k)} ${f(x - 8.5 * k)},${f(y + 7 * k)}" ${attrs}/>`;
    if (shape === "square")
        return `<rect x="${f(x - 6.5 * k)}" y="${f(y - 6.5 * k)}" width="${f(13 * k)}" height="${f(13 * k)}" rx="${f(2 * k)}" ${attrs}/>`;
    if (shape === "hex") return `<polygon points="${ring(6, 8, -Math.PI / 2)}" ${attrs}/>`;
    if (shape === "vortex")
        return `<g stroke="${color}" stroke-width="${f(2.4 * k)}" stroke-linecap="round" opacity="${opacity}" pointer-events="none">${[0, 1, 2, 3]
            .map((i) => {
                const dx = 8 * k * Math.cos((i * Math.PI) / 4),
                    dy = 8 * k * Math.sin((i * Math.PI) / 4);
                return `<line x1="${f(x - dx)}" y1="${f(y - dy)}" x2="${f(x + dx)}" y2="${f(y + dy)}"/>`;
            })
            .join("")}</g>`;
    if (shape === "circle")
        return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(7 * k)}" ${attrs}/>`;
    // A target cell without a printed shape: ring with a centre dot.
    return `<g pointer-events="none"><circle cx="${f(x)}" cy="${f(y)}" r="${f(7 * k)}" fill="none" stroke="${color}" stroke-width="${f(2 * k)}"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(2.8 * k)}" fill="${color}"/></g>`;
}
// The same shapes as a small standalone icon for buttons and labels.
export function targetIcon(shape, color) {
    return `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">${targetShape(shape, 10, 10, color)}</svg>`;
}
export function tileSvg(tile, slot = 0) {
    const colors = ["#da4d50", "#397ac7", "#2a9776", "#c89316"],
        S = 15,
        svg = [
            `<svg viewBox="0 0 120 120" aria-hidden="true"><rect width="120" height="120" fill="#f8fafb"/>`,
        ];
    const point = (r, c) => {
        let p = r * 8 + c;
        for (let i = 0; i < slot; i++) p = rotateCell(p, 8);
        return [p % 8, Math.floor(p / 8)];
    };
    for (let i = 0; i <= 8; i++)
        svg.push(
            `<path d="M${i * S},0V120M0,${i * S}H120" stroke="#dce4e9" stroke-width=".6"/>`,
        );
    for (const [rows, d] of [
        [tile.vertical_walls, 1],
        [tile.horizontal_walls, 2],
    ])
        for (const [r, c] of rows) {
            const [x, y] = point(r, c).map((v) => v * S),
                dir = (d + slot) % 4,
                e = [
                    [x, y, x + S, y],
                    [x + S, y, x + S, y + S],
                    [x, y + S, x + S, y + S],
                    [x, y, x, y + S],
                ][dir];
            svg.push(
                `<path d="M${e[0]},${e[1]}L${e[2]},${e[3]}" stroke="#263b48" stroke-width="2.5"/>`,
            );
        }
    const [bx, by] = point(7, 7);
    svg.push(
        `<rect x="${bx * S}" y="${by * S}" width="15" height="15" fill="#263b48"/>`,
    );
    for (const [r, c, color, shape] of tile.targets) {
        const [x, y] = point(r, c);
        svg.push(
            targetShape(
                shape ?? "vortex",
                x * S + S / 2,
                y * S + S / 2,
                colors[robotIndex[color]] ?? "#34424b",
                1,
                0.6,
            ),
        );
    }
    svg.push("</svg>");
    return svg.join("");
}
