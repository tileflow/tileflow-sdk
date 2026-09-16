import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const frameworkMapFixture = '/tileflow-fixture/manifest.json';
export const frameworkBackgroundStyle = {
	version: 8,
	sources: {},
	layers: [{id: 'background', type: 'background', paint: {'background-color': '#2468ac'}}],
};

/** Files served by the fixture's existing application server, not an additional listener. */
export async function writeFrameworkMapFixture(root: string, style: unknown = frameworkBackgroundStyle): Promise<void> {
	const directory = join(root, 'public', 'tileflow-fixture');
	await mkdir(directory, {recursive: true});
	await Promise.all([
		writeFile(join(directory, 'manifest.json'), JSON.stringify({
			version: 1,
			maps: {main: {defaultTheme: 'light', themes: {
				light: {colorScheme: 'light', styleUrl: './style.json', fontFaces: []},
			}}},
		}), 'utf8'),
		writeFile(join(directory, 'style.json'), JSON.stringify(style), 'utf8'),
	]);
}
