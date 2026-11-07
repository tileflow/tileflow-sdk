import {createHash} from 'node:crypto';
import {createServer} from 'node:http';

/**
 * In-memory GitHub double covering the REST calls the action makes, including Git Data objects.
 */
export async function startFakeGitHub(initial = {}) {
  const state = {
    blobs: new Map(),
    comments: [],
    commits: new Map(),
    nextId: 1,
    permissions: {},
    protectedBranches: new Set(),
    pulls: new Map(),
    reactions: [],
    refs: new Map(),
    statuses: [],
    trees: new Map(),
    pullFiles: new Map(),
    ...initial,
  };
  const id = (value) => createHash('sha1').update(value).digest('hex');
  const blob = (bytes) => {
    const sha = id(bytes);
    state.blobs.set(sha, Buffer.from(bytes));
    return sha;
  };
  const commitTree = (sha) => new Map(state.trees.get(state.commits.get(sha).tree));
  state.seedBranch = (name, files = {}) => {
    const tree = new Map(Object.entries(files).map(([path, value]) => [path, blob(value)]));
    const treeSha = id(JSON.stringify([...tree]));
    state.trees.set(treeSha, tree);
    const commit = id(`${name}-${treeSha}`);
    state.commits.set(commit, {tree: treeSha, parents: []});
    state.refs.set(name, commit);
    return commit;
  };
  state.files = (branch) => {
    const tree = commitTree(state.refs.get(branch));
    return new Map([...tree].map(([path, sha]) => [path, state.blobs.get(sha)]));
  };

  const routes = [
    [
      'GET',
      /^\/git\/ref\/heads\/(.+)$/,
      ([name]) => {
        const sha = state.refs.get(name);
        return sha ? [200, {object: {sha}}] : [404, {}];
      },
    ],
    [
      'POST',
      /^\/git\/blobs$/,
      (_, body) => [201, {sha: blob(Buffer.from(body.content, 'base64'))}],
    ],
    [
      'GET',
      /^\/git\/commits\/(\w+)$/,
      ([sha]) => [200, {tree: {sha: state.commits.get(sha).tree}}],
    ],
    [
      'GET',
      /^\/git\/trees\/(\w+)$/,
      ([sha]) => [
        200,
        {
          tree: [...commitTree(sha)].map(([path, blobSha]) => ({path, sha: blobSha, type: 'blob'})),
        },
      ],
    ],
    [
      'POST',
      /^\/git\/trees$/,
      (_, body) => {
        const tree = new Map(body.base_tree ? state.trees.get(body.base_tree) : []);
        for (const entry of body.tree) {
          if (entry.sha === null) tree.delete(entry.path);
          else tree.set(entry.path, entry.sha);
        }
        const sha = id(JSON.stringify([...tree]));
        state.trees.set(sha, tree);
        return [201, {sha}];
      },
    ],
    [
      'POST',
      /^\/git\/commits$/,
      (_, body) => {
        const sha = id(JSON.stringify(body) + state.nextId++);
        state.commits.set(sha, {tree: body.tree, parents: body.parents, message: body.message});
        return [201, {sha}];
      },
    ],
    [
      'POST',
      /^\/git\/refs$/,
      (_, body) => {
        state.refs.set(body.ref.replace('refs/heads/', ''), body.sha);
        return [201, {}];
      },
    ],
    [
      'PATCH',
      /^\/git\/refs\/heads\/(.+)$/,
      ([name], body) => {
        if (state.protectedBranches.has(name))
          return [422, {message: 'Protected branch update failed'}];
        state.refs.set(name, body.sha);
        return [200, {}];
      },
    ],
    [
      'GET',
      /^\/pulls\/(\d+)$/,
      ([number]) => {
        const pull = state.pulls.get(Number(number));
        return pull ? [200, pull] : [404, {}];
      },
    ],
    [
      'GET',
      /^\/pulls\/(\d+)\/files$/,
      ([number]) => [200, state.pullFiles.get(Number(number)) ?? []],
    ],
    ['POST', /^\/pulls$/, (_, body) => [201, {number: 900, ...body}]],
    [
      'GET',
      /^\/issues\/(\d+)\/comments$/,
      ([number]) => [200, state.comments.filter((comment) => comment.issue === Number(number))],
    ],
    [
      'POST',
      /^\/issues\/(\d+)\/comments$/,
      ([number], body) => {
        const comment = {
          id: state.nextId++,
          issue: Number(number),
          body: body.body,
          user: {login: 'github-actions[bot]'},
        };
        state.comments.push(comment);
        return [201, comment];
      },
    ],
    [
      'PATCH',
      /^\/issues\/comments\/(\d+)$/,
      ([commentId], body) => {
        state.comments.find((comment) => comment.id === Number(commentId)).body = body.body;
        return [200, {}];
      },
    ],
    [
      'POST',
      /^\/issues\/comments\/(\d+)\/reactions$/,
      ([commentId], body) => {
        state.reactions.push({comment: Number(commentId), content: body.content});
        return [201, {}];
      },
    ],
    [
      'POST',
      /^\/statuses\/(\w+)$/,
      ([sha], body) => {
        state.statuses.push({sha, ...body});
        return [201, {}];
      },
    ],
    [
      'GET',
      /^\/collaborators\/([^/]+)\/permission$/,
      ([user]) => [200, {permission: state.permissions[decodeURIComponent(user)] ?? 'read'}],
    ],
    [
      'GET',
      /^\/contents\/(.+)$/,
      ([path], _, url) => {
        const tree = commitTree(url.searchParams.get('ref'));
        const sha = tree.get(decodeURIComponent(path));
        if (!sha) return [404, {}];
        return [200, {content: state.blobs.get(sha).toString('base64')}];
      },
    ],
  ];

  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const url = new URL(request.url, 'http://localhost');
    const path = url.pathname.replace('/repos/acme/maps', '');
    for (const [method, pattern, handler] of routes) {
      const match = request.method === method ? pattern.exec(path) : null;
      if (!match) continue;
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      const [status, payload] = handler(match.slice(1), body, url);
      response.writeHead(status, {'content-type': 'application/json'});
      response.end(JSON.stringify(payload));
      return;
    }
    response.writeHead(501);
    response.end(JSON.stringify({message: `Unhandled ${request.method} ${path}`}));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.url = `http://127.0.0.1:${server.address().port}`;
  state.close = () => new Promise((resolve) => server.close(resolve));
  return state;
}
