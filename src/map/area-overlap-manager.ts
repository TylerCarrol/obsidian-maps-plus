import { BasesEntry, BasesPropertyId } from 'obsidian';
import { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { Feature, Polygon } from 'geojson';
import { classifyAreaOverlap, AreaOverlapLayer } from './area-overlap';
import type { MapConfig, MapShape } from './types';
import { toClosedLngLatRing } from './coordinates';

const SOURCE_ID = 'area-overlap';
const FILL_LAYER_ID = 'area-overlap-fill';
const OUTLINE_LAYER_ID = 'area-overlap-outline';

type AreaGeometry = Polygon;

interface OverlapFeatureProperties {
	fillColor: string;
	fillOpacity: number;
	ruleIndex: number;
}

/** Renders target layer fragments produced by the configured overlap rules. */
export class AreaOverlapManager {
	private map: MapLibreMap | null = null;

	setMap(map: MapLibreMap | null): void {
		this.map = map;
	}

	update(shapes: MapShape[], config: MapConfig): void {
		if (!this.map || config.overlapLayerCount < 2 || config.overlapRuleCount < 1) {
			this.clearSource();
			return;
		}

		const areas = shapes.filter(shape => shape.kind === 'area');
		const targetProp = config.overlapLayerProps[0];
		if (!targetProp) {
			this.clearSource();
			return;
		}

		const targetAreas = areas.filter(shape => this.readTruthy(shape.entry, targetProp));
		const sourceLayers: AreaOverlapLayer[] = [];
		for (let index = 1; index < config.overlapLayerCount; index++) {
			const property = config.overlapLayerProps[index];
			if (!property) continue;
			sourceLayers.push({
				id: index,
				sourceAreas: areas.filter(shape => this.readTruthy(shape.entry, property)),
			});
		}

		const features: Feature<AreaGeometry, OverlapFeatureProperties>[] = [];
		for (const target of targetAreas) {
			let fragments;
			try {
				fragments = classifyAreaOverlap(target.groups, sourceLayers, config.overlapRules);
			}
			catch (error) {
				console.warn(`Could not classify overlap for ${target.entry.file.name}:`, error);
				continue;
			}
			for (const fragment of fragments) {
				// Keep interior rings as holes. Rendering each ring as its own polygon
				// would fill the holes and paint lower-priority fragments over them.
				const coordinates = fragment.groups.map(toClosedLngLatRing);
				features.push({
					type: 'Feature',
					geometry: { type: 'Polygon', coordinates },
					properties: {
						fillColor: fragment.color,
						fillOpacity: fragment.fillOpacity,
						ruleIndex: fragment.ruleIndex,
					},
				});
			}
		}

		this.setFeatures(features);
	}

	private setFeatures(features: Feature<AreaGeometry, OverlapFeatureProperties>[]): void {
		if (!this.map) return;
		const data = { type: 'FeatureCollection' as const, features };
		const source = this.map.getSource<GeoJSONSource>(SOURCE_ID);
		const hasLayers = this.map.getLayer(FILL_LAYER_ID) && this.map.getLayer(OUTLINE_LAYER_ID);
		if (source && hasLayers) {
			source.setData(data);
			return;
		}

		if (this.map.getLayer(FILL_LAYER_ID)) this.map.removeLayer(FILL_LAYER_ID);
		if (this.map.getLayer(OUTLINE_LAYER_ID)) this.map.removeLayer(OUTLINE_LAYER_ID);
		if (source) this.map.removeSource(SOURCE_ID);

		this.map.addSource(SOURCE_ID, { type: 'geojson', data });
		this.map.addLayer({
			id: FILL_LAYER_ID,
			type: 'fill',
			source: SOURCE_ID,
			paint: {
				'fill-color': ['get', 'fillColor'],
				'fill-opacity': ['get', 'fillOpacity'],
			},
		});
		this.map.addLayer({
			id: OUTLINE_LAYER_ID,
			type: 'line',
			source: SOURCE_ID,
			paint: {
				'line-color': ['get', 'fillColor'],
				'line-opacity': 0.8,
				'line-width': 1,
			},
		});
	}

	private clearSource(): void {
		this.map?.getSource<GeoJSONSource>(SOURCE_ID)?.setData({
			type: 'FeatureCollection',
			features: [],
		});
	}

	private readTruthy(entry: BasesEntry, prop: BasesPropertyId): boolean {
		try {
			return entry.getValue(prop)?.isTruthy() ?? false;
		}
		catch (error) {
			console.warn(`Could not read overlap eligibility for ${entry.file.name}`, error);
			return false;
		}
	}
}
