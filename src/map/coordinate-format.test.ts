import { describe, expect, it } from 'vitest';
import { ListValue, StringValue } from 'obsidian';
import { serializeGroups, serializePoint } from './coordinate-format';

const POINT: [number, number] = [43.7, -79.6];
const RING: [number, number][] = [[10, 20], [11, 21], [12, 22]];

describe('serializePoint', () => {
	it('matches a comma-string original when saving as "same"', () => {
		expect(serializePoint(POINT, 'same', new StringValue('43.1,-79.2'))).toBe('43.7,-79.6');
	});

	it('matches a string-pair-list original when saving as "same"', () => {
		expect(serializePoint(POINT, 'same', new ListValue(['43.1', '-79.2']))).toEqual(['43.7', '-79.6']);
	});

	it('matches a number-pair-list original when saving as "same"', () => {
		expect(serializePoint(POINT, 'same', new ListValue([43.1, -79.2]))).toEqual([43.7, -79.6]);
	});

	it('defaults to a comma string when there is no original value', () => {
		expect(serializePoint(POINT, 'same', null)).toBe('43.7,-79.6');
	});

	it('forces the comma-pair format regardless of the original', () => {
		expect(serializePoint(POINT, 'commaPairs', new ListValue([43.1, -79.2]))).toBe('43.7,-79.6');
	});

	it('forces the flat-number format regardless of the original', () => {
		expect(serializePoint(POINT, 'flatNumbers', new StringValue('43.1,-79.2'))).toEqual([43.7, -79.6]);
	});

	it('forces the JSON string format regardless of the original', () => {
		expect(serializePoint(POINT, 'jsonString', new StringValue('43.1,-79.2'))).toBe('[43.7,-79.6]');
	});
});

describe('serializeGroups', () => {
	it('matches a flat comma-string ring original when saving as "same"', () => {
		const original = new ListValue(['10,20', '11,21', '12,22']);
		expect(serializeGroups([RING], 'same', original)).toEqual(['10,20', '11,21', '12,22']);
	});

	it('matches a flat number-list ring original when saving as "same"', () => {
		const original = new ListValue(['10', '20', '11', '21', '12', '22']);
		expect(serializeGroups([RING], 'same', original)).toEqual([10, 20, 11, 21, 12, 22]);
	});

	it('matches a flat pair-list ring original when saving as "same"', () => {
		const original = new ListValue([[10, 20], [11, 21], [12, 22]]);
		expect(serializeGroups([RING], 'same', original)).toEqual([[10, 20], [11, 21], [12, 22]]);
	});

	it('matches nested rings without separators when saving as "same"', () => {
		const original = new ListValue([
			[[10, 20], [11, 21], [12, 22]],
			[[30, 40], [31, 41], [32, 42]],
		]);
		const groups: [number, number][][] = [RING, [[30, 40], [31, 41], [32, 42]]];

		expect(serializeGroups(groups, 'same', original)).toEqual([
			[[10, 20], [11, 21], [12, 22]],
			[[30, 40], [31, 41], [32, 42]],
		]);
	});

	it('preserves separator labels for a multi-polygon area when saving as "same"', () => {
		const original = new ListValue(['Mainland', '10,20', '11,21', '12,22', 'Sicily', '30,40', '31,41', '32,42']);
		const groups: [number, number][][] = [RING, [[30, 40], [31, 41], [32, 42]]];

		expect(serializeGroups(groups, 'same', original)).toEqual([
			'Mainland', '10,20', '11,21', '12,22', 'Sicily', '30,40', '31,41', '32,42',
		]);
	});

	it('lets an edited group grow or shrink within a preserved separator layout', () => {
		const original = new ListValue(['Mainland', '10,20', '11,21', '12,22']);
		const grown: [number, number][][] = [[[10, 20], [11, 21], [12, 22], [13, 23]]];

		expect(serializeGroups(grown, 'same', original)).toEqual(['Mainland', '10,20', '11,21', '12,22', '13,23']);
	});

	it('forces the nested-pairs format for a single ring regardless of the original', () => {
		const original = new ListValue(['10,20', '11,21', '12,22']);
		expect(serializeGroups([RING], 'nestedPairs', original)).toEqual([[10, 20], [11, 21], [12, 22]]);
	});

	it('forces the comma-pair format for multiple groups regardless of the original', () => {
		const original = new ListValue([[10, 20], [11, 21], [12, 22]]);
		const groups: [number, number][][] = [RING, [[30, 40], [31, 41], [32, 42]]];

		expect(serializeGroups(groups, 'commaPairs', original)).toEqual([
			['10,20', '11,21', '12,22'],
			['30,40', '31,41', '32,42'],
		]);
	});

	it('forces the JSON string format for a single ring regardless of the original', () => {
		const original = new ListValue(['10,20', '11,21', '12,22']);
		expect(serializeGroups([RING], 'jsonString', original)).toBe('[[10,20],[11,21],[12,22]]');
	});
});
