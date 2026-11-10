/**
 * Minimal GitLab REST client. It uses the predefined job variables, so the same code talks to
 * gitlab.com, a self-managed instance or a local test double.
 */
export function createGitLabClient(env = process.env) {
  const api = env.CI_API_V4_URL?.replace(/\/+$/, '');
  const project = env.CI_PROJECT_ID;
  const token = env.TILEFLOW_REVIEW_TOKEN;
  if (!api || !project || !token) {
    throw new Error('CI_API_V4_URL, CI_PROJECT_ID and TILEFLOW_REVIEW_TOKEN are required.');
  }
  const url = (path) =>
    path.startsWith('/user') ? `${api}${path}` : `${api}/projects/${project}${path}`;

  async function send(method, path, body) {
    const response = await fetch(url(path), {
      method,
      headers: {
        'content-type': 'application/json',
        'private-token': token,
        'user-agent': 'tileflow-visual-review',
      },
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`GitLab ${method} ${path} failed with ${response.status}: ${text}`);
      error.status = response.status;
      throw error;
    }
    return response;
  }

  const request = async (method, path, body) => {
    const text = await (await send(method, path, body)).text();
    return text ? JSON.parse(text) : null;
  };
  const optional = async (read) => {
    try {
      return await read();
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  };
  const getBytes = async (path) => Buffer.from(await (await send('GET', path)).arrayBuffer());

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    getOptional: (path) => optional(() => request('GET', path)),
    getBytes,
    getBytesOptional: (path) => optional(() => getBytes(path)),
    async paginate(path, maximumPages = 20) {
      const items = [];
      for (let page = 1; page <= maximumPages; page += 1) {
        const separator = path.includes('?') ? '&' : '?';
        const batch = await request('GET', `${path}${separator}per_page=100&page=${page}`);
        items.push(...batch);
        if (batch.length < 100) break;
      }
      return items;
    },
  };
}
