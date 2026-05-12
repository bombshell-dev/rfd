export const SPACEDUST_BASE_URL = 'wss://spacedust.microcosm.blue';

export type SpacedustOperation = 'create' | 'delete';

export interface SpacedustLinkEvent {
	operation: SpacedustOperation;
	source: string;
	collection: string;
	path: string;
	sourceRecord: string;
	sourceRev: string;
	subject: string;
}

export interface SpacedustSubscribeFilters {
	wantedSources?: string[];
	wantedSubjects?: string[];
	wantedSubjectPrefixes?: string[];
	wantedSubjectDids?: string[];
	baseUrl?: string;
}

export function parseSourceCollection(
	source: string,
): { collection: string; path: string } | null {
	const colon = source.indexOf(':');
	if (colon === -1) return null;
	return { collection: source.slice(0, colon), path: source.slice(colon + 1) };
}

export function parseSpacedustEvent(raw: string): SpacedustLinkEvent | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object') return null;
	const obj = parsed as Record<string, unknown>;
	if (obj.kind !== 'link') return null;
	const link = obj.link as Record<string, unknown> | undefined;
	if (!link) return null;
	const operation = link.operation;
	const source = link.source;
	const sourceRecord = link.source_record;
	const sourceRev = link.source_rev;
	const subject = link.subject;
	if (
		(operation !== 'create' && operation !== 'delete') ||
		typeof source !== 'string' ||
		typeof sourceRecord !== 'string' ||
		typeof sourceRev !== 'string' ||
		typeof subject !== 'string'
	) {
		return null;
	}
	const split = parseSourceCollection(source);
	if (!split) return null;
	return {
		operation,
		source,
		collection: split.collection,
		path: split.path,
		sourceRecord,
		sourceRev,
		subject,
	};
}

export function buildSpacedustSubscribeUrl(filters: SpacedustSubscribeFilters): string {
	const parts: string[] = [];
	const append = (key: string, values: string[] | undefined) => {
		if (!values) return;
		for (const v of values) {
			parts.push(`${key}=${encodeURIComponent(v)}`);
		}
	};
	append('wantedSources', filters.wantedSources);
	append('wantedSubjects', filters.wantedSubjects);
	append('wantedSubjectPrefixes', filters.wantedSubjectPrefixes);
	append('wantedSubjectDids', filters.wantedSubjectDids);
	if (parts.length === 0) {
		throw new Error('buildSpacedustSubscribeUrl requires at least one filter');
	}
	const base = filters.baseUrl ?? SPACEDUST_BASE_URL;
	return `${base}/subscribe?${parts.join('&')}`;
}
