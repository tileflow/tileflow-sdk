import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {gunzipSync} from 'node:zlib';
import {serializeCanonicalJson} from '@tileflow/core';
import {
  expandTileflowDeploymentArtifact,
  hashHostedPublicationContent,
  hostedPublicationContentParts,
  type TileflowRendererDeploymentRequestArtifact,
  tileflowRendererDeploymentRequestArtifactSchema,
} from '@tileflow/core/build';
import {
  createTileflowNativeFamily,
  tileflowNativeFamilySchema,
} from '@tileflow/core/native-profile';

/**
 * An in-process fake of the Hosted renderer deployment protocol: `POST /v1/styles` with a schema-5
 * request, 202 with the missing native documents, a create-only `PUT` for each document (theme
 * styles first, the family document last and checked against Core) and the same `POST` to
 * activate. It follows the platform's routes, status codes and reply shapes; it stores nothing
 * beyond its own process.
 */
export type FakePlatformRequest = Readonly<{
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  /** The decoded body: gzip on the wire is undone, as the platform does before any limit. */
  body: Buffer;
}>;
export type FakePlatformReply = Readonly<{
  status: number;
  body: unknown;
  raw?: boolean;
  headers?: Record<string, string>;
}>;
type InterceptReply = FakePlatformReply | Readonly<{disconnect: true}>;

type Reservation = {
  id: string;
  version: number;
  key: string;
  artifact: TileflowRendererDeploymentRequestArtifact;
  documents: Map<string, string>;
  active: boolean;
};

export type FakePlatform = {
  readonly url: string;
  readonly mapId: string;
  /** Every request but the credential profile, in arrival order. */
  readonly requests: FakePlatformRequest[];
  /** Each `POST /v1/styles` body and the status it was answered with. */
  readonly deployments: Array<{body: Record<string, unknown>; status: number}>;
  /** Each native document upload and the status it was answered with. */
  readonly uploads: Array<{document: string; status: number; encoding?: string}>;
  /** Answer uploads with 503 once this many were accepted; `undefined` accepts all. */
  failUploadsAfter?: number;
  /** Team 3D model report added to every result. */
  teamModels?: ReadonlyArray<{model: string; version: number; sources: string}>;
  /** The active deployment's version, when one is active. */
  activeVersion(): number | undefined;
};

export type FakePlatformOptions = Readonly<{
  mapId?: string;
  preflight?: boolean;
  /** A credential profile for `/v1/me`; `false` answers 404. */
  profile?: Record<string, unknown> | false;
  /** Answer a request before the platform does; `undefined` lets the platform answer it. */
  intercept?(
    request: FakePlatformRequest,
    platform: FakePlatform,
  ): InterceptReply | undefined | Promise<InterceptReply | undefined>;
}>;

export async function startFakePlatform(
  t: {after(callback: () => Promise<void> | void): void},
  options: FakePlatformOptions = {},
): Promise<FakePlatform> {
  const mapId = options.mapId ?? 'map_AbCdEfGhIjKlMnOp';
  const reservations: Reservation[] = [];
  const iconPackages = new Set<string>();
  const fontBundles = new Set<string>();
  let accepted = 0;
  let origin = '';
  let activeWeb: {hash: string; value: Record<string, unknown>} | undefined;
  const platform: FakePlatform = {
    get url() {
      return origin;
    },
    mapId,
    requests: [],
    deployments: [],
    uploads: [],
    activeVersion: () =>
      reservations.find((reservation) => reservation.active)?.version ??
      (activeWeb?.value.version as number | undefined),
  };

  const result = (reservation: Reservation, changed: boolean) => {
    const themes = Object.keys(reservation.artifact.renderers.web.styles).sort();
    const native = `${origin}/maps/${mapId}/native`;
    return {
      kind: 'tileflow-map-deployment-result',
      schemaVersion: 3,
      changed,
      mapId,
      deploymentId: reservation.id,
      version: reservation.version,
      renderers: {
        web: {
          themes: Object.fromEntries(
            themes.map((theme) => [
              theme,
              {styleId: `${mapId}_${theme}`, styleUrl: `${origin}/maps/${mapId}/${theme}.json`},
            ]),
          ),
        },
        native: {
          profile: 'native-v1',
          manifestUrl: `${native}/manifest.json`,
          family: {
            url: `${native}/family/v${reservation.version}.json`,
            revision: sha256(reservation.documents.get('family')!),
          },
          themes: Object.fromEntries(
            themes.map((theme) => [
              theme,
              {
                styleUrl: `${native}/v${reservation.version}/${theme}.json`,
                revision: sha256(reservation.documents.get(`style:${theme}`)!),
              },
            ]),
          ),
        },
      },
      ...(platform.teamModels ? {teamModels: platform.teamModels} : {}),
    };
  };
  const missing = (reservation: Reservation) => [
    ...Object.keys(reservation.artifact.renderers.native.documents.styles)
      .sort()
      .filter((theme) => !reservation.documents.has(`style:${theme}`))
      .map((theme) => ({document: 'style' as const, theme})),
    ...(reservation.documents.has('family') ? [] : [{document: 'family' as const}]),
  ];

  const deploy = async (request: FakePlatformRequest): Promise<FakePlatformReply> => {
    let body: Record<string, any>;
    try {
      body = JSON.parse(request.body.toString('utf8')) as Record<string, any>;
    } catch {
      return failure(400, 'TF_DEPLOYMENT_BODY_INVALID');
    }
    const answer = (reply: FakePlatformReply) => {
      platform.deployments.push({body, status: reply.status});
      return reply;
    };
    if (body.artifact?.schemaVersion === 3 && request.headers['x-tileflow-publication'] === 'web') {
      const {styles} = expandTileflowDeploymentArtifact(body.artifact) as {
        styles: Record<string, unknown>;
      };
      const hash = await hashHostedPublicationContent(
        hostedPublicationContentParts(request.body, () => true),
      );
      const version = (platform.activeVersion() ?? 0) + 1;
      activeWeb = {
        hash,
        value: {
          mapId,
          version,
          changed: true,
          deploymentId: `dep_web${version}`,
          ...(platform.teamModels ? {teamModels: platform.teamModels} : {}),
          themes: Object.fromEntries(
            Object.keys(styles).map((theme) => [
              theme,
              {
                styleUrl: `${origin}/maps/${mapId}/${theme}.json`,
              },
            ]),
          ),
        },
      };
      return answer({status: 200, body: activeWeb.value});
    }
    if ([2, 4].includes(body.artifact?.schemaVersion))
      return answer(failure(400, 'TF_RENDERER_DEPLOYMENT_RETIRED'));
    if (body.artifact?.schemaVersion !== 5)
      return answer(failure(400, 'TF_NATIVE_FAMILY_REQUIRED'));
    if (body.managedMapId !== mapId || body.usageMode !== 'session')
      return answer(failure(403, 'TF_MAP_FORBIDDEN'));
    const parsed = tileflowRendererDeploymentRequestArtifactSchema.safeParse(body.artifact);
    if (!parsed.success) return answer(failure(400, 'TF_RENDERER_DEPLOYMENT_INVALID'));
    const key = await hashHostedPublicationContent(
      hostedPublicationContentParts(request.body, () => true),
    );
    const active = reservations.find((reservation) => reservation.active);
    if (active?.key === key) return answer({status: 200, body: result(active, false)});
    let reservation = reservations.find((value) => !value.active && value.key === key);
    if (!reservation) {
      const version = Math.max(0, ...reservations.map((value) => value.version)) + 1;
      reservation = {
        id: `dep_fake${version}${key.slice(0, 12)}`,
        version,
        key,
        artifact: parsed.data,
        documents: new Map(),
        active: false,
      };
      reservations.push(reservation);
    }
    const documents = missing(reservation);
    if (documents.length) {
      const index = reservation.artifact.renderers.native.documents;
      const base = `${origin}/v1/styles/deployments/${reservation.id}/native`;
      return answer({
        status: 202,
        body: {
          kind: 'tileflow-map-deployment-pending',
          schemaVersion: 1,
          mapId,
          deploymentId: reservation.id,
          version: reservation.version,
          native: {
            documents: documents.map((document) =>
              document.document === 'style'
                ? {
                    ...document,
                    ...index.styles[document.theme]!,
                    method: 'PUT',
                    url: `${base}/styles/${document.theme}.json`,
                  }
                : {
                    document: 'family',
                    sha256: index.family.sha256,
                    bytes: index.family.bytes,
                    method: 'PUT',
                    url: `${base}/family.json`,
                  },
            ),
          },
        },
      });
    }
    for (const value of reservations) value.active = false;
    reservation.active = true;
    return answer({status: 200, body: result(reservation, true)});
  };

  const upload = (request: FakePlatformRequest, match: RegExpExecArray): FakePlatformReply => {
    const [, id, theme] = match;
    const document = theme === undefined ? 'family' : `style:${theme}`;
    const answer = (reply: FakePlatformReply) => {
      platform.uploads.push({
        document,
        status: reply.status,
        ...(typeof request.headers['content-encoding'] === 'string'
          ? {encoding: request.headers['content-encoding']}
          : {}),
      });
      return reply;
    };
    const reservation = reservations.find((value) => value.id === id);
    if (!reservation) return answer(failure(404, 'TF_NATIVE_DOCUMENT_NOT_FOUND'));
    if (reservation.active) return answer(failure(409, 'TF_NATIVE_DEPLOYMENT_PUBLISHED'));
    if (platform.failUploadsAfter !== undefined && accepted >= platform.failUploadsAfter)
      return answer(failure(503, 'TF_NATIVE_DOCUMENT_UNAVAILABLE'));
    const index = reservation.artifact.renderers.native.documents;
    const expected = theme === undefined ? index.family : index.styles[theme];
    if (!expected) return answer(failure(404, 'TF_NATIVE_DOCUMENT_NOT_FOUND'));
    if (request.body.byteLength !== expected.bytes || sha256(request.body) !== expected.sha256)
      return answer(failure(400, 'TF_NATIVE_DOCUMENT_MISMATCH'));
    const text = request.body.toString('utf8');
    if (theme === undefined) {
      const absent = missing(reservation)
        .filter((value) => value.document === 'style')
        .map((value) => value.theme);
      if (absent.length)
        return answer({
          status: 409,
          body: {
            error: 'Upload every native theme style first',
            code: 'TF_NATIVE_DOCUMENTS_INCOMPLETE',
            missing: absent,
          },
        });
      // Like the platform: every theme entry is what Core computes from its own uploaded style.
      try {
        const family = tileflowNativeFamilySchema.parse(JSON.parse(text));
        for (const [position, entry] of family.themes.entries()) {
          const style = JSON.parse(reservation.documents.get(`style:${entry.name}`)!);
          const computed = createTileflowNativeFamily({
            map: family.map,
            themes: [entry.name],
            styles: {[entry.name]: style},
          }).themes[0];
          if (serializeCanonicalJson(computed) !== serializeCanonicalJson(family.themes[position]))
            throw new Error();
        }
      } catch {
        return answer(failure(400, 'TF_NATIVE_FAMILY_INVALID'));
      }
    }
    // Create-only: the same bytes converge.
    if (!reservation.documents.has(document)) reservation.documents.set(document, text);
    accepted += 1;
    return answer({
      status: 200,
      body: {
        kind: 'tileflow-native-document-receipt',
        schemaVersion: 1,
        deploymentId: reservation.id,
        version: reservation.version,
        document: theme === undefined ? 'family' : 'style',
        ...(theme === undefined ? {} : {theme}),
        sha256: expected.sha256,
        bytes: expected.bytes,
      },
    });
  };

  const iconPackage = async (request: FakePlatformRequest, hash: string) => {
    const form = await formData(request);
    const files = ['spriteJson', 'spritePng', 'sprite2xJson', 'sprite2xPng'].map((field) =>
      form.get(field),
    );
    if (!files.every((file) => file instanceof Blob)) return failure(400, 'ICON_PACKAGE_INVALID');
    const index = JSON.parse(await (files[0] as Blob).text()) as Record<string, unknown>;
    const id = `icp_${hash.slice(0, 24)}`;
    const changed = !iconPackages.has(hash);
    iconPackages.add(hash);
    return {
      status: 200,
      body: {
        changed,
        contentHash: hash,
        iconCount: Object.keys(index).length,
        id,
        spriteUrl: `${origin}/sprites/${id}/sprite`,
        totalBytes: (files as Blob[]).reduce((total, file) => total + file.size, 0),
      },
    };
  };
  const fontBundle = async (request: FakePlatformRequest, hash: string) => {
    const form = await formData(request);
    const manifestFile = form.get('manifest');
    if (!(manifestFile instanceof Blob)) return failure(400, 'FONT_BUNDLE_INVALID');
    const manifest = JSON.parse(await manifestFile.text()) as {
      files: Array<{byteLength: number; name: string}>;
      fontFaces: unknown[];
    };
    for (const file of manifest.files) {
      const part = form.get(`file:${encodeURIComponent(file.name)}`);
      if (!(part instanceof Blob) || part.size !== file.byteLength)
        return failure(400, 'FONT_BUNDLE_INVALID');
    }
    const id = `fnb_${hash.slice(0, 24)}`;
    const changed = !fontBundles.has(hash);
    fontBundles.add(hash);
    return {
      status: 200,
      body: {
        baseUrl: `${origin}/font-bundles/${id}`,
        changed,
        contentHash: hash,
        fontFaceCount: manifest.fontFaces.length,
        id,
        totalBytes: manifest.files.reduce((total, file) => total + file.byteLength, 0),
      },
    };
  };

  const server = createServer(async (incoming: IncomingMessage, response: ServerResponse) => {
    try {
      const path = incoming.url ?? '/';
      const raw = await readBody(incoming);
      if (path === '/v1/me') {
        reply(
          response,
          options.profile === false
            ? failure(404, 'TF_NOT_FOUND')
            : {status: 200, body: options.profile ?? projectProfile(mapId)},
        );
        return;
      }
      const request: FakePlatformRequest = {
        method: incoming.method ?? 'GET',
        path,
        headers: incoming.headers,
        body: incoming.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw,
      };
      if (path === '/v1/styles/publications/check' && !options.preflight) {
        reply(response, failure(404, 'TF_NOT_FOUND'));
        return;
      }
      if (
        request.method === 'GET' &&
        /^\/v1\/(?:icon-packages|font-bundles)\/[a-f0-9]{64}$/u.test(path) &&
        !options.preflight
      ) {
        reply(response, failure(404, 'TF_NOT_FOUND'));
        return;
      }
      platform.requests.push(request);
      const intercepted = await options.intercept?.(request, platform);
      if (intercepted) {
        reply(response, intercepted);
        return;
      }
      const styleUpload =
        /^\/v1\/styles\/deployments\/(dep_[A-Za-z0-9_-]+)\/native\/(?:styles\/([A-Za-z][A-Za-z0-9_-]*)\.json|family\.json)$/u.exec(
          path,
        );
      const icon = /^\/v1\/icon-packages\/([a-f0-9]{64})$/u.exec(path);
      const font = /^\/v1\/font-bundles\/([a-f0-9]{64})$/u.exec(path);
      if (request.method === 'POST' && path === '/v1/styles')
        reply(response, await deploy(request));
      else if (request.method === 'POST' && path === '/v1/styles/publications/check') {
        const input = requestJson(request);
        if (activeWeb && input.contentHash === activeWeb.hash)
          reply(response, {status: 200, body: {...activeWeb.value, changed: false}});
        else {
          const active = reservations.find((reservation) => reservation.active);
          reply(
            response,
            active?.key === input.contentHash
              ? {status: 200, body: result(active!, false)}
              : {status: 204, body: null},
          );
        }
      } else if (request.method === 'PUT' && styleUpload)
        reply(response, upload(request, styleUpload));
      else if (request.method === 'PUT' && icon)
        reply(response, await iconPackage(request, icon[1]!));
      else if (request.method === 'PUT' && font)
        reply(response, await fontBundle(request, font[1]!));
      else reply(response, failure(404, 'TF_NOT_FOUND'));
    } catch (error) {
      reply(response, {
        status: 500,
        body: {error: error instanceof Error ? error.message : 'Fake platform failure'},
      });
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('Fake platform did not listen.');
  origin = `http://127.0.0.1:${address.port}`;
  return platform;
}

export function projectProfile(mapId: string) {
  return {
    apiKeyId: 'key_test',
    credentialType: 'project_api_key',
    mapId,
    organization: {id: 'org_test', name: 'Test', slug: 'test'},
    project: {id: 'prj_map', name: 'Map', slug: 'map'},
    projectId: 'prj_map',
    scopes: ['styles:write'],
  };
}

export function failure(status: number, code: string, error = code): FakePlatformReply {
  return {status, body: {error, code}};
}

/** The JSON body of a recorded request. */
export function requestJson(request: FakePlatformRequest): Record<string, any> {
  return JSON.parse(request.body.toString('utf8')) as Record<string, any>;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function formData(request: FakePlatformRequest): Promise<FormData> {
  const body = new Uint8Array(request.body.byteLength);
  body.set(request.body);
  return new Request('https://fixture.example.test/upload', {
    body,
    headers: {'Content-Type': String(request.headers['content-type'])},
    method: 'POST',
  }).formData();
}

function reply(response: ServerResponse, value: InterceptReply) {
  if ('disconnect' in value) {
    response.destroy();
    return;
  }
  response.writeHead(value.status, {
    'Content-Type': value.raw ? 'text/html' : 'application/json',
    ...value.headers,
  });
  response.end(value.raw ? String(value.body) : JSON.stringify(value.body));
}
