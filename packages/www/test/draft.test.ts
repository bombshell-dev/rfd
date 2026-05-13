import { describe, expect, it } from 'vitest';

import { listMarkdownFilesInDiff } from '../src/lib/patch.ts';
import { buildPatch, gitBlobSha1, slugify } from '../src/lib/draft.ts';

describe('slugify', () => {
	it('lowercases and hyphenates', () => {
		expect(slugify('Cool New Proposal')).toBe('cool-new-proposal');
	});

	it('strips non-alphanumerics and collapses runs', () => {
		expect(slugify('Foo!!! Bar -- 123')).toBe('foo-bar-123');
	});

	it('trims edge hyphens', () => {
		expect(slugify('   leading and trailing   ')).toBe('leading-and-trailing');
	});

	it('returns empty when input has no alphanumerics', () => {
		expect(slugify('!!!')).toBe('');
	});

	it('caps at 60 chars', () => {
		const long = 'a'.repeat(120);
		expect(slugify(long).length).toBe(60);
	});
});

describe('gitBlobSha1', () => {
	it('matches git hash-object for an empty file', async () => {
		// Known value: `git hash-object /dev/null` → e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
		expect(await gitBlobSha1('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
	});

	it('matches git hash-object for "hello\\n"', async () => {
		// Known value: `printf 'hello\n' | git hash-object --stdin` → ce013625030ba8dba906f756967f9e9ca394464a
		expect(await gitBlobSha1('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
	});
});

describe('buildPatch', () => {
	it('produces output our own listMarkdownFilesInDiff round-trips', async () => {
		const body = '# Hello\n\nworld';
		const patch = await buildPatch({
			title: 'Hello world',
			body,
			fileName: '0000-hello-world.md',
		});
		expect(patch.startsWith('From ')).toBe(true);
		expect(patch).toMatch(/Mon Sep 17 00:00:00 2001/);
		expect(patch).toContain('Subject: [PATCH] Hello world');
		expect(patch).toContain('+++ b/0000-hello-world.md');
		const entries = listMarkdownFilesInDiff(patch);
		expect(entries).toHaveLength(1);
		expect(entries[0]!.path).toBe('0000-hello-world.md');
		expect(entries[0]!.isNew).toBe(true);
		expect(entries[0]!.content).toBe(body);
	});

	it('handles an empty body', async () => {
		const patch = await buildPatch({
			title: 'Empty',
			body: '',
			fileName: '0000-empty.md',
		});
		const entries = listMarkdownFilesInDiff(patch);
		expect(entries).toHaveLength(1);
		expect(entries[0]!.path).toBe('0000-empty.md');
		expect(entries[0]!.isNew).toBe(true);
		expect(entries[0]!.content).toBe('');
	});
});
