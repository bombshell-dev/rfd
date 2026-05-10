import { parseCanonicalResourceUri } from '@atcute/lexicons/syntax';
import type { ActorIdentifier, Did } from '@atcute/lexicons/syntax';
import type * as DiscussionRepo from 'lexicon/types/st/itch/discussion/repo';
import type * as Repo from 'lexicon/types/sh/tangled/repo';

import { clientFor, resolveActor } from './atproto.ts';

export interface DiscussionRepoView {
	claim: {
		uri: string;
		cid: string;
		repo: string;
		createdAt: string;
	};
	repo: {
		uri: string;
		cid: string;
		name: string;
		knot: string;
		description?: string;
		createdAt: string;
		owner: { did: string; handle?: string };
	};
}

export class NoDiscussionRepoError extends Error {
	override name = 'NoDiscussionRepoError';
	constructor(handle: string) {
		super(`no discussion repo claimed for ${handle}`);
	}
}

export async function getDiscussionRepo(handle: ActorIdentifier): Promise<DiscussionRepoView> {
	const claimer = await resolveActor(handle);
	const claimerRpc = clientFor(claimer.pds);

	let claimRes;
	try {
		claimRes = await claimerRpc.get('com.atproto.repo.getRecord', {
			params: {
				repo: claimer.did as Did,
				collection: 'st.itch.discussion.repo',
				rkey: 'self',
			},
		});
	} catch (err) {
		throw new NoDiscussionRepoError(claimer.handle);
	}
	const claimValue = claimRes.data.value as DiscussionRepo.Main;

	const parsed = parseCanonicalResourceUri(claimValue.repo);
	const owner = await resolveActor(parsed.repo as ActorIdentifier);
	const ownerRpc = clientFor(owner.pds);
	const repoRes = await ownerRpc.get('com.atproto.repo.getRecord', {
		params: {
			repo: parsed.repo,
			collection: 'sh.tangled.repo',
			rkey: parsed.rkey,
		},
	});
	const repoValue = repoRes.data.value as Repo.Main;

	return {
		claim: {
			uri: claimRes.data.uri,
			cid: claimRes.data.cid ?? '',
			repo: claimValue.repo,
			createdAt: claimValue.createdAt,
		},
		repo: {
			uri: repoRes.data.uri,
			cid: repoRes.data.cid ?? '',
			name: repoValue.name,
			knot: repoValue.knot,
			description: repoValue.description,
			createdAt: repoValue.createdAt,
			owner: { did: owner.did, handle: owner.handle },
		},
	};
}
