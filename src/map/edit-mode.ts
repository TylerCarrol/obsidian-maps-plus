import { App, Menu, Notice } from 'obsidian';
import { Map as MapLibreMap, GeoJSONSource, MapLayerMouseEvent, MapMouseEvent, Point } from 'maplibre-gl';
import type { Feature, Point as GeoJSONPoint } from 'geojson';
import { MapConfig, MapMarker, MapShape } from './types';
import { toLngLat } from './utils';
import { toClosedLngLatRing, toLngLatLine, MIN_POLYGON_POINTS, MIN_ROUTE_POINTS } from './coordinates';
import { nearestPointOnLine } from './edit-geometry';
import { resolveCssColor } from './color';
import { writeMarkerCoordinates, writeShapeCoordinates, deleteFrontmatterProperty } from './frontmatter-writer';

const POINTS_SOURCE_ID = 'edit-points';
const POINTS_LAYER_ID = 'edit-points-layer';
const PHANTOM_SOURCE_ID = 'edit-phantom-points';
const PHANTOM_LAYER_ID = 'edit-phantom-points-layer';

/** Only offer a phantom "add point" marker when the cursor is within this many screen pixels of the line. */
const PHANTOM_HOVER_THRESHOLD_PX = 24;

/** Snap a dragged point onto another point within this many screen pixels of the cursor. */
const SNAP_THRESHOLD_PX = 14;

interface EditPointProperties {
	kind: 'marker' | 'area' | 'route';
	ownerIndex: number;
	groupIndex: number;
	pointIndex: number;
}

interface PhantomPointProperties {
	ownerIndex: number;
	groupIndex: number;
	insertIndex: number;
}

interface PhantomHit {
	ownerIndex: number;
	groupIndex: number;
	insertIndex: number;
	point: [number, number];
	distanceSquared: number;
}

type DragState =
	| { kind: 'marker'; ownerIndex: number }
	| { kind: 'area' | 'route'; ownerIndex: number; groupIndex: number; pointIndex: number };

/**
 * Renders draggable vertex points over markers and shape outlines when edit mode
 * is on, plus phantom points for adding a vertex to a hovered line, and a
 * delete-point context menu. Edits are written straight back to each note's
 * frontmatter using the view's configured "save coordinates as" format.
 */
export class EditManager {
	private map: MapLibreMap | null = null;
	private app: App;
	private getMapConfig: () => MapConfig | null;
	private getMarkers: () => MapMarker[];
	private getShapes: () => MapShape[];
	private refreshMarkerGeometry: () => void;
	private refreshShapeGeometry: () => void;

	private interactionsBound = false;
	private dragState: DragState | null = null;
	private phantomState: (PhantomPointProperties & { point: [number, number] }) | null = null;

	constructor(
		app: App,
		getMapConfig: () => MapConfig | null,
		getMarkers: () => MapMarker[],
		getShapes: () => MapShape[],
		refreshMarkerGeometry: () => void,
		refreshShapeGeometry: () => void
	) {
		this.app = app;
		this.getMapConfig = getMapConfig;
		this.getMarkers = getMarkers;
		this.getShapes = getShapes;
		this.refreshMarkerGeometry = refreshMarkerGeometry;
		this.refreshShapeGeometry = refreshShapeGeometry;
	}

	setMap(map: MapLibreMap | null): void {
		this.map = map;
		// Listeners belong to the map instance, so a new map needs its own
		this.interactionsBound = false;
		this.dragState = null;
		this.phantomState = null;
	}

	/** Rebuilds the edit-mode layers from the current markers/shapes. Call after every data refresh. */
	update(): void {
		if (!this.map) return;

		const mapConfig = this.getMapConfig();
		const enabled = mapConfig?.editModeEnabled ?? false;

		if (!enabled) {
			this.dragState = null;
			this.phantomState = null;
		}

		this.ensureLayers();
		this.renderPoints();
		this.renderPhantom(null);
	}

	private ensureLayers(): void {
		if (!this.map) return;

		if (!this.map.getSource(POINTS_SOURCE_ID)) {
			this.map.addSource(POINTS_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
			this.map.addLayer({
				id: POINTS_LAYER_ID,
				type: 'circle',
				source: POINTS_SOURCE_ID,
				paint: {
					'circle-radius': 9,
					// MapLibre's style parser can't resolve CSS custom properties, so these need concrete values
					'circle-color': resolveCssColor('var(--interactive-accent)'),
					'circle-stroke-color': resolveCssColor('var(--background-primary)'),
					'circle-stroke-width': 2,
				},
			});
		}

		if (!this.map.getSource(PHANTOM_SOURCE_ID)) {
			this.map.addSource(PHANTOM_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
			this.map.addLayer({
				id: PHANTOM_LAYER_ID,
				type: 'circle',
				source: PHANTOM_SOURCE_ID,
				paint: {
					'circle-radius': 7,
					'circle-color': resolveCssColor('var(--text-faint)'),
					'circle-stroke-color': resolveCssColor('var(--background-primary)'),
					'circle-stroke-width': 1.5,
					'circle-opacity': 0.8,
				},
			});
		}

		this.setupInteractions();
	}

	private renderPoints(): void {
		const source = this.map?.getSource<GeoJSONSource>(POINTS_SOURCE_ID);
		if (!source) return;

		const mapConfig = this.getMapConfig();
		const features: Feature<GeoJSONPoint, EditPointProperties>[] = [];

		if (mapConfig?.editModeEnabled) {
			this.getMarkers().forEach((marker, ownerIndex) => {
				features.push(this.pointFeature(marker.coordinates, { kind: 'marker', ownerIndex, groupIndex: 0, pointIndex: 0 }));
			});

			this.getShapes().forEach((shape, ownerIndex) => {
				shape.groups.forEach((group, groupIndex) => {
					group.forEach((point, pointIndex) => {
						features.push(this.pointFeature(point, { kind: shape.kind, ownerIndex, groupIndex, pointIndex }));
					});
				});
			});
		}

		source.setData({ type: 'FeatureCollection', features });
	}

	private renderPhantom(hit: (PhantomPointProperties & { point: [number, number] }) | null): void {
		const source = this.map?.getSource<GeoJSONSource>(PHANTOM_SOURCE_ID);
		if (!source) return;

		this.phantomState = hit;

		const features: Feature<GeoJSONPoint, PhantomPointProperties>[] = hit
			? [this.pointFeature(hit.point, { ownerIndex: hit.ownerIndex, groupIndex: hit.groupIndex, insertIndex: hit.insertIndex })]
			: [];

		source.setData({ type: 'FeatureCollection', features });
	}

	private pointFeature<P>(point: [number, number], properties: P): Feature<GeoJSONPoint, P> {
		return {
			type: 'Feature',
			geometry: { type: 'Point', coordinates: toLngLat(point) },
			properties,
		};
	}

	private setupInteractions(): void {
		if (!this.map || this.interactionsBound) return;
		this.interactionsBound = true;
		const map = this.map;

		map.on('mouseenter', POINTS_LAYER_ID, () => map.getCanvas().addClass('is-over-edit-point'));
		map.on('mouseleave', POINTS_LAYER_ID, () => map.getCanvas().removeClass('is-over-edit-point'));

		map.on('mousedown', POINTS_LAYER_ID, (e: MapLayerMouseEvent) => this.beginDrag(e));
		map.on('mousemove', (e: MapMouseEvent) => {
			if (this.dragState) {
				this.continueDrag(e);
				return;
			}
			this.updatePhantomHover(e);
		});
		map.on('mouseup', () => this.endDrag());

		map.on('mouseenter', PHANTOM_LAYER_ID, () => map.getCanvas().addClass('is-over-edit-point'));
		map.on('mouseleave', PHANTOM_LAYER_ID, () => map.getCanvas().removeClass('is-over-edit-point'));
		map.on('click', PHANTOM_LAYER_ID, () => this.addPhantomPoint());
	}

	private pointRefFromFeature(e: MapLayerMouseEvent): EditPointProperties | null {
		return this.pointRefFromProperties(e.features?.[0]?.properties);
	}

	private pointRefFromProperties(properties: unknown): EditPointProperties | null {
		if (!properties || typeof properties !== 'object') return null;
		const { kind, ownerIndex, groupIndex, pointIndex } = properties as Partial<EditPointProperties>;
		if (
			(kind !== 'marker' && kind !== 'area' && kind !== 'route') ||
			typeof ownerIndex !== 'number' ||
			typeof groupIndex !== 'number' ||
			typeof pointIndex !== 'number'
		) return null;

		return { kind, ownerIndex, groupIndex, pointIndex };
	}

	private beginDrag(e: MapLayerMouseEvent): void {
		if (!this.map || !this.getMapConfig()?.editModeEnabled) return;
		const ref = this.pointRefFromFeature(e);
		if (!ref) return;

		e.preventDefault();
		this.map.dragPan.disable();
		this.map.getCanvas().addClass('is-dragging-edit-point');
		this.dragState = ref.kind === 'marker'
			? { kind: 'marker', ownerIndex: ref.ownerIndex }
			: { kind: ref.kind, ownerIndex: ref.ownerIndex, groupIndex: ref.groupIndex, pointIndex: ref.pointIndex };
	}

	private continueDrag(e: MapMouseEvent): void {
		if (!this.dragState || !this.map) return;

		const point = this.snapPoint(this.dragState, [e.point.x, e.point.y]) ?? [e.lngLat.lat, e.lngLat.lng];

		if (this.dragState.kind === 'marker') {
			const marker = this.getMarkers()[this.dragState.ownerIndex];
			if (!marker) return;
			marker.coordinates = point;
			this.refreshMarkerGeometry();
		}
		else {
			const shape = this.getShapes()[this.dragState.ownerIndex];
			const group = shape?.groups[this.dragState.groupIndex];
			if (!group) return;
			group[this.dragState.pointIndex] = point;
			this.refreshShapeGeometry();
		}

		this.renderPoints();
	}

	/** Snaps onto the nearest other point within threshold, so adjoining shapes can share exact vertices. */
	private snapPoint(dragState: DragState, cursorPixel: [number, number]): [number, number] | null {
		if (!this.map || !this.getMapConfig()?.snapToPointsEnabled) return null;

		const candidates: [number, number][] = [];

		for (const [ownerIndex, marker] of this.getMarkers().entries()) {
			if (dragState.kind === 'marker' && ownerIndex === dragState.ownerIndex) continue;
			candidates.push(marker.coordinates);
		}

		for (const [ownerIndex, shape] of this.getShapes().entries()) {
			for (const [groupIndex, group] of shape.groups.entries()) {
				for (const [pointIndex, candidate] of group.entries()) {
					const isDraggedPoint = dragState.kind !== 'marker' && ownerIndex === dragState.ownerIndex &&
						groupIndex === dragState.groupIndex && pointIndex === dragState.pointIndex;
					if (isDraggedPoint) continue;
					candidates.push(candidate);
				}
			}
		}

		let bestPoint: [number, number] | null = null;
		let bestDistanceSquared = SNAP_THRESHOLD_PX * SNAP_THRESHOLD_PX;

		for (const candidate of candidates) {
			const pixel = this.map.project(toLngLat(candidate));
			const dx = cursorPixel[0] - pixel.x;
			const dy = cursorPixel[1] - pixel.y;
			const distanceSquared = dx * dx + dy * dy;
			if (distanceSquared > bestDistanceSquared) continue;

			bestPoint = candidate;
			bestDistanceSquared = distanceSquared;
		}

		return bestPoint;
	}

	private endDrag(): void {
		if (!this.map || !this.dragState) return;
		const dragState = this.dragState;
		this.dragState = null;
		this.map.dragPan.enable();
		this.map.getCanvas().removeClass('is-dragging-edit-point');

		void this.writeBackAfterEdit(dragState.kind, dragState.ownerIndex);
	}

	private async writeBackAfterEdit(kind: 'marker' | 'area' | 'route', ownerIndex: number): Promise<void> {
		const mapConfig = this.getMapConfig();
		if (!mapConfig) return;

		try {
			if (kind === 'marker') {
				const marker = this.getMarkers()[ownerIndex];
				if (marker && mapConfig.coordinatesProp) {
					await writeMarkerCoordinates(this.app, marker.entry, mapConfig.coordinatesProp, marker.coordinates, mapConfig.coordinateSaveFormat);
				}
				return;
			}

			const shape = this.getShapes()[ownerIndex];
			const prop = kind === 'area' ? mapConfig.areaCoordinatesProp : mapConfig.routeCoordinatesProp;
			if (shape && prop) {
				await writeShapeCoordinates(this.app, shape.entry, prop, shape.groups, mapConfig.coordinateSaveFormat);
			}
		}
		catch (error) {
			console.error('Failed to save edited coordinates:', error);
			new Notice('Could not save the edited coordinates. See console for details.');
		}
	}

	/** Scans every shape's geometry directly, since a hovered line is often only a couple of pixels wide. */
	private updatePhantomHover(e: MapMouseEvent): void {
		if (!this.map || !this.getMapConfig()?.editModeEnabled) return;

		const cursor: [number, number] = [e.point.x, e.point.y];
		let best: PhantomHit | null = null;

		for (const [shapeIndex, shape] of this.getShapes().entries()) {
			for (const [groupIndex, group] of shape.groups.entries()) {
				const testLine = (shape.kind === 'area' ? toClosedLngLatRing(group) : toLngLatLine(group))
					.map(lngLat => this.map!.project(lngLat))
					.map((p: Point): [number, number] => [p.x, p.y]);

				const hit = nearestPointOnLine(cursor, testLine);
				if (!hit) continue;

				const dx = cursor[0] - hit.point[0];
				const dy = cursor[1] - hit.point[1];
				const distanceSquared = dx * dx + dy * dy;
				if (distanceSquared > PHANTOM_HOVER_THRESHOLD_PX * PHANTOM_HOVER_THRESHOLD_PX) continue;
				if (best && distanceSquared >= best.distanceSquared) continue;

				const insertIndex = Math.min(hit.segmentIndex + 1, group.length);
				best = { ownerIndex: shapeIndex, groupIndex, insertIndex, point: this.unprojectPoint(hit.point), distanceSquared };
			}
		}

		this.renderPhantom(best);
	}

	private unprojectPoint(pixel: [number, number]): [number, number] {
		const lngLat = this.map!.unproject(pixel);
		return [lngLat.lat, lngLat.lng];
	}

	private addPhantomPoint(): void {
		const hit = this.phantomState;
		if (!hit) return;

		const shape = this.getShapes()[hit.ownerIndex];
		const group = shape?.groups[hit.groupIndex];
		if (!shape || !group) return;

		group.splice(hit.insertIndex, 0, hit.point);
		this.refreshShapeGeometry();
		this.renderPoints();
		this.renderPhantom(null);

		void this.writeBackAfterEdit(shape.kind, hit.ownerIndex);
	}

	/** Called from the view's own context-menu handler, so a right-click on a point shows "Delete point" instead of the general map menu. */
	tryHandleContextMenu(evt: MouseEvent): boolean {
		if (!this.map || !this.getMapConfig()?.editModeEnabled) return false;

		const point: [number, number] = [evt.offsetX, evt.offsetY];
		const features = this.map.queryRenderedFeatures(point, { layers: [POINTS_LAYER_ID] });
		const ref = this.pointRefFromProperties(features[0]?.properties);
		if (!ref) return false;

		const menu = Menu.forEvent(evt);
		menu.addItem(item => item
			.setSection('danger')
			.setTitle('Delete point')
			.setIcon('trash-2')
			.setWarning(true)
			.onClick(() => this.deletePoint(ref)));

		return true;
	}

	private deletePoint(ref: EditPointProperties): void {
		const mapConfig = this.getMapConfig();
		if (!mapConfig) return;

		if (ref.kind === 'marker') {
			const marker = this.getMarkers()[ref.ownerIndex];
			if (!marker || !mapConfig.coordinatesProp) return;

			void deleteFrontmatterProperty(this.app, marker.entry, mapConfig.coordinatesProp).catch(error => {
				console.error('Failed to delete marker coordinates:', error);
				new Notice('Could not delete the marker point. See console for details.');
			});
			return;
		}

		const shape = this.getShapes()[ref.ownerIndex];
		const group = shape?.groups[ref.groupIndex];
		if (!shape || !group) return;

		const minimumPoints = ref.kind === 'area' ? MIN_POLYGON_POINTS : MIN_ROUTE_POINTS;
		if (group.length <= minimumPoints) {
			new Notice(`A ${ref.kind === 'area' ? 'polygon' : 'route'} needs at least ${minimumPoints} points.`);
			return;
		}

		group.splice(ref.pointIndex, 1);
		this.refreshShapeGeometry();
		this.renderPoints();

		void this.writeBackAfterEdit(ref.kind, ref.ownerIndex);
	}
}
