import type { ActorIdentifier } from '@atcute/lexicons/syntax';

import { clientFor, resolveActor } from './atproto.ts';
import {
	issueExists,
	pullExists,
	replacePullFiles,
	setPullState,
	statusValueToState,
	upsertComment,
	upsertIssue,
	upsertIssueComment,
	upsertPull,
} from './db.ts';
import { getDiscussionRepo } from './discussion.ts';
import { gunzipToString, listMarkdownFilesInDiff } from './patch.ts';

export interface BackfillResult {
	pulls: number;
	comments: number;
	statuses: number;
	issues: number;
	issueComments: number;
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

/**
 * Same-author backfill: walks the owner's PDS for every collection we care
 * about and seeds D1. Cross-author records remain unindexed until we have a
 * forward-going firehose consumer.
 */
export async function backfillOwner(
	db: D1Database,
	owner: ActorIdentifier,
): Promise<BackfillResult> {
	const view = await getDiscussionRepo(owner);
	const did = view.repo.owner.did;
	const ownerRepo = view.repo.uri;
	const pds = (await resolveActor(did as ActorIdentifier)).pds;
	const rpc = clientFor(pds);

	const counts: BackfillResult = {
		pulls: 0,
		comments: 0,
		statuses: 0,
		issues: 0,
		issueComments: 0,
	};

	const walk = async <T>(
		collection: string,
		handler: (record: Record<string, unknown>, uri: string, cid: string) => Promise<T>,
	) => {
		let cursor: string | undefined;
		do {
			const res = await rpc.get('com.atproto.repo.listRecords', {
				params: { repo: did as never, collection, limit: 100, cursor },
			});
			for (const r of res.data.records) {
				await handler(r.value as Record<string, unknown>, r.uri, r.cid);
			}
			cursor = res.data.cursor;
		} while (cursor);
	};

	await walk('sh.tangled.repo.pull', async (record, uri, cid) => {
		const target = record.target as { repo?: string } | undefined;
		if (target?.repo !== ownerRepo) return;
		await upsertPull(db, did, uri, cid, record as never);
		const rounds = (record.rounds as { patchBlob?: { ref?: { $link?: string } } }[]) ?? [];
		const latest = rounds[rounds.length - 1];
		const patchCid = latest?.patchBlob?.ref?.$link;
		const paths = patchCid ? await fetchPatchPaths(pds, did, patchCid) : [];
		await replacePullFiles(db, uri, paths);
		counts.pulls++;
	});

	await walk('sh.tangled.repo.pull.comment', async (record, uri, cid) => {
		const pullUri = record.pull as string | undefined;
		if (!pullUri || !(await pullExists(db, pullUri))) return;
		await upsertComment(db, did, uri, cid, record as never);
		counts.comments++;
	});

	await walk('sh.tangled.repo.pull.status', async (record) => {
		const pullUri = record.pull as string | undefined;
		if (!pullUri || !(await pullExists(db, pullUri))) return;
		const state = statusValueToState((record.status as string) ?? undefined);
		await setPullState(db, pullUri, state, new Date().toISOString());
		counts.statuses++;
	});

	await walk('sh.tangled.repo.issue', async (record, uri, cid) => {
		if ((record.repo as string | undefined) !== ownerRepo) return;
		await upsertIssue(db, did, uri, cid, record as never);
		counts.issues++;
	});

	await walk('sh.tangled.repo.issue.comment', async (record, uri, cid) => {
		const issueUri = record.issue as string | undefined;
		if (!issueUri || !(await issueExists(db, issueUri))) return;
		await upsertIssueComment(db, did, uri, cid, record as never);
		counts.issueComments++;
	});

	return counts;
}
