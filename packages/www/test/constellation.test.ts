import { describe, expect, it, vi } from 'vitest';

import {
	buildLinksUrl,
	listLinkingRecords,
	recordIdToAtUri,
} from '../src/lib/constellation.ts';

describe('buildLinksUrl', () => {
	it('encodes target, collection, and path', () => {
		const url = buildLinksUrl({
			target: 'at://did:plc:owner/sh.tangled.repo/self',
			collection: 'sh.tangled.repo.pull',
			path: '.target.repo',
		});
		expect(url).toBe(
			'https://constellation.microcosm.blue/links?target=at%3A%2F%2Fdid%3Aplc%3Aowner%2Fsh.tangled.repo%2Fself&collection=sh.tangled.repo.pull&path=.target.repo',
		);
	});

	it('appends cursor and limit when provided', () => {
		const url = buildLinksUrl({
			target: 'did:plc:owner',
			collection: 'sh.tangled.repo.pull',
			path: '.target.repo',
			cursor: 'opaque-cursor',
			limit: 50,
		});
		expect(url).toContain('&cursor=opaque-cursor');
		expect(url).toContain('&limit=50');
	});
});

describe('recordIdToAtUri', () => {
	it('formats did/collection/rkey as at-uri', () => {
		expect(
			recordIdToAtUri({
				did: 'did:plc:author',
				collection: 'sh.tangled.repo.pull.comment',
				rkey: 'abc123',
			}),
		).toBe('at://did:plc:author/sh.tangled.repo.pull.comment/abc123');
	});
});

describe('listLinkingRecords', () => {
	it('paginates through cursors and yields at-uris', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						total: 3,
						linking_records: [
							{ did: 'did:plc:a', collection: 'sh.tangled.repo.pull', rkey: 'r1' },
							{ did: 'did:plc:b', collection: 'sh.tangled.repo.pull', rkey: 'r2' },
						],
						cursor: 'next-page',
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						total: 3,
						linking_records: [
							{ did: 'did:plc:c', collection: 'sh.tangled.repo.pull', rkey: 'r3' },
						],
						cursor: null,
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
			);

		const out: string[] = [];
		for await (const uri of listLinkingRecords(
			{
				target: 'at://did:plc:owner/sh.tangled.repo/self',
				collection: 'sh.tangled.repo.pull',
				path: '.target.repo',
			},
			{ fetch: fetchMock as unknown as typeof fetch },
		)) {
			out.push(uri);
		}

		expect(out).toEqual([
			'at://did:plc:a/sh.tangled.repo.pull/r1',
			'at://did:plc:b/sh.tangled.repo.pull/r2',
			'at://did:plc:c/sh.tangled.repo.pull/r3',
		]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect((fetchMock.mock.calls[1][0] as string)).toContain('cursor=next-page');
	});

	it('throws on non-2xx response', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
		const iter = listLinkingRecords(
			{
				target: 'did:plc:owner',
				collection: 'sh.tangled.repo.pull',
				path: '.target.repo',
			},
			{ fetch: fetchMock as unknown as typeof fetch },
		);
		await expect(iter.next()).rejects.toThrow(/constellation/i);
	});
});
