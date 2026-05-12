import type * as IssueComment from 'lexicon/types/sh/tangled/repo/issue/comment';
import type * as Issue from 'lexicon/types/sh/tangled/repo/issue';
import type * as PullComment from 'lexicon/types/sh/tangled/repo/pull/comment';
import type * as PullStatus from 'lexicon/types/sh/tangled/repo/pull/status';
import type * as Pull from 'lexicon/types/sh/tangled/repo/pull';

const PROPOSAL_SLUG_RE = /^\d{4}(?:-[a-z0-9][a-z0-9-]*)?$/;
const ISSUE_TITLE_PREFIX_RE = /^\[(\d{4}(?:-[a-z0-9][a-z0-9-]*)?)\]/;

export interface PullRow {
	uri: string;
	cid: string;
	author_did: string;
	target_repo_uri: string;
	target_branch: string;
	source_repo_uri: string | null;
	source_branch: string | null;
	title: string;
	body: string | null;
	rounds_json: string;
	state: 'open' | 'closed' | 'merged';
	state_updated_at: string | null;
	created_at: string;
}

export interface CommentRow {
	uri: string;
	cid: string;
	author_did: string;
	pull_uri: string;
	body: string;
	created_at: string;
}

export interface IssueRow {
	uri: string;
	cid: string;
	author_did: string;
	target_repo_uri: string;
	title: string;
	body: string | null;
	proposal_slug: string | null;
	created_at: string;
}

export interface IssueCommentRow {
	uri: string;
	cid: string;
	author_did: string;
	issue_uri: string;
	body: string;
	created_at: string;
}

export function fileNameToSlug(path: string): string | null {
	const name = path.split('/').pop() ?? '';
	if (!name.endsWith('.md')) return null;
	const base = name.slice(0, -3);
	return PROPOSAL_SLUG_RE.test(base) ? base : null;
}

export function parseIssueTitleSlug(title: string): string | null {
	const match = title.match(ISSUE_TITLE_PREFIX_RE);
	return match?.[1] ?? null;
}

export function statusValueToState(value?: string): 'open' | 'closed' | 'merged' {
	switch (value) {
		case 'sh.tangled.repo.pull.status.closed':
			return 'closed';
		case 'sh.tangled.repo.pull.status.merged':
			return 'merged';
		default:
			return 'open';
	}
}

export async function upsertPull(
	db: D1Database,
	authorDid: string,
	uri: string,
	cid: string,
	record: Pull.Main,
): Promise<void> {
	const rounds = record.rounds.map((r) => ({
		createdAt: r.createdAt,
		patchCid: (r.patchBlob as { ref: { $link: string } }).ref.$link,
	}));
	await db
		.prepare(
			`INSERT INTO pulls (uri, cid, author_did, target_repo_uri, target_branch, source_repo_uri, source_branch, title, body, rounds_json, created_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
			 ON CONFLICT(uri) DO UPDATE SET
			   cid = excluded.cid,
			   target_repo_uri = excluded.target_repo_uri,
			   target_branch = excluded.target_branch,
			   source_repo_uri = excluded.source_repo_uri,
			   source_branch = excluded.source_branch,
			   title = excluded.title,
			   body = excluded.body,
			   rounds_json = excluded.rounds_json`,
		)
		.bind(
			uri,
			cid,
			authorDid,
			record.target.repo ?? '',
			record.target.branch,
			record.source?.repo ?? null,
			record.source?.branch ?? null,
			record.title,
			record.body ?? null,
			JSON.stringify(rounds),
			record.createdAt,
		)
		.run();
}

export async function replacePullFiles(
	db: D1Database,
	pullUri: string,
	paths: string[],
): Promise<void> {
	await db.prepare('DELETE FROM pull_files WHERE pull_uri = ?').bind(pullUri).run();
	const unique = Array.from(new Set(paths));
	if (unique.length === 0) return;
	const stmts = unique.map((p) =>
		db
			.prepare(
				'INSERT OR IGNORE INTO pull_files (pull_uri, file_path, proposal_slug) VALUES (?1, ?2, ?3)',
			)
			.bind(pullUri, p, fileNameToSlug(p)),
	);
	await db.batch(stmts);
}

export async function setPullState(
	db: D1Database,
	pullUri: string,
	state: 'open' | 'closed' | 'merged',
	updatedAt: string,
): Promise<void> {
	await db
		.prepare('UPDATE pulls SET state = ?1, state_updated_at = ?2 WHERE uri = ?3')
		.bind(state, updatedAt, pullUri)
		.run();
}

export async function upsertComment(
	db: D1Database,
	authorDid: string,
	uri: string,
	cid: string,
	record: PullComment.Main,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO comments (uri, cid, author_did, pull_uri, body, created_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
			 ON CONFLICT(uri) DO UPDATE SET cid = excluded.cid, body = excluded.body`,
		)
		.bind(uri, cid, authorDid, record.pull, record.body, record.createdAt)
		.run();
}

export async function upsertIssue(
	db: D1Database,
	authorDid: string,
	uri: string,
	cid: string,
	record: Issue.Main,
): Promise<void> {
	const slug = parseIssueTitleSlug(record.title);
	await db
		.prepare(
			`INSERT INTO issues (uri, cid, author_did, target_repo_uri, title, body, proposal_slug, created_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
			 ON CONFLICT(uri) DO UPDATE SET
			   cid = excluded.cid,
			   target_repo_uri = excluded.target_repo_uri,
			   title = excluded.title,
			   body = excluded.body,
			   proposal_slug = excluded.proposal_slug`,
		)
		.bind(
			uri,
			cid,
			authorDid,
			record.repo ?? '',
			record.title,
			record.body ?? null,
			slug,
			record.createdAt,
		)
		.run();
}

export async function upsertIssueComment(
	db: D1Database,
	authorDid: string,
	uri: string,
	cid: string,
	record: IssueComment.Main,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO issue_comments (uri, cid, author_did, issue_uri, body, created_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
			 ON CONFLICT(uri) DO UPDATE SET cid = excluded.cid, body = excluded.body`,
		)
		.bind(uri, cid, authorDid, record.issue, record.body, record.createdAt)
		.run();
}

export async function pullExists(db: D1Database, uri: string): Promise<boolean> {
	const r = await db.prepare('SELECT 1 FROM pulls WHERE uri = ?').bind(uri).first();
	return r !== null;
}

export async function issueExists(db: D1Database, uri: string): Promise<boolean> {
	const r = await db.prepare('SELECT 1 FROM issues WHERE uri = ?').bind(uri).first();
	return r !== null;
}

const DELETE_TABLE_BY_COLLECTION: Record<string, string> = {
	'sh.tangled.repo.pull': 'pulls',
	'sh.tangled.repo.pull.comment': 'comments',
	'sh.tangled.repo.issue': 'issues',
	'sh.tangled.repo.issue.comment': 'issue_comments',
};

export async function deleteRecord(
	db: D1Database,
	collection: string,
	uri: string,
): Promise<void> {
	const table = DELETE_TABLE_BY_COLLECTION[collection];
	if (!table) return;
	await db.prepare(`DELETE FROM ${table} WHERE uri = ?`).bind(uri).run();
}

export async function selectPullsTouchingProposal(
	db: D1Database,
	ownerRepoUri: string,
	slug: string,
): Promise<PullRow[]> {
	const numericSlug = slug.match(/^\d{4}/)?.[0] ?? slug;
	const res = await db
		.prepare(
			`SELECT p.* FROM pulls p
			 JOIN pull_files pf ON pf.pull_uri = p.uri
			 WHERE p.target_repo_uri = ?1
			   AND (pf.proposal_slug = ?2 OR pf.proposal_slug = ?3)
			 ORDER BY p.created_at DESC`,
		)
		.bind(ownerRepoUri, slug, numericSlug)
		.all<PullRow>();
	return res.results ?? [];
}

export async function selectInDiscussionSlugs(
	db: D1Database,
	ownerRepoUri: string,
): Promise<string[]> {
	const res = await db
		.prepare(
			`SELECT DISTINCT pf.proposal_slug AS slug FROM pull_files pf
			 JOIN pulls p ON p.uri = pf.pull_uri
			 WHERE p.target_repo_uri = ?1
			   AND p.state = 'open'
			   AND pf.proposal_slug IS NOT NULL`,
		)
		.bind(ownerRepoUri)
		.all<{ slug: string }>();
	return (res.results ?? []).map((r) => r.slug).filter((s): s is string => !!s);
}

export async function selectCommentsForProposal(
	db: D1Database,
	ownerRepoUri: string,
	slug: string,
): Promise<CommentRow[]> {
	const numericSlug = slug.match(/^\d{4}/)?.[0] ?? slug;
	const res = await db
		.prepare(
			`SELECT c.* FROM comments c
			 JOIN pull_files pf ON pf.pull_uri = c.pull_uri
			 JOIN pulls p ON p.uri = c.pull_uri
			 WHERE p.target_repo_uri = ?1
			   AND (pf.proposal_slug = ?2 OR pf.proposal_slug = ?3)
			 ORDER BY c.created_at`,
		)
		.bind(ownerRepoUri, slug, numericSlug)
		.all<CommentRow>();
	return res.results ?? [];
}

export async function selectIssueCommentsForProposal(
	db: D1Database,
	ownerRepoUri: string,
	slug: string,
): Promise<IssueCommentRow[]> {
	const numericSlug = slug.match(/^\d{4}/)?.[0] ?? slug;
	const res = await db
		.prepare(
			`SELECT ic.* FROM issue_comments ic
			 JOIN issues i ON i.uri = ic.issue_uri
			 WHERE i.target_repo_uri = ?1
			   AND (i.proposal_slug = ?2 OR i.proposal_slug = ?3)
			 ORDER BY ic.created_at`,
		)
		.bind(ownerRepoUri, slug, numericSlug)
		.all<IssueCommentRow>();
	return res.results ?? [];
}
