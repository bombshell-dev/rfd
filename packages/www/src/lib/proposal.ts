import type { ActorIdentifier } from '@atcute/lexicons/syntax';

import { getDiscussionRepo, type DiscussionRepoView } from './discussion.ts';
import {
	getDefaultBranch,
	getBlob,
	knotRepoId,
	listMarkdownProposals,
	type ProposalFile,
} from './knot.ts';
import { resolveActor, clientFor as pdsClient } from './atproto.ts';
import {
	selectCommentsForProposal,
	selectInDiscussionSlugs,
	selectIssueCommentsForProposal,
	selectPullsTouchingProposal,
	type CommentRow,
	type IssueCommentRow,
	type PullRow,
} from './db.ts';
import { extractMarkdownFileFromDiff, gunzipToString } from './patch.ts';

export type ProposalStatus =
	| 'discussion'
	| 'abandoned'
	| 'published'
	| 'committed'
	| 'unknown';

export interface ProposalSummary {
	slug: string;
	title?: string;
	status: ProposalStatus;
}

export interface DiscussionEntry {
	source: 'pull' | 'issue';
	uri: string;
	authorDid: string;
	body: string;
	createdAt: string;
}

export interface ProposalDetail {
	slug: string;
	repo: DiscussionRepoView['repo'];
	status: ProposalStatus;
	content: { source: 'default' | 'pull'; text: string } | null;
	pulls: PullRow[];
	discussion: DiscussionEntry[];
}

function deriveStatus(opts: {
	onDefaultBranch: boolean;
	pulls: PullRow[];
}): ProposalStatus {
	const { onDefaultBranch, pulls } = opts;
	const hasOpen = pulls.some((p) => p.state === 'open');
	const hasMerged = pulls.some((p) => p.state === 'merged');
	const allClosed = pulls.length > 0 && pulls.every((p) => p.state === 'closed');

	if (hasOpen) return 'discussion';
	if (onDefaultBranch && hasMerged) return 'published';
	if (onDefaultBranch) return 'committed';
	if (allClosed) return 'abandoned';
	return 'unknown';
}

export interface ProposalEnv {
	DB: D1Database | null;
}

async function resolveOwner(handle: ActorIdentifier) {
	const view = await getDiscussionRepo(handle);
	return view;
}

export async function listProposals(
	env: ProposalEnv,
	handle: ActorIdentifier,
): Promise<{ repo: DiscussionRepoView['repo']; proposals: ProposalSummary[] }> {
	const view = await resolveOwner(handle);
	const repoId = knotRepoId(view.repo.owner.did, view.repo.name);

	let onDefault: ProposalFile[] = [];
	let branchName = 'main';
	try {
		const branch = await getDefaultBranch(view.repo.knot, repoId);
		branchName = branch.name;
		onDefault = await listMarkdownProposals(view.repo.knot, repoId, branchName);
	} catch {
		// knot unreachable / repo empty — leave onDefault empty.
	}

	const inDiscussion = env.DB ? await selectInDiscussionSlugs(env.DB, view.repo.uri) : [];
	const seen = new Set<string>();
	const summaries: ProposalSummary[] = [];

	for (const file of onDefault) {
		seen.add(file.slug);
		summaries.push({ slug: file.slug, status: 'committed' });
	}
	for (const slug of inDiscussion) {
		if (seen.has(slug)) continue;
		seen.add(slug);
		summaries.push({ slug, status: 'discussion' });
	}

	if (env.DB) {
		// Refine status for files that appear on default but also have indexed pulls.
		for (const summary of summaries) {
			const pulls = await selectPullsTouchingProposal(env.DB, view.repo.uri, summary.slug);
			summary.status = deriveStatus({
				onDefaultBranch: seen.has(summary.slug) && onDefault.some((f) => f.slug === summary.slug),
				pulls,
			});
		}
	}

	summaries.sort((a, b) => a.slug.localeCompare(b.slug));
	return { repo: view.repo, proposals: summaries };
}

async function fetchPatchAsText(pds: string, did: string, cid: string): Promise<string | null> {
	const url = new URL('/xrpc/com.atproto.sync.getBlob', pds);
	url.searchParams.set('did', did);
	url.searchParams.set('cid', cid);
	const res = await fetch(url);
	if (!res.ok) return null;
	const bytes = new Uint8Array(await res.arrayBuffer());
	try {
		return await gunzipToString(bytes);
	} catch {
		return null;
	}
}

async function readContentFromPull(
	pull: PullRow,
	path: string,
): Promise<string | null> {
	const rounds = JSON.parse(pull.rounds_json) as { createdAt: string; patchCid: string }[];
	const latest = rounds[rounds.length - 1];
	if (!latest) return null;
	const owner = await resolveActor(pull.author_did as ActorIdentifier);
	const text = await fetchPatchAsText(owner.pds, pull.author_did, latest.patchCid);
	if (!text) return null;
	const entry = extractMarkdownFileFromDiff(text, path);
	return entry?.content ?? null;
}

export async function getProposal(
	env: ProposalEnv,
	handle: ActorIdentifier,
	slug: string,
): Promise<ProposalDetail | null> {
	const view = await resolveOwner(handle);
	const repoId = knotRepoId(view.repo.owner.did, view.repo.name);

	let branchName = 'main';
	try {
		const branch = await getDefaultBranch(view.repo.knot, repoId);
		branchName = branch.name;
	} catch {
		// stay with 'main' default
	}

	const filename = `${slug}.md`;
	let content: ProposalDetail['content'] = null;
	let onDefaultBranch = false;
	const fromDefault = await getBlob(view.repo.knot, repoId, branchName, filename);
	if (fromDefault !== null) {
		onDefaultBranch = true;
		content = { source: 'default', text: fromDefault };
	}

	const pulls = env.DB ? await selectPullsTouchingProposal(env.DB, view.repo.uri, slug) : [];
	if (!content) {
		const openPull = pulls.find((p) => p.state === 'open') ?? pulls[0];
		if (openPull) {
			const fromPull = await readContentFromPull(openPull, filename);
			if (fromPull !== null) {
				content = { source: 'pull', text: fromPull };
			}
		}
	}

	if (!content && pulls.length === 0) return null;

	const status = deriveStatus({ onDefaultBranch, pulls });

	const discussion: DiscussionEntry[] = [];
	if (env.DB) {
		const [pcs, ics]: [CommentRow[], IssueCommentRow[]] = await Promise.all([
			selectCommentsForProposal(env.DB, view.repo.uri, slug),
			selectIssueCommentsForProposal(env.DB, view.repo.uri, slug),
		]);
		for (const c of pcs) {
			discussion.push({
				source: 'pull',
				uri: c.uri,
				authorDid: c.author_did,
				body: c.body,
				createdAt: c.created_at,
			});
		}
		for (const c of ics) {
			discussion.push({
				source: 'issue',
				uri: c.uri,
				authorDid: c.author_did,
				body: c.body,
				createdAt: c.created_at,
			});
		}
		discussion.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	}

	return {
		slug,
		repo: view.repo,
		status,
		content,
		pulls,
		discussion,
	};
}

// suppress unused-import lint; pdsClient may be used by future helpers.
void pdsClient;
