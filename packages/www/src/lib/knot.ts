import { simpleFetchHandler, XRPC } from '@atcute/client';

export interface DefaultBranch {
	name: string;
	hash: string;
	when: string;
}

export interface TreeFile {
	name: string;
	mode: string;
	size: number;
}

export interface ProposalFile {
	slug: string;
	path: string;
	size: number;
}

const PROPOSAL_FILE_RE = /^\d{4}(?:-[a-z0-9][a-z0-9-]*)?\.md$/;

function clientFor(knot: string): XRPC {
	const service = knot.startsWith('http') ? knot : `https://${knot}`;
	return new XRPC({ handler: simpleFetchHandler({ service }) });
}

/**
 * Knot's `repo` parameter is `did:plc:.../repoName` per the lexicon spec.
 */
export function knotRepoId(did: string, repoName: string): string {
	return `${did}/${repoName}`;
}

export async function getDefaultBranch(knot: string, repoId: string): Promise<DefaultBranch> {
	const rpc = clientFor(knot);
	const res = await rpc.get('sh.tangled.repo.getDefaultBranch', {
		params: { repo: repoId },
	});
	const data = res.data as DefaultBranch;
	return data;
}

export async function listMarkdownProposals(
	knot: string,
	repoId: string,
	ref: string,
): Promise<ProposalFile[]> {
	const rpc = clientFor(knot);
	const res = await rpc.get('sh.tangled.repo.tree', {
		params: { repo: repoId, ref },
	});
	const files = (res.data as { files: TreeFile[] }).files ?? [];
	const out: ProposalFile[] = [];
	for (const f of files) {
		if (!PROPOSAL_FILE_RE.test(f.name)) continue;
		const slug = f.name.slice(0, -3);
		out.push({ slug, path: f.name, size: f.size });
	}
	return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

export interface BlobResponse {
	content: string;
	encoding: 'utf-8' | 'base64';
	size: number;
	isBinary?: boolean;
}

export async function getBlob(
	knot: string,
	repoId: string,
	ref: string,
	path: string,
): Promise<string | null> {
	const rpc = clientFor(knot);
	try {
		const res = await rpc.get('sh.tangled.repo.blob', {
			params: { repo: repoId, ref, path },
		});
		const data = res.data as BlobResponse;
		if (data.isBinary) return null;
		if (data.encoding === 'base64') {
			return atob(data.content);
		}
		return data.content;
	} catch {
		return null;
	}
}
