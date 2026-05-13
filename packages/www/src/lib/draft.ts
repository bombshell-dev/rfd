export function slugify(title: string): string {
	return title
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
}

const NULL_SHA = '0'.repeat(40);

function toHex(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let out = '';
	for (const b of bytes) out += b.toString(16).padStart(2, '0');
	return out;
}

/**
 * git's hash-object: sha1("blob " + length + "\0" + content).
 * Length is in bytes (UTF-8), not characters.
 */
export async function gitBlobSha1(content: string): Promise<string> {
	const encoded = new TextEncoder().encode(content);
	const header = new TextEncoder().encode(`blob ${encoded.byteLength}\0`);
	const buf = new Uint8Array(header.byteLength + encoded.byteLength);
	buf.set(header, 0);
	buf.set(encoded, header.byteLength);
	const digest = await crypto.subtle.digest('SHA-1', buf);
	return toHex(digest);
}

function formatRfc2822Date(d: Date): string {
	// e.g. "Sat, 10 May 2026 12:34:56 +0000"
	const pad = (n: number) => n.toString().padStart(2, '0');
	const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const months = [
		'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
	];
	return `${days[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

export interface BuildPatchInput {
	title: string;
	body: string;
	fileName: string;
	authorName?: string;
	authorEmail?: string;
	date?: Date;
}

/**
 * Constructs a single-commit `git format-patch`-style text that adds the given
 * file with the body as its full content. Tangled's appview accepts these
 * directly (see patchutil.IsFormatPatch + validator/pull.go).
 */
export async function buildPatch({
	title,
	body,
	fileName,
	authorName = 'st.itch user',
	authorEmail = 'noreply@stitch.bot',
	date = new Date(),
}: BuildPatchInput): Promise<string> {
	const newSha = await gitBlobSha1(body);
	const lines = body.length === 0 ? [] : body.split('\n');
	const lineCount = lines.length;
	const additions = lines.map((line) => `+${line}`).join('\n');
	const hunk = lineCount > 0 ? `@@ -0,0 +1,${lineCount} @@\n${additions}\n` : '';

	const summary =
		`---\n` +
		` ${fileName} | ${lineCount} ${'+'.repeat(Math.min(lineCount, 6))}\n` +
		` 1 file changed, ${lineCount} insertion${lineCount === 1 ? '' : 's'}(+)\n` +
		` create mode 100644 ${fileName}\n\n`;

	const diff =
		`diff --git a/${fileName} b/${fileName}\n` +
		`new file mode 100644\n` +
		`index 0000000..${newSha.slice(0, 7)}\n` +
		`--- /dev/null\n` +
		`+++ b/${fileName}\n` +
		hunk;

	return (
		`From ${NULL_SHA} Mon Sep 17 00:00:00 2001\n` +
		`From: ${authorName} <${authorEmail}>\n` +
		`Date: ${formatRfc2822Date(date)}\n` +
		`Subject: [PATCH] ${title}\n` +
		`\n` +
		summary +
		diff +
		`-- \n2.42.0\n`
	);
}

export async function gzipString(text: string): Promise<Uint8Array> {
	const stream = new Response(text).body!.pipeThrough(new CompressionStream('gzip'));
	const buf = await new Response(stream).arrayBuffer();
	return new Uint8Array(buf);
}
