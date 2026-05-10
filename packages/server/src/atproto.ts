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

const actorResolver = new LocalActorResolver({ handleResolver, didDocumentResolver });

export interface ResolvedActor {
	did: string;
	handle: string;
	pds: string;
}

export async function resolveActor(actor: ActorIdentifier): Promise<ResolvedActor> {
	const r = await actorResolver.resolve(actor);
	return { did: r.did, handle: r.handle, pds: r.pds };
}

export function clientFor(pds: string): XRPC {
	return new XRPC({ handler: simpleFetchHandler({ service: pds }) });
}
