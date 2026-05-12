import type { ActorIdentifier } from '@atcute/lexicons/syntax';

import { resolveActor } from './atproto.ts';
import { listLinkingRecords } from './constellation.ts';
import { getDiscussionRepo, type DiscussionRepoView } from './discussion.ts';
import {
	createDbOps,
	indexRecord,
	parseAtUri,
	type IndexerOps,
} from './index-event.ts';
import { gunzipToString, listMarkdownFilesInDiff } from './patch.ts';
import { hydrateRecord, type HydratedRecord } from './slingshot.ts';

export interface ColdStartCounts {
	pulls: number;
	comments: number;
	statuses: number;
	issues: number;
	issueComments: number;
}

export interface ColdStartResult extends ColdStartCounts {
	view: DiscussionRepoView;
}

interface IngestContext {
	db: D1Database;
	ops: IndexerOps;
	ownerRepoUri: string;
	pdsByDid: Map<string, string>;
	counts: ColdStartCounts;
}

async function fetchPatchPaths(pds: string, did: string, cid: string): Promise<string[]> {
	const url = new URL('/xrpc/com.atproto.sync.getBlob', pds);
	url.searchParams.set('did', did);
	url.searchParams.set('cid', cid);
	const res = await fetch(url);
	if (!res.ok) return [];
	const text = await gunzipToString(new Uint8Array(await res.arrayBuffer()));
	return listMarkdownFilesInDiff(text).map((entry) => entry.path);
}

async function resolvePdsFor(did: string, cache: Map<string, string>): Promise<string | null> {
	const cached = cache.get(did);
	if (cached) return cached;
	try {
		const r = await resolveActor(did as ActorIdentifier);
		cache.set(did, r.pds);
		return r.pds;
	} catch {
		return null;
	}
}

async function ingestRecord(
	atUri: string,
	collection: string,
	ctx: IngestContext,
): Promise<HydratedRecord | null> {
	const hydrated = await hydrateRecord(atUri);
	if (!hydrated) return null;
	const result = await indexRecord(
		{ uri: hydrated.uri, cid: hydrated.cid, collection, value: hydrated.value },
		ctx.ops,
		ctx.ownerRepoUri,
	);
	return result === 'indexed' ? hydrated : null;
}

async function ingestPullsAndIssues(ctx: IngestContext): Promise<{
	pullUris: string[];
	issueUris: string[];
}> {
	const pullUris: string[] = [];
	const issueUris: string[] = [];

	for await (const uri of listLinkingRecords({
		target: ctx.ownerRepoUri,
		collection: 'sh.tangled.repo.pull',
		path: '.target.repo',
	})) {
		const hydrated = await ingestRecord(uri, 'sh.tangled.repo.pull', ctx);
		if (!hydrated) continue;
		ctx.counts.pulls++;
		pullUris.push(hydrated.uri);

		const parsed = parseAtUri(hydrated.uri);
		const record = hydrated.value as {
			rounds?: { patchBlob?: { ref?: { $link?: string } } }[];
		};
		const latest = record.rounds?.[record.rounds.length - 1];
		const patchCid = latest?.patchBlob?.ref?.$link;
		if (patchCid && parsed && ctx.ops.replacePullFiles) {
			const pds = await resolvePdsFor(parsed.did, ctx.pdsByDid);
			const paths = pds ? await fetchPatchPaths(pds, parsed.did, patchCid) : [];
			await ctx.ops.replacePullFiles(hydrated.uri, paths);
		}
	}

	for await (const uri of listLinkingRecords({
		target: ctx.ownerRepoUri,
		collection: 'sh.tangled.repo.issue',
		path: '.repo',
	})) {
		const hydrated = await ingestRecord(uri, 'sh.tangled.repo.issue', ctx);
		if (!hydrated) continue;
		ctx.counts.issues++;
		issueUris.push(hydrated.uri);
	}

	return { pullUris, issueUris };
}

async function ingestPullChildren(pullUris: string[], ctx: IngestContext): Promise<void> {
	for (const pullUri of pullUris) {
		for await (const uri of listLinkingRecords({
			target: pullUri,
			collection: 'sh.tangled.repo.pull.comment',
			path: '.pull',
		})) {
			const hydrated = await ingestRecord(uri, 'sh.tangled.repo.pull.comment', ctx);
			if (hydrated) ctx.counts.comments++;
		}
		for await (const uri of listLinkingRecords({
			target: pullUri,
			collection: 'sh.tangled.repo.pull.status',
			path: '.pull',
		})) {
			const hydrated = await ingestRecord(uri, 'sh.tangled.repo.pull.status', ctx);
			if (hydrated) ctx.counts.statuses++;
		}
	}
}

async function ingestIssueChildren(issueUris: string[], ctx: IngestContext): Promise<void> {
	for (const issueUri of issueUris) {
		for await (const uri of listLinkingRecords({
			target: issueUri,
			collection: 'sh.tangled.repo.issue.comment',
			path: '.issue',
		})) {
			const hydrated = await ingestRecord(uri, 'sh.tangled.repo.issue.comment', ctx);
			if (hydrated) ctx.counts.issueComments++;
		}
	}
}

export async function coldStartFromConstellation(
	db: D1Database,
	owner: ActorIdentifier,
): Promise<ColdStartResult> {
	const view = await getDiscussionRepo(owner);
	const ownerRepoUri = view.repo.uri;
	const ctx: IngestContext = {
		db,
		ops: createDbOps(db),
		ownerRepoUri,
		pdsByDid: new Map(),
		counts: { pulls: 0, comments: 0, statuses: 0, issues: 0, issueComments: 0 },
	};

	const { pullUris, issueUris } = await ingestPullsAndIssues(ctx);
	await ingestPullChildren(pullUris, ctx);
	await ingestIssueChildren(issueUris, ctx);

	return { view, ...ctx.counts };
}
