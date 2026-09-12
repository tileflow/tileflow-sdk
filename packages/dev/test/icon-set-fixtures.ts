import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TileflowIconSetPin, TileflowIconsLockfileV1} from '@tileflow/core';
import {packTileflowRenderedIcons, type TileflowRenderedIcon} from '../src/icon-sprite';
import type {CompiledTileflowIconPackage} from '../src/icons';

export function renderedIcon(id: string, color: readonly [number, number, number, number], width = 4, height = 2, twoColor = color): TileflowRenderedIcon {
	function cell(ratio: number, rgba: readonly number[]) {
		const data = new Uint8Array(width * height * ratio * ratio * 4);
		for (let index = 0; index < data.length; index += 4) data.set(rgba, index);
		return {width: width * ratio, height: height * ratio, rgba: data};
	}
	return {id, oneX: cell(1, color), twoX: cell(2, twoColor)};
}

export async function setFixture(index: number, icons: TileflowRenderedIcon[], version = 1): Promise<{pin: TileflowIconSetPin; artifact: CompiledTileflowIconPackage}> {
	const artifact = await packTileflowRenderedIcons(icons);
	return {artifact, pin: {
		teamId: 'team_fixture', setId: `ics_${String(index).padStart(16, '0')}`, versionId: `icv_${`${index}-${version}`.padStart(16, '0')}`, version,
		packageId: `icp_${artifact.contentHash.slice(0, 16)}`, contentHash: artifact.contentHash, manifest: artifact.manifest,
		spriteUrl: `https://api.tileflow.dev/sprites/icp_${artifact.contentHash.slice(0, 16)}/sprite`,
	}};
}

export function lockFor(sets: Record<string, TileflowIconSetPin>): TileflowIconsLockfileV1 { return {lockfileVersion: 1, sets}; }

export async function withIconSetFixture(run: (cwd: string) => Promise<void>): Promise<void> {
	const cwd = await mkdtemp(join(tmpdir(), 'tileflow-icon-sets-'));
	try { await run(cwd); } finally { await rm(cwd, {recursive: true, force: true}); }
}
