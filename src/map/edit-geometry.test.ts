import { describe, expect, it } from 'vitest';
import { nearestPointOnLine, nearestPointOnSegment } from './edit-geometry';

describe('nearestPointOnSegment', () => {
	it('projects onto the middle of a segment', () => {
		const result = nearestPointOnSegment([5, 5], [0, 0], [10, 0]);
		expect(result.point).toEqual([5, 0]);
		expect(result.t).toBeCloseTo(0.5);
	});

	it('clamps to the start when the projection falls before it', () => {
		const result = nearestPointOnSegment([-5, 5], [0, 0], [10, 0]);
		expect(result.point).toEqual([0, 0]);
		expect(result.t).toBe(0);
	});

	it('clamps to the end when the projection falls past it', () => {
		const result = nearestPointOnSegment([15, 5], [0, 0], [10, 0]);
		expect(result.point).toEqual([10, 0]);
		expect(result.t).toBe(1);
	});

	it('returns the shared point for a zero-length segment', () => {
		const result = nearestPointOnSegment([5, 5], [2, 2], [2, 2]);
		expect(result.point).toEqual([2, 2]);
	});
});

describe('nearestPointOnLine', () => {
	it('picks the closest of multiple segments', () => {
		const line: [number, number][] = [[0, 0], [10, 0], [10, 10]];
		const result = nearestPointOnLine([9, 9], line);

		expect(result?.segmentIndex).toBe(1);
		expect(result?.point).toEqual([10, 9]);
	});

	it('returns null for a line with fewer than two points', () => {
		expect(nearestPointOnLine([0, 0], [[1, 1]])).toBeNull();
	});
});
