import {setTimeout as delay} from 'node:timers/promises';
import {commentMarker, statusContext} from '../contract.mjs';
import {createGitLabClient} from './client.mjs';

const developerAccess = 30;
const maximumAttempts = 4;
const pipelinePollAttempts = 30;
const pipelinePollDelayMs = 2000;
const skipCi = '[ci skip]';
const statusStates = {error: 'failed', failure: 'failed', success: 'success'};

/**
 * Capture executes merge request code. Forks are out of scope because a parent pipeline for a fork
 * exposes every parent variable, and the publishing token must stay out of this job.
 */
export function assertGitLabCaptureAllowed(env) {
  if (env.CI_PIPELINE_SOURCE !== 'merge_request_event') {
    throw new Error('Capture runs merge request code and must run in a merge request pipeline.');
  }
  const {CI_MERGE_REQUEST_PROJECT_ID: target, CI_MERGE_REQUEST_SOURCE_PROJECT_ID: source} = env;
  if (source !== env.CI_PROJECT_ID || target !== env.CI_PROJECT_ID) {
    throw new Error('Capture supports merge requests from the same project only.');
  }
  if (env.TILEFLOW_REVIEW_TOKEN) {
    throw new Error(
      'Capture must not receive TILEFLOW_REVIEW_TOKEN. Limit it to the tileflow-visual-review environment.',
    );
  }
}

export function gitlabApprovalInstructions() {
  return [
    'If the renders above are intended, someone with at least the Developer role can accept them',
    'for this commit by running the **tileflow-visual-review-approve** job in this pipeline.',
  ];
}

const encodePath = (path) => encodeURIComponent(path);
const topLevel = (path) => path.split('/')[0];

export function createGitLabProvider(env) {
  const gitlab = createGitLabClient(env);
  const branch = env.TILEFLOW_REVIEW_EVIDENCE_BRANCH;
  const reference = (number) => `!${number}`;
  const comment = (number, body) => gitlab.post(`/merge_requests/${number}/notes`, {body});

  async function setStatus(sha, state, description, targetUrl, target = {}) {
    const pipelineId =
      target.pipelineId ?? (sha === env.CI_COMMIT_SHA ? Number(env.CI_PIPELINE_ID) : undefined);
    const body = {
      name: statusContext,
      state: statusStates[state],
      description: description.slice(0, 255),
      ...(targetUrl ? {target_url: targetUrl.slice(0, 255)} : {}),
      ...(target.ref ? {ref: target.ref} : {}),
      ...(pipelineId ? {pipeline_id: pipelineId} : {}),
    };
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await gitlab.post(`/statuses/${sha}`, body);
      } catch (error) {
        if (attempt >= maximumAttempts || error.status !== 409) throw error;
      }
    }
  }

  /**
   * A skip-CI commit still gets a skipped merge request pipeline, which GitLab creates a moment
   * after the merge request. A status on any other pipeline leaves "Pipelines must succeed" blocked.
   */
  async function skippedPipelineId(iid, sha) {
    for (let attempt = 1; attempt <= pipelinePollAttempts; attempt += 1) {
      const {head_pipeline: pipeline} = await gitlab.get(`/merge_requests/${iid}`);
      if (pipeline?.sha === sha && pipeline.source === 'merge_request_event') return pipeline.id;
      await delay(pipelinePollDelayMs);
    }
    return undefined;
  }

  async function listTree(ref, path) {
    const query = new URLSearchParams({path, recursive: 'true', ref});
    const entries = await paginateOptional(`/repository/tree?${query}`);
    return entries.filter((entry) => entry.type === 'blob');
  }

  /**
   * The tree endpoint answers 404 for a path that does not exist yet.
   */
  async function paginateOptional(path) {
    try {
      return await gitlab.paginate(path);
    } catch (error) {
      if (error.status === 404) return [];
      throw error;
    }
  }

  async function existingPaths(ref, paths) {
    const roots = [...new Set(paths.map(topLevel))];
    const trees = await Promise.all(roots.map((root) => listTree(ref, root)));
    return new Set(trees.flat().map(({path}) => path));
  }

  async function changeRequestsWithEvidence() {
    const query = new URLSearchParams({ref: branch});
    const root = await paginateOptional(`/repository/tree?${query}`);
    const approvals = await listTree(branch, 'approvals');
    const numbers = [
      ...root.filter(({type}) => type === 'tree').map(({name}) => /^pr-(\d+)$/.exec(name)?.[1]),
      ...approvals.map(({name}) => /^pr-(\d+)\.json$/.exec(name)?.[1]),
    ].filter(Boolean);
    return [...new Set(numbers)].map(Number);
  }

  function fileActions(files, existing) {
    return files.map(({path, bytes}) => ({
      action: existing.has(path) ? 'update' : 'create',
      content: Buffer.from(bytes).toString('base64'),
      encoding: 'base64',
      file_path: path,
    }));
  }

  return {
    reference,
    comment,
    setStatus: (sha, state, description, targetUrl) =>
      setStatus(sha, state, description, targetUrl),
    changeRequestNoun: 'merge request',
    approvalInstructions: gitlabApprovalInstructions,
    isAutomationFile: (path) => path === '.gitlab-ci.yml' || path.startsWith('.gitlab/'),
    captureCameFromChangeRequest: () => env.CI_PIPELINE_SOURCE === 'merge_request_event',
    captureRunUrl: () => env.CI_PIPELINE_URL,

    approvalRequest() {
      if (env.CI_JOB_MANUAL !== 'true') return null;
      return {author: env.GITLAB_USER_LOGIN, requestedSha: env.TILEFLOW_REVIEW_HEAD_SHA};
    },
    acknowledgeApproval: async () => {},
    async canApprove() {
      const member = await gitlab.getOptional(`/members/all/${env.GITLAB_USER_ID}`);
      return (member?.access_level ?? 0) >= developerAccess;
    },

    async closedChangeRequests() {
      const closed = [];
      for (const number of await changeRequestsWithEvidence()) {
        const {state} = await gitlab.get(`/merge_requests/${number}`);
        if (state === 'merged' || state === 'closed') {
          closed.push({number, merged: state === 'merged'});
        }
      }
      return closed;
    },
    async getChangeRequest(number) {
      const mergeRequest = await gitlab.get(`/merge_requests/${number}`);
      return {
        number,
        headSha: mergeRequest.sha,
        baseBranch: mergeRequest.target_branch,
        open: mergeRequest.state === 'opened',
      };
    },
    async listChangedFiles(number) {
      const diffs = await gitlab.paginate(`/merge_requests/${number}/diffs`);
      return [...new Set(diffs.flatMap(({new_path, old_path}) => [new_path, old_path]))];
    },
    async upsertReport(number, body) {
      const [{id}, notes] = await Promise.all([
        gitlab.get('/user'),
        gitlab.paginate(`/merge_requests/${number}/notes`),
      ]);
      const existing = notes.find(
        (note) => note.author?.id === id && note.body?.startsWith(commentMarker),
      );
      if (existing) await gitlab.put(`/merge_requests/${number}/notes/${existing.id}`, {body});
      else await comment(number, body);
    },
    writeRunOutput: async (_, verdict) => console.log(`verdict=${verdict}`),

    async writeEvidence(files, message, removePrefixes = []) {
      for (let attempt = 1; ; attempt += 1) {
        const current = await gitlab.getOptional(`/repository/branches/${encodePath(branch)}`);
        const existing = current
          ? await existingPaths(branch, [...files.map(({path}) => path), ...removePrefixes])
          : new Set();
        const removed = [...existing].filter((path) =>
          removePrefixes.some((prefix) => path.startsWith(prefix)),
        );
        const actions = [
          ...fileActions(files, existing),
          ...removed.map((path) => ({action: 'delete', file_path: path})),
        ];
        if (actions.length === 0) return current?.commit.id;
        try {
          const commit = await gitlab.post('/repository/commits', {
            actions,
            branch,
            commit_message: `${message} ${skipCi}`,
            ...(current ? {} : {start_branch: env.CI_DEFAULT_BRANCH}),
          });
          return commit.id;
        } catch (error) {
          if (attempt >= maximumAttempts || ![400, 409].includes(error.status)) throw error;
        }
      }
    },
    async readEvidenceJson(path) {
      const query = new URLSearchParams({ref: branch});
      const bytes = await gitlab.getBytesOptional(
        `/repository/files/${encodePath(path)}/raw?${query}`,
      );
      return bytes ? JSON.parse(bytes.toString('utf8')) : null;
    },
    async listEvidence(prefix) {
      const entries = await listTree(branch, prefix.replace(/\/+$/, ''));
      return new Map(entries.map(({id, path}) => [path.slice(prefix.length), id]));
    },
    evidenceUrl: (id, path) => `${env.CI_PROJECT_URL}/-/raw/${id}/${path}`,

    async publishBaselines({baseBranch, files, message, number}) {
      const contents = await Promise.all(
        files.map(async ({path, handle}) => ({
          path,
          bytes: await gitlab.getBytes(`/repository/blobs/${handle}/raw`),
        })),
      );
      const existing = await existingPaths(
        baseBranch,
        files.map(({path}) => path),
      );
      const actions = fileActions(contents, existing);
      const commit_message = `${message} ${skipCi}`;
      try {
        const commit = await gitlab.post('/repository/commits', {
          actions,
          branch: baseBranch,
          commit_message,
        });
        return {commit: commit.id};
      } catch (error) {
        if (error.status !== 403 && !/protected|not allowed/i.test(error.message)) throw error;
      }

      // A protected base branch refuses the token, so the same files go up for merge instead.
      const head = `tileflow-visual-review-baselines/mr-${number}`;
      const commit = await gitlab.post('/repository/commits', {
        actions,
        branch: head,
        commit_message,
        force: true,
        start_branch: baseBranch,
      });
      const proposal = await gitlab.post('/merge_requests', {
        description: `Baselines approved in ${reference(number)}.`,
        remove_source_branch: true,
        source_branch: head,
        target_branch: baseBranch,
        title: `Update visual baselines for ${reference(number)}`,
      });
      const pipelineId = await skippedPipelineId(proposal.iid, commit.id);
      await setStatus(
        commit.id,
        'success',
        'Baselines approved in the source merge request',
        undefined,
        pipelineId ? {pipelineId} : {ref: head},
      );
      return {proposedIn: reference(proposal.iid)};
    },
  };
}
