import { simpleFetchHandler, XRPC } from '@atcute/client';
import {
	CompositeDidDocumentResolver,
	CompositeHandleResolver,
	DohJsonHandleResolver,
	LocalActorResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	WellKnownHandleResolver,
} from '@atcute/identity-resolver';
import type { ActorIdentifier } from '@atcute/lexicons/syntax';

import { resolveActorViaSlingshot } from './slingshot.ts';

let lazyLocalResolver: LocalActorResolver | undefined;

function localResolver(): LocalActorResolver {
	if (!lazyLocalResolver) {
		const handleResolver = new CompositeHandleResolver({
			strategy: 'race',
			methods: {
				dns: new DohJsonHandleResolver({
					dohUrl: 'https://mozilla.cloudflare-dns.com/dns-query',
				}),
				http: new WellKnownHandleResolver(),
			},
		});
		const didDocumentResolver = new CompositeDidDocumentResolver({
			methods: {
				plc: new PlcDidDocumentResolver(),
				web: new WebDidDocumentResolver(),
			},
		});
		lazyLocalResolver = new LocalActorResolver({ handleResolver, didDocumentResolver });
	}
	return lazyLocalResolver;
}

export interface ResolvedActor {
	did: string;
	handle: string;
	pds: string;
}

export async function resolveActor(actor: ActorIdentifier): Promise<ResolvedActor> {
	try {
		const mini = await resolveActorViaSlingshot(actor);
		if (mini) return mini;
	} catch (err) {
		console.warn('slingshot resolveMiniDoc failed, falling back to local resolver', err);
	}
	const r = await localResolver().resolve(actor);
	return { did: r.did, handle: r.handle, pds: r.pds };
}

export function clientFor(pds: string): XRPC {
	return new XRPC({ handler: simpleFetchHandler({ service: pds }) });
}

export const SLINGSHOT_BASE_URL = 'https://slingshot.microcosm.blue';

let slingshotClient: XRPC | undefined;

export function clientForSlingshot(): XRPC {
	if (!slingshotClient) {
		slingshotClient = new XRPC({
			handler: simpleFetchHandler({ service: SLINGSHOT_BASE_URL }),
		});
	}
	return slingshotClient;
}
