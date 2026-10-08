import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createServer, preview } from 'vite';
import { PAGE_PATHS } from '../page-routes.ts';

// Run after `pnpm build`: exercise actual HTTP handling, not just the route predicate.
test('built pages and 404 share working, absolute asset URLs', async () => {
    const shell = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
    for (const path of PAGE_PATHS.filter((path) => path !== '/')) {
        assert.equal(await readFile(new URL(`../dist${path}/index.html`, import.meta.url), 'utf8'), shell);
    }
    const notFound = await readFile(new URL('../dist/404.html', import.meta.url), 'utf8');
    assert.match(notFound, /页面不存在/);
    assert.match(notFound, /Page not found/);
    assert.match(notFound, /name="robots" content="noindex"/);
    const assets = [...shell.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)].map((match) => match[1]);
    assert.ok(assets.some((url) => url.endsWith('.js')));
    assert.ok(assets.some((url) => url.endsWith('.css')));
    for (const asset of assets) assert.ok(notFound.includes(asset));
});

for (const mode of ['dev', 'preview'] as const) {
    test(`${mode}: known pages, unknown pages, HEAD and static assets`, async (t) => {
        const server = mode === 'dev'
            ? await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
            : await preview({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
        t.after(() => server.close());
        if (mode === 'dev') await (server as Awaited<ReturnType<typeof createServer>>).listen();
        const address = server.httpServer!.address() as AddressInfo;
        const origin = `http://127.0.0.1:${address.port}`;
        const get = (path: string, method = 'GET') => fetch(`${origin}${path}`, { method, headers: { Accept: 'text/html' } });

        for (const path of PAGE_PATHS) {
            for (const url of new Set([path, path === '/' ? '/' : `${path}/`, `${path}?test=refresh`])) {
                const response = await get(url);
                assert.equal(response.status, 200, url);
                assert.match(await response.text(), /id="root"/);
            }
        }
        for (const path of ['/missing-page', '/admin/missing/nested', '/settings/typo', '/Settings']) {
            const response = await get(path);
            assert.equal(response.status, 404, path);
            assert.match(await response.text(), /页面不存在/);
        }
        const head = await get('/missing-page', 'HEAD');
        assert.equal(head.status, 404);
        assert.equal(await head.text(), '');

        // Explicit error-page URLs are physical assets too; they must not turn into a 200 or loop.
        for (const path of ['/404', '/404.html', '/404/', '/404.html/', '/404.html?test=direct']) {
            for (const method of ['GET', 'HEAD']) {
                const response = await fetch(`${origin}${path}`, { method, redirect: 'manual' });
                assert.equal(response.status, 404, `${method} ${path}`);
                assert.equal(response.headers.get('Location'), null, path);
                const body = await response.text();
                if (method === 'HEAD') assert.equal(body, '');
                else assert.match(body, /页面不存在/);
            }
        }

        const html = await (await get('/')).text();
        const asset = mode === 'dev' ? '/src/main.tsx' : /src="(\/assets\/[^" ]+\.js)"/.exec(html)![1];
        const script = await fetch(`${origin}${asset}`);
        assert.equal(script.status, 200);
        assert.match(script.headers.get('Content-Type') ?? '', /javascript/);
        const missingAsset = await fetch(`${origin}/assets/nonexistent.js`);
        assert.equal(missingAsset.status, 404);

        if (mode === 'dev') {
            const api = await get('/api/nonexistent');
            assert.equal(api.status, 404);
            assert.match(api.headers.get('Content-Type') ?? '', /application\/json/);
            assert.match((await api.json()).error, /Not found/);

            const { default: worker } = await (server as Awaited<ReturnType<typeof createServer>>).ssrLoadModule('/worker/index.ts');
            const fetched: string[] = [];
            const env = { ASSETS: { fetch: async (input: URL) => {
                fetched.push(String(input));
                // Reproduce the platform's physical-file response: the wrapper must override 200.
                return new Response(await readFile(new URL('../dist/404.html', import.meta.url), 'utf8'), { status: 200 });
            } } };
            const errorPage = await worker.fetch(new Request(`${origin}/404.html?test=direct`), env);
            assert.equal(errorPage.status, 404);
            assert.match(await errorPage.text(), /页面不存在/);
            // Fetch the clean asset path: fetching /404.html would introduce an HTML-normalization redirect.
            assert.deepEqual(fetched, [`${origin}/404`]);
            const errorHead = await worker.fetch(new Request(`${origin}/404`, { method: 'HEAD' }), env);
            assert.equal(errorHead.status, 404);
            assert.equal(await errorHead.text(), '');
            assert.equal(fetched.length, 1, 'HEAD should not fetch an asset body');
            assert.equal((await worker.fetch(new Request(`${origin}/404`, { method: 'POST' }), env)).status, 405);
            assert.equal((await worker.fetch(new Request(`${origin}/api/nonexistent`), env)).status, 404);
        }
    });
}

test('platform entries preserve URL, method, headers and request body', async (t) => {
    const server = await createServer({ server: { middlewareMode: true }, logLevel: 'error' });
    t.after(() => server.close());
    const { default: app } = await server.ssrLoadModule('/server/app.ts');
    // A test-only endpoint verifies delegation without depending on external services or writing KV.
    app.post('/api/platform-entry-probe', async (c: any) => c.json({
        path: c.req.path,
        query: c.req.query('probe'),
        header: c.req.header('x-entry-probe'),
        body: await c.req.json(),
    }));
    const { default: worker } = await server.ssrLoadModule('/worker/index.ts');
    const { default: vercel } = await server.ssrLoadModule('/vercel/index.ts');
    const { default: netlify, config } = await server.ssrLoadModule('/netlify/functions/index.mts');
    assert.equal(config.path, '/api/*');
    for (const entry of [vercel, netlify, (request: Request) => worker.fetch(request, {})]) {
        const request = new Request('https://example.com/api/platform-entry-probe?probe=original', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-entry-probe': 'preserved' },
            body: JSON.stringify({ hello: 'world' }),
        });
        const response = await entry(request);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            path: '/api/platform-entry-probe', query: 'original', header: 'preserved', body: { hello: 'world' },
        });
        const missing = await entry(new Request('https://example.com/api/no-such-entry'));
        assert.equal(missing.status, 404);
        assert.match(missing.headers.get('Content-Type') ?? '', /application\/json/);
    }
});
