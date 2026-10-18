import { Value, ListValue, StringValue, NullValue } from 'obsidian';
import { coordinateFromValue, parseCoordinate, verifyLatLng, toLngLat } from './utils';

/** Minimum points needed before a group of coordinates is a usable polygon ring. */
export const MIN_POLYGON_POINTS = 3;
/** Minimum points needed before a group of coordinates is a usable route segment. */
export const MIN_ROUTE_POINTS = 2;

/**
 * Parses an area property into one ring per polygon.
 *
 * A flat list of coordinates produces a single polygon. Any list item that is not
 * a coordinate acts as a separator, so plain text such as "Mainland" or "Sicily"
 * starts the next polygon of a multi-polygon area.
 */
export function polygonRingsFromValue(value: Value | null): [number, number][][] | null {
	return groupsFromValue(value, MIN_POLYGON_POINTS);
}

/**
 * Parses a route property into one point list per route segment. Non-coordinate
 * items separate segments the same way they separate polygons of an area.
 */
export function routeSegmentsFromValue(value: Value | null): [number, number][][] | null {
	return groupsFromValue(value, MIN_ROUTE_POINTS);
}

/**
 * Converts a [lat, lng] ring to the [lng, lat] order MapLibre expects, repeating
 * the first point at the end so the polygon is explicitly closed.
 */
export function toClosedLngLatRing(points: [number, number][]): [number, number][] {
	const ring = points.map(toLngLat);
	const first = ring[0];
	const last = ring[ring.length - 1];

	if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
		ring.push([first[0], first[1]]);
	}

	return ring;
}

/** Converts a [lat, lng] point list to the [lng, lat] order MapLibre expects. */
export function toLngLatLine(points: [number, number][]): [number, number][] {
	return points.map(toLngLat);
}

function groupsFromValue(value: Value | null, minimumPoints: number): [number, number][][] | null {
	if (value instanceof ListValue) {
		return groupsFromList(value, minimumPoints);
	}

	if (value instanceof StringValue) {
		return groupsFromString(value.toString(), minimumPoints);
	}

	return null;
}

function groupsFromList(value: ListValue, minimumPoints: number): [number, number][][] | null {
	const entries: (Value | null)[] = [];
	for (let index = 0; index < value.length(); index++) {
		const entry = value.get(index);
		entries.push(entry && !Value.equals(entry, NullValue.value) ? entry : null);
	}

	// Nested lists, where each item is itself a full ring or segment
	const nested = entries.map(entry => (entry instanceof ListValue ? pointsFromList(entry, minimumPoints) : null));
	if (nested.length > 0 && nested.every((group): group is [number, number][] => group != null)) {
		return nested;
	}

	const grouped = groupBySeparators(entries.map(entry => (entry ? coordinateFromValue(entry) : null)), minimumPoints);
	if (grouped) return grouped;

	// A flat run of numbers, e.g. ["36.4", "23.3", "36.5", "23.4", ...]
	const flat = flatPointsFromEntries(entries, minimumPoints);
	return flat && [flat];
}

function pointsFromList(value: ListValue, minimumPoints: number): [number, number][] | null {
	const entries: (Value | null)[] = [];
	for (let index = 0; index < value.length(); index++) {
		const entry = value.get(index);
		entries.push(entry && !Value.equals(entry, NullValue.value) ? entry : null);
	}

	const points = entries
		.map(entry => (entry ? coordinateFromValue(entry) : null))
		.filter((point): point is [number, number] => point != null);
	if (points.length >= minimumPoints) return points;

	return flatPointsFromEntries(entries, minimumPoints);
}

function flatPointsFromEntries(entries: (Value | null)[], minimumPoints: number): [number, number][] | null {
	const numbers: number[] = [];
	for (const entry of entries) {
		const number = entry ? parseCoordinate(entry) : null;
		if (number == null) return null;
		numbers.push(number);
	}

	if (numbers.length < minimumPoints * 2 || numbers.length % 2 !== 0) return null;

	const points: [number, number][] = [];
	for (let index = 0; index < numbers.length; index += 2) {
		const lat = numbers[index];
		const lng = numbers[index + 1];
		if (lat == null || lng == null || !verifyLatLng(lat, lng)) return null;
		points.push([lat, lng]);
	}

	return points;
}

function groupsFromString(input: string, minimumPoints: number): [number, number][][] | null {
	const normalized = input.trim();
	if (!normalized) return null;

	const fromJson = groupsFromJsonString(normalized, minimumPoints);
	if (fromJson) return fromJson;

	// Semicolons and newlines separate points; YAML-style bullets are optional
	const segments = normalized
		.split(/[;\n]+/)
		.map(segment => segment.trim().replace(/^-\s+/, ''))
		.filter(segment => segment.length > 0);

	return groupBySeparators(
		segments.map(segment => coordinateFromValue(new StringValue(segment))),
		minimumPoints
	);
}

function groupsFromJsonString(input: string, minimumPoints: number): [number, number][][] | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(input);
	}
	catch {
		return null;
	}

	if (!Array.isArray(parsed)) return null;

	// Distinguish [[[lat, lng], ...], ...] from [[lat, lng], ...]
	const first: unknown = parsed[0];
	const rings: unknown[] = Array.isArray(first) && Array.isArray(first[0]) ? parsed : [parsed];

	const groups = rings
		.map(ring => (Array.isArray(ring) ? pointsFromJsonRing(ring, minimumPoints) : null))
		.filter((group): group is [number, number][] => group != null);

	return groups.length > 0 ? groups : null;
}

function pointsFromJsonRing(ring: unknown[], minimumPoints: number): [number, number][] | null {
	const points: [number, number][] = [];
	for (const item of ring) {
		if (!Array.isArray(item) || item.length < 2) continue;
		const lat = parseCoordinate(item[0]);
		const lng = parseCoordinate(item[1]);
		if (lat == null || lng == null || !verifyLatLng(lat, lng)) continue;
		points.push([lat, lng]);
	}

	return points.length >= minimumPoints ? points : null;
}

/**
 * Splits a run of parsed items into groups, starting a new group at every item
 * that did not parse as a coordinate. Groups that are too short are dropped, so
 * a stray label never discards the polygons around it.
 */
function groupBySeparators(
	items: ([number, number] | null)[],
	minimumPoints: number
): [number, number][][] | null {
	const groups: [number, number][][] = [];
	let current: [number, number][] = [];

	for (const item of items) {
		if (item) {
			current.push(item);
			continue;
		}

		if (current.length >= minimumPoints) groups.push(current);
		current = [];
	}

	if (current.length >= minimumPoints) groups.push(current);

	return groups.length > 0 ? groups : null;
}
