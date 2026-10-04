// The API (/api/*) as one Hono app built on the web standard Request/Response, so every platform runs the
// same code: Cloudflare Workers (server/worker.ts), Vercel (api/index.ts), Netlify
// (netlify/functions/api.mts) and the Vite dev server (vite.config.ts). The frontend is a static SPA that
// each platform serves from its CDN, so only API requests reach this app.
import { Hono, type Context } from 'hono';
import * as adminDownloads from './routes/admin-downloads.js';
import * as adminFiles from './routes/admin-files.js';
import * as adminGithub from './routes/admin-github.js';
import * as adminList from './routes/admin-list.js';
import * as adminRulesUpdate from './routes/admin-rules-update.js';
import * as downloadFile from './routes/download-file.js';
import * as downloads from './routes/downloads.js';
import * as init from './routes/init.js';
import * as shortUrl from './routes/short-url.js';
import * as shortUrlMove from './routes/short-url-move.js';
import * as shortUrls from './routes/short-urls.js';
import * as sub from './routes/sub.js';
import * as subInit from './routes/sub-init.js';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;

type RouteContext = { params: Promise<Record<string, unknown>> };
type Handler = (request: Request, context: RouteContext) => Response | Promise<Response>;
type RouteModule = Partial<Record<(typeof METHODS)[number], Handler>>;

const app = new Hono();

// API responses are dynamic: unless a handler sets its own Cache-Control, no CDN or Workers Cache may store them
app.use('/api/*', async (c, next) => {
    await next();
    if (!c.res.headers.has('Cache-Control')) {
        // Copy first: responses from Response.redirect() or fetch() have immutable headers
        const res = new Response(c.res.body, c.res);
        res.headers.set('Cache-Control', 'no-store');
        c.res = res;
    }
});

// Registers every method a route module exports. Routes are matched in registration order, so specific
// paths come before the wildcards that would also match them.
function mount(path: string, module: RouteModule, params?: (c: Context) => Record<string, unknown>) {
    for (const method of METHODS) {
        const handler = module[method];
        if (handler) {
            app.on(method, path, (c) => handler(c.req.raw, { params: Promise.resolve(params ? params(c) : c.req.param()) }));
        }
    }
}

mount('/api/init', init);
mount('/api/sub/init', subInit);
mount('/api/sub', sub);
mount('/api/admin/list', adminList);
mount('/api/admin/github', adminGithub);
mount('/api/admin/downloads', adminDownloads);
mount('/api/admin/rules/update', adminRulesUpdate);
// Everything else under /api/admin/ is a file path in the virtual file system
mount('/api/admin/*', adminFiles, (c) => ({
    path: c.req.path.slice('/api/admin/'.length).split('/').filter(Boolean).map(decodeURIComponent),
}));
mount('/api/downloads/:appId/:platform', downloadFile);
mount('/api/downloads', downloads);
mount('/api/s/:id/move', shortUrlMove);
mount('/api/s/:id', shortUrl);
mount('/api/s', shortUrls);

app.notFound((c) => c.json({ error: `Not found: ${c.req.method} ${c.req.path}` }, 404));

export default app;
