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
import type * as Pull from 'lexicon/types/sh/tangled/repo/pull';
import {
	fileNameToSlug,
	selectCommentsForProposal,
	selectInDiscussionSlugs,
	selectIssueCommentsForProposal,
	selectPullsTouchingProposal,
	type CommentRow,
	type IssueCommentRow,
	type PullRow,
} from './db.ts';
import {
	extractMarkdownFileFromDiff,
	gunzipToString,
	listMarkdownFilesInDiff,
} from './patch.ts';

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

function repoIdsFor(view: DiscussionRepoView): readonly string[] {
	const ids = new Set<string>([view.repo.uri]);
	if (view.repo.repoDid) ids.add(view.repo.repoDid);
	return [...ids];
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

	const repoIds = repoIdsFor(view);
	const inDiscussion = env.DB ? await selectInDiscussionSlugs(env.DB, repoIds) : [];
	let liveSlugs: string[] = [];
	try {
		liveSlugs = await fallbackOwnerPullSlugs(view);
	} catch {
		// best-effort — leave empty if PDS lookup fails
	}
	const seen = new Set<string>();
	const summaries: ProposalSummary[] = [];

	for (const file of onDefault) {
		seen.add(file.slug);
		summaries.push({ slug: file.slug, status: 'committed' });
	}
	for (const slug of [...inDiscussion, ...liveSlugs]) {
		if (seen.has(slug)) continue;
		seen.add(slug);
		summaries.push({ slug, status: 'discussion' });
	}

	if (env.DB) {
		// Refine status only when D1 actually has indexed pulls for the slug.
		// Otherwise keep the optimistic `committed`/`discussion` we just set.
		for (const summary of summaries) {
			const pulls = await selectPullsTouchingProposal(env.DB, repoIds, summary.slug);
			if (pulls.length === 0) continue;
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

/**
 * Same-author live fallback for the proposal list: walks the owner's own PDS
 * for `sh.tangled.repo.pull` records, extracts every `.md` path each patch
 * touches, and returns the proposal slugs derived from those filenames. Used
 * when D1 hasn't been seeded with cross-author/forward-going data yet.
 */
async function fallbackOwnerPullSlugs(ownerView: DiscussionRepoView): Promise<string[]> {
	const ownerDid = ownerView.repo.owner.did;
	const targetMatches = new Set<string>([ownerView.repo.uri]);
	if (ownerView.repo.repoDid) targetMatches.add(ownerView.repo.repoDid);

	const ownerActor = await resolveActor(ownerDid as ActorIdentifier);
	const rpc = pdsClient(ownerActor.pds);

	const slugs = new Set<string>();
	let cursor: string | undefined;
	let pages = 0;
	const MAX_PAGES = 3;

	while (pages < MAX_PAGES) {
		const res = await rpc.get('com.atproto.repo.listRecords', {
			params: {
				repo: ownerDid as never,
				collection: 'sh.tangled.repo.pull',
				limit: 50,
				cursor,
			},
		});
		for (const record of res.data.records) {
			const value = record.value as Pull.Main;
			const targetRepo = value.target?.repo;
			if (!targetRepo || !targetMatches.has(targetRepo)) continue;
			const rounds = value.rounds ?? [];
			const latest = rounds[rounds.length - 1];
			const patchCid = (latest?.patchBlob as { ref?: { $link?: string } } | undefined)?.ref
				?.$link;
			if (!patchCid) continue;
			const text = await fetchPatchAsText(ownerActor.pds, ownerDid, patchCid);
			if (!text) continue;
			for (const entry of listMarkdownFilesInDiff(text)) {
				const slug = fileNameToSlug(entry.path);
				if (slug) slugs.add(slug);
			}
		}
		if (!res.data.cursor) break;
		cursor = res.data.cursor;
		pages++;
	}
	return [...slugs];
}
/**
 * Same-author live fallback used when D1 has no rows for this proposal yet
 * (typically: a user just submitted a draft and the indexer hasn't caught up).
 * Scans `sh.tangled.repo.pull` on the discussion repo owner's PDS, finds
 * records whose latest patch touches `${slug}.md`, and synthesises PullRows.
 * Cross-author pulls remain invisible until the indexer is running.
 */
async function fallbackOwnerPulls(
	ownerView: DiscussionRepoView,
	slug: string,
): Promise<PullRow[]> {
	const ownerDid = ownerView.repo.owner.did;
	const ownerRepoUri = ownerView.repo.uri;
	// `target.repo` may be stored as either the lexicon-correct at-uri or the
	// bare `repoDid` that tangled.org's own UI writes. Accept either.
	const targetMatches = new Set<string>([ownerRepoUri]);
	if (ownerView.repo.repoDid) targetMatches.add(ownerView.repo.repoDid);
	const filename = `${slug}.md`;

	const ownerActor = await resolveActor(ownerDid as ActorIdentifier);
	const rpc = pdsClient(ownerActor.pds);

	const out: PullRow[] = [];
	let cursor: string | undefined;
	let pages = 0;
	const MAX_PAGES = 3;

	while (pages < MAX_PAGES) {
		const res = await rpc.get('com.atproto.repo.listRecords', {
			params: {
				repo: ownerDid as never,
				collection: 'sh.tangled.repo.pull',
				limit: 50,
				cursor,
			},
		});
		for (const record of res.data.records) {
			const value = record.value as Pull.Main;
			const targetRepo = value.target?.repo;
			if (!targetRepo || !targetMatches.has(targetRepo)) continue;

			const rounds = value.rounds ?? [];
			const latest = rounds[rounds.length - 1];
			const patchCid = (latest?.patchBlob as { ref?: { $link?: string } } | undefined)?.ref
				?.$link;
			if (!patchCid) continue;
			const text = await fetchPatchAsText(ownerActor.pds, ownerDid, patchCid);
			if (!text) continue;
			const entry = extractMarkdownFileFromDiff(text, filename);
			if (!entry) continue;

			const mappedRounds = rounds.map((r) => ({
				createdAt: r.createdAt,
				patchCid:
					(r.patchBlob as { ref?: { $link?: string } } | undefined)?.ref?.$link ?? '',
			}));
			out.push({
				uri: record.uri,
				cid: record.cid ?? '',
				author_did: ownerDid,
				target_repo_uri: value.target.repo ?? '',
				target_branch: value.target.branch,
				source_repo_uri: value.source?.repo ?? null,
				source_branch: value.source?.branch ?? null,
				title: value.title,
				body: value.body ?? null,
				rounds_json: JSON.stringify(mappedRounds),
				state: 'open',
				state_updated_at: null,
				created_at: value.createdAt,
			});
		}
		if (!res.data.cursor) break;
		cursor = res.data.cursor;
		pages++;
	}

	out.sort((a, b) => b.created_at.localeCompare(a.created_at));
	return out;
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

	const repoIds = repoIdsFor(view);
	let pulls = env.DB ? await selectPullsTouchingProposal(env.DB, repoIds, slug) : [];
	if (pulls.length === 0) {
		try {
			pulls = await fallbackOwnerPulls(view, slug);
		} catch {
			// best-effort — leave empty if PDS lookup fails
		}
	}

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
			selectCommentsForProposal(env.DB, repoIds, slug),
			selectIssueCommentsForProposal(env.DB, repoIds, slug),
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
