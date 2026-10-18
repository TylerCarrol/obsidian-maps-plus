import { App, BasesEntry, BasesPropertyId } from 'obsidian';
import { CoordinateFormat, serializeGroups, serializePoint } from './coordinate-format';

/** Strips the `note.`/`file.`/`formula.` source prefix, leaving the raw frontmatter key. */
export function propertyKeyFromId(prop: BasesPropertyId): string {
	const separatorIndex = prop.indexOf('.');
	return separatorIndex === -1 ? prop : prop.slice(separatorIndex + 1);
}

/** Writes an edited marker coordinate back to the note's frontmatter. */
export async function writeMarkerCoordinates(
	app: App,
	entry: BasesEntry,
	prop: BasesPropertyId,
	point: [number, number],
	format: CoordinateFormat
): Promise<void> {
	const originalValue = entry.getValue(prop);
	const value = serializePoint(point, format, originalValue);
	const key = propertyKeyFromId(prop);

	await app.fileManager.processFrontMatter(entry.file, (frontmatter: Record<string, unknown>) => {
		frontmatter[key] = value;
	});
}

/** Writes edited area/route coordinate groups back to the note's frontmatter. */
export async function writeShapeCoordinates(
	app: App,
	entry: BasesEntry,
	prop: BasesPropertyId,
	groups: [number, number][][],
	format: CoordinateFormat
): Promise<void> {
	const originalValue = entry.getValue(prop);
	const value = serializeGroups(groups, format, originalValue);
	const key = propertyKeyFromId(prop);

	await app.fileManager.processFrontMatter(entry.file, (frontmatter: Record<string, unknown>) => {
		frontmatter[key] = value;
	});
}

/** Removes a coordinate property entirely, e.g. when a marker's only point is deleted. */
export async function deleteFrontmatterProperty(app: App, entry: BasesEntry, prop: BasesPropertyId): Promise<void> {
	const key = propertyKeyFromId(prop);

	await app.fileManager.processFrontMatter(entry.file, (frontmatter: Record<string, unknown>) => {
		delete frontmatter[key];
	});
}
