import type { ActorIdentifier } from '@atcute/lexicons/syntax';

import { coldStartFromConstellation, type ColdStartCounts } from './cold-start.ts';

export type BackfillResult = ColdStartCounts;

/**
 * Cold-start ingestion: drives the indexer from Constellation backlinks against the
 * owner's discussion repo, hydrating each record via Slingshot. Used by the admin
 * /reindex endpoint and as the recovery path when the Spacedust subscriber boots cold.
 */
export async function backfillOwner(
	db: D1Database,
	owner: ActorIdentifier,
): Promise<BackfillResult> {
	const result = await coldStartFromConstellation(db, owner);
	const { view: _view, ...counts } = result;
	return counts;
}
