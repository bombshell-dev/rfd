import { parseAtUri } from './index-event.ts';

export const SLINGSHOT_BASE_URL = 'https://slingshot.microcosm.blue';

export interface HydratedRecord {
	uri: string;
	cid: string;
	value: unknown;
}

export interface ResolvedActorMini {
	did: string;
	handle: string;
	pds: string;
}

export interface SlingshotOptions {
	fetch?: typeof fetch;
	baseUrl?: string;
	signal?: AbortSignal;
}

export type HydrateOptions = SlingshotOptions;

export async function hydrateRecord(
	atUri: string,
	options: HydrateOptions = {},
): Promise<HydratedRecord | null> {
	const parsed = parseAtUri(atUri);
	if (!parsed) return null;
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const base = options.baseUrl ?? SLINGSHOT_BASE_URL;
	const params = new URLSearchParams({
		repo: parsed.did,
		collection: parsed.collection,
		rkey: parsed.rkey,
	});
	const url = `${base}/xrpc/com.atproto.repo.getRecord?${params.toString()}`;
	const res = await fetchImpl(url, { signal: options.signal });
	if (res.status === 404) return null;
	if (!res.ok) {
		throw new Error(`slingshot getRecord failed: ${res.status} ${await res.text()}`);
	}
	const body = (await res.json()) as HydratedRecord;
	return body;
}

export async function resolveActorViaSlingshot(
	identifier: string,
	options: SlingshotOptions = {},
): Promise<ResolvedActorMini | null> {
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const base = options.baseUrl ?? SLINGSHOT_BASE_URL;
	const params = new URLSearchParams({ identifier });
	const url = `${base}/xrpc/com.bad-example.identity.resolveMiniDoc?${params.toString()}`;
	const res = await fetchImpl(url, { signal: options.signal });
	if (res.status === 400) return null;
	if (!res.ok) {
		throw new Error(`slingshot resolveMiniDoc failed: ${res.status} ${await res.text()}`);
	}
	const body = (await res.json()) as { did: string; handle: string; pds: string };
	return { did: body.did, handle: body.handle, pds: body.pds };
}
