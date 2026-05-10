import { parseCanonicalResourceUri } from '@atcute/lexicons/syntax';
import type { ActorIdentifier, Did, ResourceUri } from '@atcute/lexicons/syntax';
import type * as Pull from 'lexicon/types/sh/tangled/repo/pull';
import type * as PullComment from 'lexicon/types/sh/tangled/repo/pull/comment';
import type * as Repo from 'lexicon/types/sh/tangled/repo';

import { clientFor, resolveActor } from './atproto.ts';
import { extractMarkdownFromPatch, type ExtractedMarkdown } from './patch.ts';

export interface PullView {
	pull: {
		uri: string;
		cid: string;
		title: string;
		body?: string;
		target: Pull.Target;
		source?: Pull.Source;
		createdAt: string;
		rounds: { createdAt: string; patchCid: string }[];
	};
	repo: {
		uri: string;
		cid: string;
		name: string;
		knot: string;
		description?: string;
		createdAt: string;
	} | null;
	markdown: ExtractedMarkdown | null;
	comments: {
		uri: string;
		cid: string;
		body: string;
		createdAt: string;
		author: { did: string; handle?: string };
	}[];
}

export interface FetchPullArgs {
	handle: ActorIdentifier;
	rkey: string;
}

export async function fetchPull({ handle, rkey }: FetchPullArgs): Promise<PullView> {
	const author = await resolveActor(handle);
	const rpc = clientFor(author.pds);

	const pullRes = await rpc.get('com.atproto.repo.getRecord', {
		params: { repo: author.did as Did, collection: 'sh.tangled.repo.pull', rkey },
	});
	const pullValue = pullRes.data.value as Pull.Main;
	const pullUri = pullRes.data.uri as ResourceUri;

	const repoView = await fetchRepoFromTarget(pullValue.target);

	const latest = pullValue.rounds[pullValue.rounds.length - 1];
	let markdown: ExtractedMarkdown | null = null;
	if (latest) {
		const patchCid = (latest.patchBlob as { ref: { $link: string } }).ref.$link;
		const bytes = await fetchBlob(author.pds, author.did, patchCid);
		try {
			markdown = await extractMarkdownFromPatch(bytes);
		} catch {
			markdown = null;
		}
	}

	const comments = await listCommentsForPull({
		pds: author.pds,
		did: author.did,
		pullUri,
		authorHandle: author.handle,
	});

	return {
		pull: {
			uri: pullRes.data.uri,
			cid: pullRes.data.cid ?? '',
			title: pullValue.title,
			body: pullValue.body,
			target: pullValue.target,
			source: pullValue.source,
			createdAt: pullValue.createdAt,
			rounds: pullValue.rounds.map((r) => ({
				createdAt: r.createdAt,
				patchCid: (r.patchBlob as { ref: { $link: string } }).ref.$link,
			})),
		},
		repo: repoView,
		markdown,
		comments,
	};
}

async function fetchRepoFromTarget(target: Pull.Target): Promise<PullView['repo']> {
	if (!target.repo) return null;
	let parsed;
	try {
		parsed = parseCanonicalResourceUri(target.repo);
	} catch {
		return null;
	}
	const { repo: ownerDid, rkey } = parsed;

	try {
		const owner = await resolveActor(ownerDid as ActorIdentifier);
		const rpc = clientFor(owner.pds);
		const res = await rpc.get('com.atproto.repo.getRecord', {
			params: { repo: ownerDid, collection: 'sh.tangled.repo', rkey },
		});
		const value = res.data.value as Repo.Main;
		return {
			uri: res.data.uri,
			cid: res.data.cid ?? '',
			name: value.name,
			knot: value.knot,
			description: value.description,
			createdAt: value.createdAt,
		};
	} catch {
		return null;
	}
}

async function fetchBlob(pds: string, did: string, cid: string): Promise<Uint8Array> {
	const url = new URL('/xrpc/com.atproto.sync.getBlob', pds);
	url.searchParams.set('did', did);
	url.searchParams.set('cid', cid);
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`failed to fetch blob ${cid}: ${res.status}`);
	}
	return new Uint8Array(await res.arrayBuffer());
}

interface ListCommentsArgs {
	pds: string;
	did: string;
	pullUri: ResourceUri;
	authorHandle: string;
}

async function listCommentsForPull({
	pds,
	did,
	pullUri,
	authorHandle,
}: ListCommentsArgs): Promise<PullView['comments']> {
	const rpc = clientFor(pds);
	const out: PullView['comments'] = [];
	let cursor: string | undefined;
	do {
		const res = await rpc.get('com.atproto.repo.listRecords', {
			params: {
				repo: did as Did,
				collection: 'sh.tangled.repo.pull.comment',
				limit: 100,
				cursor,
			},
		});
		for (const r of res.data.records) {
			const value = r.value as PullComment.Main;
			if (value.pull !== pullUri) continue;
			out.push({
				uri: r.uri,
				cid: r.cid,
				body: value.body,
				createdAt: value.createdAt,
				author: { did, handle: authorHandle },
			});
		}
		cursor = res.data.cursor;
	} while (cursor);
	out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	return out;
}
