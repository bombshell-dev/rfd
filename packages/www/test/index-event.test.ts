import { describe, expect, it, vi } from 'vitest';

import { indexRecord, indexDelete, parseAtUri } from '../src/lib/index-event.ts';
import type { IndexerOps } from '../src/lib/index-event.ts';

const OWNER_REPO_URI = 'at://did:plc:owner/sh.tangled.repo/self';

function makeOps(overrides: Partial<IndexerOps> = {}): IndexerOps {
	return {
		upsertPull: vi.fn().mockResolvedValue(undefined),
		upsertComment: vi.fn().mockResolvedValue(undefined),
		setPullState: vi.fn().mockResolvedValue(undefined),
		upsertIssue: vi.fn().mockResolvedValue(undefined),
		upsertIssueComment: vi.fn().mockResolvedValue(undefined),
		pullExists: vi.fn().mockResolvedValue(true),
		issueExists: vi.fn().mockResolvedValue(true),
		replacePullFiles: vi.fn().mockResolvedValue(undefined),
		deleteByUri: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

describe('parseAtUri', () => {
	it('splits did/collection/rkey', () => {
		expect(parseAtUri('at://did:plc:abc/sh.tangled.repo.pull/r1')).toEqual({
			did: 'did:plc:abc',
			collection: 'sh.tangled.repo.pull',
			rkey: 'r1',
		});
	});

	it('returns null for malformed uris', () => {
		expect(parseAtUri('https://example.com/foo')).toBeNull();
		expect(parseAtUri('at://did:plc:abc/only-collection')).toBeNull();
	});
});

describe('indexRecord', () => {
	it('routes pulls targeting the owner repo to upsertPull', async () => {
		const ops = makeOps();
		const result = await indexRecord(
			{
				uri: 'at://did:plc:author/sh.tangled.repo.pull/r1',
				cid: 'bafy1',
				collection: 'sh.tangled.repo.pull',
				value: {
					$type: 'sh.tangled.repo.pull',
					title: 'Add RFD 0042',
					target: { repo: OWNER_REPO_URI, branch: 'main' },
					rounds: [],
					createdAt: '2026-05-10T00:00:00Z',
				},
			},
			ops,
			OWNER_REPO_URI,
		);

		expect(result).toBe('indexed');
		expect(ops.upsertPull).toHaveBeenCalledWith(
			'did:plc:author',
			'at://did:plc:author/sh.tangled.repo.pull/r1',
			'bafy1',
			expect.objectContaining({ title: 'Add RFD 0042' }),
		);
	});

	it('skips pulls targeting other repos', async () => {
		const ops = makeOps();
		const result = await indexRecord(
			{
				uri: 'at://did:plc:author/sh.tangled.repo.pull/r1',
				cid: 'bafy1',
				collection: 'sh.tangled.repo.pull',
				value: {
					target: { repo: 'at://did:plc:elsewhere/sh.tangled.repo/self', branch: 'main' },
					rounds: [],
					title: 't',
					createdAt: '2026-05-10T00:00:00Z',
				},
			},
			ops,
			OWNER_REPO_URI,
		);

		expect(result).toBe('skipped');
		expect(ops.upsertPull).not.toHaveBeenCalled();
	});

	it('skips comments when their pull is not in our index', async () => {
		const ops = makeOps({ pullExists: vi.fn().mockResolvedValue(false) });
		const result = await indexRecord(
			{
				uri: 'at://did:plc:b/sh.tangled.repo.pull.comment/c1',
				cid: 'bafy2',
				collection: 'sh.tangled.repo.pull.comment',
				value: {
					pull: 'at://did:plc:author/sh.tangled.repo.pull/unknown',
					body: 'hi',
					createdAt: '2026-05-10T00:00:00Z',
				},
			},
			ops,
			OWNER_REPO_URI,
		);

		expect(result).toBe('skipped');
		expect(ops.upsertComment).not.toHaveBeenCalled();
	});

	it('routes comments on tracked pulls', async () => {
		const ops = makeOps();
		const result = await indexRecord(
			{
				uri: 'at://did:plc:b/sh.tangled.repo.pull.comment/c1',
				cid: 'bafy2',
				collection: 'sh.tangled.repo.pull.comment',
				value: {
					pull: 'at://did:plc:author/sh.tangled.repo.pull/r1',
					body: 'looks good',
					createdAt: '2026-05-10T00:00:00Z',
				},
			},
			ops,
			OWNER_REPO_URI,
		);

		expect(result).toBe('indexed');
		expect(ops.upsertComment).toHaveBeenCalled();
	});

	it('routes pull statuses to setPullState', async () => {
		const ops = makeOps();
		await indexRecord(
			{
				uri: 'at://did:plc:author/sh.tangled.repo.pull.status/s1',
				cid: 'bafy3',
				collection: 'sh.tangled.repo.pull.status',
				value: {
					pull: 'at://did:plc:author/sh.tangled.repo.pull/r1',
					status: 'sh.tangled.repo.pull.status.merged',
					createdAt: '2026-05-10T01:00:00Z',
				},
			},
			ops,
			OWNER_REPO_URI,
		);

		expect(ops.setPullState).toHaveBeenCalledWith(
			'at://did:plc:author/sh.tangled.repo.pull/r1',
			'merged',
			'2026-05-10T01:00:00Z',
		);
	});

	it('routes issues targeting the owner repo to upsertIssue', async () => {
		const ops = makeOps();
		await indexRecord(
			{
				uri: 'at://did:plc:author/sh.tangled.repo.issue/i1',
				cid: 'bafy4',
				collection: 'sh.tangled.repo.issue',
				value: {
					title: '[0042] An issue',
					repo: OWNER_REPO_URI,
					createdAt: '2026-05-10T00:00:00Z',
				},
			},
			ops,
			OWNER_REPO_URI,
		);

		expect(ops.upsertIssue).toHaveBeenCalled();
	});

	it('returns unsupported for unrelated collections', async () => {
		const ops = makeOps();
		const result = await indexRecord(
			{
				uri: 'at://did:plc:author/app.bsky.feed.post/r1',
				cid: 'bafyx',
				collection: 'app.bsky.feed.post',
				value: {},
			},
			ops,
			OWNER_REPO_URI,
		);
		expect(result).toBe('unsupported');
	});
});

describe('indexDelete', () => {
	it('calls deleteByUri for known collections', async () => {
		const ops = makeOps();
		const result = await indexDelete(
			{
				uri: 'at://did:plc:b/sh.tangled.repo.pull.comment/c1',
				collection: 'sh.tangled.repo.pull.comment',
			},
			ops,
		);
		expect(result).toBe('deleted');
		expect(ops.deleteByUri).toHaveBeenCalledWith(
			'sh.tangled.repo.pull.comment',
			'at://did:plc:b/sh.tangled.repo.pull.comment/c1',
		);
	});

	it('returns unsupported for unrelated collections', async () => {
		const ops = makeOps();
		const result = await indexDelete(
			{ uri: 'at://did:plc:author/app.bsky.feed.post/r1', collection: 'app.bsky.feed.post' },
			ops,
		);
		expect(result).toBe('unsupported');
		expect(ops.deleteByUri).not.toHaveBeenCalled();
	});
});
