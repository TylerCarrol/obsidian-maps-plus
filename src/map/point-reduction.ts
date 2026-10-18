type Coordinate = [number, number];

const SEARCH_ITERATIONS = 32;

/** Reduces one line or polygon ring without changing the input array. */
export function reducePointGroup(
	points: Coordinate[],
	maxPoints: number,
	minimumPoints: number,
): Coordinate[] {
	if (!Number.isFinite(maxPoints) || maxPoints <= 0 || points.length <= maxPoints) {
		return points.slice();
	}

	const isClosed = points.length > 1 && sameCoordinate(points[0], points[points.length - 1]);
	const source = isClosed ? points.slice(0, -1) : points.slice();
	const minimum = Math.min(minimumPoints, source.length);
	if (source.length <= Math.max(maxPoints, minimum)) {
		return isClosed ? [...source, source[0]!] : source;
	}

	const target = Math.max(minimum, Math.floor(maxPoints));
	let low = 0;
	let high = maximumDistanceSquared(source);
	let best = simplify(source, 0);

	for (let iteration = 0; iteration < SEARCH_ITERATIONS; iteration++) {
		const tolerance = (low + high) / 2;
		const candidate = simplify(source, tolerance);
		if (candidate.length > target) {
			low = tolerance;
		} else {
			best = candidate;
			high = tolerance;
		}
	}

	const reduced = best.length < minimum ? source.slice(0, minimum) : best;
	return isClosed ? [...reduced, reduced[0]!] : reduced;
}

export function reducePointGroups(
	groups: Coordinate[][],
	maxPoints: number,
	minimumPoints: number,
): Coordinate[][] {
	return groups.map(group => reducePointGroup(group, maxPoints, minimumPoints));
}

function simplify(points: Coordinate[], toleranceSquared: number): Coordinate[] {
	if (points.length <= 2) return points.slice();

	const keep = new Uint8Array(points.length);
	keep[0] = 1;
	keep[points.length - 1] = 1;
	simplifyRange(points, 0, points.length - 1, toleranceSquared, keep);
	return points.filter((_, index) => keep[index] === 1);
}

function simplifyRange(
	points: Coordinate[],
	start: number,
	end: number,
	toleranceSquared: number,
	keep: Uint8Array,
): void {
	if (end - start <= 1) return;

	let furthestIndex = -1;
	let furthestDistance = toleranceSquared;
	for (let index = start + 1; index < end; index++) {
		const distance = distanceToSegmentSquared(points[index]!, points[start]!, points[end]!);
		if (distance > furthestDistance) {
			furthestDistance = distance;
			furthestIndex = index;
		}
	}

	if (furthestIndex === -1) return;
	keep[furthestIndex] = 1;
	simplifyRange(points, start, furthestIndex, toleranceSquared, keep);
	simplifyRange(points, furthestIndex, end, toleranceSquared, keep);
}

function distanceToSegmentSquared(point: Coordinate, start: Coordinate, end: Coordinate): number {
	const deltaX = end[0] - start[0];
	const deltaY = end[1] - start[1];
	const lengthSquared = deltaX * deltaX + deltaY * deltaY;
	if (lengthSquared === 0) {
		return distanceSquared(point, start);
	}

	const projection = Math.max(0, Math.min(1,
		((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / lengthSquared));
	const closest: Coordinate = [start[0] + projection * deltaX, start[1] + projection * deltaY];
	return distanceSquared(point, closest);
}

function distanceSquared(a: Coordinate, b: Coordinate): number {
	const deltaX = a[0] - b[0];
	const deltaY = a[1] - b[1];
	return deltaX * deltaX + deltaY * deltaY;
}

function maximumDistanceSquared(points: Coordinate[]): number {
	let maximum = 0;
	for (let index = 1; index < points.length; index++) {
		maximum = Math.max(maximum, distanceSquared(points[index]!, points[0]!));
	}
	return maximum || 1;
}

function sameCoordinate(a: Coordinate | undefined, b: Coordinate | undefined): boolean {
	return a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1];
}