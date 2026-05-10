import type { ActorIdentifier } from '@atcute/lexicons/syntax';
import { Hono } from 'hono';

import { fetchPull } from '../lib/pull.ts';

const app = new Hono();

app.get('/:handle/:repo/pulls/:rkey', async (c) => {
	const { handle, repo, rkey } = c.req.param();
	return c.json(await fetchPull({ handle: handle as ActorIdentifier, repo, rkey }));
});

export default app;
