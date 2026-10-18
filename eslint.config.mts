import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'maps-plus/**',
		'maps-plus-demo-vault/**/plugins/**',
		'src-example/**',
		'tsconfig.json',
		'vitest.config.ts',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 20,
					allowDefaultProject: [
						'eslint.config.mts',
						'manifest.json',
						'scripts/generate-earth-map.mjs',
						'scripts/generate-countries.mjs',
						'scripts/generate-areas.mjs',
						'scripts/generate-tdsb-school-catchments.mjs',
						'scripts/generate-subway-walksheds.mjs',
						'scripts/generate-rtl-plugin.mjs',
						'src/utils/*.test.ts',
						'src/map/*.test.ts',
						'src/__tests__/*.ts',
					],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		rules: {
			'obsidianmd/ui/sentence-case': ['warn', { ignoreRegex: ['^Maps+ Preview$'] }],
		},
	},
	// Repository generators run under Node and are not bundled into the plugin.
	{
		files: ['scripts/**/*.mjs'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			'no-restricted-globals': 'off',
			'obsidianmd/no-nodejs-modules': 'off',
			'obsidianmd/rule-custom-message': 'off',
			'obsidianmd/prefer-window-timers': 'off',
		},
	},
	// Test and mock files are not Obsidian plugin code — disable plugin-specific
	// rules that only apply to the production plugin source.
	{
		files: ['src/**/*.test.ts', 'src/__tests__/**', 'src/__mocks__/**'],
		rules: {
			'obsidianmd/prefer-create-el': 'off',
			'obsidianmd/ui/sentence-case': 'off',
		},
	},
);
