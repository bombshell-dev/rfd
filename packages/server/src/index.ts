import type {} from '@atcute/atproto';
import { Hono } from 'hono';
import type { ActorIdentifier } from '@atcute/lexicons/syntax';

import { fetchPull } from './pull.ts';

const app = new Hono();

app.get('/healthz', (c) => c.json({ ok: true }));

app.get('/:handle/:repo/pulls/:rkey', async (c) => {
	const { handle, repo, rkey } = c.req.param();
	const result = await fetchPull({ handle: handle as ActorIdentifier, repo, rkey });
	return c.json(result);
});

app.onError((err, c) => {
	console.error(err);
	return c.json({ error: err.message ?? String(err) }, 500);
});

export default app;
