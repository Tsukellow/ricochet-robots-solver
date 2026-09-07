// Assign lanes from the complete route so scrubbing never moves earlier tracks.
export function trajectory(moves, step, size, pad = 22, cell = 40) {
    const groups = new Map();
    const routes = moves.map((m) => {
        const horizontal =
            Math.floor(m.from / size) === Math.floor(m.to / size);
        const axis = horizontal ? Math.floor(m.from / size) : m.from % size;
        const coordinate = (p) =>
            horizontal ? p % size : Math.floor(p / size);
        const lo = Math.min(coordinate(m.from), coordinate(m.to));
        const hi = Math.max(coordinate(m.from), coordinate(m.to));
        const key = `${horizontal ? "h" : "v"}:${axis}`;
        const group = groups.get(key) ?? [];
        const overlaps = group.filter((r) => lo < r.hi && hi > r.lo);
        const lane = overlaps.length
            ? Math.max(...overlaps.map((r) => r.lane)) + 1
            : 0;
        const route = { ...m, horizontal, lo, hi, lane, group };
        group.push(route);
        groups.set(key, group);
        return route;
    });
    const visible = routes.slice(0, Math.max(0, Math.min(moves.length, step)));
    return visible.map((route, i) => {
        const { horizontal, lane, group } = route;
        const maxLane = Math.max(...group.map((r) => r.lane));
        // Keep even many repeated tracks inside their original row or column.
        const offset =
            -lane * Math.min(5, (cell * 0.35) / Math.max(1, maxLane));
        const x = (p) =>
            pad + (p % size) * cell + cell / 2 + (horizontal ? 0 : offset);
        const y = (p) =>
            pad +
            Math.floor(p / size) * cell +
            cell / 2 +
            (horizontal ? offset : 0);
        return {
            ...moves[i],
            number: i + 1,
            current: i === visible.length - 1,
            x1: x(route.from),
            y1: y(route.from),
            x2: x(route.to),
            y2: y(route.to),
        };
    });
}
