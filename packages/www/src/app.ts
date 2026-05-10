import { pages } from 'astro/hono';
import { Hono } from 'hono';

import discussion from './api/discussion.ts';
import healthz from './api/healthz.ts';
import pulls from './api/pulls.ts';
import { NoDiscussionRepoError } from './lib/discussion.ts';

const api = new Hono();
api.route('/healthz', healthz);
api.route('/', discussion);
api.route('/', pulls);
api.onError((err, c) => {
	console.error(err);
	if (err instanceof NoDiscussionRepoError) {
		return c.json({ error: err.message }, 404);
	}
	return c.json({ error: err.message ?? String(err) }, 500);
});

const app = new Hono();
app.route('/api/v0', api);
app.use(pages());

export default app;
