// Ordinary pages stay on the static host. Explicit 404 URLs must run here, because 404.html is also
// a real asset and would otherwise be served with status 200.
import app from './app.js';
import { isNotFoundPath } from '../page-routes';

interface Env {
    ASSETS: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        if (!isNotFoundPath(url.pathname)) return app.fetch(request);
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
        }
        return new Response(
            request.method === 'HEAD' ? null : (await env.ASSETS.fetch(new URL('/404', url))).body,
            {
                status: 404,
                headers: {
                    'Cache-Control': 'public, max-age=0, must-revalidate',
                    'Content-Type': 'text/html; charset=utf-8',
                },
            },
        );
    },
};
