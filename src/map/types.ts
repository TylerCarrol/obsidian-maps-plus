import { BasesEntry, BasesPropertyId } from 'obsidian';
import { CoordinateFormat } from './coordinate-format';

/** Resolved view configuration driving how the map and its markers render. */
export interface MapConfig {
	coordinatesProp: BasesPropertyId | null;
	markerIconProp: BasesPropertyId | null;
	markerColorProp: BasesPropertyId | null;
	areaCoordinatesProp: BasesPropertyId | null;
	areaFillColorProp: BasesPropertyId | null;
	areaStrokeColorProp: BasesPropertyId | null;
	overlapLayerCount: number;
	overlapRuleCount: number;
	overlapLayerProps: (BasesPropertyId | null)[];
	overlapRules: OverlapRuleConfig[];
	routeCoordinatesProp: BasesPropertyId | null;
	routeColorProp: BasesPropertyId | null;
	areaPointReductionMode: PointReductionMode;
	areaMaxPoints: number;
	routePointReductionMode: PointReductionMode;
	routeMaxPoints: number;
	mapHeight: number;
	defaultZoom: number;
	/** null when no center is configured, which is distinct from a center of [0, 0]. */
	center: [number, number] | null;
	maxZoom: number;
	minZoom: number;
	mapTiles: string[];
	mapTilesDark: string[];
	currentTileSetId: string | null;
	editModeEnabled: boolean;
	coordinateSaveFormat: CoordinateFormat;
	snapToPointsEnabled: boolean;
}

export type PointReductionMode = 'none' | 'fixed';

export type OverlapComparator = '==' | '!=' | '<' | '>' | '<=' | '>=';

export interface OverlapRuleConfig {
	type: 'layerOverlapCount';
	comparator: OverlapComparator;
	count: number;
	color: string;
	fillOpacity: number;
}

export interface MapMarker {
	entry: BasesEntry;
	coordinates: [number, number];
	/** Lucide icon name, or null for a plain dot. */
	icon: string | null;
	color: string;
	/** Key of the composite image combining icon and color. */
	imageKey: string;
}

export interface MapMarkerProperties {
	entryIndex: number;
	icon: string; // Composite image key combining icon and color
}

export type MapShapeKind = 'area' | 'route';

export interface MapShape {
	entry: BasesEntry;
	kind: MapShapeKind;
	/** [lat, lng] point groups: one per polygon of an area, or per segment of a route. */
	groups: [number, number][][];
	/** Resolved CSS colors, since MapLibre paint properties cannot read CSS variables. */
	fillColor: string;
	strokeColor: string;
	/** 1 when the fill color carries its own alpha, so it is not dimmed twice. */
	fillOpacity: number;
}

export interface MapShapeProperties {
	shapeIndex: number;
	fillColor: string;
	strokeColor: string;
	fillOpacity: number;
}

