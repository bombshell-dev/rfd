import { describe, expect, it, vi } from 'vitest';

import { hydrateRecord } from '../src/lib/slingshot.ts';

describe('hydrateRecord', () => {
	it('fetches getRecord from slingshot using did/collection/rkey from the at-uri', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					uri: 'at://did:plc:author/sh.tangled.repo.pull/r1',
					cid: 'bafy1',
					value: { title: 't' },
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			),
		);

		const record = await hydrateRecord(
			'at://did:plc:author/sh.tangled.repo.pull/r1',
			{ fetch: fetchMock as unknown as typeof fetch },
		);

		expect(record).toEqual({
			uri: 'at://did:plc:author/sh.tangled.repo.pull/r1',
			cid: 'bafy1',
			value: { title: 't' },
		});
		const calledUrl = fetchMock.mock.calls[0][0] as string;
		expect(calledUrl).toContain('https://slingshot.microcosm.blue/xrpc/com.atproto.repo.getRecord');
		expect(calledUrl).toContain('repo=did%3Aplc%3Aauthor');
		expect(calledUrl).toContain('collection=sh.tangled.repo.pull');
		expect(calledUrl).toContain('rkey=r1');
	});

	it('returns null on 404 (record absent / deleted)', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
		const record = await hydrateRecord(
			'at://did:plc:author/sh.tangled.repo.pull/missing',
			{ fetch: fetchMock as unknown as typeof fetch },
		);
		expect(record).toBeNull();
	});

	it('returns null for malformed at-uri', async () => {
		const fetchMock = vi.fn();
		const record = await hydrateRecord('not-an-at-uri', {
			fetch: fetchMock as unknown as typeof fetch,
		});
		expect(record).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('throws on other non-2xx responses', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
		await expect(
			hydrateRecord('at://did:plc:a/sh.tangled.repo.pull/r1', {
				fetch: fetchMock as unknown as typeof fetch,
			}),
		).rejects.toThrow(/slingshot/i);
	});
});
