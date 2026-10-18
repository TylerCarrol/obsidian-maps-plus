# Maps+ Plugin for Obsidian

[![GitHub Release](https://img.shields.io/github/v/release/TylerCarrol/obsidian-maps-plus?logo=github&sort=semver)](https://github.com/TylerCarrol/obsidian-maps-plus/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/TylerCarrol/obsidian-maps-plus/blob/main/LICENSE)
[![Lint](https://github.com/TylerCarrol/obsidian-maps-plus/actions/workflows/lint.yml/badge.svg)](https://github.com/TylerCarrol/obsidian-maps-plus/actions/workflows/lint.yml)
[![Test](https://github.com/TylerCarrol/obsidian-maps-plus/actions/workflows/test.yml/badge.svg)](https://github.com/TylerCarrol/obsidian-maps-plus/actions/workflows/test.yml)
[![Scc Count Badge](https://sloc.xyz/github/TylerCarrol/obsidian-maps-plus?category=code)](https://github.com/TylerCarrol/obsidian-maps-plus?category=code)
[![BuyMeACoffee](https://raw.githubusercontent.com/pachadotdev/buymeacoffee-badges/main/bmc-yellow.svg)](https://buymeacoffee.com/tylercarrol)

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
