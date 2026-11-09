import {createHash} from 'node:crypto';
import {createServer} from 'node:http';

/**
 * In-memory GitLab double covering the REST calls the provider makes, with the refusals that
 * matter: `create` on an existing file, `update` on a missing one, and protected branches.
 */
export async function startFakeGitLab() {
  const state = {
    blobs: new Map(),
    branches: new Map(),
    diffs: new Map(),
    members: {},
    mergeRequests: new Map(),
    nextId: 1,
    notes: [],
    protectedBranches: new Set(),
    statuses: [],
    tokenUser: {id: 500, username: 'project_bot'},
  };
  const blob = (bytes) => {
    const sha = createHash('sha1').update(bytes).digest('hex');
    state.blobs.set(sha, Buffer.from(bytes));
    return sha;
  };
  const commitId = () => createHash('sha1').update(String(state.nextId++)).digest('hex');
  state.seedBranch = (name, files = {}) => {
    const tree = new Map(Object.entries(files).map(([path, value]) => [path, blob(value)]));
    state.branches.set(name, {id: commitId(), tree});
  };
  state.files = (name) =>
    new Map([...state.branches.get(name).tree].map(([path, sha]) => [path, state.blobs.get(sha)]));

  const entriesBelow = (tree, path, recursive) => {
    const prefix = path ? `${path}/` : '';
    const seen = new Map();
    for (const [file, id] of tree) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      const [name, ...more] = rest.split('/');
      if (recursive || more.length === 0) {
        seen.set(file, {id, name: rest.split('/').at(-1), path: file, type: 'blob'});
      } else {
        seen.set(`${prefix}${name}`, {name, path: `${prefix}${name}`, type: 'tree'});
      }
    }
    return [...seen.values()];
  };

  const routes = [
    ['GET', /^\/user$/, () => [200, state.tokenUser]],
    [
      'GET',
      /^\/projects\/42\/repository\/branches\/(.+)$/,
      ([name]) => {
        const branch = state.branches.get(decodeURIComponent(name));
        return branch ? [200, {commit: {id: branch.id}}] : [404, {}];
      },
    ],
    [
      'GET',
      /^\/projects\/42\/repository\/tree$/,
      (_, __, url) => {
        const branch = state.branches.get(url.searchParams.get('ref'));
        if (!branch) return [404, {message: 'invalid revision or path'}];
        const path = url.searchParams.get('path') ?? '';
        const recursive = url.searchParams.get('recursive') === 'true';
        const entries = entriesBelow(branch.tree, path, recursive);
        if (path && entries.length === 0) return [404, {message: 'invalid revision or path'}];
        return [200, entries];
      },
    ],
    [
      'GET',
      /^\/projects\/42\/repository\/files\/(.+)\/raw$/,
      ([path], _, url) => {
        const sha = state.branches
          .get(url.searchParams.get('ref'))
          ?.tree.get(decodeURIComponent(path));
        return sha ? [200, state.blobs.get(sha)] : [404, {}];
      },
    ],
    [
      'GET',
      /^\/projects\/42\/repository\/blobs\/(\w+)\/raw$/,
      ([sha]) => (state.blobs.has(sha) ? [200, state.blobs.get(sha)] : [404, {}]),
    ],
    [
      'POST',
      /^\/projects\/42\/repository\/commits$/,
      (_, body) => {
        if (state.protectedBranches.has(body.branch)) {
          return [403, {message: 'You are not allowed to push into this branch'}];
        }
        const current = state.branches.get(body.branch);
        const start = body.start_branch ? state.branches.get(body.start_branch) : current;
        if (!start) return [400, {message: 'You can only create or edit files on a branch'}];
        const tree = new Map(body.force || !current ? start.tree : current.tree);
        for (const {action, content, encoding, file_path: path} of body.actions) {
          if (action === 'create' && tree.has(path)) return [400, {message: 'already exists'}];
          if (action !== 'create' && !tree.has(path)) return [400, {message: 'does not exist'}];
          if (action === 'delete') tree.delete(path);
          else tree.set(path, blob(Buffer.from(content, encoding)));
        }
        const commit = {id: commitId(), message: body.commit_message, tree};
        state.branches.set(body.branch, commit);
        return [201, {id: commit.id}];
      },
    ],
    [
      'GET',
      /^\/projects\/42\/merge_requests\/(\d+)$/,
      ([iid]) => {
        const mergeRequest = state.mergeRequests.get(Number(iid));
        return mergeRequest ? [200, mergeRequest] : [404, {}];
      },
    ],
    [
      'GET',
      /^\/projects\/42\/merge_requests\/(\d+)\/diffs$/,
      ([iid]) => [200, state.diffs.get(Number(iid)) ?? []],
    ],
    [
      'POST',
      /^\/projects\/42\/merge_requests$/,
      (_, body) => {
        const sha = state.branches.get(body.source_branch).id;
        const pipeline = {id: 901, sha, source: 'merge_request_event', status: 'skipped'};
        state.mergeRequests.set(900, {iid: 900, ...body, sha, head_pipeline: pipeline});
        return [201, {iid: 900}];
      },
    ],
    [
      'GET',
      /^\/projects\/42\/merge_requests\/(\d+)\/notes$/,
      ([iid]) => [200, state.notes.filter((note) => note.iid === Number(iid))],
    ],
    [
      'POST',
      /^\/projects\/42\/merge_requests\/(\d+)\/notes$/,
      ([iid], body) => {
        const note = {
          id: state.nextId++,
          iid: Number(iid),
          body: body.body,
          author: state.tokenUser,
        };
        state.notes.push(note);
        return [201, note];
      },
    ],
    [
      'PUT',
      /^\/projects\/42\/merge_requests\/(\d+)\/notes\/(\d+)$/,
      ([, id], body) => {
        state.notes.find((note) => note.id === Number(id)).body = body.body;
        return [200, {}];
      },
    ],
    [
      'POST',
      /^\/projects\/42\/statuses\/(\w+)$/,
      ([sha], body) => {
        if (!['failed', 'success'].includes(body.state)) return [400, {message: 'bad state'}];
        state.statuses.push({sha, ...body});
        return [201, {}];
      },
    ],
    [
      'GET',
      /^\/projects\/42\/members\/all\/(\d+)$/,
      ([id]) => {
        const level = state.members[id];
        return level ? [200, {access_level: level}] : [404, {}];
      },
    ],
  ];

  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const url = new URL(request.url, 'http://localhost');
    // Node keeps percent-encoding in pathname, which is what the file routes need.
    const path = url.pathname.replace('/api/v4', '');
    for (const [method, pattern, handler] of routes) {
      const match = request.method === method ? pattern.exec(path) : null;
      if (!match) continue;
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      const [status, payload] = handler(match.slice(1), body, url);
      response.writeHead(status);
      response.end(Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));
      return;
    }
    response.writeHead(501);
    response.end(JSON.stringify({message: `Unhandled ${request.method} ${path}`}));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.url = `http://127.0.0.1:${server.address().port}/api/v4`;
  state.close = () => new Promise((resolve) => server.close(resolve));
  return state;
}
