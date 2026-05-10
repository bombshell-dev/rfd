import type { ActorIdentifier } from '@atcute/lexicons/syntax';
import { Hono } from 'hono';

import { getDiscussionRepo } from '../lib/discussion.ts';

const app = new Hono();

app.get('/:handle', async (c) => {
	const { handle } = c.req.param();
	return c.json(await getDiscussionRepo(handle as ActorIdentifier));
});

export default app;
