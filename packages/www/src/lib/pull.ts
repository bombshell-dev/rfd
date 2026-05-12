import { parseCanonicalResourceUri } from '@atcute/lexicons/syntax';
import type { ActorIdentifier, Did } from '@atcute/lexicons/syntax';
import type * as Pull from 'lexicon/types/sh/tangled/repo/pull';
import type * as PullComment from 'lexicon/types/sh/tangled/repo/pull/comment';
import type * as Repo from 'lexicon/types/sh/tangled/repo';

import { clientForSlingshot, resolveActor } from './atproto.ts';
import { listLinkingRecords } from './constellation.ts';
import { parseAtUri } from './index-event.ts';
import { extractMarkdownFromPatch, type ExtractedMarkdown } from './patch.ts';
import { hydrateRecord, type HydratedRecord } from './slingshot.ts';

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
	const pullRes = await clientForSlingshot().get('com.atproto.repo.getRecord', {
		params: { repo: author.did as Did, collection: 'sh.tangled.repo.pull', rkey },
	});
	const pullValue = pullRes.data.value as Pull.Main;
	const pullUri = pullRes.data.uri;

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

	const comments = await collectCommentsFor(pullUri);

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
		const res = await clientForSlingshot().get('com.atproto.repo.getRecord', {
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

export interface CollectCommentsDeps {
	listLinks?: (pullUri: string) => AsyncIterable<string>;
	hydrate?: (atUri: string) => Promise<HydratedRecord | null>;
}

export async function collectCommentsFor(
	pullUri: string,
	deps: CollectCommentsDeps = {},
): Promise<PullView['comments']> {
	const listLinks =
		deps.listLinks ??
		((uri: string) =>
			listLinkingRecords({
				target: uri,
				collection: 'sh.tangled.repo.pull.comment',
				path: '.pull',
			}));
	const hydrate = deps.hydrate ?? hydrateRecord;

	const out: PullView['comments'] = [];
	for await (const commentUri of listLinks(pullUri)) {
		const hydrated = await hydrate(commentUri);
		if (!hydrated) continue;
		const value = hydrated.value as PullComment.Main;
		if (value.pull !== pullUri) continue;
		const parsed = parseAtUri(hydrated.uri);
		if (!parsed) continue;
		out.push({
			uri: hydrated.uri,
			cid: hydrated.cid,
			body: value.body,
			createdAt: value.createdAt,
			author: { did: parsed.did },
		});
	}
	out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	return out;
}
