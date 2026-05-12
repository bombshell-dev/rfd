import { describe, expect, it, vi } from 'vitest';

import { resolveActorViaSlingshot } from '../src/lib/slingshot.ts';

describe('resolveActorViaSlingshot', () => {
	it('returns did/handle/pds from a successful response', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					did: 'did:plc:abc',
					handle: 'alice.example',
					pds: 'https://pds.example',
					signing_key: 'multibase...',
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			),
		);

		const actor = await resolveActorViaSlingshot('alice.example', {
			fetch: fetchMock as unknown as typeof fetch,
		});

		expect(actor).toEqual({
			did: 'did:plc:abc',
			handle: 'alice.example',
			pds: 'https://pds.example',
		});
		const calledUrl = fetchMock.mock.calls[0][0] as string;
		expect(calledUrl).toContain(
			'https://slingshot.microcosm.blue/xrpc/com.bad-example.identity.resolveMiniDoc',
		);
		expect(calledUrl).toContain('identifier=alice.example');
	});

	it('url-encodes DID identifiers (with colons)', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					did: 'did:plc:abc',
					handle: 'alice.example',
					pds: 'https://pds.example',
					signing_key: 'k',
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			),
		);

		await resolveActorViaSlingshot('did:plc:abc', {
			fetch: fetchMock as unknown as typeof fetch,
		});

		expect(fetchMock.mock.calls[0][0] as string).toContain('identifier=did%3Aplc%3Aabc');
	});

	it('returns null on 400 (identity not resolved)', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: 'HandleNotFound' }), { status: 400 }),
		);

		const actor = await resolveActorViaSlingshot('missing.example', {
			fetch: fetchMock as unknown as typeof fetch,
		});

		expect(actor).toBeNull();
	});

	it('throws on other non-2xx responses', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));

		await expect(
			resolveActorViaSlingshot('alice.example', {
				fetch: fetchMock as unknown as typeof fetch,
			}),
		).rejects.toThrow(/slingshot/i);
	});
});
