import { describe, expect, it } from 'vitest';
import { reducePointGroup, reducePointGroups } from './point-reduction';

describe('reducePointGroup', () => {
	it('reduces a detailed line to the requested maximum', () => {
		const points = Array.from({ length: 100 }, (_, index) => [index, Math.sin(index / 5)] as [number, number]);

		expect(reducePointGroup(points, 20, 2)).toHaveLength(20);
	});

	it('keeps small groups unchanged and does not mutate them', () => {
		const points: [number, number][] = [[0, 0], [1, 1], [2, 0]];
		const reduced = reducePointGroup(points, 10, 3);

		expect(reduced).toEqual(points);
		expect(reduced).not.toBe(points);
	});

	it('preserves a closed ring', () => {
		const ring: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
		const reduced = reducePointGroup(ring, 3, 3);

		expect(reduced.length).toBe(4);
		expect(reduced[0]).toEqual(reduced[reduced.length - 1]);
	});

	it('preserves the minimum geometry size', () => {
		const triangle: [number, number][] = [[0, 0], [1, 0], [0, 1]];

		expect(reducePointGroup(triangle, 1, 3)).toHaveLength(3);
	});

	it('reduces every group independently', () => {
		const groups = [
			Array.from({ length: 20 }, (_, index) => [index, 0] as [number, number]),
			[[0, 0], [1, 1], [2, 0]] as [number, number][],
		];

		expect(reducePointGroups(groups, 5, 3).map(group => group.length)).toEqual([3, 3]);
	});
});