import type { ActorIdentifier } from '@atcute/lexicons/syntax';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';

import { backfillOwner } from '../lib/backfill.ts';

const app = new Hono();

app.use('*', async (c, next) => {
	const token = env.RFD_ADMIN_TOKEN;
	const auth = c.req.header('authorization');
	if (!token || auth !== `Bearer ${token}`) {
		return c.json({ error: 'unauthorized' }, 401);
	}
	await next();
});

app.post('/reindex', async (c) => {
	const owner = env.RFD_DEFAULT_OWNER?.trim();
	if (!owner) {
		return c.json({ error: 'RFD_DEFAULT_OWNER not configured' }, 400);
	}
	if (!env.db) {
		return c.json({ error: 'D1 binding `db` not configured' }, 500);
	}
	const counts = await backfillOwner(env.db, owner as ActorIdentifier);
	return c.json({ ok: true, ...counts });
});

export default app;
