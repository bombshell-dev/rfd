export interface ExtractedMarkdown {
	path: string;
	content: string;
}

export interface MarkdownFileEntry {
	path: string;
	content: string;
	isNew: boolean;
	isDelete: boolean;
}

export async function gunzipToString(gz: Uint8Array): Promise<string> {
	const stream = new Response(gz).body!.pipeThrough(new DecompressionStream('gzip'));
	const buf = await new Response(stream).arrayBuffer();
	return new TextDecoder().decode(buf);
}

interface FileBlock {
	path: string;
	isNew: boolean;
	isDelete: boolean;
	added: string[];
}

function flushBlock(block: FileBlock | null): MarkdownFileEntry | null {
	if (!block) return null;
	if (!block.path.endsWith('.md')) return null;
	if (block.added.length === 0 && !block.isNew && !block.isDelete) return null;
	return {
		path: block.path,
		content: block.added.join('\n'),
		isNew: block.isNew,
		isDelete: block.isDelete,
	};
}

/**
 * Walks a unified diff (extracted from a multi-commit git-format-patch) and
 * returns one entry per `.md` file present at the *end* of the patch. Renames
 * follow through (state transfers from old path to new), so the entries
 * reflect the final filenames. Added lines accumulate across all commits.
 *
 * v1 caveats: line-level deletes aren't applied (we only collect `+` lines),
 * so for non-additive modifications we over-collect. Good enough for new
 * proposals + simple amendments.
 */
export function listMarkdownFilesInDiff(diffText: string): MarkdownFileEntry[] {
	const lines = diffText.split('\n');
	const blocks = new Map<string, FileBlock>();
	let current: FileBlock | null = null;

	for (const line of lines) {
		if (line.startsWith('diff --git ')) {
			const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
			if (!match || !match[2]) {
				current = null;
				continue;
			}
			const oldPath = match[1]!;
			const newPath = match[2];
			if (oldPath !== newPath && blocks.has(oldPath)) {
				const transferred = blocks.get(oldPath)!;
				blocks.delete(oldPath);
				transferred.path = newPath;
				blocks.set(newPath, transferred);
				current = transferred;
			} else {
				current = blocks.get(newPath) ?? {
					path: newPath,
					isNew: false,
					isDelete: false,
					added: [],
				};
				blocks.set(newPath, current);
			}
			continue;
		}
		if (!current) continue;
		if (line.startsWith('new file mode')) {
			current.isNew = true;
			continue;
		}
		if (line.startsWith('deleted file mode')) {
			current.isDelete = true;
			continue;
		}
		if (
			line.startsWith('---') ||
			line.startsWith('+++') ||
			line.startsWith('@@') ||
			line.startsWith('index ') ||
			line.startsWith('similarity index') ||
			line.startsWith('rename ') ||
			line.startsWith('Binary files')
		) {
			continue;
		}
		if (line.startsWith('+')) {
			current.added.push(line.slice(1));
		}
	}

	const out: MarkdownFileEntry[] = [];
	for (const block of blocks.values()) {
		const entry = flushBlock(block);
		if (entry) out.push(entry);
	}
	return out;
}

/**
 * Returns the first `.md` file the diff touches with its added content.
 * Backwards-compatible with the original Phase 1 API.
 */
export function extractMarkdownFromDiff(diffText: string): ExtractedMarkdown | null {
	const all = listMarkdownFilesInDiff(diffText);
	const entry = all[0];
	if (!entry) return null;
	return { path: entry.path, content: entry.content };
}

/**
 * Returns the entry for a specific path within the diff, if present.
 */
export function extractMarkdownFileFromDiff(
	diffText: string,
	path: string,
): MarkdownFileEntry | null {
	for (const entry of listMarkdownFilesInDiff(diffText)) {
		if (entry.path === path) return entry;
	}
	return null;
}

export async function extractMarkdownFromPatch(gz: Uint8Array): Promise<ExtractedMarkdown | null> {
	const text = await gunzipToString(gz);
	return extractMarkdownFromDiff(text);
}

export async function listMarkdownFilesInPatch(gz: Uint8Array): Promise<MarkdownFileEntry[]> {
	const text = await gunzipToString(gz);
	return listMarkdownFilesInDiff(text);
}
