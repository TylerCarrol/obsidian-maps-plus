/**
 * Resolved CSS colors, cached because getComputedStyle forces a style
 * recalculation. Cleared when the theme changes.
 */
const resolvedColors = new Map<string, string>();

/**
 * Resolves any CSS color, including custom properties such as
 * `var(--color-accent)`, to a concrete value that canvas and MapLibre accept.
 */
export function resolveCssColor(color: string): string {
	const cached = resolvedColors.get(color);
	if (cached !== undefined) return cached;

	// A temporary hidden element lets the browser do the resolution
	const tempEl = document.body.createDiv('bases-map-color-probe');
	tempEl.setCssStyles({ color });
	const computedColor = getComputedStyle(tempEl).color;
	tempEl.remove();

	resolvedColors.set(color, computedColor);
	return computedColor;
}

export function clearResolvedColors(): void {
	resolvedColors.clear();
}
