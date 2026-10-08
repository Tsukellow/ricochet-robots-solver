import { validateBoard } from "./engine.js";
import { randomTarget } from "./random.js";

// As in the board game, the robots stay where the last round ended and only the target changes.
export function nextRound(input, robots, rng = Math.random) {
    const b = validateBoard(input);
    if (!Array.isArray(robots) || robots.length !== b.robots.length)
        throw Error("机器人位置与当前局面不一致。");
    b.robots = [...robots];
    const next = randomTarget(validateBoard(b), rng);
    if (
        next.target.cell === b.target.cell &&
        next.target.robot === b.target.robot
    )
        throw Error("没有其他可抽取的目标。");
    return next;
}
