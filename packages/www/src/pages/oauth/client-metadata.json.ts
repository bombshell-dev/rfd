import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
	const origin = url.origin;
	const metadata = {
		client_id: `${origin}/oauth/client-metadata.json`,
		client_name: 'st.itch RFD',
		client_uri: origin,
		redirect_uris: [`${origin}/settings/oauth/callback`],
		scope: 'atproto transition:generic',
		grant_types: ['authorization_code', 'refresh_token'],
		response_types: ['code'],
		token_endpoint_auth_method: 'none',
		application_type: 'web',
		dpop_bound_access_tokens: true,
	};
	return new Response(JSON.stringify(metadata, null, 2), {
		headers: { 'content-type': 'application/json' },
	});
};
