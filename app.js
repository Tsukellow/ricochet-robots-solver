import { nextRound } from "./round.js";
import {
    randomRobots,
    randomTarget,
    randomPhysical,
    randomArtificial,
} from "./random.js";
import { trajectory } from "./trajectory.js";
import {
    emptyBoard,
    wall,
    validateBoard,
    DIRS,
    COLORS,
    neighbor,
} from "./engine.js";
const $ = (id) => document.getElementById(id),
    palette = ["#da4d50", "#397ac7", "#2a9776", "#e2ac29", "#8b96a7"];
import {
    assemble,
    replaceTile,
    rotateBoard,
    validateLayout,
    tileSvg,
    targetGlyph,
    DEFAULT_LAYOUT,
    SLOT_NAMES,
    GROUPS,
    SHAPES,
} from "./assembly.js";
const { tiles } = await fetch("./tiles.json").then((r) => r.json());
function preset() {
    return assemble(DEFAULT_LAYOUT, tiles);
}
let draftLayout = [...DEFAULT_LAYOUT],
    activeSlot = 0;
let board = preset(),
    tool = "robot:0",
    customTarget = false,
    worker = null,
    solution = null,
    step = 0,
    lowerBound = 0,
    toastTimer;
try {
    const saved = localStorage.getItem("ricochet-lab-v1");
    if (saved) board = validateBoard(JSON.parse(saved));
    if (localStorage.getItem("ricochet-default-rules-v2") !== "applied") {
        board.rules = { ...board.rules, requireTurn: false };
        localStorage.setItem("ricochet-lab-v1", JSON.stringify(board));
        localStorage.setItem("ricochet-default-rules-v2", "applied");
    }
} catch {
    notify("已载入示例；此前保存的棋盘无法读取。");
}
let previousBoard = structuredClone(board);
const undoHistory = [];
function notify(message) {
    $("toast").textContent = message;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("toast").hidden = true), 4500);
}
function save() {
    try {
        localStorage.setItem("ricochet-lab-v1", JSON.stringify(board));
    } catch {
        notify("无法保存当前局面，请导出棋盘以便下次使用。");
    }
}
function stop() {
    if (worker) {
        worker.terminate();
        worker = null;
        $("solve").textContent = "计算最少步数";
        $("solve").classList.remove("running");
    }
}
function changed() {
    if (JSON.stringify(board) !== JSON.stringify(previousBoard)) {
        undoHistory.push(previousBoard);
        if (undoHistory.length > 20) undoHistory.shift();
        previousBoard = structuredClone(board);
    }
    stop();
    solution = null;
    step = 0;
    lowerBound = 0;
    $("result").textContent = "局面已更新，可以开始计算。";
    $("replay").hidden = true;
    save();
    render();
}
function displayedRobots() {
    const p = [...board.robots];
    if (solution)
        for (const m of solution.moves.slice(0, step)) p[m.robot] = m.to;
    return p;
}
function render() {
    const n = board.size,
        robots = displayedRobots(),
        S = 40,
        pad = 22,
        svg = [];
    svg.push(
        `<svg viewBox="0 0 ${n * S + pad} ${n * S + pad}" role="grid" aria-label="棋盘，使用方向键选择格子，回车放置；编辑墙壁时 Shift 加方向键切换墙壁"><rect x="${pad}" y="${pad}" width="${n * S}" height="${n * S}" fill="#f8fafb"/>`,
    );
    for (let x = 0; x < n; x++)
        svg.push(
            `<text x="${pad + x * S + S / 2}" y="13" text-anchor="middle" fill="#afbfca" font-size="10">${x + 1}</text><text x="9" y="${pad + x * S + S * 0.6}" text-anchor="middle" fill="#afbfca" font-size="10">${x + 1}</text>`,
        );
    for (let p = 0; p < n * n; p++) {
        const x = pad + (p % n) * S,
            y = pad + Math.floor(p / n) * S;
        svg.push(
            `<rect x="${x}" y="${y}" width="${S}" height="${S}" fill="${board.blocked.includes(p) ? "#263b48" : ((p % n) + Math.floor(p / n)) % 2 ? "#f0f4f7" : "#f8fafb"}" stroke="#d9e1e6" stroke-width=".7" role="gridcell" tabindex="${p === 0 ? "0" : "-1"}" data-cell="${p}" aria-label="第 ${Math.floor(p / n) + 1} 行，第 ${(p % n) + 1} 列${robots.includes(p) ? "，" + COLORS[robots.indexOf(p)] + "机器人" : ""}${p === board.target.cell ? "，目标" : ""}"/>`,
        );
    }
    for (const goal of board.goals ?? []) {
        const x = pad + (goal.cell % n) * S + S / 2,
            y = pad + Math.floor(goal.cell / n) * S + S / 2;
        svg.push(
            `<text x="${x}" y="${y + 6}" text-anchor="middle" fill="${goal.robot < 0 ? "#394554" : palette[goal.robot]}" font-size="21" opacity="${goal.cell === board.target.cell ? 1 : 0.65}" pointer-events="none">${targetGlyph(goal.shape)}</text>`,
        );
    }
    const t = board.target.cell,
        tx = pad + (t % n) * S + S / 2,
        ty = pad + Math.floor(t / n) * S + S / 2,
        c = board.target.robot < 0 ? "#394554" : palette[board.target.robot];
    svg.push(
        `<g pointer-events="none"><circle cx="${tx}" cy="${ty}" r="13" fill="none" stroke="${c}" stroke-width="3"/><circle cx="${tx}" cy="${ty}" r="5" fill="${c}"/></g>`,
    );
    for (let p = 0; p < n * n; p++)
        for (let d = 0; d < 4; d++) {
            const q = neighbor(p, d, n);
            if (q >= 0 && q < p) continue;
            const x = pad + (p % n) * S,
                y = pad + Math.floor(p / n) * S,
                ends = [
                    [x, y, x + S, y],
                    [x + S, y, x + S, y + S],
                    [x, y + S, x + S, y + S],
                    [x, y, x, y + S],
                ][d];
            if (board.walls[p] & DIRS[d].bit)
                svg.push(
                    `<line x1="${ends[0]}" y1="${ends[1]}" x2="${ends[2]}" y2="${ends[3]}" stroke="#263b48" stroke-width="4" stroke-linecap="round" pointer-events="none"/>`,
                );
        }
    if (solution && step > 0) {
        svg.push(
            `<defs>${palette.map((color, i) => `<marker id="arrow-${i}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="${color}"/></marker>`).join("")}</defs>`,
        );
        for (const m of trajectory(solution.moves, step, n, pad, S)) {
            const color = palette[m.robot],
                cx = (m.x1 + m.x2) / 2,
                cy = (m.y1 + m.y2) / 2;
            svg.push(
                `<g pointer-events="none" data-trace-step="${m.number}"><line x1="${m.x1}" y1="${m.y1}" x2="${m.x2}" y2="${m.y2}" stroke="${color}" stroke-width="${m.current ? 5 : 2.8}" opacity="${m.current ? 1 : 0.62}" stroke-linecap="round" marker-end="url(#arrow-${m.robot})"/><circle cx="${cx}" cy="${cy}" r="9" fill="#fff" stroke="${color}" stroke-width="${m.current ? 2.5 : 1}"/><text x="${cx}" y="${cy + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="${color}">${m.number}</text></g>`,
            );
        }
    }
    robots.forEach((p, i) => {
        const x = pad + (p % n) * S + S / 2,
            y = pad + Math.floor(p / n) * S + S / 2;
        svg.push(
            `<g pointer-events="none"><rect x="${x - 12}" y="${y - 12}" width="24" height="24" rx="7" fill="${palette[i]}" stroke="#fff" stroke-width="2"/><text x="${x}" y="${y + 4}" fill="${i === 3 ? "#3e310b" : "#fff"}" text-anchor="middle" font-size="11" font-weight="700">${["R", "B", "G", "Y", "S"][i]}</text></g>`,
        );
    });
    if (tool === "wall")
        for (let p = 0; p < n * n; p++)
            for (let d = 0; d < 4; d++) {
                const q = neighbor(p, d, n);
                if (
                    q < 0 ||
                    q < p ||
                    board.blocked.includes(p) ||
                    board.blocked.includes(q)
                )
                    continue;
                const x = pad + (p % n) * S,
                    y = pad + Math.floor(p / n) * S,
                    e = [
                        [x, y, x + S, y],
                        [x + S, y, x + S, y + S],
                        [x, y + S, x + S, y + S],
                        [x, y, x, y + S],
                    ][d];
                svg.push(
                    `<line class="wall-hit" data-wall="${p}:${d}" x1="${e[0]}" y1="${e[1]}" x2="${e[2]}" y2="${e[3]}" stroke="transparent" stroke-width="13"/>`,
                );
            }
    svg.push("</svg>");
    $("board").innerHTML = svg.join("");
    $("undo").disabled = !undoHistory.length;
    $("count").value = String(board.robots.length);
    $("target-color").value = String(board.target.robot);
    for (const option of $("target-color").options)
        option.disabled = Number(option.value) >= board.robots.length;
    $("tools").innerHTML = board.robots
        .map(
            (_, i) =>
                `<button class="tool ${tool === "robot:" + i ? "active" : ""}" data-tool="robot:${i}" aria-pressed="${tool === "robot:" + i}"><span class="swatch" style="--color:${palette[i]}"></span>${COLORS[i]}色</button>`,
        )
        .join("");
    for (const [id, mode] of [
        ["edit-walls", "wall"],
        ["place-target", "target"],
    ]) {
        $(id).classList.toggle("active", tool === mode);
        $(id).setAttribute("aria-pressed", String(tool === mode));
    }
    $("hint").textContent =
        tool === "wall"
            ? "点击格子边缘添加 / 移除墙壁；键盘使用 Shift + 方向键。"
            : tool === "target"
              ? "点击格子放置目标；目标格允许放置机器人。"
              : "";
    $("hint").hidden = !$("hint").textContent;

    $("require-turn").checked = !!board.rules?.requireTurn;
    $("rotate-board").disabled = board.size !== 16;
    const selectedGoal = board.goals?.find(
        (g) => g.cell === board.target.cell && g.robot === board.target.robot,
    );
    const custom = customTarget || !selectedGoal;
    $("target-modes").hidden = !board.goals?.length;
    $("goal-picker").hidden = custom || !board.goals?.length;
    $("custom-target-controls").hidden = !custom;
    $("preset-target").classList.toggle("active", !custom);
    $("custom-target").classList.toggle("active", custom);
    $("preset-target").setAttribute("aria-pressed", String(!custom));
    $("custom-target").setAttribute("aria-pressed", String(custom));
    $("current-target").textContent = !custom
        ? `本轮目标：${selectedGoal.robot < 0 ? "任意颜色" : COLORS[selectedGoal.robot] + "色"} · ${SHAPES[selectedGoal.shape]}`
        : `自定义目标：${board.target.robot < 0 ? "任意颜色" : COLORS[board.target.robot] + "色"} · (${(board.target.cell % n) + 1}, ${Math.floor(board.target.cell / n) + 1})`;
    const shapes = ["circle", "triangle", "square", "hex", "vortex"];
    $("goal-options").innerHTML = [0, 1, 2, 3, -1]
        .map((robot) => {
            const goals = (board.goals ?? [])
                .filter((g) => g.robot === robot)
                .sort(
                    (a, b) => shapes.indexOf(a.shape) - shapes.indexOf(b.shape),
                );
            if (!goals.length) return "";
            return `<div class="goal-color-row"><span>${robot < 0 ? "任意" : COLORS[robot]}</span><div class="goal-buttons">${goals.map((g) => `<button data-goal="${g.id}" aria-label="${robot < 0 ? "任意" : COLORS[robot]} ${SHAPES[g.shape]}" aria-pressed="${!custom && selectedGoal?.id === g.id}" class="${!custom && selectedGoal?.id === g.id ? "active" : ""}" style="--goal-color:${robot < 0 ? "#394554" : palette[robot]}" ${robot >= board.robots.length ? "disabled" : ""}><b>${targetGlyph(g.shape)}</b><small>${SHAPES[g.shape]}</small></button>`).join("")}</div></div>`;
        })
        .join("");
    if (solution) {
        $("step-range").max = String(solution.moves.length);
        $("step-range").value = String(step);
        $("step-label").textContent = `${step} / ${solution.moves.length} 步`;
        $("previous").disabled = step === 0;
        $("next").disabled = step === solution.moves.length;
        $("moves").innerHTML = solution.moves
            .map(
                (m, i) =>
                    `<li><button data-step="${i + 1}" class="${i + 1 === step ? "selected" : ""}"><span>${String(i + 1).padStart(2, "0")}</span><span class="swatch" style="--color:${palette[m.robot]}"></span>${COLORS[m.robot]} ${["↑", "→", "↓", "←"][m.direction]}<small>(${(m.to % n) + 1}, ${Math.floor(m.to / n) + 1})</small></button></li>`,
            )
            .join("");
    }
}
function editCell(p) {
    if (solution && step > 0) {
        rewind();
        notify("已回到起点，可以编辑局面。");
        return;
    }
    if (board.blocked.includes(p)) return notify("中央区域不能放置棋子。");
    if (tool === "target") {
        board.target = { cell: p, robot: board.target.robot };
    } else if (tool.startsWith("robot:")) {
        const r = Number(tool.split(":")[1]);
        if (board.robots.some((v, i) => i !== r && v === p))
            return notify("这个格子已有其他机器人。");
        board.robots[r] = p;
    } else return;
    changed();
}
function editWall(p, d) {
    if (solution && step > 0) {
        rewind();
        notify("已回到起点，可以编辑局面。");
        return;
    }
    const q = neighbor(p, d, board.size);
    if (q < 0 || board.blocked.includes(p) || board.blocked.includes(q))
        return notify("外边界和禁入格的墙壁不能移除。");
    wall(board, p, d, !(board.walls[p] & DIRS[d].bit));
    delete board.layout;
    changed();
}
function startSolve() {
    if (worker) {
        stop();
        $("result").textContent =
            `已停止 · 尚未证明最优。至少需要 ${lowerBound} 步。`;
        return;
    }
    try {
        validateBoard(board);
    } catch (e) {
        notify(e.message);
        return;
    }
    solution = null;
    step = 0;
    lowerBound = 0;
    $("replay").hidden = true;
    render();
    worker = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
    });
    $("solve").textContent = "停止搜索 ■";
    $("solve").classList.add("running");
    $("result").textContent = "正在计算最少步数…";
    worker.onmessage = ({ data }) => {
        if (data.type === "progress") {
            lowerBound = data.progress.lowerBound;
            $("result").textContent =
                `正在检查 ${lowerBound} 步解… 已搜索 ${data.progress.nodes.toLocaleString()} 个节点。`;
            return;
        }
        stop();
        if (data.type === "error") {
            $("result").textContent = data.message;
            return;
        }
        const r = data.result;
        lowerBound = r.lowerBound;
        if (r.status === "optimal") {
            solution = r;
            step = r.moves.length;
            $("result").innerHTML =
                `<div class="result-line"><span class="optimal">✓ 已证明最优</span><span><strong>${r.moves.length}</strong>步</span><small>${(r.elapsedMs / 1000).toFixed(2)} 秒</small></div>`;
            $("replay").hidden = false;
            render();
        } else if (r.status === "unsolvable") {
            $("result").textContent =
                "无解：目标机器人无法到达目标所在的连通区域。";
        } else {
            $("result").textContent =
                `搜索达到限制，尚未证明最优。至少需要 ${r.lowerBound} 步。可增加搜索时间后重试。`;
        }
    };
    worker.onerror = () => {
        stop();
        $("result").textContent = "求解器启动失败，请刷新页面重试。";
    };
    worker.postMessage({
        board,
        options: { maxMs: Number($("timeout").value), maxDepth: 80 },
    });
}
function loadBoard(value) {
    const b = validateBoard(value);
    board = b;
    customTarget = false;
    tool = "robot:0";
    changed();
}
function rewind() {
    step = 0;
    render();
}
function setStep(value) {
    if (!solution) return;
    step = Math.max(0, Math.min(solution.moves.length, value));
    render();
}
function renderAssembly() {
    $("assembly-slots").innerHTML = [0, 1, 3, 2]
        .map((slot) => {
            const tile = tiles.find((t) => t.id === draftLayout[slot]);
            return `<button class="assembly-slot ${slot === activeSlot ? "selected" : ""}" data-slot="${slot}" aria-pressed="${slot === activeSlot}"><span>${SLOT_NAMES[slot]} · ${tile.id} ${GROUPS[tile.group].name}</span>${tileSvg(tile, slot)}</button>`;
        })
        .join("");
    $("assembly-slot-label").textContent =
        `正在设置：${SLOT_NAMES[activeSlot]}`;
    $("tile-catalog").innerHTML = Object.entries(GROUPS)
        .map(
            ([group, info]) =>
                `<section class="tile-group"><h3 style="color:${info.color}">${info.name} · ${group} 组</h3><div class="tile-options">${tiles
                    .filter((t) => t.group === group && t.supported)
                    .map(
                        (t) =>
                            `<button class="tile-option ${draftLayout[activeSlot] === t.id ? "selected" : ""}" data-tile="${t.id}" aria-pressed="${draftLayout[activeSlot] === t.id}">${tileSvg(t, activeSlot)}<span>${t.id}${draftLayout.includes(t.id) ? " · 已选" : ""}</span></button>`,
                    )
                    .join("")}</div></section>`,
        )
        .join("");
}
function init() {
    render();
    $("undo").onclick = () => {
        if (!undoHistory.length) return;
        const value = undoHistory.pop();
        previousBoard = structuredClone(value);
        loadBoard(value);
    };
    $("step-range").oninput = (e) => setStep(Number(e.target.value));
    const chooseTool = (value) => {
        tool = tool === value && value === "wall" ? "robot:0" : value;
        step = 0;
        render();
    };
    $("edit-walls").onclick = () => chooseTool("wall");
    $("place-target").onclick = () => chooseTool("target");
    const applyRandom = (action) => {
        try {
            loadBoard(action());
        } catch (error) {
            notify(error.message);
        }
    };
    $("next-round").onclick = () => {
        applyRandom(() => nextRound(board, solution));
    };
    $("new-round").onclick = () =>
        applyRandom(() => randomRobots(randomTarget(board)));
    $("random-physical").onclick = () =>
        applyRandom(() => randomPhysical(tiles, board));
    $("random-artificial").onclick = () =>
        applyRandom(() => randomArtificial(board));
    $("random-robots").onclick = () => applyRandom(() => randomRobots(board));
    $("random-target").onclick = () => {
        const custom =
            customTarget ||
            !board.goals?.some(
                (g) =>
                    g.cell === board.target.cell &&
                    g.robot === board.target.robot,
            );
        if (!custom) return applyRandom(() => randomTarget(board));
        const input = structuredClone(board);
        delete input.goals;
        try {
            board.target = randomTarget(input).target;
            customTarget = true;
            changed();
        } catch (error) {
            notify(error.message);
        }
    };
    $("show-all").onclick = () => setStep(solution?.moves.length ?? 0);
    $("tools").onclick = (e) => {
        const b = e.target.closest("[data-tool]");
        if (b) {
            chooseTool(b.dataset.tool);
        }
    };
    $("board").onclick = (e) => {
        const w = e.target.closest("[data-wall]");
        if (w) {
            const [p, d] = w.dataset.wall.split(":").map(Number);
            editWall(p, d);
            return;
        }
        const cell = e.target.closest("[data-cell]");
        if (cell) editCell(Number(cell.dataset.cell));
    };
    $("board").onkeydown = (e) => {
        const cell = e.target.closest("[data-cell]");
        if (!cell) return;
        const p = Number(cell.dataset.cell),
            d = ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].indexOf(
                e.key,
            );
        if (d >= 0) {
            e.preventDefault();
            if (e.shiftKey && tool === "wall") {
                editWall(p, d);
                $("board").querySelector(`[data-cell="${p}"]`)?.focus();
            } else {
                const q = neighbor(p, d, board.size);
                if (q >= 0) {
                    cell.setAttribute("tabindex", "-1");
                    const next = $("board").querySelector(`[data-cell="${q}"]`);
                    next.setAttribute("tabindex", "0");
                    next.focus();
                }
            }
        } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            editCell(p);
            $("board").querySelector(`[data-cell="${p}"]`)?.focus();
        }
    };
    $("target-color").onchange = (e) => {
        board.target = {
            cell: board.target.cell,
            robot: Number(e.target.value),
        };
        changed();
    };
    $("count").onchange = (e) => {
        const count = Number(e.target.value);
        const nextRobots = board.robots.slice(0, count);
        while (nextRobots.length < count) {
            const free = board.walls.findIndex(
                (_, p) => !board.blocked.includes(p) && !nextRobots.includes(p),
            );
            if (free < 0) {
                notify("没有足够的可用格子。");
                render();
                return;
            }
            nextRobots.push(free);
        }
        board.robots = nextRobots;
        if (board.target.robot >= count) board.target.robot = 0;
        if (tool.startsWith("robot:") && Number(tool.split(":")[1]) >= count)
            tool = "robot:0";
        changed();
    };
    $("preset").onclick = () => {
        try {
            validateLayout(board.layout, tiles);
            draftLayout = [...board.layout];
        } catch {
            draftLayout = [...DEFAULT_LAYOUT];
        }
        activeSlot = 0;
        renderAssembly();
        $("assembly-dialog").showModal();
    };
    $("close-assembly").onclick = $("cancel-assembly").onclick = () =>
        $("assembly-dialog").close();
    $("assembly-slots").onclick = (e) => {
        const button = e.target.closest("[data-slot]");
        if (button) {
            activeSlot = Number(button.dataset.slot);
            renderAssembly();
        }
    };
    $("tile-catalog").onclick = (e) => {
        const button = e.target.closest("[data-tile]");
        if (button) {
            draftLayout = replaceTile(
                draftLayout,
                activeSlot,
                button.dataset.tile,
                tiles,
            );
            renderAssembly();
        }
    };
    $("cycle-face").onclick = () => {
        const id = draftLayout[activeSlot];
        draftLayout = replaceTile(
            draftLayout,
            activeSlot,
            id[0] + ((Number(id[1]) % 3) + 1),
            tiles,
        );
        renderAssembly();
    };
    $("rotate-layout").onclick = () => {
        draftLayout = [
            draftLayout[3],
            draftLayout[0],
            draftLayout[1],
            draftLayout[2],
        ];
        activeSlot = (activeSlot + 1) % 4;
        renderAssembly();
    };
    $("apply-assembly").onclick = () => {
        try {
            loadBoard(assemble(draftLayout, tiles, board));
            $("assembly-dialog").close();
            notify("棋盘已拼装，接着放置机器人并选择目标。");
        } catch (error) {
            notify(error.message);
        }
    };
    $("rotate-board").onclick = () => loadBoard(rotateBoard(board));
    const selectGoal = (goal) => {
        if (!goal || goal.robot >= board.robots.length) return;
        board.target = { ...goal };
        customTarget = false;
        tool = "robot:0";
        changed();
    };
    $("goal-options").onclick = (e) => {
        const button = e.target.closest("[data-goal]");
        if (button)
            selectGoal(board.goals?.find((g) => g.id === button.dataset.goal));
    };
    $("preset-target").onclick = () =>
        selectGoal(
            board.goals?.find(
                (g) =>
                    g.cell === board.target.cell &&
                    g.robot === board.target.robot,
            ) ?? board.goals?.find((g) => g.robot < board.robots.length),
        );
    $("custom-target").onclick = () => {
        customTarget = true;
        step = 0;
        tool = "target";
        render();
    };
    $("require-turn").onchange = (e) => {
        board.rules = { requireTurn: e.target.checked };
        changed();
    };
    $("empty").onclick = () => loadBoard(emptyBoard());
    $("solve").onclick = startSolve;
    $("previous").onclick = () => setStep(step - 1);
    $("next").onclick = () => setStep(step + 1);
    $("rewind").onclick = rewind;
    $("moves").onclick = (e) => {
        const b = e.target.closest("[data-step]");
        if (b) setStep(Number(b.dataset.step));
    };
    $("export").onclick = () => {
        const url = URL.createObjectURL(
                new Blob([JSON.stringify(board, null, 2)], {
                    type: "application/json",
                }),
            ),
            a = document.createElement("a");
        a.href = url;
        a.download = "ricochet-board.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    $("import").onchange = async (e) => {
        const file = e.target.files[0];
        try {
            if (file) {
                if (file.size > 100000)
                    throw Error("文件过大，请选择棋盘 JSON。");
                loadBoard(JSON.parse(await file.text()));
                notify("棋盘已导入。");
            }
        } catch (err) {
            notify("导入失败：" + err.message);
        }
        e.target.value = "";
    };
    const context = document.modelContext;
    if (context?.registerTool) {
        const life = new AbortController();
        for (const t of [
            {
                name: "read_ricochet_board",
                description:
                    "Read the current board and optimal search result.",
                inputSchema: {
                    type: "object",
                    properties: {},
                    additionalProperties: false,
                },
                annotations: { readOnlyHint: true },
                execute: () => ({
                    board: structuredClone(board),
                    result: solution,
                }),
            },
            {
                name: "set_ricochet_board",
                description:
                    "Validate and replace the current board, saving it in this browser and clearing the prior solution.",
                inputSchema: {
                    type: "object",
                    properties: { board: { type: "object" } },
                    required: ["board"],
                    additionalProperties: false,
                },
                execute: (input) => {
                    loadBoard(input.board);
                    return { board: structuredClone(board) };
                },
            },
        ]) {
            try {
                Promise.resolve(
                    context.registerTool(t, { signal: life.signal }),
                ).catch(() => {});
            } catch {}
        }
        window.addEventListener("pagehide", () => life.abort(), { once: true });
    }
}
init();
