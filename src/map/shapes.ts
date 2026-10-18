import { App, BasesEntry, BasesPropertyId, Keymap, Menu, Value } from 'obsidian';
import { Map as MapLibreMap, LngLatBounds, GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl';
import type { Feature, LineString, MultiLineString, MultiPolygon, Polygon } from 'geojson';
import { MapConfig, MapShape, MapShapeProperties } from './types';
import { polygonRingsFromValue, routeSegmentsFromValue, toClosedLngLatRing, toLngLatLine } from './coordinates';
import { reducePointGroup } from './point-reduction';
import { resolveCssColor } from './color';
import {
	DEFAULT_AREA_FILL_COLOR,
	DEFAULT_AREA_FILL_OPACITY,
	DEFAULT_AREA_STROKE_COLOR,
	DEFAULT_AREA_STROKE_WIDTH,
	DEFAULT_ROUTE_COLOR,
	DEFAULT_ROUTE_WIDTH,
} from './constants';
import { PopupManager } from './popup';

const SOURCE_ID = 'shapes';
const AREA_FILL_LAYER_ID = 'shape-area-fill';
const AREA_OUTLINE_LAYER_ID = 'shape-area-outline';
const ROUTE_LAYER_ID = 'shape-route-line';
const INTERACTIVE_LAYER_IDS = [AREA_FILL_LAYER_ID, AREA_OUTLINE_LAYER_ID, ROUTE_LAYER_ID];

type ShapeGeometry = Polygon | MultiPolygon | LineString | MultiLineString;

/** The Bases query results the shapes are rendered from. */
interface ShapeData {
	data: BasesEntry[];
	properties?: BasesPropertyId[];
}

/**
 * Renders area polygons and route lines below the marker layers. Areas support
 * multiple polygons per note, so a country made of a mainland and its islands
 * stays a single entry.
 */
export class ShapeManager {
	private map: MapLibreMap | null = null;
	private app: App;
	private mapEl: HTMLElement;
	private shapes: MapShape[] = [];
	private bounds: LngLatBounds | null = null;
	// Interactions are layer-scoped and survive setStyle, so they bind only once
	private interactionsBound = false;
	private popupManager: PopupManager;
	private onOpenFile: (path: string, newLeaf: boolean) => void;
	private getData: () => ShapeData | null;
	private getMapConfig: () => MapConfig | null;
	private getDisplayName: (prop: BasesPropertyId) => string;

	constructor(
		app: App,
		mapEl: HTMLElement,
		popupManager: PopupManager,
		onOpenFile: (path: string, newLeaf: boolean) => void,
		getData: () => ShapeData | null,
		getMapConfig: () => MapConfig | null,
		getDisplayName: (prop: BasesPropertyId) => string
	) {
		this.app = app;
		this.mapEl = mapEl;
		this.popupManager = popupManager;
		this.onOpenFile = onOpenFile;
		this.getData = getData;
		this.getMapConfig = getMapConfig;
		this.getDisplayName = getDisplayName;
	}

	setMap(map: MapLibreMap | null): void {
		this.map = map;
		// Listeners belong to the map instance, so a new map needs its own
		this.interactionsBound = false;
	}

	getBounds(): LngLatBounds | null {
		return this.bounds;
	}

	getShapes(): MapShape[] {
		return this.shapes;
	}

	/** Re-renders the current shapes without re-reading them from the query results, for live drag feedback. */
	refreshGeometry(): void {
		const source = this.map?.getSource<GeoJSONSource>(SOURCE_ID);
		if (!source) return;

		source.setData({ type: 'FeatureCollection', features: this.createFeatures() });
	}

	updateShapes(data: { data: BasesEntry[] }): void {
		const mapConfig = this.getMapConfig();
		if (!this.map || !data || !mapConfig) return;

		this.shapes = this.collectShapes(data.data, mapConfig);

		const bounds = new LngLatBounds();
		let hasBounds = false;
		for (const shape of this.shapes) {
			for (const group of shape.groups) {
				for (const [lat, lng] of group) {
					bounds.extend([lng, lat]);
					hasBounds = true;
				}
			}
		}

		this.bounds = hasBounds ? bounds : null;
		const features = this.createFeatures();

		const source = this.map.getSource<GeoJSONSource>(SOURCE_ID);
		if (source) {
			source.setData({ type: 'FeatureCollection', features });
		} else {
			this.map.addSource(SOURCE_ID, {
				type: 'geojson',
				data: { type: 'FeatureCollection', features },
			});
			this.addShapeLayers();
			this.setupShapeInteractions();
		}
	}

	private collectShapes(entries: BasesEntry[], mapConfig: MapConfig): MapShape[] {
		const shapes: MapShape[] = [];

		for (const entry of entries) {
			if (!entry) continue;

			const areaGroups = this.readGroups(entry, mapConfig.areaCoordinatesProp, polygonRingsFromValue);
			if (areaGroups) {
				const fillColor = this.readColor(entry, mapConfig.areaFillColorProp, DEFAULT_AREA_FILL_COLOR);
				shapes.push({
					entry,
					kind: 'area',
					groups: areaGroups,
					fillColor,
					strokeColor: this.readColor(entry, mapConfig.areaStrokeColorProp, DEFAULT_AREA_STROKE_COLOR),
					// A resolved color only reports rgba() when it carries its own alpha
					fillOpacity: fillColor.startsWith('rgba(') ? 1 : DEFAULT_AREA_FILL_OPACITY,
				});
			}

			const routeGroups = this.readGroups(entry, mapConfig.routeCoordinatesProp, routeSegmentsFromValue);
			if (routeGroups) {
				const routeColor = this.readColor(entry, mapConfig.routeColorProp, DEFAULT_ROUTE_COLOR);
				shapes.push({
					entry,
					kind: 'route',
					groups: routeGroups,
					fillColor: routeColor,
					strokeColor: routeColor,
					fillOpacity: 1,
				});
			}
		}

		return shapes;
	}

	private readGroups(
		entry: BasesEntry,
		prop: BasesPropertyId | null,
		parse: (value: Value | null) => [number, number][][] | null
	): [number, number][][] | null {
		if (!prop) return null;

		try {
			return parse(entry.getValue(prop));
		}
		catch (error) {
			console.warn(`Could not read shape coordinates for ${entry.file.name}`, error);
			return null;
		}
	}

	/** Reads a color property, falling back to the default, and resolves CSS variables. */
	private readColor(entry: BasesEntry, prop: BasesPropertyId | null, fallback: string): string {
		let color: string | null = null;

		if (prop) {
			try {
				const value = entry.getValue(prop);
				color = value?.isTruthy() ? value.toString().trim() || null : null;
			}
			catch (error) {
				console.warn(`Could not read shape color for ${entry.file.name}`, error);
			}
		}

		return resolveCssColor(color ?? fallback);
	}

	private createFeatures(): Feature<ShapeGeometry, MapShapeProperties>[] {
		return this.shapes.map((shape, shapeIndex) => ({
			type: 'Feature',
			geometry: this.createGeometry(shape),
			properties: {
				shapeIndex,
				fillColor: shape.fillColor,
				strokeColor: shape.strokeColor,
				fillOpacity: shape.fillOpacity,
			},
		}));
	}

	private createGeometry(shape: MapShape): ShapeGeometry {
		const mapConfig = this.getMapConfig();
		const reductionMode = shape.kind === 'area'
			? mapConfig?.areaPointReductionMode
			: mapConfig?.routePointReductionMode;
		const configuredBudget = shape.kind === 'area'
			? mapConfig?.areaMaxPoints
			: mapConfig?.routeMaxPoints;
		const budget = reductionMode === 'fixed' && configuredBudget !== undefined
			? configuredBudget
			: null;
		const groups = budget === null
			? shape.groups
			: shape.groups.map(group => reducePointGroup(
				group,
				budget,
				shape.kind === 'area' ? 3 : 2,
			));
		if (shape.kind === 'area') {
			// Each group is the exterior ring of its own polygon
			const polygons = groups.map(group => [toClosedLngLatRing(group)]);
			return polygons.length === 1 && polygons[0]
				? { type: 'Polygon', coordinates: polygons[0] }
				: { type: 'MultiPolygon', coordinates: polygons };
		}

		const lines = groups.map(toLngLatLine);
		return lines.length === 1 && lines[0]
			? { type: 'LineString', coordinates: lines[0] }
			: { type: 'MultiLineString', coordinates: lines };
	}

	private addShapeLayers(): void {
		if (!this.map) return;

		this.map.addLayer({
			id: AREA_FILL_LAYER_ID,
			type: 'fill',
			source: SOURCE_ID,
			filter: ['==', '$type', 'Polygon'],
			paint: {
				'fill-color': ['get', 'fillColor'],
				'fill-opacity': ['get', 'fillOpacity'],
			},
		});

		this.map.addLayer({
			id: AREA_OUTLINE_LAYER_ID,
			type: 'line',
			source: SOURCE_ID,
			filter: ['==', '$type', 'Polygon'],
			paint: {
				'line-color': ['get', 'strokeColor'],
				'line-width': DEFAULT_AREA_STROKE_WIDTH,
			},
		});

		this.map.addLayer({
			id: ROUTE_LAYER_ID,
			type: 'line',
			source: SOURCE_ID,
			filter: ['==', '$type', 'LineString'],
			layout: {
				'line-cap': 'round',
				'line-join': 'round',
			},
			paint: {
				'line-color': ['get', 'strokeColor'],
				'line-width': DEFAULT_ROUTE_WIDTH,
			},
		});
	}

	/** Resolves the shape a layer event refers to, or null if it hit nothing known. */
	private shapeFromEvent(e: MapLayerMouseEvent): MapShape | null {
		// GeoJSON feature properties are untyped, so confirm the index really is one
		const shapeIndex: unknown = e.features?.[0]?.properties?.shapeIndex;
		if (typeof shapeIndex !== 'number') return null;
		return this.shapes[shapeIndex] ?? null;
	}

	private setupShapeInteractions(): void {
		// Layers are recreated under the same id after a style change, but these
		// listeners are bound to the map, not the layer, so they outlive it
		if (!this.map || this.interactionsBound) return;
		this.interactionsBound = true;

		for (const layerId of INTERACTIVE_LAYER_IDS) {
			this.map.on('mouseenter', layerId, () => {
				this.map?.getCanvas().addClass('is-over-map-feature');
			});

			this.map.on('mouseleave', layerId, () => {
				this.map?.getCanvas().removeClass('is-over-map-feature');
				this.popupManager.hidePopup();
			});

			this.map.on('mouseenter', layerId, (e: MapLayerMouseEvent) => this.showShapePopup(e));

			this.map.on('click', layerId, (e: MapLayerMouseEvent) => {
				// In edit mode, clicking a shape should not navigate away from the map
				if (this.getMapConfig()?.editModeEnabled) return;

				const shape = this.shapeFromEvent(e);
				if (!shape) return;

				const newLeaf = e.originalEvent ? Boolean(Keymap.isModEvent(e.originalEvent)) : false;
				this.onOpenFile(shape.entry.file.path, newLeaf);
			});

			this.map.on('contextmenu', layerId, (e: MapLayerMouseEvent) => {
				const shape = this.shapeFromEvent(e);
				if (!shape) return;

				e.preventDefault();
				const file = shape.entry.file;
				const menu = Menu.forEvent(e.originalEvent);
				this.app.workspace.handleLinkContextMenu(menu, file.path, '');

				menu.addItem(item => item
					.setSection('danger')
					.setTitle('Delete file')
					.setIcon('trash-2')
					.setWarning(true)
					.onClick(() => this.app.fileManager.promptForDeletion(file)));
			});

			this.map.on('mouseover', layerId, (e: MapLayerMouseEvent) => {
				const shape = this.shapeFromEvent(e);
				if (!shape) return;

				this.app.workspace.trigger('hover-link', {
					event: e.originalEvent,
					source: 'bases',
					hoverParent: this.app.renderContext,
					targetEl: this.mapEl,
					linktext: shape.entry.file.path,
				});
			});
		}
	}

	/** Anchors the popup to the pointer, since a shape has no single obvious point. */
	private showShapePopup(e: MapLayerMouseEvent): void {
		const shape = this.shapeFromEvent(e);
		if (!shape) return;

		const data = this.getData();
		const mapConfig = this.getMapConfig();
		if (!data || !data.properties || !mapConfig) return;

		this.popupManager.showPopup(
			shape.entry,
			[e.lngLat.lat, e.lngLat.lng],
			data.properties,
			this.getShapeDrivenProps(mapConfig),
			this.getDisplayName
		);
	}

	/** Properties already represented by the shape itself, so popups skip them. */
	private getShapeDrivenProps(mapConfig: MapConfig): BasesPropertyId[] {
		return [
			mapConfig.areaCoordinatesProp,
			mapConfig.areaFillColorProp,
			mapConfig.areaStrokeColorProp,
			mapConfig.routeCoordinatesProp,
			mapConfig.routeColorProp,
		].filter((prop): prop is BasesPropertyId => prop != null);
	}
}
