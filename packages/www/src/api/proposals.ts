import type { ActorIdentifier } from '@atcute/lexicons/syntax';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';

import { getProposal, listProposals } from '../lib/proposal.ts';

const app = new Hono();

app.get('/:handle/proposals', async (c) => {
	const { handle } = c.req.param();
	const result = await listProposals({ DB: env.db ?? null }, handle as ActorIdentifier);
	return c.json(result);
});

app.get('/:handle/proposals/:slug', async (c) => {
	const { handle, slug } = c.req.param();
	const result = await getProposal({ DB: env.db ?? null }, handle as ActorIdentifier, slug);
	if (!result) {
		return c.json({ error: `proposal not found: ${slug}` }, 404);
	}
	return c.json(result);
});

export default app;
