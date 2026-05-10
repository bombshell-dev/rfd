import { describe, expect, it } from 'vitest';

import { extractMarkdownFromDiff, gunzipToString } from '../src/patch.ts';

const ADD_MD_PATCH = `From abc123 Mon Sep 17 00:00:00 2001
From: Jane Doe <jane@example.com>
Subject: [PATCH] add rfd

---
 rfd/0042/README.md | 5 +++++
 1 file changed, 5 insertions(+)
 create mode 100644 rfd/0042/README.md

diff --git a/rfd/0042/README.md b/rfd/0042/README.md
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/rfd/0042/README.md
@@ -0,0 +1,5 @@
+# RFD 42
+
+An example RFD.
+
+End.
--
2.42.0
`;

const ADD_MD_AND_CODE_PATCH = `diff --git a/src/lib.ts b/src/lib.ts
new file mode 100644
index 0000000..aaaaaaa
--- /dev/null
+++ b/src/lib.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
diff --git a/docs/proposal.md b/docs/proposal.md
new file mode 100644
index 0000000..bbbbbbb
--- /dev/null
+++ b/docs/proposal.md
@@ -0,0 +1,3 @@
+# Proposal
+
+Body.
`;

const NO_MD_PATCH = `diff --git a/src/lib.ts b/src/lib.ts
new file mode 100644
index 0000000..aaaaaaa
--- /dev/null
+++ b/src/lib.ts
@@ -0,0 +1,1 @@
+export const x = 1;
`;

describe('extractMarkdownFromDiff', () => {
	it('extracts a single newly added .md file', () => {
		const result = extractMarkdownFromDiff(ADD_MD_PATCH);
		expect(result).not.toBeNull();
		expect(result!.path).toBe('rfd/0042/README.md');
		expect(result!.content).toBe('# RFD 42\n\nAn example RFD.\n\nEnd.');
	});

	it('returns the .md file even when it is not the first file in the diff', () => {
		const result = extractMarkdownFromDiff(ADD_MD_AND_CODE_PATCH);
		expect(result).not.toBeNull();
		expect(result!.path).toBe('docs/proposal.md');
		expect(result!.content).toBe('# Proposal\n\nBody.');
	});

	it('returns null when the patch adds no .md', () => {
		expect(extractMarkdownFromDiff(NO_MD_PATCH)).toBeNull();
	});

	it('returns null on empty input', () => {
		expect(extractMarkdownFromDiff('')).toBeNull();
	});
});

describe('gunzipToString', () => {
	it('round-trips a gzipped string', async () => {
		const text = '# hello\nworld';
		const encoded = new TextEncoder().encode(text);
		const compressed = await new Response(
			new Response(encoded).body!.pipeThrough(new CompressionStream('gzip')),
		).arrayBuffer();
		const out = await gunzipToString(new Uint8Array(compressed));
		expect(out).toBe(text);
	});
});
