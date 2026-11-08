/**
 * Minimal GitHub REST client. It uses the standard runner variables, so the same code talks to
 * github.com, Enterprise Server or a local test double.
 */
export function createGitHub(env = process.env) {
  const api = (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, '');
  const repository = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN;
  if (!repository || !token) throw new Error('GITHUB_REPOSITORY and a token are required.');

  async function request(method, path, body) {
    const url = path.startsWith('http') ? path : `${api}/repos/${repository}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'tileflow-visual-review',
        'x-github-api-version': '2022-11-28',
      },
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    if (response.status === 204) return null;
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`GitHub ${method} ${path} failed with ${response.status}: ${text}`);
      error.status = response.status;
      throw error;
    }
    return text ? JSON.parse(text) : null;
  }

  return {
    repository,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    async getOptional(path) {
      try {
        return await request('GET', path);
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    },
    async paginate(path, maximumPages = 10) {
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
