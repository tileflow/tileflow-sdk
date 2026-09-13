import {resolve} from 'node:path';
import {auditTileflowMapThemeValues} from '@tileflow/core';
import {
  createTileflowNativeDiagnostic,
  resolveTileflowRenderer,
  TileflowNativeCompatibilityError,
} from '@tileflow/core/native-profile';
import {
  createTileflowBuildArtifacts,
  disposeTileflowBuildArtifacts,
  type TileflowArtifactPlan,
  writeTileflowArtifactPlan,
} from '@tileflow/dev/artifacts';
import {
  createTileflowCommandFailureDocument,
  createTileflowCommandSummary,
  createTileflowStructuredDiagnostics,
  serializeTileflowCommandDocument,
} from '@tileflow/dev/validation';
import {withTileflowConfigSecretsHidden} from './config-execution';

export type RendererArtifactCommandOptions = {
  apiBaseUrl: string;
  config: string;
  json?: boolean;
  out?: string;
  renderer: string;
  target: string;
};

/** Local artifact preparation only; neither command opens a renderer or contacts Hosted. */
export async function runRendererArtifactCommand(
  command: 'validate' | 'build',
  options: RendererArtifactCommandOptions,
): Promise<void> {
  let artifacts: TileflowArtifactPlan | undefined;
  try {
    const renderer = resolveTileflowRenderer(options.renderer);
    if (options.target !== 'local' && options.target !== 'hosted') {
      throw Object.assign(new Error('Expected a local or hosted target.'), {
        code: 'INVALID_TARGET', phase: 'command-validation', path: 'target',
      });
    }
    if (renderer === 'native' && options.target === 'hosted') {
      throw new TileflowNativeCompatibilityError([
        createTileflowNativeDiagnostic('NATIVE_RENDERER_UNSUPPORTED', '/target'),
      ]);
    }
    if (command === 'build' && options.target === 'hosted') {
      throw Object.assign(new Error('Build prepares local artifacts; Hosted publication uses deploy.'), {
        code: 'HOSTED_INCOMPATIBLE', phase: 'command-validation', path: 'target',
        suggestion: 'Use validate --target hosted for web preflight, or build --target local.',
      });
    }
    artifacts = await withTileflowConfigSecretsHidden(() => createTileflowBuildArtifacts({
      apiBaseUrl: options.apiBaseUrl,
      config: options.config,
      renderer,
      styleBaseUrl: '.',
      target: 'production',
    }));
    const outDir = options.out ?? 'dist/tileflow';
    if (command === 'build') await writeTileflowArtifactPlan(artifacts, {outDir});
    const summary = createTileflowCommandSummary({
      code: command === 'validate' ? 'VALIDATION_OK' : 'BUILD_OK',
      command,
      message: command === 'validate' ? 'Tileflow artifact validation passed.' : 'Built Tileflow artifacts.',
      ok: true,
      phase: command === 'validate' ? 'validation' : 'build',
      severity: 'info',
      suggestion: renderer === 'native'
        ? 'Use the prepared native manifest with a separately qualified native runtime.'
        : 'Serve the prepared artifact directory.',
    });
    const warnings = Object.values(artifacts.project.maps).flatMap((map) =>
      auditTileflowMapThemeValues(map).filter(({severity}) => severity === 'warning'),
    );
    const diagnostics = warnings.length ? createTileflowStructuredDiagnostics({diagnostics: warnings}, process.cwd(), {code: 'VALIDATION_WARNING', phase: 'theme-audit'}) : [];
    const document = {
      ...summary,
      target: options.target,
      renderer,
      ...(artifacts.nativeBuild ? {profile: artifacts.nativeBuild.profile, validation: 'static-artifacts'} : {}),
      maps: Object.keys(artifacts.project.maps).sort(),
      diagnostics,
    };
    if (options.json) process.stdout.write(serializeTileflowCommandDocument(document));
    else {
      console.log(summary.message);
      for (const issue of diagnostics) console.warn(`${issue.path}: ${issue.message}`);
      if (artifacts.nativeBuild) console.log('Profile: native-v1 (static artifacts; no device qualification).');
      if (command === 'build') console.log(`Output: ${resolve(outDir, ...(renderer === 'native' ? ['native'] : []))}`);
    }
  } catch (error) {
    const document = createTileflowCommandFailureDocument(command, error, process.cwd(), {
      code: command === 'validate' ? 'VALIDATION_FAILED' : 'BUILD_FAILED',
      phase: 'artifact-preparation',
    });
    if (options.json) process.stderr.write(serializeTileflowCommandDocument(document));
    else {
      for (const issue of document.diagnostics) {
        console.error(`${issue.code} ${issue.path || '(root)'}: ${issue.message}`);
        console.error(`Suggestion: ${issue.suggestion}`);
      }
    }
    process.exitCode = 1;
  } finally {
    if (artifacts) await disposeTileflowBuildArtifacts(artifacts);
  }
}
