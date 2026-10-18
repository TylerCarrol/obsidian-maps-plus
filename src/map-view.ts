import {
	BasesView,
	debounce,
	Menu,
	Platform,
	QueryController,
	Value,
	StringValue,
	NullValue,
	BasesAllOptions,
	BasesViewConfig,
	BasesOptions,
} from 'obsidian';
import { Map, setRTLTextPlugin, LngLatBounds } from 'maplibre-gl';
import type ObsidianMapsPlugin from './main';
import { DEFAULT_MAP_HEIGHT, DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from './map/constants';
import { CustomZoomControl } from './map/controls/zoom-control';
import { CustomGeolocateControl } from './map/controls/geolocate-control';
import { BackgroundSwitcherControl } from './map/controls/background-switcher';
import { StyleManager } from './map/style';
import { PopupManager } from './map/popup';
import { MarkerManager } from './map/markers';
import { ShapeManager } from './map/shapes';
import { AreaOverlapManager } from './map/area-overlap-manager';
import { EditManager } from './map/edit-mode';
import { MapConfig } from './map/types';
import { OverlapComparator, OverlapRuleConfig, PointReductionMode } from './map/types';
import { hasOwnProperty, coordinateFromValue, toLngLat, roundCoordinate, formatCoordinates, sameCoordinates } from './map/utils';
import { propertyKeyFromId } from './map/frontmatter-writer';
import { CoordinateFormat, COORDINATE_FORMAT_LABELS } from './map/coordinate-format';
import { rtlPluginCode } from './map/rtl-plugin-code';

export const MapViewType = 'maps-plus';

/** Raw config values watched for changes. Values stay unknown; only equality matters. */
interface ConfigSnapshot {
	center: unknown;
	defaultZoom: unknown;
	minZoom: unknown;
	maxZoom: unknown;
	mapHeight: unknown;
	mapTiles: unknown;
	mapTilesDark: unknown;
	areaPointReductionMode: unknown;
	areaMaxPoints: unknown;
	routePointReductionMode: unknown;
	routeMaxPoints: unknown;
}

export class MapView extends BasesView {
	type = MapViewType;
	scrollEl: HTMLElement;
	containerEl: HTMLElement;
	mapEl: HTMLElement;
	plugin: ObsidianMapsPlugin;

	// Internal rendering data
	private map: Map | null = null;
	private mapConfig: MapConfig | null = null;
	private pendingMapState: { center?: { lng: number, lat: number }, zoom?: number } | null = null;
	private isFirstLoad = true;
	private lastConfigSnapshot: ConfigSnapshot | null = null;
	private lastEvaluatedCenter: [number, number] | null = null;
	private dataUpdateVersion = 0;

	// Managers
	private styleManager: StyleManager;
	private popupManager: PopupManager;
	private markerManager: MarkerManager;
	private shapeManager: ShapeManager;
	private areaOverlapManager: AreaOverlapManager;
	private editManager: EditManager;

	// Static flag to track RTL plugin initialization
	private static rtlPluginInitialized = false;

	constructor(controller: QueryController, scrollEl: HTMLElement, plugin: ObsidianMapsPlugin) {
		super(controller);
		this.scrollEl = scrollEl;
		this.plugin = plugin;
		this.containerEl = scrollEl.createDiv({ cls: 'bases-map-container is-loading', attr: { tabIndex: 0 } });
		this.mapEl = this.containerEl.createDiv('bases-map');

		// Initialize managers
		this.styleManager = new StyleManager(this.app);
		this.popupManager = new PopupManager(this.containerEl, this.app);
		this.markerManager = new MarkerManager(
			this.app,
			this.mapEl,
			this.popupManager,
			(path, newLeaf) => void this.app.workspace.openLinkText(path, '', newLeaf),
			() => this.data,
			() => this.mapConfig,
			(prop) => this.config.getDisplayName(prop)
		);
		this.shapeManager = new ShapeManager(
			this.app,
			this.mapEl,
			this.popupManager,
			(path, newLeaf) => void this.app.workspace.openLinkText(path, '', newLeaf),
			() => this.data,
			() => this.mapConfig,
			(prop) => this.config.getDisplayName(prop)
		);
		this.areaOverlapManager = new AreaOverlapManager();
		this.editManager = new EditManager(
			this.app,
			() => this.mapConfig,
			() => this.markerManager.getMarkers(),
			() => this.shapeManager.getShapes(),
			() => this.markerManager.refreshGeometry(),
			() => {
				this.shapeManager.refreshGeometry();
				this.updateAreaOverlap();
			}
		);
	}

	onload(): void {
		// Listen for theme changes to update map tiles
		this.registerEvent(this.app.workspace.on('css-change', this.onThemeChange, this));

		// Add context menu to map
		this.registerDomEvent(this.mapEl, 'contextmenu', (evt) => {
			evt.preventDefault();
			this.showMapContextMenu(evt);
		});
	}

	onunload() {
		this.destroyMap();
	}

	/** Reduce flashing due to map re-rendering by debouncing while resizes are still ocurring. */
	private onResizeDebounce = debounce(
		() => { if (this.map) this.map.resize() },
		100,
		true);

	onResize(): void {
		this.onResizeDebounce();
	}

	public focus(): void {
		this.containerEl.focus({ preventScroll: true });
	}

	private onThemeChange = (): void => {
		if (this.map) {
			void this.updateMapStyle();
		}
	};

	private async updateMapStyle(): Promise<void> {
		if (!this.map || !this.mapConfig) return;
		const newStyle = await this.styleManager.getMapStyle(this.mapConfig.mapTiles, this.mapConfig.mapTilesDark);
		this.map.setStyle(newStyle);
		this.markerManager.clearLoadedIcons();
		await this.renderDataAfterStyle();
	}

	private async switchToTileSet(tileSetId: string): Promise<void> {
		const tileSet = this.plugin.settings.tileSets.find(ts => ts.id === tileSetId);
		if (!tileSet || !this.mapConfig) return;

		this.mapConfig.currentTileSetId = tileSetId;

		// Update the current tiles
		this.mapConfig.mapTiles = tileSet.lightTiles ? [tileSet.lightTiles] : [];
		this.mapConfig.mapTilesDark = tileSet.darkTiles
			? [tileSet.darkTiles]
			: (tileSet.lightTiles ? [tileSet.lightTiles] : []);

		// Update the map style
		await this.updateMapStyle();
	}

	private async initializeMap(): Promise<void> {
		if (this.map) return;

		// Initialize RTL text plugin once
		if (!MapView.rtlPluginInitialized) {
			try {
				// Create a blob URL from the bundled RTL plugin code
				// The plugin needs to run in a worker context
				const blob = new Blob([rtlPluginCode], { type: 'application/javascript' });
				const blobURL = URL.createObjectURL(blob);
				// Set lazy loading to false - plugin is initialized since code is already bundled
				void setRTLTextPlugin(blobURL, false);
				MapView.rtlPluginInitialized = true;
			} catch (error) {
				console.warn('Failed to initialize RTL text plugin:', error);
			}
		}

		// Load config first
		const currentTileSetId = this.mapConfig?.currentTileSetId || null;
		this.mapConfig = this.loadConfig(currentTileSetId);

		// Set initial map height based on context
		this.applyMapHeight();

		// Get the map style (may involve fetching remote style JSON)
		const mapStyle = await this.styleManager.getMapStyle(this.mapConfig.mapTiles, this.mapConfig.mapTilesDark);

		// Determine initial position: prefer ephemeral state if available, otherwise use config.
		// An unconfigured center starts at the default and is corrected to the marker
		// bounds once the style has loaded.
		let initialCenter = toLngLat(this.mapConfig.center ?? DEFAULT_MAP_CENTER);
		let initialZoom = this.mapConfig.defaultZoom;

		// Capture if we are starting with a pending state restoration
		const isRestoringState = this.pendingMapState !== null;

		const pendingCenter = this.pendingMapState?.center;
		if (pendingCenter) initialCenter = [pendingCenter.lng, pendingCenter.lat];
		initialZoom = this.pendingMapState?.zoom ?? initialZoom;

		// Initialize MapLibre GL JS map with configured tiles or default style
		this.map = new Map({
			container: this.mapEl,
			style: mapStyle,
			center: initialCenter,
			zoom: initialZoom,
			minZoom: this.mapConfig.minZoom,
			maxZoom: this.mapConfig.maxZoom,
		});

		// Set map reference in managers
		this.popupManager.setMap(this.map);
		this.markerManager.setMap(this.map);
		this.shapeManager.setMap(this.map);
		this.areaOverlapManager.setMap(this.map);
		this.editManager.setMap(this.map);

		this.map.addControl(new CustomZoomControl(), 'top-right');

		// Desktop Electron grants the geolocation permission but has no location
		// provider behind it, so requests hang until they time out
		if (Platform.isMobileApp) {
			this.map.addControl(new CustomGeolocateControl(), 'top-right');
		}

		// Add background switcher if multiple tile sets are available
		if (this.plugin.settings.tileSets.length > 1) {
			const currentId = this.mapConfig.currentTileSetId || this.plugin.settings.tileSets[0]?.id || '';
			if (currentId) {
				this.map.addControl(
					new BackgroundSwitcherControl(
						this.plugin.settings.tileSets,
						currentId,
						(tileSetId) => void this.switchToTileSet(tileSetId)
					),
					'top-right'
				);
			}
		}

		this.map.on('error', (e) => {
			console.warn('Map error:', e);
		});

		// Ensure the center and zoom are set after map loads (in case the style loading overrides it)
		this.map.on('load', () => {
			if (!this.map || !this.mapConfig) return;

			// If we were restoring state, do not reset to defaults
			if (isRestoringState || this.pendingMapState) return;

			const configuredCenter = this.mapConfig.center;

			// Set center based on configuration
			if (configuredCenter) {
				this.map.setCenter(toLngLat(configuredCenter));
			}
			else {
				const bounds = this.getFeatureBounds();
				if (bounds) {
					this.map.setCenter(bounds.getCenter()); // Center on markers and shapes
				}
			}

			// Set zoom based on configuration
			if (this.hasConfiguredZoom()) {
				this.map.setZoom(this.mapConfig.defaultZoom); // Use configured zoom
			}
			else {
				const bounds = this.getFeatureBounds();
				if (bounds) {
					this.map.fitBounds(bounds, { padding: 20 }); // Fit all markers and shapes
				}
			}
		});

		// Hide tooltip on the map element.
		this.mapEl.querySelector('canvas')?.setCssProps({ '--no-tooltip': 'true' });
	}

	private updateAreaOverlap(): void {
		if (this.mapConfig) {
			this.areaOverlapManager.update(this.shapeManager.getShapes(), this.mapConfig);
		}
	}

	private async renderDataAfterStyle(): Promise<void> {
		const map = this.map;
		if (!map || !this.mapConfig || !this.data) return;

		if (!map.isStyleLoaded()) {
			await new Promise<void>(resolve => {
				void map.once('idle', () => {
					resolve();
				});
			});
		}
		if (!this.map || !this.mapConfig) return;

		// setStyle removes runtime sources and layers, so recreate all data layers
		// only after the replacement style is ready.
		this.shapeManager.updateShapes(this.data);
		this.updateAreaOverlap();
		await this.markerManager.updateMarkers(this.data);
		this.editManager.update();

		if (this.pendingMapState && this.map) {
			const { center, zoom } = this.pendingMapState;
			if (center) this.map.setCenter(center);
			if (zoom !== null && zoom !== undefined) this.map.setZoom(zoom);
			this.pendingMapState = null;
		}
	}

	private destroyMap(): void {
		this.popupManager.destroy();
		if (this.map) {
			this.map.remove();
			this.map = null;
		}
		this.markerManager.setMap(null);
		this.shapeManager.setMap(null);
		this.areaOverlapManager.setMap(null);
		this.editManager.setMap(null);
	}

	public onDataUpdated(): void {
		this.containerEl.removeClass('is-loading');
		const updateVersion = ++this.dataUpdateVersion;

		const configSnapshot = this.getConfigSnapshot();
		const configChanged = JSON.stringify(this.lastConfigSnapshot) !== JSON.stringify(configSnapshot);

		const currentTileSetId = this.mapConfig?.currentTileSetId || null;
		this.mapConfig = this.loadConfig(currentTileSetId);

		// Check if the evaluated center coordinates have changed
		const centerChanged = !sameCoordinates(this.mapConfig.center, this.lastEvaluatedCenter);

		void this.initializeMap().then(async () => {
			if (updateVersion !== this.dataUpdateVersion) return;

			// Apply config to map on first load or when config changes
			if (configChanged) {
				await this.applyConfigToMap(this.lastConfigSnapshot, configSnapshot);
				this.lastConfigSnapshot = configSnapshot;
				this.isFirstLoad = false;
			}
			if (updateVersion !== this.dataUpdateVersion) return;
			// Update center when the evaluated center coordinates change
			// (e.g., due to formula re-evaluation when active file changes)
			// But skip if we're restoring ephemeral state
			else if (this.map && !this.isFirstLoad && centerChanged && this.pendingMapState === null) {
				this.updateCenter();
			}

			await this.renderDataAfterStyle();
			if (updateVersion !== this.dataUpdateVersion) return;

			// Track state for next comparison
			if (this.mapConfig) {
				const center = this.mapConfig.center;
				this.lastEvaluatedCenter = center && [center[0], center[1]];
			}
		});
	}

	/** A zoom of 0 is valid, so this tests for presence rather than truthiness. */
	private hasConfiguredZoom(): boolean {
		return Number.isNumber(this.config.get('defaultZoom'));
	}

	/** Bounds covering every rendered feature, or null when nothing is rendered. */
	private getFeatureBounds(): LngLatBounds | null {
		const featureBounds = [this.markerManager.getBounds(), this.shapeManager.getBounds()]
			.filter((bounds): bounds is LngLatBounds => bounds != null && !bounds.isEmpty());
		if (featureBounds.length === 0) return null;

		const combined = new LngLatBounds();
		for (const bounds of featureBounds) {
			combined.extend(bounds);
		}

		return combined;
	}

	private updateZoom(): void {
		if (!this.map || !this.mapConfig) return;

		if (this.hasConfiguredZoom()) {
			this.map.setZoom(this.mapConfig.defaultZoom);
		}
	}

	private updateCenter(): void {
		if (!this.map || !this.mapConfig) return;

		const configuredCenter = this.mapConfig.center;
		if (configuredCenter) {
			// Only recenter if the evaluated coordinates actually changed
			const currentCenter = this.map.getCenter();
			if (!currentCenter) return; // Map not fully initialized yet

			const targetCenter = toLngLat(configuredCenter);
			const centerActuallyChanged = Math.abs(currentCenter.lng - targetCenter[0]) > 0.00001 ||
				Math.abs(currentCenter.lat - targetCenter[1]) > 0.00001;
			if (centerActuallyChanged) {
				this.map.setCenter(targetCenter);
			}
		}
	}

	private async applyConfigToMap(oldConfig: ConfigSnapshot | null, newConfig: ConfigSnapshot): Promise<void> {
		if (!this.map || !this.mapConfig) return;

		// Detect what changed
		const centerConfigChanged = oldConfig?.center !== newConfig.center;
		const zoomConfigChanged = oldConfig?.defaultZoom !== newConfig.defaultZoom;
		const tilesChanged = JSON.stringify(oldConfig?.mapTiles) !== JSON.stringify(newConfig.mapTiles) ||
			JSON.stringify(oldConfig?.mapTilesDark) !== JSON.stringify(newConfig.mapTilesDark);
		const heightChanged = oldConfig?.mapHeight !== newConfig.mapHeight;

		// Update map constraints
		this.map.setMinZoom(this.mapConfig.minZoom);
		this.map.setMaxZoom(this.mapConfig.maxZoom);

		// Clamp current zoom to new min/max bounds
		const currentZoom = this.map.getZoom();
		if (currentZoom < this.mapConfig.minZoom) {
			this.map.setZoom(this.mapConfig.minZoom);
		} else if (currentZoom > this.mapConfig.maxZoom) {
			this.map.setZoom(this.mapConfig.maxZoom);
		}

		// Skip updating zoom/center if we have pending ephemeral state to restore
		// (e.g., when navigating back in history to restore the user's last pan/zoom)
		const hasEphemeralState = this.pendingMapState !== null;

		// Only update zoom on first load or when zoom config explicitly changed
		// But skip if we're restoring ephemeral state
		if (!hasEphemeralState && (this.isFirstLoad || zoomConfigChanged)) {
			this.updateZoom();
		}

		// Update center on first load or when center config changed
		// But skip if we're restoring ephemeral state
		if (!hasEphemeralState && (this.isFirstLoad || centerConfigChanged)) {
			this.updateCenter();
		}

		// Update map style if tiles configuration changed
		if (this.isFirstLoad || tilesChanged) {
			const newStyle = await this.styleManager.getMapStyle(this.mapConfig.mapTiles, this.mapConfig.mapTilesDark);
			const currentStyle = this.map.getStyle();
			if (JSON.stringify(newStyle) !== JSON.stringify(currentStyle)) {
				this.map.setStyle(newStyle);
				this.markerManager.clearLoadedIcons();
			}
		}

		// Update map height for embedded views if height changed
		if (this.isFirstLoad || heightChanged) {
			this.applyMapHeight();
			// Resize map after height changes
			this.map.resize();
		}
	}

	isEmbedded(): boolean {
		// Check if this map view is embedded in a markdown file rather than opened directly
		// If the scrollEl has a parent with 'bases-embed' class, it's embedded
		return this.scrollEl.parentElement?.matchParent('.bases-embed, .block-language-base') != null;
	}

	/** Embedded views size to the configured height; direct views let CSS drive it. */
	private applyMapHeight(): void {
		this.mapEl.style.height = this.isEmbedded() && this.mapConfig
			? this.mapConfig.mapHeight + 'px'
			: '';
	}

	private loadConfig(currentTileSetId: string | null): MapConfig {
		// Load property configurations
		const coordinatesProp = this.config.getAsPropertyId('coordinates');
		const markerIconProp = this.config.getAsPropertyId('markerIcon');
		const markerColorProp = this.config.getAsPropertyId('markerColor');
		const areaCoordinatesProp = this.config.getAsPropertyId('areaCoordinates');
		const areaFillColorProp = this.config.getAsPropertyId('areaFillColor');
		const areaStrokeColorProp = this.config.getAsPropertyId('areaStrokeColor');
		const overlapLayerCount = this.getNumericConfig('overlapLayerCount', 0, 0, 8);
		const overlapRuleCount = this.getNumericConfig('overlapRuleCount', 0, 0, 12);
		const overlapLayerProps = Array.from({ length: overlapLayerCount }, (_, index) =>
			this.config.getAsPropertyId(`overlapLayer${index + 1}`));
		const overlapRules = this.loadOverlapRules(overlapRuleCount);
		const routeCoordinatesProp = this.config.getAsPropertyId('routeCoordinates');
		const routeColorProp = this.config.getAsPropertyId('routeColor');
		const areaPointReductionMode = this.getPointReductionMode('areaPointReductionMode');
		const areaMaxPoints = this.getNumericConfig('areaMaxPoints', 1000, 3, 1000000);
		const routePointReductionMode = this.getPointReductionMode('routePointReductionMode');
		const routeMaxPoints = this.getNumericConfig('routeMaxPoints', 1000, 2, 1000000);

		// Load numeric configurations with validation
		const minZoom = this.getNumericConfig('minZoom', 0, 0, 24);
		const maxZoom = this.getNumericConfig('maxZoom', 18, 0, 24);
		const defaultZoom = this.getNumericConfig('defaultZoom', DEFAULT_MAP_ZOOM, minZoom, maxZoom);

		// Load center coordinates
		const center = this.getCenterFromConfig();

		// Load map height for embedded views
		const mapHeight = this.isEmbedded()
			? this.getNumericConfig('mapHeight', DEFAULT_MAP_HEIGHT, 100, 2000)
			: DEFAULT_MAP_HEIGHT;

		// Load map tiles configurations
		// Use view-specific tiles if configured, otherwise fall back to plugin defaults
		const viewSpecificTiles = this.getArrayConfig('mapTiles');
		const viewSpecificTilesDark = this.getArrayConfig('mapTilesDark');

		let mapTiles: string[];
		let mapTilesDark: string[];
		let selectedTileSetId: string | null;

		if (viewSpecificTiles.length > 0) {
			// View has specific tiles configured
			mapTiles = viewSpecificTiles;
			mapTilesDark = viewSpecificTilesDark;
			selectedTileSetId = null;
		} else if (this.plugin.settings.tileSets.length > 0) {
			// Use first tile set from plugin settings (or previously selected one)
			const tileSet = currentTileSetId
				? this.plugin.settings.tileSets.find(ts => ts.id === currentTileSetId)
				: null;
			const selectedTileSet = tileSet ?? this.plugin.settings.tileSets[0];

			if (!selectedTileSet) {
				// Should be unreachable given the length check above, but keeps TS happy
				mapTiles = [];
				mapTilesDark = [];
				selectedTileSetId = null;
			} else {
				selectedTileSetId = selectedTileSet.id;
				mapTiles = selectedTileSet.lightTiles ? [selectedTileSet.lightTiles] : [];
				mapTilesDark = selectedTileSet.darkTiles
					? [selectedTileSet.darkTiles]
					: (selectedTileSet.lightTiles ? [selectedTileSet.lightTiles] : []);
			}
		} else {
			// No tiles configured, will fall back to default style
			mapTiles = [];
			mapTilesDark = [];
			selectedTileSetId = null;
		}

		return {
			coordinatesProp,
			markerIconProp,
			markerColorProp,
			areaCoordinatesProp,
			areaFillColorProp,
			areaStrokeColorProp,
			overlapLayerCount,
			overlapRuleCount,
			overlapLayerProps,
			overlapRules,
			routeCoordinatesProp,
			routeColorProp,
			areaPointReductionMode,
			areaMaxPoints,
			routePointReductionMode,
			routeMaxPoints,
			mapHeight,
			defaultZoom,
			center,
			maxZoom,
			minZoom,
			mapTiles,
			mapTilesDark,
			currentTileSetId: selectedTileSetId,
			editModeEnabled: this.getBooleanConfig('editMode', false),
			coordinateSaveFormat: this.getCoordinateFormatConfig(),
			snapToPointsEnabled: this.getBooleanConfig('snapToPoints', true),
		};
	}

	private getBooleanConfig(key: string, defaultValue: boolean): boolean {
		const value = this.config.get(key);
		return typeof value === 'boolean' ? value : defaultValue;
	}

	private getPointReductionMode(key: string): PointReductionMode {
		const value = this.config.get(key);
		return value === 'fixed' ? value : 'none';
	}

	private loadOverlapRules(count: number): OverlapRuleConfig[] {
		return Array.from({ length: count }, (_, index) => ({
			type: 'layerOverlapCount',
			comparator: this.getComparatorConfig(`overlapRule${index + 1}Comparator`),
			count: this.getNumericConfig(`overlapRule${index + 1}Count`, 0, 0, 8),
			color: this.getStringConfig(`overlapRule${index + 1}Color`, '#48a868'),
			fillOpacity: this.getNumericConfig(`overlapRule${index + 1}Opacity`, 0.5, 0, 1),
		}));
	}

	private getComparatorConfig(key: string): OverlapComparator {
		const value = this.config.get(key);
		return value === '!=' || value === '<' || value === '>' || value === '<=' || value === '>='
			? value
			: '==';
	}

	private getStringConfig(key: string, defaultValue: string): string {
		const value = this.config.get(key);
		return typeof value === 'string' && value.trim().length > 0 ? value.trim() : defaultValue;
	}

	private getCoordinateFormatConfig(): CoordinateFormat {
		const value = this.config.get('coordinateSaveFormat');
		return typeof value === 'string' && value in COORDINATE_FORMAT_LABELS ? value as CoordinateFormat : 'same';
	}

	private getNumericConfig(key: string, defaultValue: number, min: number, max: number): number {
		const value = this.config.get(key);
		const numericValue = typeof value === 'number'
			? value
			: typeof value === 'string' && value.trim().length > 0
				? Number(value)
				: NaN;
		if (!Number.isFinite(numericValue)) return defaultValue;

		return Math.min(max, Math.max(min, numericValue));
	}

	private getArrayConfig(key: string): string[] {
		const value = this.config.get(key);
		if (!value) return [];

		// Handle array values
		if (Array.isArray(value)) {
			return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
		}

		// Handle single string value
		if (typeof value === 'string' && value.trim().length > 0) {
			return [value.trim()];
		}

		return [];
	}

	/** Returns null when no usable center is configured, so [0, 0] stays a real center. */
	private getCenterFromConfig(): [number, number] | null {
		let centerConfig: Value | null = null;

		try {
			centerConfig = this.config.getEvaluatedFormula(this, 'center');
		} catch {
			// Formula evaluation failed (e.g., this.file is null when no active file)
		}

		// Fall back to the raw config value, which also supports the legacy string format
		if (!centerConfig || Value.equals(centerConfig, NullValue.value)) {
			const centerConfigStr = this.config.get('center');
			if (!String.isString(centerConfigStr)) return null;
			centerConfig = new StringValue(centerConfigStr);
		}

		return coordinateFromValue(centerConfig);
	}

	private getConfigSnapshot(): ConfigSnapshot {
		// Create a snapshot of config values that affect map display
		return {
			center: this.config.get('center'),
			defaultZoom: this.config.get('defaultZoom'),
			minZoom: this.config.get('minZoom'),
			maxZoom: this.config.get('maxZoom'),
			mapHeight: this.config.get('mapHeight'),
			mapTiles: this.config.get('mapTiles'),
			mapTilesDark: this.config.get('mapTilesDark'),
			areaPointReductionMode: this.config.get('areaPointReductionMode'),
			areaMaxPoints: this.config.get('areaMaxPoints'),
			routePointReductionMode: this.config.get('routePointReductionMode'),
			routeMaxPoints: this.config.get('routeMaxPoints'),
		};
	}

	private showMapContextMenu(evt: MouseEvent): void {
		if (!this.map || !this.mapConfig) return;
		// A right-click on an edit-mode point gets its own "Delete point" menu instead
		if (this.editManager.tryHandleContextMenu(evt)) return;

		const currentZoom = Math.round(this.map.getZoom() * 10) / 10; // Round to 1 decimal place

		// Get coordinates from the location of the right-click event, not the map center
		const clickPoint: [number, number] = [evt.offsetX, evt.offsetY];
		const clickedCoords = this.map.unproject(clickPoint);
		const currentLat = roundCoordinate(clickedCoords.lat);
		const currentLng = roundCoordinate(clickedCoords.lng);

		const menu = Menu.forEvent(evt);
		menu.addItem(item => item
			.setTitle('New note')
			.setSection('action')
			.setIcon('square-pen')
			.onClick(() => {
				void this.createFileForView('', (frontmatter: Record<string, unknown>) => {
					// Pre-fill coordinates if a coordinates property is configured
					if (this.mapConfig?.coordinatesProp) {
						const propertyKey = propertyKeyFromId(this.mapConfig.coordinatesProp);
						frontmatter[propertyKey] = [currentLat.toString(), currentLng.toString()];
					}
				});
			})
		);

		menu.addItem(item => item
			.setTitle('Copy coordinates')
			.setSection('action')
			.setIcon('copy')
			.onClick(() => {
				void navigator.clipboard.writeText(formatCoordinates(currentLat, currentLng));
			})
		);

		menu.addItem(item => item
			.setTitle('Set default center point')
			.setSection('action')
			.setIcon('map-pin')
			.onClick(() => {
				// Set the current center as the default coordinates
				const coordListStr = `[${currentLat}, ${currentLng}]`;

				// 1. Update the component's internal state immediately.
				// This ensures that if a re-render is triggered, its logic will use the
				// new coordinates and prevent the map from recentering on markers.
				if (this.mapConfig) {
					this.mapConfig.center = [currentLat, currentLng];
				}

				// 2. Set the config value, which will be saved.
				this.config.set('center', coordListStr);

				// 3. Immediately move the map for instant user feedback.
				this.map?.setCenter(toLngLat([currentLat, currentLng]));
			})
		);

		menu.addItem(item => item
			.setTitle(`Set default zoom (${currentZoom})`)
			.setSection('action')
			.setIcon('crosshair')
			.onClick(() => {
				this.config.set('defaultZoom', currentZoom);
			})
		);
	}

	public setEphemeralState(state: unknown): void {
		if (!state) {
			this.pendingMapState = null;
			return;
		}

		this.pendingMapState = {};
		if (hasOwnProperty(state, 'center') && hasOwnProperty(state.center, 'lng') && hasOwnProperty(state.center, 'lat')) {
			const lng = state.center.lng;
			const lat = state.center.lat;

			if (typeof lng === 'number' && typeof lat === 'number') {
				this.pendingMapState.center = { lng, lat };
			}
		}
		if (hasOwnProperty(state, 'zoom') && typeof state.zoom === 'number') {
			this.pendingMapState.zoom = state.zoom;
		}
	}

	public getEphemeralState(): unknown {
		if (!this.map) return {};

		const center = this.map.getCenter();
		return {
			center: { lng: center.lng, lat: center.lat },
			zoom: this.map.getZoom(),
		};
	}

	static getViewOptions(config: BasesViewConfig): BasesAllOptions[] {
		const overlapOptions: BasesOptions[] = [
			{
				displayName: 'Number of layers',
				type: 'slider',
				key: 'overlapLayerCount',
				min: 0,
				max: 8,
				step: 1,
				default: 0,
				instant: true,
			},
		];
		for (let index = 1; index <= 8; index++) {
			overlapOptions.push({
				displayName: `Layer ${index}${index === 1 ? ' (target areas)' : ' (counted areas)'}`,
				type: 'property',
				key: `overlapLayer${index}`,
				filter: prop => !prop.startsWith('file.'),
				placeholder: 'Formula or property',
				shouldHide: () => index > MapView.getViewOptionCount(config, 'overlapLayerCount', 8),
			});
		}
		overlapOptions.push({
			displayName: 'Number of rules',
			type: 'slider',
			key: 'overlapRuleCount',
			min: 0,
			max: 12,
			step: 1,
			default: 0,
			instant: true,
		});
		for (let index = 1; index <= 12; index++) {
			const ruleIsHidden = () => index > MapView.getViewOptionCount(config, 'overlapRuleCount', 12);
			overlapOptions.push({
				displayName: `Rule ${index} type`,
				type: 'dropdown',
				key: `overlapRule${index}Type`,
				options: { layerOverlapCount: 'Layer overlap count' },
				default: 'layerOverlapCount',
				shouldHide: ruleIsHidden,
			});
			overlapOptions.push({
				displayName: `Rule ${index} comparison`,
				type: 'dropdown',
				key: `overlapRule${index}Comparator`,
				options: { '==': '==', '!=': '!=', '<': '<', '>': '>', '<=': '<=', '>=': '>=' },
				default: '==',
				shouldHide: ruleIsHidden,
			});
			overlapOptions.push({
				displayName: `Rule ${index} layer count`,
				type: 'text',
				key: `overlapRule${index}Count`,
				default: '0',
				placeholder: 'Number of layers',
				shouldHide: ruleIsHidden,
			});
			overlapOptions.push({
				displayName: `Rule ${index} color`,
				type: 'text',
				key: `overlapRule${index}Color`,
				default: '#48a868',
				placeholder: 'CSS color, for example #48a868',
				shouldHide: ruleIsHidden,
			});
			overlapOptions.push({
				displayName: `Rule ${index} opacity`,
				type: 'slider',
				key: `overlapRule${index}Opacity`,
				min: 0,
				max: 1,
				step: 0.05,
				default: 0.5,
				shouldHide: ruleIsHidden,
			});
		}

		return [
			{
				displayName: 'Embedded height',
				type: 'slider',
				key: 'mapHeight',
				min: 200,
				max: 800,
				step: 20,
				default: DEFAULT_MAP_HEIGHT,
			},
			{
				displayName: 'Display',
				type: 'group',
				items: [

					{
						displayName: 'Center coordinates',
						type: 'formula',
						key: 'center',
						placeholder: '[latitude, longitude]',
					},
					{
						displayName: 'Default zoom',
						type: 'slider',
						key: 'defaultZoom',
						min: 1,
						max: 18,
						step: 1,
						default: DEFAULT_MAP_ZOOM,
					},
					{
						displayName: 'Minimum zoom',
						type: 'slider',
						key: 'minZoom',
						min: 0,
						max: 24,
						step: 1,
						default: 0,
					},
					{
						displayName: 'Maximum zoom',
						type: 'slider',
						key: 'maxZoom',
						min: 0,
						max: 24,
						step: 1,
						default: 18,
					},
				]
			},
			{
				displayName: 'Markers',
				type: 'group',
				items: [
					{
						displayName: 'Marker coordinates',
						type: 'property',
						key: 'coordinates',
						filter: prop => !prop.startsWith('file.'),
						placeholder: 'Property',
					},
					{
						displayName: 'Marker icon',
						type: 'property',
						key: 'markerIcon',
						filter: prop => !prop.startsWith('file.'),
						placeholder: 'Property',
					},
					{
						displayName: 'Marker color',
						type: 'property',
						key: 'markerColor',
						filter: prop => !prop.startsWith('file.'),
						placeholder: 'Property',
					},
				]
			},
			{
				displayName: 'Areas',
				type: 'group',
				items: [
					{
						displayName: 'Area coordinates',
						type: 'property',
						key: 'areaCoordinates',
						filter: prop => !prop.startsWith('file.'),
						placeholder: 'Property',
					},
					{
						displayName: 'Area fill color',
						type: 'property',
						key: 'areaFillColor',
						filter: prop => !prop.startsWith('file.'),
						placeholder: 'Property',
					},
					{
						displayName: 'Area stroke color',
						type: 'property',
						key: 'areaStrokeColor',
						filter: prop => !prop.startsWith('file.'),
						placeholder: 'Property',
					},
					{
						displayName: 'Point reduction',
						type: 'dropdown',
						key: 'areaPointReductionMode',
						options: {
							none: 'None',
							fixed: 'Fixed maximum',
						},
						default: 'none',
					},
					{
						displayName: 'Maximum points per ring',
						type: 'text',
						key: 'areaMaxPoints',
						default: '1000',
						placeholder: 'Number of points',
					},
				]
			},
			{
				displayName: 'Overlaps',
				type: 'group',
				items: overlapOptions,
			},
			{
				displayName: 'Routes',
				type: 'group',
				items: [
					{
						displayName: 'Route coordinates',
						type: 'property',
						key: 'routeCoordinates',
						filter: prop => !prop.startsWith('file.'),
						placeholder: 'Property',
					},
					{
						displayName: 'Route color',
						type: 'property',
						key: 'routeColor',
						filter: prop => !prop.startsWith('file.'),
						placeholder: 'Property',
					},
					{
						displayName: 'Point reduction',
						type: 'dropdown',
						key: 'routePointReductionMode',
						options: {
							none: 'None',
							fixed: 'Fixed maximum',
						},
						default: 'none',
					},
					{
						displayName: 'Maximum points per segment',
						type: 'text',
						key: 'routeMaxPoints',
						default: '1000',
						placeholder: 'Number of points',
					},
				]
			},
			{
				displayName: 'Background',
				type: 'group',
				items: [
					{
						displayName: 'Map tiles',
						type: 'multitext',
						key: 'mapTiles',
					},
					{
						displayName: 'Map tiles in dark mode',
						type: 'multitext',
						key: 'mapTilesDark',
					},
				]
			},
			{
				displayName: 'Edit mode',
				type: 'group',
				items: [
					{
						displayName: 'Edit mode',
						type: 'toggle',
						key: 'editMode',
						default: false,
					},
					{
						displayName: 'Save coordinates as',
						type: 'dropdown',
						key: 'coordinateSaveFormat',
						options: COORDINATE_FORMAT_LABELS,
						default: 'same',
					},
					{
						displayName: 'Snap to points',
						type: 'toggle',
						key: 'snapToPoints',
						default: true,
					},
				]
			},
		];
	}

	private static getViewOptionCount(config: BasesViewConfig, key: string, max: number): number {
		const value = config.get(key);
		const numericValue = typeof value === 'number'
			? value
			: typeof value === 'string' && value.trim().length > 0
				? Number(value)
				: NaN;
		return Number.isFinite(numericValue) ? Math.min(max, Math.max(0, numericValue)) : 0;
	}
}
