import { Value, ListValue, StringValue, NumberValue, NullValue } from 'obsidian';
import { coordinateFromValue } from './utils';

/**
 * How edited coordinates get written back to frontmatter. `'same'` mirrors
 * whatever structure the property already had; the rest are explicit formats
 * a user can force regardless of what was there before.
 */
export type CoordinateFormat = 'same' | 'commaPairs' | 'flatNumbers' | 'nestedPairs' | 'jsonString';

export const COORDINATE_FORMAT_LABELS: Record<CoordinateFormat, string> = {
	same: 'Same as loaded type',
	commaPairs: 'List of "lat,lng" strings',
	flatNumbers: 'Flat list of numbers',
	nestedPairs: 'List of [lat, lng] pairs',
	jsonString: 'JSON array string',
};

function isCoordinateValue(value: Value | null): boolean {
	return value != null && !Value.equals(value, NullValue.value) && coordinateFromValue(value) != null;
}

function pointAsCommaString([lat, lng]: [number, number]): string {
	return `${lat},${lng}`;
}

function pointAsPair([lat, lng]: [number, number]): [number, number] {
	return [lat, lng];
}

// --- Single marker coordinate -------------------------------------------------

type PointShape = 'commaString' | 'jsonString' | 'numberPair' | 'stringPair' | null;

function detectPointShape(value: Value | null): PointShape {
	if (value instanceof StringValue) {
		try {
			JSON.parse(value.toString().trim());
			return 'jsonString';
		}
		catch {
			return 'commaString';
		}
	}

	if (value instanceof ListValue && value.length() >= 2) {
		return value.get(0) instanceof StringValue ? 'stringPair' : 'numberPair';
	}

	return null;
}

/** Serializes a single marker coordinate for storage in frontmatter. */
export function serializePoint(point: [number, number], format: CoordinateFormat, originalValue: Value | null): unknown {
	const resolved = format === 'same' ? (detectPointShape(originalValue) ?? 'commaString') : explicitPointFormat(format);

	switch (resolved) {
		case 'commaString':
			return pointAsCommaString(point);
		case 'jsonString':
			return JSON.stringify(pointAsPair(point));
		case 'stringPair':
			return [point[0].toString(), point[1].toString()];
		case 'numberPair':
		default:
			return pointAsPair(point);
	}
}

/** A single point has nothing to nest, so 'flatNumbers' and 'nestedPairs' both mean a [lat, lng] pair. */
function explicitPointFormat(format: Exclude<CoordinateFormat, 'same'>): Exclude<PointShape, null> {
	switch (format) {
		case 'commaPairs': return 'commaString';
		case 'jsonString': return 'jsonString';
		case 'flatNumbers':
		case 'nestedPairs':
		default: return 'numberPair';
	}
}

// --- Area/route groups ---------------------------------------------------------

type GroupsShape =
	| { kind: 'flatRing'; itemFormat: 'commaString' | 'numberList' | 'pair' }
	| { kind: 'nestedRings'; itemFormat: 'commaString' | 'pair' }
	| { kind: 'separatedFlat'; segments: FlatSegment[] }
	| { kind: 'jsonString' }
	| null;

type FlatSegment =
	| { type: 'label'; text: string }
	| { type: 'run'; itemFormat: 'commaString' | 'pair' };

function splitIntoFlatSegments(value: ListValue): FlatSegment[] {
	const segments: FlatSegment[] = [];
	let inRun = false;

	for (let index = 0; index < value.length(); index++) {
		const item = value.get(index);
		if (isCoordinateValue(item)) {
			if (!inRun) {
				segments.push({ type: 'run', itemFormat: item instanceof ListValue ? 'pair' : 'commaString' });
				inRun = true;
			}
		}
		else {
			segments.push({ type: 'label', text: item.toString() });
			inRun = false;
		}
	}

	return segments;
}

function detectGroupsShape(value: Value | null): GroupsShape {
	if (value instanceof StringValue) {
		try {
			JSON.parse(value.toString().trim());
			return { kind: 'jsonString' };
		}
		catch {
			return null;
		}
	}

	if (!(value instanceof ListValue) || value.length() === 0) return null;

	const first = value.get(0);

	// Nested lists: either one ring per polygon, or a single ring of [lat, lng] pairs
	if (first instanceof ListValue) {
		const firstOfFirst = first.length() > 0 ? first.get(0) : null;
		if (firstOfFirst instanceof ListValue) {
			return { kind: 'nestedRings', itemFormat: firstOfFirst.get(0) instanceof StringValue ? 'commaString' : 'pair' };
		}
		return { kind: 'flatRing', itemFormat: 'pair' };
	}

	// A flat run of plain numbers (rather than whole "lat,lng" coordinates) is a single ring
	if (allEntries(value, isPlainNumberValue)) return { kind: 'flatRing', itemFormat: 'numberList' };

	// Flat list mixing label strings with coordinates separates multiple groups
	const segments = splitIntoFlatSegments(value);
	if (segments.some(segment => segment.type === 'label')) {
		return { kind: 'separatedFlat', segments };
	}

	if (first instanceof StringValue) return { kind: 'flatRing', itemFormat: 'commaString' };
	if (first instanceof NumberValue) return { kind: 'flatRing', itemFormat: 'numberList' };

	return null;
}

function allEntries(value: ListValue, predicate: (item: Value) => boolean): boolean {
	for (let index = 0; index < value.length(); index++) {
		if (!predicate(value.get(index))) return false;
	}
	return true;
}

/** A bare number, as opposed to a whole "lat,lng" coordinate string. */
function isPlainNumberValue(value: Value): boolean {
	if (value instanceof NumberValue) return true;
	return value instanceof StringValue && /^-?\d+(\.\d+)?$/.test(value.toString().trim());
}

function ringAsCommaStrings(points: [number, number][]): string[] {
	return points.map(pointAsCommaString);
}

function ringAsPairs(points: [number, number][]): [number, number][] {
	return points.map(pointAsPair);
}

function ringAsFlatNumbers(points: [number, number][]): number[] {
	return points.flat();
}

/**
 * Serializes area/route coordinate groups for storage in frontmatter. Since
 * edit mode only edits points within existing groups, `groups.length` always
 * matches the number of groups already present in `originalValue`.
 */
export function serializeGroups(
	groups: [number, number][][],
	format: CoordinateFormat,
	originalValue: Value | null
): unknown {
	if (format !== 'same') return serializeGroupsExplicit(groups, format);

	const shape = detectGroupsShape(originalValue);
	if (!shape) return serializeGroupsExplicit(groups, 'commaPairs');

	switch (shape.kind) {
		case 'jsonString':
			return JSON.stringify(groups.length === 1 ? ringAsPairs(groups[0] ?? []) : groups.map(ringAsPairs));

		case 'separatedFlat':
			return rebuildSeparatedFlat(shape.segments, groups);

		case 'nestedRings':
			return groups.map(ring => (shape.itemFormat === 'commaString' ? ringAsCommaStrings(ring) : ringAsPairs(ring)));

		case 'flatRing': {
			const ring = groups[0] ?? [];
			if (shape.itemFormat === 'numberList') return ringAsFlatNumbers(ring);
			if (shape.itemFormat === 'pair') return ringAsPairs(ring);
			return ringAsCommaStrings(ring);
		}
	}
}

function serializeGroupsExplicit(groups: [number, number][][], format: Exclude<CoordinateFormat, 'same'>): unknown {
	const single = groups.length === 1;

	switch (format) {
		case 'commaPairs':
			return single ? ringAsCommaStrings(groups[0] ?? []) : groups.map(ringAsCommaStrings);
		case 'flatNumbers':
			return single ? ringAsFlatNumbers(groups[0] ?? []) : groups.map(ringAsFlatNumbers);
		case 'jsonString':
			return JSON.stringify(single ? ringAsPairs(groups[0] ?? []) : groups.map(ringAsPairs));
		case 'nestedPairs':
		default:
			return single ? ringAsPairs(groups[0] ?? []) : groups.map(ringAsPairs);
	}
}

/** Replaces each coordinate run with its edited group, keeping label entries in place. */
function rebuildSeparatedFlat(segments: FlatSegment[], groups: [number, number][][]): unknown[] {
	const result: unknown[] = [];
	let groupIndex = 0;

	for (const segment of segments) {
		if (segment.type === 'label') {
			result.push(segment.text);
			continue;
		}

		const points = groups[groupIndex++] ?? [];
		for (const point of points) {
			result.push(segment.itemFormat === 'pair' ? pointAsPair(point) : pointAsCommaString(point));
		}
	}

	return result;
}
