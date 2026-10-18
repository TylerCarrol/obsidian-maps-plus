# Maps+ Plugin for Obsidian

[![GitHub Release](https://img.shields.io/github/v/release/TylerCarrol/obsidian-maps-plus?logo=github&sort=semver)](https://github.com/TylerCarrol/obsidian-maps-plus/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/TylerCarrol/obsidian-maps-plus/blob/main/LICENSE)
[![Lint](https://github.com/TylerCarrol/obsidian-maps-plus/actions/workflows/lint.yml/badge.svg)](https://github.com/TylerCarrol/obsidian-maps-plus/actions/workflows/lint.yml)
[![Test](https://github.com/TylerCarrol/obsidian-maps-plus/actions/workflows/test.yml/badge.svg)](https://github.com/TylerCarrol/obsidian-maps-plus/actions/workflows/test.yml)
[![Scc Count Badge](https://sloc.xyz/github/TylerCarrol/obsidian-maps-plus?category=code)](https://github.com/TylerCarrol/obsidian-maps-plus?category=code)
[![BuyMeACoffee](https://raw.githubusercontent.com/pachadotdev/buymeacoffee-badges/main/bmc-yellow.svg)](https://buymeacoffee.com/tylercarrol)

Adds a Bases map view for Obsidian that can render point markers, polygon areas, and routes.

## Why this is a separate view

Obsidian's official **Maps** plugin does not currently expose a public extension API for adding extra geometry types to its built-in view. This plugin therefore registers a companion Bases view named **Maps+** that follows the same workflow while adding polygon and route support.

## What it supports

- Point markers from a coordinates property
- Polygon areas from a property containing three or more coordinate pairs
- Routes from a property containing two or more coordinate pairs
- Per-note marker, fill, stroke, and route colors
- Click a marker, area, or route to open its note

## Area property formats

Use a property selected as **Area coordinates** in the Bases view options. Supported formats:

```yaml
area:
  - [37.77986, -122.42905]
  - [37.78139, -122.42515]
  - [37.77773, -122.42252]
  - [37.77501, -122.42625]
```

or:

```yaml
area: "[[37.77986, -122.42905], [37.78139, -122.42515], [37.77773, -122.42252], [37.77501, -122.42625]]"
```

## Route property formats

Use a property selected as **Route coordinates** in the Bases view options. Supported formats:

```yaml
route:
  - [37.77161, -122.51073]
  - [37.77144, -122.49524]
  - [37.77043, -122.45458]
```

or:

```yaml
route: "[[37.77161, -122.51073], [37.77144, -122.49524], [37.77043, -122.45458]]"
```

## Example Bases view

```yaml
views:
  - type: maps-plus
    name: Areas and routes
    coordinates: note.coordinates
    markerColor: note.markerColor
    areaCoordinates: note.area
    areaFillColor: note.areaFillColor
    areaStrokeColor: note.areaStrokeColor
    routeCoordinates: note.route
    routeColor: note.routeColor
    defaultZoom: 13
```

## Privacy / external services

The map view loads its basemap style and tiles from **OpenFreeMap** (`tiles.openfreemap.org`). No note content is uploaded by this plugin, but the service will receive the usual tile requests needed to draw the map.

## Install for development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the plugin:
   ```bash
   npm run build
   ```
3. Copy `main.js`, `manifest.json`, and `styles.css` to:
   ```text
  <Vault>/.obsidian/plugins/maps-plus/
   ```
4. In Obsidian, enable **Settings → Community plugins → Maps+**.

## Fastest way to try it

This repository includes a ready-made demo vault in `/maps-plus-demo-vault`.

1. Run `npm run build`
2. Copy `main.js`, `manifest.json`, and `styles.css` to `maps-plus/.obsidian/plugins/maps-plus/`
3. Open `maps-plus` in Obsidian
4. Open `maps-plus/Maps.base`

See `maps-plus/README.md` for the included example notes.
