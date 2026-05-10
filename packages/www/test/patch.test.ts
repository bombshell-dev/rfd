import { describe, expect, it } from 'vitest';

import { extractMarkdownFromDiff, gunzipToString, listMarkdownFilesInDiff } from '../src/lib/patch.ts';

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

	it('returns an empty .md when the patch creates an empty new .md file', () => {
		const patch = `From abc Mon Sep 17 00:00:00 2001
Subject: [PATCH] hello

diff --git a/0001.md b/0001.md
new file mode 100644
index 0000000..e69de29
--
2.53.0
`;
		const result = extractMarkdownFromDiff(patch);
		expect(result).not.toBeNull();
		expect(result!.path).toBe('0001.md');
		expect(result!.content).toBe('');
	});
});

describe('listMarkdownFilesInDiff', () => {
	it('returns every .md file the diff touches', () => {
		const patch = `diff --git a/src/lib.ts b/src/lib.ts
new file mode 100644
index 0000000..aaaaaaa
--- /dev/null
+++ b/src/lib.ts
@@ -0,0 +1,1 @@
+export const x = 1;
diff --git a/0001-hello.md b/0001-hello.md
new file mode 100644
index 0000000..bbbbbbb
--- /dev/null
+++ b/0001-hello.md
@@ -0,0 +1,2 @@
+# Hello
+World.
diff --git a/0002-bye.md b/0002-bye.md
new file mode 100644
index 0000000..ccccccc
--- /dev/null
+++ b/0002-bye.md
@@ -0,0 +1,1 @@
+# Bye
`;
		const entries = listMarkdownFilesInDiff(patch);
		expect(entries).toHaveLength(2);
		expect(entries[0]!.path).toBe('0001-hello.md');
		expect(entries[0]!.isNew).toBe(true);
		expect(entries[0]!.content).toBe('# Hello\nWorld.');
		expect(entries[1]!.path).toBe('0002-bye.md');
		expect(entries[1]!.content).toBe('# Bye');
	});

	it('follows renames across commits in a git-format-patch', () => {
		const patch = `From abc Mon Sep 17 00:00:00 2001
Subject: [PATCH] add empty

diff --git a/0001.md b/0001.md
new file mode 100644
index 0000000..e69de29
--
2.53.0


From def Mon Sep 17 00:00:00 2001
Subject: [PATCH] fill in

---
 0001.md | 3 +++
 1 file changed, 3 insertions(+)

diff --git a/0001.md b/0001.md
index e69de29..028157d 100644
--- a/0001.md
+++ b/0001.md
@@ -0,0 +1,3 @@
+# hello
+
+body
--
2.53.0


From ghi Mon Sep 17 00:00:00 2001
Subject: [PATCH] rename

---
 0001.md => 0001-test.md | 0
 1 file changed, 0 insertions(+), 0 deletions(-)
 rename 0001.md => 0001-test.md (100%)

diff --git a/0001.md b/0001-test.md
similarity index 100%
rename from 0001.md
rename to 0001-test.md
--
2.53.0
`;
		const entries = listMarkdownFilesInDiff(patch);
		expect(entries).toHaveLength(1);
		expect(entries[0]!.path).toBe('0001-test.md');
		expect(entries[0]!.isNew).toBe(true);
		expect(entries[0]!.content).toBe('# hello\n\nbody');
	});

	it('flags deleted .md files', () => {
		const patch = `diff --git a/old.md b/old.md
deleted file mode 100644
index 1234567..0000000
--- a/old.md
+++ /dev/null
@@ -1,1 +0,0 @@
-# Gone
`;
		const entries = listMarkdownFilesInDiff(patch);
		expect(entries).toHaveLength(1);
		expect(entries[0]!.path).toBe('old.md');
		expect(entries[0]!.isDelete).toBe(true);
		expect(entries[0]!.content).toBe('');
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
