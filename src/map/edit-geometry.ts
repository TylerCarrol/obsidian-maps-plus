/**
 * Projects a point onto a line segment, for placing a phantom "add point" marker
 * while hovering a route or area outline. Coordinates are in whatever consistent
 * 2D space the caller uses (screen pixels or [lng, lat]); the math is the same.
 */
export function nearestPointOnSegment(
	point: [number, number],
	start: [number, number],
	end: [number, number]
): { point: [number, number]; t: number } {
	const [px, py] = point;
	const [ax, ay] = start;
	const [bx, by] = end;

	const dx = bx - ax;
	const dy = by - ay;
	const lengthSquared = dx * dx + dy * dy;

	if (lengthSquared === 0) return { point: [ax, ay], t: 0 };

	const rawT = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
	const t = Math.min(1, Math.max(0, rawT));

	return { point: [ax + t * dx, ay + t * dy], t };
}

/** Finds the closest point across every segment of a line, so hovering anywhere on it works. */
export function nearestPointOnLine(
	point: [number, number],
	line: [number, number][]
): { point: [number, number]; segmentIndex: number; distanceSquared: number } | null {
	let best: { point: [number, number]; segmentIndex: number; distanceSquared: number } | null = null;

	for (let index = 0; index < line.length - 1; index++) {
		const start = line[index];
		const end = line[index + 1];
		if (!start || !end) continue;

		const { point: projected } = nearestPointOnSegment(point, start, end);
		const dx = point[0] - projected[0];
		const dy = point[1] - projected[1];
		const distanceSquared = dx * dx + dy * dy;

		if (!best || distanceSquared < best.distanceSquared) {
			best = { point: projected, segmentIndex: index, distanceSquared };
		}
	}

	return best;
}
