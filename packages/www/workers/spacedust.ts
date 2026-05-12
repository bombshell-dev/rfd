import { SpacedustSubscriber } from '../src/lib/spacedust-subscriber.ts';

export { SpacedustSubscriber };

interface AuxEnv {
	db: D1Database;
	SUBSCRIBER: DurableObjectNamespace;
}

const SINGLETON_NAME = 'singleton';

export default {
	async fetch(request: Request, env: AuxEnv): Promise<Response> {
		const id = env.SUBSCRIBER.idFromName(SINGLETON_NAME);
		const stub = env.SUBSCRIBER.get(id);
		return stub.fetch(request);
	},
};
