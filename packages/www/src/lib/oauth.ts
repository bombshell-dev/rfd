import { XRPC } from '@atcute/client';
import {
	CompositeDidDocumentResolver,
	CompositeHandleResolver,
	DohJsonHandleResolver,
	LocalActorResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	WellKnownHandleResolver,
} from '@atcute/identity-resolver';
import {
	configureOAuth,
	createAuthorizationUrl,
	deleteStoredSession,
	finalizeAuthorization,
	getSession,
	OAuthUserAgent,
	type Session,
} from '@atcute/oauth-browser-client';

let configured = false;

export const SCOPE = 'atproto transition:generic';

/**
 * Build the OAuth `client_id` for the current origin.
 *
 * - **Dev (loopback)**: atproto OAuth's loopback exception requires
 *   `http://localhost?redirect_uri=<encoded>&scope=<encoded>`. The redirect
 *   itself uses 127.0.0.1 (loopback IP); only the client_id authority is the
 *   literal `localhost`. The auth server doesn't fetch this URL — it parses
 *   the params directly.
 * - **Prod**: a regular https URL pointing at the hosted client metadata JSON.
 */
function clientIdFor(origin: string, redirectUri: string): string {
	const url = new URL(origin);
	const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
	if (isLoopback) {
		const params = new URLSearchParams({ redirect_uri: redirectUri, scope: SCOPE });
		return `http://localhost?${params.toString()}`;
	}
	return `${origin}/oauth/client-metadata.json`;
}

export function configure(origin: string = location.origin): void {
	if (configured) return;
	const handleResolver = new CompositeHandleResolver({
		strategy: 'race',
		methods: {
			dns: new DohJsonHandleResolver({ dohUrl: 'https://mozilla.cloudflare-dns.com/dns-query' }),
			http: new WellKnownHandleResolver(),
		},
	});
	const didDocumentResolver = new CompositeDidDocumentResolver({
		methods: {
			plc: new PlcDidDocumentResolver(),
			web: new WebDidDocumentResolver(),
		},
	});
	const redirectUri = `${origin}/oauth/callback`;
	configureOAuth({
		metadata: {
			client_id: clientIdFor(origin, redirectUri),
			redirect_uri: redirectUri,
		},
		identityResolver: new LocalActorResolver({ handleResolver, didDocumentResolver }),
	});
	configured = true;
}

export async function startLogin(handle: string): Promise<void> {
	const url = await createAuthorizationUrl({
		target: { type: 'account', identifier: handle as never },
		scope: SCOPE,
	});
	location.assign(url);
}

export async function finishLogin(): Promise<Session> {
	// atproto OAuth servers may return the response in either the URL fragment
	// (default for browser public clients) or the query string. Try both.
	const hash = new URLSearchParams(location.hash.slice(1));
	const search = new URLSearchParams(location.search);
	const params = hash.has('state') || hash.has('error') ? hash : search;
	const { session } = await finalizeAuthorization(params);
	return session;
}

export function agentForSession(session: Session): {
	agent: OAuthUserAgent;
	rpc: XRPC;
} {
	const agent = new OAuthUserAgent(session);
	const rpc = new XRPC({ handler: agent });
	return { agent, rpc };
}

export async function resumeAgent(did: string): Promise<{ agent: OAuthUserAgent; rpc: XRPC }> {
	const session = await getSession(did as never, { allowStale: true });
	return agentForSession(session);
}

export async function signOut(did: string): Promise<void> {
	try {
		const { agent } = await resumeAgent(did);
		await agent.signOut();
	} catch {
		await deleteStoredSession(did as never);
	}
}
