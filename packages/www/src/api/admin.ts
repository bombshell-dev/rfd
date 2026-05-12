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

async function proxyToSpacedust(path: string, body?: unknown): Promise<Response> {
	const init: RequestInit = body !== undefined
		? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
		: { method: 'POST' };
	return env.SPACEDUST.fetch(new Request(`https://spacedust.internal${path}`, init));
}

app.post('/spacedust/start', async (c) => {
	const owner = env.RFD_DEFAULT_OWNER?.trim();
	if (!owner) {
		return c.json({ error: 'RFD_DEFAULT_OWNER not configured' }, 400);
	}
	const configureRes = await proxyToSpacedust('/configure', { owner });
	if (!configureRes.ok) {
		return c.json({ error: 'configure failed', status: configureRes.status }, 502);
	}
	const startRes = await proxyToSpacedust('/start');
	return new Response(startRes.body, { status: startRes.status, headers: startRes.headers });
});

app.post('/spacedust/stop', async () => proxyToSpacedust('/stop'));

app.get('/spacedust/status', async () => proxyToSpacedust('/status'));

export default app;
