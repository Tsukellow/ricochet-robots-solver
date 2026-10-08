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
    slide,
    isGoal,
    afterTurn,
} from "./engine.js";
import {
    assemble,
    replaceTile,
    rotateBoard,
    validateLayout,
    tileSvg,
    targetShape,
    targetIcon,
    DEFAULT_LAYOUT,
    SLOT_NAMES,
    GROUPS,
    SHAPES,
} from "./assembly.js";
const $ = (id) => document.getElementById(id),
    palette = ["#da4d50", "#397ac7", "#2a9776", "#e2ac29", "#8b96a7"],
    LETTERS = ["R", "B", "G", "Y", "S"],
    DIRECTION_NAMES = ["向上", "向右", "向下", "向左"],
    KEYS = ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"],
    S = 40,
    PAD = 3,
    reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const { tiles } = await fetch("./tiles.json").then((r) => r.json());
function preset() {
    return assemble(DEFAULT_LAYOUT, tiles);
}
let draftLayout = [...DEFAULT_LAYOUT],
    activeSlot = 0;
// The board holds the round's starting position; the player's moves are applied on top of it.
let board = preset(),
    tool = null,
    customTarget = false,
    toastTimer;
let played = [],
    selected = null,
    phase = "play",
    message = "",
    hint = null,
    lastMove = null,
    swiped = false,
    drag = null;
let optimal = null,
    optimalStatus = "idle",
    optimalJob = null,
    hintJob = null,
    step = 0,
    roundId = 0,
    timeoutMs = 10000;
// Each round opens with a thinking phase on a clean board. As in the board game, the countdown
// only starts when someone calls a move count (the 开始倒计时 button).
let thinkLimit = 60,
    countdownStart = null,
    thinkTimer = null;
try {
    const saved = localStorage.getItem("ricochet-lab-v1");
    if (saved) board = validateBoard(JSON.parse(saved));
    if (localStorage.getItem("ricochet-default-rules-v2") !== "applied") {
        board.rules = { ...board.rules, requireTurn: false };
        localStorage.setItem("ricochet-lab-v1", JSON.stringify(board));
        localStorage.setItem("ricochet-default-rules-v2", "applied");
    }
    const limit = Number(localStorage.getItem("ricochet-timeout"));
    if ([10000, 30000, 120000].includes(limit)) timeoutMs = limit;
    const think = localStorage.getItem("ricochet-think");
    if (think !== null && [30, 60, 120].includes(Number(think)))
        thinkLimit = Number(think);
} catch {
    notify("已载入示例；此前保存的棋盘无法读取。");
}
let previousBoard = structuredClone(board);
const undoHistory = [];

function notify(text) {
    $("toast").textContent = text;
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
const robotName = (r) => (r < 0 ? "任意机器人" : `${COLORS[r]}色机器人`);
// Cells are only named for screen readers; the board itself carries no coordinates.
const cellName = (p) =>
    `第 ${Math.floor(p / board.size) + 1} 行第 ${(p % board.size) + 1} 列`;
const clock = (seconds) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const limitName = () =>
    timeoutMs >= 60000 ? `${timeoutMs / 60000} 分钟` : `${timeoutMs / 1000} 秒`;
function positions(moves = played) {
    const p = [...board.robots];
    for (const m of moves) p[m.robot] = m.to;
    return p;
}
function turnsAfter(moves) {
    const t = board.robots.map(() => 0);
    for (const m of moves) t[m.robot] = afterTurn(t[m.robot], m.direction);
    return t;
}
function currentGoal() {
    return board.goals?.find(
        (g) => g.cell === board.target.cell && g.robot === board.target.robot,
    );
}

// Solver runs in a worker; each job reports once and is discarded.
function solveJob(input, onDone) {
    const worker = new Worker(new URL("./worker.js", import.meta.url), {
            type: "module",
        }),
        job = { worker, done: false };
    const finish = (result) => {
        worker.terminate();
        job.done = true;
        onDone(result);
    };
    worker.onmessage = ({ data }) => {
        if (data.type === "progress") return;
        finish(
            data.type === "error"
                ? { status: "error", message: data.message }
                : data.result,
        );
    };
    worker.onerror = () =>
        finish({
            status: "error",
            message: "求解器启动失败，请刷新页面重试。",
        });
    worker.postMessage({
        board: input,
        options: { maxMs: timeoutMs, maxDepth: 80 },
    });
    return job;
}
function cancel(job) {
    if (job && !job.done) job.worker.terminate();
    return null;
}
function solveRound() {
    optimalJob = cancel(optimalJob);
    const id = roundId;
    optimal = null;
    optimalStatus = "running";
    optimalJob = solveJob(structuredClone(board), (result) => {
        if (id !== roundId) return;
        optimalJob = null;
        optimal = result;
        optimalStatus = result.status;
        if (phase === "answer" && result.status === "optimal")
            step = result.moves.length;
        render();
    });
}
function stopThinking() {
    clearInterval(thinkTimer);
    thinkTimer = null;
}
function countdownLeft() {
    return thinkLimit - (Date.now() - countdownStart) / 1000;
}
function tickThinking() {
    if (phase !== "think") return stopThinking();
    if (countdownStart !== null && countdownLeft() <= 0) return startInput(true);
    renderClock();
}
function startCountdown() {
    if (phase !== "think" || countdownStart !== null) return;
    countdownStart = Date.now();
    thinkTimer = setInterval(tickThinking, 250);
    render();
}
function startThinking() {
    stopThinking();
    phase = "think";
    selected = null;
    countdownStart = null;
}
function startInput(timeUp = false) {
    if (phase !== "think") return;
    stopThinking();
    phase = "play";
    selected = board.target.robot >= 0 ? board.target.robot : null;
    message = timeUp ? "时间到，开始输入解法。" : "";
    render();
}
function startRound() {
    roundId++;
    hintJob = cancel(hintJob);
    optimalJob = cancel(optimalJob);
    played = [];
    phase = "play";
    message = "";
    hint = null;
    lastMove = null;
    step = 0;
    selected = board.target.robot >= 0 ? board.target.robot : null;
    stopThinking();
    if (tool === null) startThinking();
    optimal = null;
    optimalStatus = "idle";
    if (tool === null) {
        try {
            validateBoard(board);
            solveRound();
        } catch (e) {
            optimal = { status: "error", message: e.message };
            optimalStatus = "error";
        }
    }
    render();
}
function changed() {
    if (JSON.stringify(board) !== JSON.stringify(previousBoard)) {
        undoHistory.push(previousBoard);
        if (undoHistory.length > 20) undoHistory.shift();
        previousBoard = structuredClone(board);
    }
    save();
    startRound();
}
function loadBoard(value) {
    board = validateBoard(value);
    customTarget = false;
    tool = null;
    changed();
}
function setTool(value, toggle = true) {
    tool = toggle && tool === value ? null : value;
    startRound();
}

function move(r, d) {
    if (tool !== null || phase !== "play" || r === null) return;
    const pos = positions(),
        from = pos[r],
        to = slide(board, pos, r, d);
    selected = r;
    hintJob = cancel(hintJob);
    if (to === from) {
        message = `${robotName(r)}${DIRECTION_NAMES[d]}走不动。`;
        render();
        return;
    }
    played.push({ robot: r, direction: d, from, to });
    $("announce").textContent = `${robotName(r)}${DIRECTION_NAMES[d]}，停在${cellName(to)}。`;
    lastMove = { robot: r, from, to };
    hint = null;
    message = "";
    if (isGoal(board, positions(), turnsAfter(played))) phase = "won";
    render();
}
function undoMove() {
    if (!played.length || (phase !== "play" && phase !== "won")) return;
    hintJob = cancel(hintJob);
    const m = played.pop();
    selected = m.robot;
    phase = "play";
    hint = null;
    message = "";
    render();
}
function restart() {
    hintJob = cancel(hintJob);
    stopThinking();
    played = [];
    phase = "play";
    hint = null;
    message = "";
    selected = board.target.robot >= 0 ? board.target.robot : null;
    render();
}
function useHint(m) {
    hint = m;
    selected = m.robot;
    message = `提示：${robotName(m.robot)}${DIRECTION_NAMES[m.direction]}。`;
    render();
}
function requestHint() {
    if (phase !== "play" || hintJob) return;
    if (!played.length && optimalStatus === "optimal")
        return useHint(optimal.moves[0]);
    const input = structuredClone(board),
        id = roundId,
        count = played.length;
    input.robots = positions();
    message = "正在计算提示…";
    hintJob = solveJob(input, (result) => {
        hintJob = null;
        if (id !== roundId || count !== played.length || phase !== "play")
            return render();
        if (result.status === "optimal" && result.moves.length)
            return useHint(result.moves[0]);
        message =
            result.status === "unsolvable"
                ? "从当前位置已经到不了目标，可以撤销几步或重来。"
                : result.status === "error"
                  ? result.message
                  : `没能在 ${limitName()}内算出提示，可以在设置里延长求解时间。`;
        render();
    });
    render();
}
function showAnswer() {
    hintJob = cancel(hintJob);
    stopThinking();
    phase = "answer";
    hint = null;
    message = "";
    if (optimalStatus === "optimal") step = optimal.moves.length;
    render();
}
function goNext() {
    const robots =
        phase === "won"
            ? positions()
            : phase === "answer" && optimalStatus === "optimal"
              ? positions(optimal.moves)
              : [...board.robots];
    try {
        loadBoard(nextRound(board, robots));
    } catch (error) {
        notify(error.message);
    }
}
function setStep(value) {
    if (optimalStatus !== "optimal") return;
    step = Math.max(0, Math.min(optimal.moves.length, value));
    render();
}

function goalText() {
    const goal = currentGoal(),
        color = board.target.robot < 0 ? "#394554" : palette[board.target.robot],
        icon = targetIcon(goal?.shape ?? null, color),
        place = goal ? `${SHAPES[goal.shape]}目标` : "目标格";
    return `<span class="goal-glyph">${icon}</span><span>把${robotName(board.target.robot)}移到${place}${board.rules?.requireTurn ? "，途中至少转弯一次" : ""}</span>`;
}
// Only results and events go here; how to play lives behind the ? button.
function statusText() {
    if (tool) return "";
    if (message) return message;
    if (phase === "won") {
        if (optimalStatus === "optimal")
            return played.length === optimal.moves.length
                ? "到达目标，和最优解一样少。"
                : `到达目标。最优解 ${optimal.moves.length} 步。`;
        return optimalStatus === "running"
            ? "到达目标。正在计算最优步数…"
            : "到达目标。";
    }
    if (phase === "answer") {
        if (optimalStatus === "running") return "正在计算最优解…";
        if (optimalStatus === "unsolvable") return "这一局无解。";
        if (optimalStatus === "error") return optimal.message;
        if (optimalStatus === "optimal") {
            if (step === 0 || step === optimal.moves.length) return "";
            const m = optimal.moves[step - 1];
            return `第 ${step} 步：${robotName(m.robot)}${DIRECTION_NAMES[m.direction]}。`;
        }
        return `没能在 ${limitName()}内算出最优解。可以再算一次，或在设置里延长求解时间。`;
    }
    if (optimalStatus === "unsolvable") return "这一局无解，换个目标再玩。";
    if (optimalStatus === "error") return optimal.message;
    return "";
}
function actionList() {
    if (tool) return [{ action: "finish-edit", label: "完成编辑", primary: true }];
    const next = {
        action: "next",
        label: "下一局",
        primary: true,
        title: "机器人留在现在的位置，换一个新目标",
    };
    if (phase === "won")
        return [{ action: "answer", label: "看最优解" }, next];
    if (phase === "answer") {
        if (optimalStatus === "optimal")
            return [
                { action: "prev", label: "上一步", disabled: step === 0 },
                {
                    action: "forward",
                    label: "下一步",
                    disabled: step === optimal.moves.length,
                },
                { action: "restart", label: "重新挑战" },
                next,
            ];
        const back = { action: "resume", label: "返回游戏" };
        return optimalStatus === "running"
            ? [back, next]
            : [{ action: "resolve", label: "再算一次" }, back, next];
    }
    if (optimalStatus === "unsolvable")
        return [{ ...next, label: "换个目标", title: "" }];
    if (phase === "think")
        return [
            { action: "answer", label: "看答案" },
            ...(countdownStart === null
                ? [{ action: "countdown", label: "开始倒计时" }]
                : []),
            { action: "start-input", label: "开始输入解法", primary: true },
        ];
    return [
        { action: "undo-move", label: "撤销", disabled: !played.length },
        { action: "restart", label: "重来", disabled: !played.length },
        {
            action: "hint",
            label: hintJob ? "计算中" : "提示",
            disabled: !!hintJob || optimalStatus === "error",
        },
        {
            action: "answer",
            label: "看答案",
            disabled: optimalStatus === "error",
        },
    ];
}

function boardSvg() {
    const n = board.size,
        editing = tool !== null,
        answer = phase === "answer" && optimalStatus === "optimal",
        robots = editing
            ? board.robots
            : answer
              ? positions(optimal.moves.slice(0, step))
              : positions(),
        svg = [];
    svg.push(
        `<svg viewBox="0 0 ${n * S + 2 * PAD} ${n * S + 2 * PAD}" ${editing ? 'role="grid" aria-label="棋盘编辑，方向键选择格子，回车放置；编辑墙壁时 Shift 加方向键切换墙壁"' : 'role="img" aria-label="棋盘"'}><rect x="${PAD}" y="${PAD}" width="${n * S}" height="${n * S}" fill="#f8fafb"/>`,
    );
    for (let p = 0; p < n * n; p++) {
        const x = PAD + (p % n) * S,
            y = PAD + Math.floor(p / n) * S,
            fill = board.blocked.includes(p)
                ? "#263b48"
                : ((p % n) + Math.floor(p / n)) % 2
                  ? "#f0f4f7"
                  : "#f8fafb",
            focus = editing
                ? ` role="gridcell" tabindex="${p === 0 ? "0" : "-1"}" aria-label="${cellName(p)}${robots.includes(p) ? "，" + robotName(robots.indexOf(p)) : ""}${p === board.target.cell ? "，目标" : ""}"`
                : "";
        svg.push(
            `<rect x="${x}" y="${y}" width="${S}" height="${S}" fill="${fill}" stroke="#d9e1e6" stroke-width=".7" data-cell="${p}"${focus}/>`,
        );
    }
    for (const goal of board.goals ?? []) {
        const x = PAD + (goal.cell % n) * S + S / 2,
            y = PAD + Math.floor(goal.cell / n) * S + S / 2;
        svg.push(
            targetShape(
                goal.shape,
                x,
                y,
                goal.robot < 0 ? "#394554" : palette[goal.robot],
                goal.cell === board.target.cell ? 1 : editing ? 0.45 : 0.2,
            ),
        );
    }
    const t = board.target.cell,
        tx = PAD + (t % n) * S + S / 2,
        ty = PAD + Math.floor(t / n) * S + S / 2,
        c = board.target.robot < 0 ? "#394554" : palette[board.target.robot];
    svg.push(
        `<g pointer-events="none" class="${phase === "won" && !editing ? "target reached" : "target"}"><circle cx="${tx}" cy="${ty}" r="16" fill="${c}" opacity="0" class="target-glow"/>${currentGoal() ? `<circle cx="${tx}" cy="${ty}" r="15" fill="none" stroke="${c}" stroke-width="2.5"/>` : `<circle cx="${tx}" cy="${ty}" r="13" fill="none" stroke="${c}" stroke-width="3"/><circle cx="${tx}" cy="${ty}" r="5" fill="${c}"/>`}</g>`,
    );
    for (let p = 0; p < n * n; p++)
        for (let d = 0; d < 4; d++) {
            const q = neighbor(p, d, n);
            if (q >= 0 && q < p) continue;
            const x = PAD + (p % n) * S,
                y = PAD + Math.floor(p / n) * S,
                e = [
                    [x, y, x + S, y],
                    [x + S, y, x + S, y + S],
                    [x, y + S, x + S, y + S],
                    [x, y, x, y + S],
                ][d];
            if (board.walls[p] & DIRS[d].bit)
                svg.push(
                    `<line x1="${e[0]}" y1="${e[1]}" x2="${e[2]}" y2="${e[3]}" stroke="#263b48" stroke-width="4" stroke-linecap="round" pointer-events="none"/>`,
                );
        }
    const center = (p) => [
        PAD + (p % n) * S + S / 2,
        PAD + Math.floor(p / n) * S + S / 2,
    ];
    svg.push(
        `<defs>${palette.map((color, i) => `<marker id="arrow-${i}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="${color}"/></marker>`).join("")}</defs>`,
    );
    const route = editing ? [] : answer ? optimal.moves : played,
        shown = editing ? 0 : answer ? step : played.length;
    const labels = [];
    for (const m of trajectory(route, shown, n, PAD, S)) {
        const color = palette[m.robot],
            spots = [0.5, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6].map((f) => [
                m.x1 + (m.x2 - m.x1) * f,
                m.y1 + (m.y2 - m.y1) * f,
            ]),
            clearance = ([x, y]) =>
                Math.min(Infinity, ...labels.map(([a, b]) => Math.hypot(x - a, y - b))),
            [cx, cy] =
                spots.find((spot) => clearance(spot) >= 19) ??
                spots.reduce((best, spot) =>
                    clearance(spot) > clearance(best) ? spot : best,
                );
        labels.push([cx, cy]);
        svg.push(
            `<g pointer-events="none"><line x1="${m.x1}" y1="${m.y1}" x2="${m.x2}" y2="${m.y2}" stroke="${color}" stroke-width="${m.current ? 4.5 : 2.6}" opacity="${m.current ? 0.95 : 0.55}" stroke-linecap="round" marker-end="url(#arrow-${m.robot})"/><circle cx="${cx}" cy="${cy}" r="8.5" fill="#fff" stroke="${color}" stroke-width="${m.current ? 2.2 : 1}"/><text x="${cx}" y="${cy + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="${color}">${m.number}</text></g>`,
        );
    }
    // Landing spots for the selected robot: tapping one moves the robot there.
    if (!editing && phase === "play" && selected !== null) {
        const from = robots[selected],
            [fx, fy] = center(from),
            color = palette[selected];
        for (let d = 0; d < 4; d++) {
            const to = slide(board, robots, selected, d);
            if (to === from) continue;
            const [gx, gy] = center(to),
                hinted = hint?.robot === selected && hint.direction === d,
                ux = Math.sign(gx - fx),
                uy = Math.sign(gy - fy);
            // The dashed line runs from the robot's ring to the edge of the landing outline.
            svg.push(
                `<g class="ghost${hinted ? " hinted" : ""}" data-move="${d}" role="button" aria-label="${robotName(selected)}${DIRECTION_NAMES[d]}，停在 ${cellName(to)}"><line x1="${fx + ux * 17}" y1="${fy + uy * 17}" x2="${gx - ux * 15}" y2="${gy - uy * 15}" stroke="${color}" stroke-width="${hinted ? 3.5 : 2}" stroke-dasharray="${hinted ? "7 5" : "3 6"}" stroke-linecap="round" opacity="${hinted ? 0.95 : 0.6}" pointer-events="none"/><rect x="${gx - 15}" y="${gy - 15}" width="30" height="30" rx="9" fill="${color}" fill-opacity="${hinted ? 0.28 : 0.12}" stroke="${color}" stroke-width="2" stroke-dasharray="4 3"/><rect x="${gx - S / 2}" y="${gy - S / 2}" width="${S}" height="${S}" fill="transparent"/></g>`,
            );
        }
    }
    robots.forEach((p, i) => {
        const [x, y] = center(p),
            active = !editing && phase === "play" && selected === i;
        svg.push(
            `<g class="robot${active ? " selected" : ""}" data-robot="${i}"${!editing && phase === "play" ? ` role="button" aria-label="${robotName(i)}，${cellName(p)}" aria-pressed="${active}"` : ' pointer-events="none"'}><rect x="${x - S / 2}" y="${y - S / 2}" width="${S}" height="${S}" fill="transparent"/>${active ? `<rect x="${x - 17}" y="${y - 17}" width="34" height="34" rx="11" fill="none" stroke="${palette[i]}" stroke-width="2.5"/>` : ""}<rect x="${x - 12}" y="${y - 12}" width="24" height="24" rx="7" fill="${palette[i]}" stroke="#fff" stroke-width="2"/><text x="${x}" y="${y + 4}" fill="${i === 3 ? "#3e310b" : "#fff"}" text-anchor="middle" font-size="11" font-weight="700" pointer-events="none">${LETTERS[i]}</text></g>`,
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
                const x = PAD + (p % n) * S,
                    y = PAD + Math.floor(p / n) * S,
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
    if (editing)
        svg.push(
            `<rect class="cell-focus" x="0" y="0" width="${S - 4}" height="${S - 4}" rx="7" visibility="hidden" pointer-events="none"/>`,
        );
    svg.push("</svg>");
    return svg.join("");
}
function animateMove() {
    const m = lastMove;
    lastMove = null;
    if (!m || reducedMotion.matches) return;
    const g = $("board").querySelector(`[data-robot="${m.robot}"]`);
    if (!g) return;
    const n = board.size,
        dx = ((m.from % n) - (m.to % n)) * S,
        dy = (Math.floor(m.from / n) - Math.floor(m.to / n)) * S,
        cells = (Math.abs(dx) + Math.abs(dy)) / S;
    g.style.transform = `translate(${dx}px, ${dy}px)`;
    g.getBoundingClientRect();
    g.style.transition = `transform ${Math.min(320, 110 + cells * 30)}ms cubic-bezier(.2,.8,.3,1)`;
    g.style.transform = "";
}
// The thinking clock updates on its own tick without redrawing the board.
function renderClock() {
    const counting = countdownStart !== null,
        left = counting ? Math.max(0, countdownLeft()) : 0,
        urgent = counting && left <= 10;
    $("count").hidden = !counting;
    $("count").innerHTML = counting
        ? `<span>剩余</span><strong>${clock(Math.ceil(left))}</strong>`
        : "";
    $("count").classList.toggle("urgent", urgent);
    $("think-bar").hidden = !counting;
    $("think-bar").classList.toggle("urgent", urgent);
    $("think-bar").firstElementChild.style.width = `${counting ? (left / thinkLimit) * 100 : 100}%`;
}
function renderRound() {
    const editing = tool !== null;
    $("round").dataset.phase = editing ? "edit" : phase;
    $("goal").innerHTML = goalText();
    $("count").hidden = editing;
    if (phase === "think" && !editing) renderClock();
    else {
        $("think-bar").hidden = true;
        $("count").classList.remove("urgent");
        $("count").innerHTML =
            phase === "answer" && optimalStatus === "optimal"
                ? `<span>最优</span><strong>${optimal.moves.length}</strong><span>步</span>`
                : `<strong>${played.length}</strong><span>步</span>`;
    }
    $("status").textContent = statusText();
    const focused = document.activeElement?.closest?.("#actions [data-action]")
        ?.dataset.action;
    $("actions").innerHTML = actionList()
        .map(
            (a) =>
                `<button data-action="${a.action}" class="${a.primary ? "primary" : ""}"${a.disabled ? " disabled" : ""}${a.title ? ` title="${a.title}"` : ""}>${a.label}</button>`,
        )
        .join("");
    if (focused) {
        const again = $("actions").querySelector(
            `[data-action="${focused}"]:not(:disabled)`,
        );
        (again ?? $("actions").querySelector("button:not(:disabled)"))?.focus();
    }
    const answer = phase === "answer" && optimalStatus === "optimal",
        list = editing ? [] : answer ? optimal.moves : played;
    $("moves-panel").hidden = !list.length;
    $("moves-title").textContent = answer ? "最优解" : "你的走法";
    $("moves").innerHTML = list
        .map((m, i) => {
            const body = `<span class="move-no">${i + 1}</span><span class="swatch" style="--color:${palette[m.robot]}"></span>${COLORS[m.robot]}色${DIRECTION_NAMES[m.direction]}`;
            return answer
                ? `<li><button data-step="${i + 1}" class="${i + 1 === step ? "selected" : ""}" aria-current="${i + 1 === step}">${body}</button></li>`
                : `<li>${body}</li>`;
        })
        .join("");
}
function renderSetup() {
    $("undo").disabled = !undoHistory.length;
    $("robot-count").value = String(board.robots.length);
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
    $("require-turn").checked = !!board.rules?.requireTurn;
    $("timeout").value = String(timeoutMs);
    $("think-limit").value = String(thinkLimit);
    $("rotate-board").disabled = board.size !== 16;
    const selectedGoal = currentGoal(),
        custom = customTarget || !selectedGoal;
    $("target-modes").hidden = !board.goals?.length;
    $("goal-picker").hidden = custom || !board.goals?.length;
    $("custom-target-controls").hidden = !custom;
    $("preset-target").classList.toggle("active", !custom);
    $("custom-target").classList.toggle("active", custom);
    $("preset-target").setAttribute("aria-pressed", String(!custom));
    $("custom-target").setAttribute("aria-pressed", String(custom));
    $("current-target").textContent = !custom
        ? `本轮目标：${selectedGoal.robot < 0 ? "任意颜色" : COLORS[selectedGoal.robot] + "色"}${SHAPES[selectedGoal.shape]}`
        : `自定义目标：${board.target.robot < 0 ? "任意机器人" : COLORS[board.target.robot] + "色"}`;
    const shapes = ["circle", "triangle", "square", "hex", "vortex"];
    $("goal-options").innerHTML = [0, 1, 2, 3, -1]
        .map((robot) => {
            const goals = (board.goals ?? [])
                .filter((g) => g.robot === robot)
                .sort(
                    (a, b) => shapes.indexOf(a.shape) - shapes.indexOf(b.shape),
                );
            if (!goals.length) return "";
            return `<div class="goal-color-row"><span>${robot < 0 ? "任意" : COLORS[robot]}</span><div class="goal-buttons">${goals.map((g) => `<button data-goal="${g.id}" aria-label="${robot < 0 ? "任意" : COLORS[robot]}${SHAPES[g.shape]}" aria-pressed="${!custom && selectedGoal?.id === g.id}" class="${!custom && selectedGoal?.id === g.id ? "active" : ""}" style="--goal-color:${robot < 0 ? "#394554" : palette[robot]}" ${robot >= board.robots.length ? "disabled" : ""}><b>${targetIcon(g.shape, robot < 0 ? "#394554" : palette[robot])}</b><small>${SHAPES[g.shape]}</small></button>`).join("")}</div></div>`;
        })
        .join("");
}
function render() {
    $("board").innerHTML = boardSvg();
    $("board").classList.toggle("editing", tool !== null);
    animateMove();
    renderRound();
    renderSetup();
}

function editCell(p) {
    if (board.blocked.includes(p)) return notify("中央区域不能放置棋子。");
    if (tool === "target") {
        board.target = { cell: p, robot: board.target.robot };
    } else if (tool?.startsWith("robot:")) {
        const r = Number(tool.split(":")[1]);
        if (board.robots.some((v, i) => i !== r && v === p))
            return notify("这个格子已有其他机器人。");
        board.robots[r] = p;
    } else return;
    changed();
}
function editWall(p, d) {
    const q = neighbor(p, d, board.size);
    if (q < 0 || board.blocked.includes(p) || board.blocked.includes(q))
        return notify("外边界和禁入格的墙壁不能移除。");
    wall(board, p, d, !(board.walls[p] & DIRS[d].bit));
    delete board.layout;
    changed();
}
function directionTo(from, p) {
    const n = board.size;
    if (from === p) return -1;
    if (Math.floor(from / n) === Math.floor(p / n)) return p > from ? 1 : 3;
    if (from % n === p % n) return p > from ? 2 : 0;
    return -1;
}
function renderAssembly() {
    $("assembly-slots").innerHTML = [0, 1, 3, 2]
        .map((slot) => {
            const tile = tiles.find((t) => t.id === draftLayout[slot]);
            return `<button class="assembly-slot ${slot === activeSlot ? "selected" : ""}" data-slot="${slot}" aria-pressed="${slot === activeSlot}"><span>${SLOT_NAMES[slot]}：${tile.id} ${GROUPS[tile.group].name}</span>${tileSvg(tile, slot)}</button>`;
        })
        .join("");
    $("assembly-slot-label").textContent =
        `正在设置：${SLOT_NAMES[activeSlot]}`;
    $("tile-catalog").innerHTML = Object.entries(GROUPS)
        .map(
            ([group, info]) =>
                `<section class="tile-group"><h3 style="color:${info.color}">${info.name}（${group} 组）</h3><div class="tile-options">${tiles
                    .filter((t) => t.group === group && t.supported)
                    .map(
                        (t) =>
                            `<button class="tile-option ${draftLayout[activeSlot] === t.id ? "selected" : ""}" data-tile="${t.id}" aria-pressed="${draftLayout[activeSlot] === t.id}">${tileSvg(t, activeSlot)}<span>${t.id}${draftLayout.includes(t.id) ? "（已选）" : ""}</span></button>`,
                    )
                    .join("")}</div></section>`,
        )
        .join("");
}
// On phones the round panel is pinned to the bottom; keep page content clear of it.
function trackRoundPanel() {
    const panel = $("round"),
        update = () =>
            document.documentElement.style.setProperty(
                "--round-height",
                getComputedStyle(panel).position === "fixed"
                    ? `${panel.offsetHeight}px`
                    : "0px",
            );
    new ResizeObserver(update).observe(panel);
    addEventListener("resize", update);
    update();
}

function init() {
    startRound();
    trackRoundPanel();
    $("help-toggle").onclick = () => {
        const open = $("help").hidden;
        $("help").hidden = !open;
        $("help-toggle").setAttribute("aria-expanded", String(open));
    };
    $("actions").onclick = (e) => {
        const button = e.target.closest("[data-action]");
        if (!button || button.disabled) return;
        ({
            "finish-edit": () => setTool(null, false),
            "start-input": () => startInput(),
            countdown: startCountdown,
            "undo-move": undoMove,
            restart,
            hint: requestHint,
            answer: showAnswer,
            next: goNext,
            prev: () => setStep(step - 1),
            forward: () => setStep(step + 1),
            resume: () => {
                phase = "play";
                render();
            },
            resolve: () => {
                solveRound();
                render();
            },
        })[button.dataset.action]?.();
    };
    $("board").onclick = (e) => {
        if (swiped) {
            swiped = false;
            return;
        }
        if (tool !== null) {
            const w = e.target.closest("[data-wall]");
            if (w) {
                const [p, d] = w.dataset.wall.split(":").map(Number);
                return editWall(p, d);
            }
            const cell = e.target.closest("[data-cell]");
            if (cell) editCell(Number(cell.dataset.cell));
            return;
        }
        if (phase !== "play") return;
        const ghost = e.target.closest("[data-move]");
        if (ghost) return move(selected, Number(ghost.dataset.move));
        const robot = e.target.closest("[data-robot]");
        if (robot) {
            const r = Number(robot.dataset.robot);
            selected = selected === r ? null : r;
            message = "";
            return render();
        }
        const cell = e.target.closest("[data-cell]");
        if (cell && selected !== null) {
            const d = directionTo(
                positions()[selected],
                Number(cell.dataset.cell),
            );
            if (d >= 0) move(selected, d);
        }
    };
    // Dragging a robot moves it in the direction of the drag.
    $("board").addEventListener("pointerdown", (e) => {
        const robot = e.target.closest("[data-robot]");
        drag =
            tool === null && phase === "play" && robot
                ? {
                      robot: Number(robot.dataset.robot),
                      x: e.clientX,
                      y: e.clientY,
                      id: e.pointerId,
                  }
                : null;
    });
    $("board").addEventListener("pointerup", (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.x,
            dy = e.clientY - drag.y,
            r = drag.robot;
        drag = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
        swiped = true;
        setTimeout(() => (swiped = false), 350);
        move(r, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);
    });
    $("board").addEventListener("pointercancel", () => (drag = null));
    // Keyboard focus in edit mode: outline the focused cell above the grid lines.
    $("board").addEventListener("focusin", (e) => {
        const cell = e.target.closest?.("[data-cell]"),
            ring = $("board").querySelector(".cell-focus");
        if (!ring) return;
        if (!cell || !cell.matches(":focus-visible"))
            return ring.setAttribute("visibility", "hidden");
        ring.setAttribute("x", Number(cell.getAttribute("x")) + 2);
        ring.setAttribute("y", Number(cell.getAttribute("y")) + 2);
        ring.setAttribute("visibility", "visible");
    });
    $("board").addEventListener("focusout", () =>
        $("board").querySelector(".cell-focus")?.setAttribute("visibility", "hidden"),
    );
    $("board").onkeydown = (e) => {
        if (tool !== null) return editKey(e);
        if (e.altKey) return;
        if (phase === "think") {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                startInput();
            } else if (e.key.toLowerCase() === "t" && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                startCountdown();
            }
            return;
        }
        const number = Number(e.key);
        if (Number.isInteger(number) && number >= 1 && number <= board.robots.length) {
            e.preventDefault();
            if (phase === "play") {
                selected = number - 1;
                message = "";
                render();
            }
            return;
        }
        const d = KEYS.indexOf(e.key);
        if (d >= 0 && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            if (phase !== "play") return;
            if (selected === null)
                selected = board.target.robot >= 0 ? board.target.robot : 0;
            move(selected, d);
        } else if (
            e.key === "Backspace" ||
            ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z")
        ) {
            e.preventDefault();
            undoMove();
        }
    };
    function editKey(e) {
        const cell = e.target.closest("[data-cell]");
        const d = KEYS.indexOf(e.key);
        if (!cell) {
            if (d >= 0 || e.key === "Enter") {
                e.preventDefault();
                $("board").querySelector('[data-cell][tabindex="0"]')?.focus();
            }
            return;
        }
        const p = Number(cell.dataset.cell);
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
    }
    $("moves").onclick = (e) => {
        const b = e.target.closest("[data-step]");
        if (b) setStep(Number(b.dataset.step));
    };

    const applyRandom = (action) => {
        try {
            loadBoard(action());
        } catch (error) {
            notify(error.message);
        }
    };
    $("undo").onclick = () => {
        if (!undoHistory.length) return;
        const value = undoHistory.pop();
        previousBoard = structuredClone(value);
        board = validateBoard(value);
        customTarget = false;
        tool = null;
        save();
        startRound();
    };
    $("new-round").onclick = () =>
        applyRandom(() => randomRobots(randomTarget(board)));
    $("random-physical").onclick = () =>
        applyRandom(() => randomPhysical(tiles, board));
    $("random-artificial").onclick = () =>
        applyRandom(() => randomArtificial(board));
    $("random-robots").onclick = () => applyRandom(() => randomRobots(board));
    $("random-target").onclick = () => {
        const custom = customTarget || !currentGoal();
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
    $("tools").onclick = (e) => {
        const b = e.target.closest("[data-tool]");
        if (b) setTool(b.dataset.tool);
    };
    $("edit-walls").onclick = () => setTool("wall");
    $("place-target").onclick = () => setTool("target");
    $("target-color").onchange = (e) => {
        board.target = {
            cell: board.target.cell,
            robot: Number(e.target.value),
        };
        changed();
    };
    $("robot-count").onchange = (e) => {
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
        if (tool?.startsWith("robot:") && Number(tool.split(":")[1]) >= count)
            tool = null;
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
            notify("棋盘已拼装，可以在局面设置里摆放机器人和选择目标。");
        } catch (error) {
            notify(error.message);
        }
    };
    $("rotate-board").onclick = () => loadBoard(rotateBoard(board));
    const selectGoal = (goal) => {
        if (!goal || goal.robot >= board.robots.length) return;
        board.target = { ...goal };
        customTarget = false;
        tool = null;
        changed();
    };
    $("goal-options").onclick = (e) => {
        const button = e.target.closest("[data-goal]");
        if (button)
            selectGoal(board.goals?.find((g) => g.id === button.dataset.goal));
    };
    $("preset-target").onclick = () =>
        selectGoal(
            currentGoal() ??
                board.goals?.find((g) => g.robot < board.robots.length),
        );
    $("custom-target").onclick = () => {
        customTarget = true;
        setTool("target", false);
    };
    $("require-turn").onchange = (e) => {
        board.rules = { requireTurn: e.target.checked };
        changed();
    };
    $("think-limit").onchange = (e) => {
        thinkLimit = Number(e.target.value);
        try {
            localStorage.setItem("ricochet-think", String(thinkLimit));
        } catch {}
        if (phase === "think" && countdownStart !== null)
            countdownStart = Date.now();
        render();
    };
    $("timeout").onchange = (e) => {
        timeoutMs = Number(e.target.value);
        try {
            localStorage.setItem("ricochet-timeout", String(timeoutMs));
        } catch {}
        if (tool === null && !["optimal", "unsolvable", "running"].includes(optimalStatus))
            solveRound();
        render();
    };
    $("empty").onclick = () => loadBoard(emptyBoard());
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
                    "Read the current board, the player's moves and the optimal search result.",
                inputSchema: {
                    type: "object",
                    properties: {},
                    additionalProperties: false,
                },
                annotations: { readOnlyHint: true },
                execute: () => ({
                    board: structuredClone(board),
                    moves: structuredClone(played),
                    result: optimal,
                }),
            },
            {
                name: "set_ricochet_board",
                description:
                    "Validate and replace the current board, saving it in this browser and starting a new round.",
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
