import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';

// `0001` or `0001-name`. Matches the proposal slug shape used in routes.
const SLUG_RE = /^\d{4}(?:-[a-z0-9][a-z0-9-]*)?$/;

export const onRequest = defineMiddleware((context, next) => {
	const owner = env.RFD_DEFAULT_OWNER?.trim();
	if (!owner) return next();

	const segments = context.url.pathname.split('/').filter(Boolean);
	if (segments.length === 0) {
		return context.rewrite(`/${owner}`);
	}
	if (segments.length === 1 && segments[0] && SLUG_RE.test(segments[0])) {
		return context.rewrite(`/${owner}/${segments[0]}`);
	}

	return next();
});
