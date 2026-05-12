export const CONSTELLATION_BASE_URL = 'https://constellation.microcosm.blue';

export interface RecordId {
	did: string;
	collection: string;
	rkey: string;
}

export interface LinksQuery {
	target: string;
	collection: string;
	path: string;
	cursor?: string;
	limit?: number;
	baseUrl?: string;
}

interface LinksResponse {
	total: number;
	linking_records: RecordId[];
	cursor: string | null;
}

export function recordIdToAtUri(id: RecordId): string {
	return `at://${id.did}/${id.collection}/${id.rkey}`;
}

export function buildLinksUrl(query: LinksQuery): string {
	const base = query.baseUrl ?? CONSTELLATION_BASE_URL;
	const params = new URLSearchParams();
	params.set('target', query.target);
	params.set('collection', query.collection);
	params.set('path', query.path);
	if (query.cursor) params.set('cursor', query.cursor);
	if (typeof query.limit === 'number') params.set('limit', String(query.limit));
	return `${base}/links?${params.toString()}`;
}

export interface ListLinkingRecordsOptions {
	fetch?: typeof fetch;
	signal?: AbortSignal;
}

export async function* listLinkingRecords(
	query: LinksQuery,
	options: ListLinkingRecordsOptions = {},
): AsyncGenerator<string, void, void> {
	const fetchImpl = options.fetch ?? globalThis.fetch;
	let cursor = query.cursor;
	while (true) {
		const url = buildLinksUrl({ ...query, cursor });
		const res = await fetchImpl(url, { signal: options.signal });
		if (!res.ok) {
			throw new Error(`constellation /links failed: ${res.status} ${await res.text()}`);
		}
		const body = (await res.json()) as LinksResponse;
		for (const record of body.linking_records) {
			yield recordIdToAtUri(record);
		}
		if (!body.cursor) return;
		cursor = body.cursor;
	}
}
