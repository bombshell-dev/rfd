import type * as IssueComment from 'lexicon/types/sh/tangled/repo/issue/comment';
import type * as Issue from 'lexicon/types/sh/tangled/repo/issue';
import type * as PullComment from 'lexicon/types/sh/tangled/repo/pull/comment';
import type * as Pull from 'lexicon/types/sh/tangled/repo/pull';

import {
	deleteRecord,
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

export type TrackedCollection =
	| 'sh.tangled.repo.pull'
	| 'sh.tangled.repo.pull.comment'
	| 'sh.tangled.repo.pull.status'
	| 'sh.tangled.repo.issue'
	| 'sh.tangled.repo.issue.comment';

export const TRACKED_COLLECTIONS: TrackedCollection[] = [
	'sh.tangled.repo.pull',
	'sh.tangled.repo.pull.comment',
	'sh.tangled.repo.pull.status',
	'sh.tangled.repo.issue',
	'sh.tangled.repo.issue.comment',
];

export interface ParsedAtUri {
	did: string;
	collection: string;
	rkey: string;
}

export function parseAtUri(uri: string): ParsedAtUri | null {
	if (!uri.startsWith('at://')) return null;
	const rest = uri.slice('at://'.length);
	const parts = rest.split('/');
	if (parts.length < 3) return null;
	const [did, collection, ...rkeyParts] = parts;
	if (!did || !collection || rkeyParts.length === 0) return null;
	return { did, collection, rkey: rkeyParts.join('/') };
}

export interface IndexerOps {
	upsertPull: (
		authorDid: string,
		uri: string,
		cid: string,
		record: Pull.Main,
	) => Promise<void>;
	upsertComment: (
		authorDid: string,
		uri: string,
		cid: string,
		record: PullComment.Main,
	) => Promise<void>;
	setPullState: (
		pullUri: string,
		state: 'open' | 'closed' | 'merged',
		updatedAt: string,
	) => Promise<void>;
	upsertIssue: (
		authorDid: string,
		uri: string,
		cid: string,
		record: Issue.Main,
	) => Promise<void>;
	upsertIssueComment: (
		authorDid: string,
		uri: string,
		cid: string,
		record: IssueComment.Main,
	) => Promise<void>;
	pullExists: (uri: string) => Promise<boolean>;
	issueExists: (uri: string) => Promise<boolean>;
	replacePullFiles?: (pullUri: string, paths: string[]) => Promise<void>;
	deleteByUri: (collection: string, uri: string) => Promise<void>;
}

export interface IndexInput {
	uri: string;
	cid: string;
	collection: string;
	value: unknown;
}

export type IndexResult = 'indexed' | 'skipped' | 'unsupported';

export async function indexRecord(
	input: IndexInput,
	ops: IndexerOps,
	ownerRepoUri: string,
): Promise<IndexResult> {
	const parsed = parseAtUri(input.uri);
	if (!parsed) return 'unsupported';
	const value = input.value as Record<string, unknown> | null | undefined;
	if (!value) return 'skipped';

	switch (input.collection) {
		case 'sh.tangled.repo.pull': {
			const target = (value as { target?: { repo?: string } }).target;
			if (target?.repo !== ownerRepoUri) return 'skipped';
			await ops.upsertPull(parsed.did, input.uri, input.cid, value as Pull.Main);
			return 'indexed';
		}
		case 'sh.tangled.repo.pull.comment': {
			const pullUri = (value as { pull?: string }).pull;
			if (!pullUri || !(await ops.pullExists(pullUri))) return 'skipped';
			await ops.upsertComment(parsed.did, input.uri, input.cid, value as PullComment.Main);
			return 'indexed';
		}
		case 'sh.tangled.repo.pull.status': {
			const pullUri = (value as { pull?: string }).pull;
			if (!pullUri || !(await ops.pullExists(pullUri))) return 'skipped';
			const state = statusValueToState((value as { status?: string }).status);
			const updatedAt =
				(value as { createdAt?: string }).createdAt ?? new Date().toISOString();
			await ops.setPullState(pullUri, state, updatedAt);
			return 'indexed';
		}
		case 'sh.tangled.repo.issue': {
			const repo = (value as { repo?: string }).repo;
			if (repo !== ownerRepoUri) return 'skipped';
			await ops.upsertIssue(parsed.did, input.uri, input.cid, value as Issue.Main);
			return 'indexed';
		}
		case 'sh.tangled.repo.issue.comment': {
			const issueUri = (value as { issue?: string }).issue;
			if (!issueUri || !(await ops.issueExists(issueUri))) return 'skipped';
			await ops.upsertIssueComment(
				parsed.did,
				input.uri,
				input.cid,
				value as IssueComment.Main,
			);
			return 'indexed';
		}
		default:
			return 'unsupported';
	}
}

export interface DeleteInput {
	uri: string;
	collection: string;
}

export type DeleteResult = 'deleted' | 'unsupported';

export async function indexDelete(
	input: DeleteInput,
	ops: IndexerOps,
): Promise<DeleteResult> {
	if (!(TRACKED_COLLECTIONS as string[]).includes(input.collection)) {
		return 'unsupported';
	}
	await ops.deleteByUri(input.collection, input.uri);
	return 'deleted';
}

export function createDbOps(db: D1Database): IndexerOps {
	return {
		upsertPull: (did, uri, cid, record) => upsertPull(db, did, uri, cid, record),
		upsertComment: (did, uri, cid, record) => upsertComment(db, did, uri, cid, record),
		setPullState: (uri, state, updatedAt) => setPullState(db, uri, state, updatedAt),
		upsertIssue: (did, uri, cid, record) => upsertIssue(db, did, uri, cid, record),
		upsertIssueComment: (did, uri, cid, record) =>
			upsertIssueComment(db, did, uri, cid, record),
		pullExists: (uri) => pullExists(db, uri),
		issueExists: (uri) => issueExists(db, uri),
		replacePullFiles: (uri, paths) => replacePullFiles(db, uri, paths),
		deleteByUri: (collection, uri) => deleteRecord(db, collection, uri),
	};
}
