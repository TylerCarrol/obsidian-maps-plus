import { describe, expect, it } from 'vitest';
import { ListValue, StringValue } from 'obsidian';
import { polygonRingsFromValue, routeSegmentsFromValue, toClosedLngLatRing, toLngLatLine } from './coordinates';

const TRIANGLE = ['10,20', '11,21', '12,22'];
const SQUARE = ['30,40', '31,41', '32,42', '33,43'];

describe('polygonRingsFromValue', () => {
	it('reads a flat list of coordinate strings as one polygon', () => {
		const rings = polygonRingsFromValue(new ListValue(TRIANGLE));

		expect(rings).toEqual([[[10, 20], [11, 21], [12, 22]]]);
	});

	it('splits polygons at text separators', () => {
		const rings = polygonRingsFromValue(new ListValue(['Mainland', ...TRIANGLE, 'Sicily', ...SQUARE]));

		expect(rings).toHaveLength(2);
		expect(rings?.[0]).toEqual([[10, 20], [11, 21], [12, 22]]);
		expect(rings?.[1]).toEqual([[30, 40], [31, 41], [32, 42], [33, 43]]);
	});

	it('drops groups that are too short to be a polygon', () => {
		const rings = polygonRingsFromValue(new ListValue(['Islet', '10,20', 'Mainland', ...TRIANGLE]));

		expect(rings).toEqual([[[10, 20], [11, 21], [12, 22]]]);
	});

	it('reads nested lists as one polygon each', () => {
		const rings = polygonRingsFromValue(
			new ListValue([
				[[10, 20], [11, 21], [12, 22]],
				[[30, 40], [31, 41], [32, 42]],
			])
		);

		expect(rings).toHaveLength(2);
		expect(rings?.[1]).toEqual([[30, 40], [31, 41], [32, 42]]);
	});

	it('reads a list of coordinate pairs as one polygon', () => {
		const rings = polygonRingsFromValue(new ListValue([[10, 20], [11, 21], [12, 22]]));

		expect(rings).toEqual([[[10, 20], [11, 21], [12, 22]]]);
	});

	it('reads a flat run of numbers as one polygon', () => {
		const rings = polygonRingsFromValue(new ListValue(['10', '20', '11', '21', '12', '22']));

		expect(rings).toEqual([[[10, 20], [11, 21], [12, 22]]]);
	});

	it('reads separated polygons from a multi-line string', () => {
		const rings = polygonRingsFromValue(
			new StringValue('Mainland\n- 10,20\n- 11,21\n- 12,22\nSicily\n- 30,40\n- 31,41\n- 32,42')
		);

		expect(rings).toHaveLength(2);
		expect(rings?.[0]).toEqual([[10, 20], [11, 21], [12, 22]]);
	});

	it('reads nested JSON arrays as multiple polygons', () => {
		const rings = polygonRingsFromValue(
			new StringValue('[[[10,20],[11,21],[12,22]],[[30,40],[31,41],[32,42]]]')
		);

		expect(rings).toHaveLength(2);
	});

	it('rejects coordinates outside the valid range', () => {
		expect(polygonRingsFromValue(new ListValue(['100,20', '11,21', '12,222']))).toBeNull();
	});

	it('returns null for values that hold no polygon', () => {
		expect(polygonRingsFromValue(new ListValue(['Mainland', 'Sicily']))).toBeNull();
		expect(polygonRingsFromValue(new StringValue(''))).toBeNull();
		expect(polygonRingsFromValue(null)).toBeNull();
	});
});

describe('routeSegmentsFromValue', () => {
	it('accepts a two-point route', () => {
		expect(routeSegmentsFromValue(new ListValue(['10,20', '11,21']))).toEqual([[[10, 20], [11, 21]]]);
	});

	it('splits routes into segments at text separators', () => {
		const segments = routeSegmentsFromValue(new ListValue(['Leg one', '10,20', '11,21', 'Leg two', '30,40', '31,41']));

		expect(segments).toEqual([
			[[10, 20], [11, 21]],
			[[30, 40], [31, 41]],
		]);
	});
});

describe('coordinate conversion', () => {
	it('closes a ring and flips it to lng/lat order', () => {
		expect(toClosedLngLatRing([[10, 20], [11, 21], [12, 22]])).toEqual([
			[20, 10], [21, 11], [22, 12], [20, 10],
		]);
	});

	it('leaves an already closed ring alone', () => {
		expect(toClosedLngLatRing([[10, 20], [11, 21], [12, 22], [10, 20]])).toHaveLength(4);
	});

	it('flips a line to lng/lat order without closing it', () => {
		expect(toLngLatLine([[10, 20], [11, 21]])).toEqual([[20, 10], [21, 11]]);
	});
});
