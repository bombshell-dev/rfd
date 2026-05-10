import type { ActorIdentifier } from '@atcute/lexicons/syntax';
import { Hono } from 'hono';

import { fetchPull } from '../lib/pull.ts';

const app = new Hono();

app.get('/:handle/pulls/:rkey', async (c) => {
	const { handle, rkey } = c.req.param();
	return c.json(await fetchPull({ handle: handle as ActorIdentifier, rkey }));
});

export default app;
