import { parseAtUri } from './index-event.ts';

export const SLINGSHOT_BASE_URL = 'https://slingshot.microcosm.blue';

export interface HydratedRecord {
	uri: string;
	cid: string;
	value: unknown;
}

export interface HydrateOptions {
	fetch?: typeof fetch;
	baseUrl?: string;
	signal?: AbortSignal;
}

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
