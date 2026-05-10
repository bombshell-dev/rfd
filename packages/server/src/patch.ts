export interface ExtractedMarkdown {
	path: string;
	content: string;
}

export async function gunzipToString(gz: Uint8Array): Promise<string> {
	const stream = new Response(gz).body!.pipeThrough(new DecompressionStream('gzip'));
	const buf = await new Response(stream).arrayBuffer();
	return new TextDecoder().decode(buf);
}

/**
 * Walks a unified diff (extracted from a git-format-patch) and returns the
 * first newly-added `.md` file with its content. Modifications to existing
 * files are out of scope for v1: we only collect added lines, treating the
 * "new" file as the concatenation of `+` lines from each hunk.
 */
export function extractMarkdownFromDiff(diffText: string): ExtractedMarkdown | null {
	const lines = diffText.split('\n');
	let currentPath: string | null = null;
	let collected: string[] = [];

	for (const line of lines) {
		if (line.startsWith('diff --git ')) {
			if (currentPath && collected.length > 0) {
				return { path: currentPath, content: collected.join('\n') };
			}
			currentPath = null;
			collected = [];
			continue;
		}

		if (line.startsWith('+++ ')) {
			const target = line.slice(4).trim();
			if (target === '/dev/null') {
				currentPath = null;
				continue;
			}
			const path = target.startsWith('b/') ? target.slice(2) : target;
			currentPath = path.endsWith('.md') ? path : null;
			collected = [];
			continue;
		}

		if (currentPath === null) continue;
		if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) continue;
		if (line.startsWith('+')) {
			collected.push(line.slice(1));
		}
	}

	if (currentPath && collected.length > 0) {
		return { path: currentPath, content: collected.join('\n') };
	}
	return null;
}

export async function extractMarkdownFromPatch(gz: Uint8Array): Promise<ExtractedMarkdown | null> {
	const text = await gunzipToString(gz);
	return extractMarkdownFromDiff(text);
}
