export interface ExtractedMarkdown {
	path: string;
	content: string;
}

export async function gunzipToString(gz: Uint8Array): Promise<string> {
	const stream = new Response(gz).body!.pipeThrough(new DecompressionStream('gzip'));
	const buf = await new Response(stream).arrayBuffer();
	return new TextDecoder().decode(buf);
}

interface FileBlock {
	path: string;
	isNew: boolean;
	added: string[];
}

const finalize = (block: FileBlock | null): ExtractedMarkdown | null => {
	if (!block) return null;
	if (!block.path.endsWith('.md')) return null;
	if (block.added.length === 0 && !block.isNew) return null;
	return { path: block.path, content: block.added.join('\n') };
};

/**
 * Walks a unified diff (extracted from a git-format-patch) and returns the
 * first newly-added `.md` file with its content. Modifications to existing
 * files are out of scope for v1: we only collect added lines, treating the
 * "new" file as the concatenation of `+` lines from each hunk. An empty
 * newly-created `.md` (no hunk body) returns `{ path, content: '' }`.
 */
export function extractMarkdownFromDiff(diffText: string): ExtractedMarkdown | null {
	const lines = diffText.split('\n');
	let current: FileBlock | null = null;

	for (const line of lines) {
		if (line.startsWith('diff --git ')) {
			const result = finalize(current);
			if (result) return result;
			const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
			current = match && match[2] ? { path: match[2], isNew: false, added: [] } : null;
			continue;
		}
		if (!current) continue;
		if (line.startsWith('new file mode')) {
			current.isNew = true;
			continue;
		}
		if (
			line.startsWith('---') ||
			line.startsWith('+++') ||
			line.startsWith('@@') ||
			line.startsWith('index ') ||
			line.startsWith('similarity index') ||
			line.startsWith('rename ') ||
			line.startsWith('deleted file mode') ||
			line.startsWith('Binary files')
		) {
			continue;
		}
		if (line.startsWith('+')) {
			current.added.push(line.slice(1));
		}
	}
	return finalize(current);
}

export async function extractMarkdownFromPatch(gz: Uint8Array): Promise<ExtractedMarkdown | null> {
	const text = await gunzipToString(gz);
	return extractMarkdownFromDiff(text);
}
