import type { ActorIdentifier } from '@atcute/lexicons/syntax';

import { coldStartFromConstellation } from './cold-start.ts';
import { getDiscussionRepo } from './discussion.ts';
import {
	createDbOps,
	indexDelete,
	indexRecord,
	TRACKED_COLLECTIONS,
} from './index-event.ts';
import { hydrateRecord } from './slingshot.ts';
import {
	buildSpacedustSubscribeUrl,
	parseSpacedustEvent,
	type SpacedustLinkEvent,
} from './spacedust.ts';

interface OwnerConfig {
	owner: string;
	ownerDid: string;
	ownerRepoUri: string;
}

const RECONNECT_BACKOFF_MS = 5_000;
const RECONNECT_BACKOFF_MAX_MS = 60_000;

const SPACEDUST_SOURCES = [
	'sh.tangled.repo.pull:target.repo',
	'sh.tangled.repo.pull.comment:pull',
	'sh.tangled.repo.pull.status:pull',
	'sh.tangled.repo.issue:repo',
	'sh.tangled.repo.issue.comment:issue',
];

export interface SpacedustEnv {
	db: D1Database;
}

export class SpacedustSubscriber implements DurableObject {
	private state: DurableObjectState;
	private env: SpacedustEnv;
	private ws: WebSocket | null = null;
	private connecting = false;
	private backoffMs = RECONNECT_BACKOFF_MS;

	constructor(state: DurableObjectState, env: SpacedustEnv) {
		this.state = state;
		this.env = env;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		switch (url.pathname) {
			case '/configure': {
				const body = (await request.json()) as { owner?: string };
				if (!body.owner) return Response.json({ error: 'owner required' }, { status: 400 });
				const config = await this.resolveOwner(body.owner);
				await this.state.storage.put('config', config);
				return Response.json({ ok: true, ...config });
			}
			case '/start': {
				const config = await this.requireConfig();
				if (!config) {
					return Response.json({ error: 'not configured' }, { status: 400 });
				}
				await this.ensureConnected(config);
				return Response.json({ ok: true, connected: this.ws !== null });
			}
			case '/stop': {
				await this.disconnect();
				await this.state.storage.deleteAlarm();
				return Response.json({ ok: true });
			}
			case '/status': {
				const config = await this.requireConfig();
				return Response.json({
					configured: config !== null,
					connected: this.ws !== null,
					connecting: this.connecting,
					owner: config?.owner ?? null,
					ownerDid: config?.ownerDid ?? null,
					ownerRepoUri: config?.ownerRepoUri ?? null,
				});
			}
			default:
				return new Response('not found', { status: 404 });
		}
	}

	async alarm(): Promise<void> {
		const config = await this.requireConfig();
		if (!config) return;
		await this.ensureConnected(config);
	}

	async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
		await this.handleEvent(text);
	}

	async webSocketClose(): Promise<void> {
		await this.handleClose();
	}

	async webSocketError(): Promise<void> {
		await this.handleClose();
	}

	private async resolveOwner(owner: string): Promise<OwnerConfig> {
		const view = await getDiscussionRepo(owner as ActorIdentifier);
		return {
			owner,
			ownerDid: view.repo.owner.did,
			ownerRepoUri: view.repo.uri,
		};
	}

	private async requireConfig(): Promise<OwnerConfig | null> {
		const stored = await this.state.storage.get<OwnerConfig>('config');
		return stored ?? null;
	}

	private async ensureConnected(config: OwnerConfig): Promise<void> {
		if (this.ws || this.connecting) return;
		this.connecting = true;
		try {
			await this.reconcile(config);
			const url = buildSpacedustSubscribeUrl({ wantedSources: SPACEDUST_SOURCES });
			const upgraded = await fetch(url, { headers: { Upgrade: 'websocket' } });
			const ws = upgraded.webSocket;
			if (!ws) throw new Error('spacedust did not return a websocket');
			this.state.acceptWebSocket(ws);
			this.ws = ws;
			this.backoffMs = RECONNECT_BACKOFF_MS;
		} catch (err) {
			console.error('spacedust connect failed', err);
			await this.scheduleReconnect();
		} finally {
			this.connecting = false;
		}
	}

	private async disconnect(): Promise<void> {
		const ws = this.ws;
		this.ws = null;
		if (ws) {
			try {
				ws.close(1000, 'shutdown');
			} catch {
				// ignore
			}
		}
	}

	private async handleClose(): Promise<void> {
		this.ws = null;
		await this.scheduleReconnect();
	}

	private async scheduleReconnect(): Promise<void> {
		const delay = this.backoffMs;
		this.backoffMs = Math.min(this.backoffMs * 2, RECONNECT_BACKOFF_MAX_MS);
		await this.state.storage.setAlarm(Date.now() + delay);
	}

	private async handleEvent(raw: string): Promise<void> {
		const event = parseSpacedustEvent(raw);
		if (!event) return;
		const config = await this.requireConfig();
		if (!config) return;
		if (!(TRACKED_COLLECTIONS as readonly string[]).includes(event.collection)) return;
		try {
			await this.applyEvent(event, config);
		} catch (err) {
			console.error('spacedust event failed', event, err);
		}
	}

	private async applyEvent(event: SpacedustLinkEvent, config: OwnerConfig): Promise<void> {
		const ops = createDbOps(this.env.db);
		if (event.operation === 'delete') {
			await indexDelete({ uri: event.sourceRecord, collection: event.collection }, ops);
			return;
		}
		const hydrated = await hydrateRecord(event.sourceRecord);
		if (!hydrated) return;
		await indexRecord(
			{
				uri: hydrated.uri,
				cid: hydrated.cid,
				collection: event.collection,
				value: hydrated.value,
			},
			ops,
			config.ownerRepoUri,
		);
	}

	private async reconcile(config: OwnerConfig): Promise<void> {
		await coldStartFromConstellation(this.env.db, config.owner as ActorIdentifier);
	}
}
