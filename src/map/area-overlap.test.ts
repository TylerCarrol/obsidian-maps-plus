import { describe, expect, it } from 'vitest';
import type { MapShape, OverlapRuleConfig } from './types';
import { classifyAreaOverlap } from './area-overlap';

const TARGET = [[0, 0], [0, 10], [10, 10], [10, 0]] as [number, number][];
const LEFT = [[0, 0], [0, 5], [10, 5], [10, 0]] as [number, number][];
const RIGHT = [[0, 5], [0, 10], [10, 10], [10, 5]] as [number, number][];

function area(groups: [number, number][][]): MapShape {
	return {
		entry: {} as MapShape['entry'],
		kind: 'area',
		groups,
		fillColor: '#000000',
		strokeColor: '#000000',
		fillOpacity: 1,
	};
}

function rule(comparator: OverlapRuleConfig['comparator'], count: number, color: string): OverlapRuleConfig {
	return { type: 'layerOverlapCount', comparator, count, color, fillOpacity: 1 };
}

describe('classifyAreaOverlap', () => {
	it('matches exactly one covered layer', () => {
		const fragments = classifyAreaOverlap(
			[TARGET],
			[
				{ id: 1, sourceAreas: [area([LEFT])] },
				{ id: 2, sourceAreas: [area([RIGHT])] },
			],
			[rule('==', 1, 'yellow')]
		);

		expect(fragments).toHaveLength(2);
		expect(fragments.every(fragment => fragment.color === 'yellow')).toBe(true);
	});

	it('matches all covered layers', () => {
		const fragments = classifyAreaOverlap(
			[TARGET],
			[
				{ id: 1, sourceAreas: [area([TARGET])] },
				{ id: 2, sourceAreas: [area([TARGET])] },
			],
			[rule('==', 2, 'green')]
		);

		expect(fragments).toHaveLength(1);
		expect(fragments[0]?.color).toBe('green');
	});

	it('supports every requested comparator', () => {
		const cases: Array<[OverlapRuleConfig['comparator'], boolean]> = [
			['==', false], ['!=', true], ['<', false], ['>', true], ['<=', false], ['>=', true],
		];
		for (const [comparator, matches] of cases) {
			const fragments = classifyAreaOverlap(
				[TARGET],
				[{ id: 1, sourceAreas: [area([TARGET])] }],
				[rule(comparator, 0, 'result')]
			);
			expect(fragments.length > 0).toBe(matches);
		}
	});

	it('uses the first matching rule', () => {
		const fragments = classifyAreaOverlap(
			[TARGET],
			[{ id: 1, sourceAreas: [area([TARGET])] }],
			[rule('>=', 1, 'preferred'), rule('==', 1, 'fallback')]
		);

		expect(fragments[0]?.color).toBe('preferred');
	});

	it('does not double-count duplicate source geometry in one layer', () => {
		const fragments = classifyAreaOverlap(
			[TARGET],
			[{ id: 1, sourceAreas: [area([LEFT]), area([LEFT])] }],
			[rule('==', 1, 'green')]
		);

		expect(fragments).toHaveLength(1);
		expect(fragments[0]?.color).toBe('green');
	});

	it('does not classify edge-only contact as covered', () => {
		const touching = [[0, 10], [0, 20], [10, 20], [10, 10]] as [number, number][];
		const fragments = classifyAreaOverlap(
			[TARGET],
			[{ id: 1, sourceAreas: [area([touching])] }],
			[rule('==', 0, 'none')]
		);

		expect(fragments[0]?.color).toBe('none');
	});

	it('keeps valid source polygons when another source polygon is malformed', () => {
		const malformed = [[0, 0], [1, 1], [2, 2]] as [number, number][];
		const fragments = classifyAreaOverlap(
			[TARGET],
			[{ id: 1, sourceAreas: [area([malformed]), area([LEFT])] }],
			[rule('==', 1, 'covered')]
		);

		expect(fragments).toHaveLength(1);
		expect(fragments[0]?.color).toBe('covered');
	});
});
