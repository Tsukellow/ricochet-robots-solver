import { validateBoard, slide, afterTurn, isGoal } from "./engine.js";
import { randomTarget } from "./random.js";

// A new round always starts at the complete solution endpoint, independent of replay.
export function nextRound(input, solution, rng = Math.random) {
    if (solution?.status !== "optimal" || !Array.isArray(solution.moves))
        throw Error("请先完成本局求解，再进入下一局。");
    const b = validateBoard(input);
    const turns = b.robots.map(() => 0);
    for (const m of solution.moves) {
        if (
            !Number.isInteger(m.robot) ||
            m.robot < 0 ||
            m.robot >= b.robots.length ||
            !Number.isInteger(m.direction) ||
            m.direction < 0 ||
            m.direction > 3 ||
            b.robots[m.robot] !== m.from ||
            m.from === m.to ||
            slide(b, b.robots, m.robot, m.direction) !== m.to
        )
            throw Error("解答与当前局面不一致，请重新求解。");
        b.robots[m.robot] = m.to;
        turns[m.robot] = afterTurn(turns[m.robot], m.direction);
    }
    if (!isGoal(b, b.robots, turns)) throw Error("这条路线尚未完成本局目标。");
    const next = randomTarget(b, rng);
    if (
        next.target.cell === b.target.cell &&
        next.target.robot === b.target.robot
    )
        throw Error("没有其他可抽取的目标。");
    return next;
}
