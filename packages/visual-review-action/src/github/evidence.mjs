const maximumAttempts = 4;
const placeholderPath = 'README.md';
const placeholder =
  'Evidence for the Tileflow visual review action. Files here are managed automatically.\n';

/**
 * Writes to the evidence branch through the Git Data API, so no job in this stage needs a checkout
 * of anything pull request code could have touched.
 */
export async function writeEvidence(github, branch, files, message, removePrefixes = []) {
  for (let attempt = 1; ; attempt += 1) {
    const reference = await github.getOptional(`/git/ref/heads/${branch}`);
    const parent = reference?.object.sha;
    const entries = [];
    for (const {path, bytes} of files) {
      const blob = await github.post('/git/blobs', {
        content: Buffer.from(bytes).toString('base64'),
        encoding: 'base64',
      });
      entries.push({path, mode: '100644', type: 'blob', sha: blob.sha});
    }
    if (removePrefixes.length > 0 && parent) {
      const {tree} = await github.get(`/git/trees/${parent}?recursive=1`);
      const blobs = tree.filter((entry) => entry.type === 'blob');
      const removed = blobs.filter(({path}) =>
        removePrefixes.some((prefix) => path.startsWith(prefix)),
      );
      for (const {path} of removed) {
        entries.push({path, mode: '100644', type: 'blob', sha: null});
      }
      // GitHub refuses a tree update that would leave the tree empty.
      if (removed.length > 0 && removed.length === blobs.length && files.length === 0) {
        const blob = await github.post('/git/blobs', {content: placeholder, encoding: 'utf-8'});
        entries.push({path: placeholderPath, mode: '100644', type: 'blob', sha: blob.sha});
      }
    }
    if (entries.length === 0) return parent;
    const baseTree = parent ? (await github.get(`/git/commits/${parent}`)).tree.sha : undefined;
    const tree = await github.post('/git/trees', {
      ...(baseTree ? {base_tree: baseTree} : {}),
      tree: entries,
    });
    const commit = await github.post('/git/commits', {
      message,
      tree: tree.sha,
      parents: parent ? [parent] : [],
    });
    try {
      if (parent) {
        await github.patch(`/git/refs/heads/${branch}`, {sha: commit.sha});
      } else {
        await github.post('/git/refs', {ref: `refs/heads/${branch}`, sha: commit.sha});
      }
      return commit.sha;
    } catch (error) {
      if (attempt >= maximumAttempts || ![409, 422].includes(error.status)) throw error;
    }
  }
}

export async function readEvidenceJson(github, branch, path) {
  const reference = await github.getOptional(`/git/ref/heads/${branch}`);
  if (!reference) return null;
  const file = await github.getOptional(
    `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${reference.object.sha}`,
  );
  if (!file) return null;
  return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
}

export async function listEvidenceBlobs(github, branch, prefix) {
  const reference = await github.getOptional(`/git/ref/heads/${branch}`);
  if (!reference) return new Map();
  const {tree} = await github.get(`/git/trees/${reference.object.sha}?recursive=1`);
  return new Map(
    tree
      .filter((entry) => entry.type === 'blob' && entry.path.startsWith(prefix))
      .map((entry) => [entry.path.slice(prefix.length), entry.sha]),
  );
}
