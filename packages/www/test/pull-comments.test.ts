import { describe, expect, it, vi } from 'vitest';

import { collectCommentsFor } from '../src/lib/pull.ts';

const PULL_URI = 'at://did:plc:owner/sh.tangled.repo.pull/r1';

async function* asyncIter<T>(items: T[]): AsyncGenerator<T> {
	for (const item of items) yield item;
}

describe('collectCommentsFor', () => {
	it('hydrates each at-uri returned by Constellation and sorts by createdAt', async () => {
		const hydrate = vi
			.fn()
			.mockResolvedValueOnce({
				uri: 'at://did:plc:b/sh.tangled.repo.pull.comment/c2',
				cid: 'bafy2',
				value: { pull: PULL_URI, body: 'second', createdAt: '2026-05-10T01:00:00Z' },
			})
			.mockResolvedValueOnce({
				uri: 'at://did:plc:a/sh.tangled.repo.pull.comment/c1',
				cid: 'bafy1',
				value: { pull: PULL_URI, body: 'first', createdAt: '2026-05-10T00:00:00Z' },
			});

		const comments = await collectCommentsFor(PULL_URI, {
			listLinks: () =>
				asyncIter([
					'at://did:plc:b/sh.tangled.repo.pull.comment/c2',
					'at://did:plc:a/sh.tangled.repo.pull.comment/c1',
				]),
			hydrate,
		});

		expect(comments.map((c) => c.body)).toEqual(['first', 'second']);
		expect(comments[0].author).toEqual({ did: 'did:plc:a' });
		expect(comments[1].author).toEqual({ did: 'did:plc:b' });
	});

	it('skips comments whose pull field does not match the requested pull (defensive)', async () => {
		const hydrate = vi.fn().mockResolvedValue({
			uri: 'at://did:plc:b/sh.tangled.repo.pull.comment/c1',
			cid: 'bafy1',
			value: {
				pull: 'at://did:plc:other/sh.tangled.repo.pull/elsewhere',
				body: 'not for us',
				createdAt: '2026-05-10T00:00:00Z',
			},
		});

		const comments = await collectCommentsFor(PULL_URI, {
			listLinks: () => asyncIter(['at://did:plc:b/sh.tangled.repo.pull.comment/c1']),
			hydrate,
		});

		expect(comments).toEqual([]);
	});

	it('skips at-uris whose hydrate returns null (deleted / missing record)', async () => {
		const hydrate = vi.fn().mockResolvedValue(null);

		const comments = await collectCommentsFor(PULL_URI, {
			listLinks: () => asyncIter(['at://did:plc:b/sh.tangled.repo.pull.comment/gone']),
			hydrate,
		});

		expect(comments).toEqual([]);
	});
});
