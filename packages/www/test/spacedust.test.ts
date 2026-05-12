import { describe, expect, it } from 'vitest';

import {
	buildSpacedustSubscribeUrl,
	parseSpacedustEvent,
	parseSourceCollection,
} from '../src/lib/spacedust.ts';

describe('parseSpacedustEvent', () => {
	it('parses a create link event', () => {
		const raw = JSON.stringify({
			kind: 'link',
			origin: 'live',
			link: {
				operation: 'create',
				source: 'sh.tangled.repo.pull.comment:pull',
				source_record: 'at://did:plc:author/sh.tangled.repo.pull.comment/abc',
				source_rev: '3l5xyz',
				subject: 'at://did:plc:owner/sh.tangled.repo.pull/123',
			},
		});

		const event = parseSpacedustEvent(raw);

		expect(event).toEqual({
			operation: 'create',
			source: 'sh.tangled.repo.pull.comment:pull',
			collection: 'sh.tangled.repo.pull.comment',
			path: 'pull',
			sourceRecord: 'at://did:plc:author/sh.tangled.repo.pull.comment/abc',
			sourceRev: '3l5xyz',
			subject: 'at://did:plc:owner/sh.tangled.repo.pull/123',
		});
	});

	it('parses a delete link event', () => {
		const raw = JSON.stringify({
			kind: 'link',
			origin: 'live',
			link: {
				operation: 'delete',
				source: 'sh.tangled.repo.pull:target.repo',
				source_record: 'at://did:plc:author/sh.tangled.repo.pull/xyz',
				source_rev: '3l5abc',
				subject: 'at://did:plc:owner/sh.tangled.repo/self',
			},
		});

		const event = parseSpacedustEvent(raw);

		expect(event?.operation).toBe('delete');
		expect(event?.collection).toBe('sh.tangled.repo.pull');
		expect(event?.path).toBe('target.repo');
	});

	it('returns null for non-link events', () => {
		const raw = JSON.stringify({ kind: 'something_else' });
		expect(parseSpacedustEvent(raw)).toBeNull();
	});

	it('returns null for malformed JSON', () => {
		expect(parseSpacedustEvent('{not json')).toBeNull();
	});

	it('returns null when link payload is missing required fields', () => {
		const raw = JSON.stringify({ kind: 'link', origin: 'live', link: { operation: 'create' } });
		expect(parseSpacedustEvent(raw)).toBeNull();
	});
});

describe('parseSourceCollection', () => {
	it('splits collection from path', () => {
		expect(parseSourceCollection('sh.tangled.repo.pull.comment:pull')).toEqual({
			collection: 'sh.tangled.repo.pull.comment',
			path: 'pull',
		});
	});

	it('handles dotted paths', () => {
		expect(parseSourceCollection('sh.tangled.repo.pull:target.repo')).toEqual({
			collection: 'sh.tangled.repo.pull',
			path: 'target.repo',
		});
	});

	it('returns null when no colon is present', () => {
		expect(parseSourceCollection('sh.tangled.repo.pull')).toBeNull();
	});
});

describe('buildSpacedustSubscribeUrl', () => {
	it('encodes wantedSources as repeated params', () => {
		const url = buildSpacedustSubscribeUrl({
			wantedSources: [
				'sh.tangled.repo.pull:target.repo',
				'sh.tangled.repo.pull.comment:pull',
			],
		});

		expect(url).toBe(
			'wss://spacedust.microcosm.blue/subscribe?wantedSources=sh.tangled.repo.pull%3Atarget.repo&wantedSources=sh.tangled.repo.pull.comment%3Apull',
		);
	});

	it('combines wantedSources with wantedSubjectDids', () => {
		const url = buildSpacedustSubscribeUrl({
			wantedSources: ['sh.tangled.repo.pull:target.repo'],
			wantedSubjectDids: ['did:plc:owner'],
		});

		expect(url).toContain('wantedSources=sh.tangled.repo.pull%3Atarget.repo');
		expect(url).toContain('wantedSubjectDids=did%3Aplc%3Aowner');
	});

	it('throws when no filter is provided', () => {
		expect(() => buildSpacedustSubscribeUrl({})).toThrow(/at least one filter/i);
	});

	it('honours a custom base url', () => {
		const url = buildSpacedustSubscribeUrl({
			wantedSources: ['sh.tangled.repo.pull:target.repo'],
			baseUrl: 'wss://spacedust.example.test',
		});

		expect(url.startsWith('wss://spacedust.example.test/subscribe?')).toBe(true);
	});
});
