import polygonClipping from 'polygon-clipping';
import type { MapShape, OverlapComparator, OverlapRuleConfig } from './types';

type Coordinate = [number, number];
type Polygon = Coordinate[][];
type MultiPolygon = Polygon[];

export interface AreaOverlapLayer {
	id: number;
	sourceAreas: MapShape[];
}

export interface ClassifiedAreaFragment {
	groups: Coordinate[][];
	layerIds: number[];
	ruleIndex: number;
	color: string;
	fillOpacity: number;
}

interface WorkingFragment {
	geometry: MultiPolygon;
	layerIds: number[];
}

/** Splits an area by each counted layer, then applies the first matching rule. */
export function classifyAreaOverlap(
	targetGroups: Coordinate[][],
	layers: AreaOverlapLayer[],
	rules: OverlapRuleConfig[]
): ClassifiedAreaFragment[] {
	const target = toMultiPolygon(targetGroups);
	if (target.length === 0) return [];

	let fragments: WorkingFragment[] = [{ geometry: target, layerIds: [] }];
	for (const layer of layers) {
		const source = unionAreas(layer.sourceAreas);
		if (source.length === 0) continue;

		const next: WorkingFragment[] = [];
		for (const fragment of fragments) {
			let covered: MultiPolygon;
			let uncovered: MultiPolygon;
			try {
				covered = polygonClipping.intersection(fragment.geometry, source);
				uncovered = polygonClipping.difference(fragment.geometry, source);
			}
			catch (error) {
				console.warn('Could not split an overlap fragment:', error);
				next.push(fragment);
				continue;
			}
			if (uncovered.length > 0) next.push({ ...fragment, geometry: uncovered });
			if (covered.length > 0) {
				next.push({ geometry: covered, layerIds: [...fragment.layerIds, layer.id] });
			}
		}
		fragments = next;
	}

	return fragments.flatMap(fragment => {
		const overlapCount = fragment.layerIds.length;
		const ruleIndex = rules.findIndex(rule => compare(overlapCount, rule.comparator, rule.count));
		const rule = rules[ruleIndex];
		if (!rule) return [];

		return fragment.geometry.map(polygon => ({
			groups: polygon.map(ring => fromLngLatRing(ring)),
			layerIds: fragment.layerIds,
			ruleIndex,
			color: rule.color,
			fillOpacity: rule.fillOpacity,
		}));
	});
}

function compare(value: number, comparator: OverlapComparator, target: number): boolean {
	switch (comparator) {
		case '==': return value === target;
		case '!=': return value !== target;
		case '<': return value < target;
		case '>': return value > target;
		case '<=': return value <= target;
		case '>=': return value >= target;
	}
}

function unionAreas(sourceAreas: MapShape[]): MultiPolygon {
	const polygons = sourceAreas
		.filter(shape => shape.kind === 'area')
		.flatMap(shape => shape.groups.map(toPolygon));
	let union: MultiPolygon = [];
	for (const polygon of polygons) {
		try {
			const first = union[0];
			union = first
				? polygonClipping.union(first, ...union.slice(1), polygon)
				: [polygon];
		}
		catch (error) {
			console.warn('Could not add an overlap source polygon:', error);
		}
	}
	return union;
}

function toMultiPolygon(groups: Coordinate[][]): MultiPolygon {
	return groups.map(toPolygon);
}

function toPolygon(group: Coordinate[]): Polygon {
	return [group.map(([lat, lng]) => [lng, lat])];
}

function fromLngLatRing(ring: Coordinate[]): Coordinate[] {
	return ring.map(([lng, lat]) => [lat, lng]);
}
