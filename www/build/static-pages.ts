import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import en from '../messages/en.json' with { type: 'json' };
import zh from '../messages/zh.json' with { type: 'json' };
import { isNotFoundPath, isPagePath, PAGE_PATHS } from '../page-routes.ts';

function sendNotFound(req: IncomingMessage, res: ServerResponse, html: string) {
    res.writeHead(404, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=0, must-revalidate',
    });
    res.end(req.method === 'HEAD' ? undefined : html);
}

function notFoundHtml(html: string): string {
    // A useful error page even before JavaScript loads (or when it is disabled). React replaces it
    // with the localized page and language switcher; all asset URLs remain absolute for nested URLs.
    return html
        .replace(/<title>.*?<\/title>/, `<title>404 — ${zh.NotFoundPage.title} | Subconverter-RS</title>`)
        .replace('</head>', '    <meta name="robots" content="noindex" />\n  </head>')
        .replace('<div id="root"></div>', `<div id="root"><main class="min-h-screen flex flex-col items-center justify-center gap-6 bg-gray-900 px-6 text-center text-white">
            <p class="text-6xl font-bold">404</p>
            <h1 class="text-2xl font-semibold">${zh.NotFoundPage.title}</h1>
            <p>${zh.NotFoundPage.description}</p>
            <p lang="en">${en.NotFoundPage.title}. ${en.NotFoundPage.description}</p>
            <a href="/" class="rounded bg-blue-600 px-5 py-3 text-white">${zh.NotFoundPage.backToHome} / ${en.NotFoundPage.backToHome}</a>
        </main></div>`);
}

export function staticPages(): Plugin {
    return {
        name: 'static-page-routes',
        enforce: 'post',
        generateBundle(_options, bundle) {
            const entry = bundle['index.html'];
            if (!entry || entry.type !== 'asset') throw new Error('Missing SPA index.html');
            const html = String(entry.source);
            for (const path of PAGE_PATHS) {
                if (path === '/') continue;
                this.emitFile({ type: 'asset', fileName: `${path.slice(1)}/index.html`, source: html });
            }
            this.emitFile({ type: 'asset', fileName: '404.html', source: notFoundHtml(html) });
        },
        configureServer(server) {
            // Intercept before Vite normalizes /404 to /404.html or serves the existing file as 200.
            server.middlewares.use(async (req, res, next) => {
                if (!isNotFoundPath(new URL(req.url ?? '/', 'http://localhost').pathname)) return next();
                if (!['GET', 'HEAD'].includes(req.method ?? '')) return next();
                try {
                    const source = await readFile(resolve(server.config.root, 'index.html'), 'utf8');
                    sendNotFound(req, res, await server.transformIndexHtml(req.url ?? '/404', notFoundHtml(source)));
                } catch (error) { next(error); }
            });
            // appType: 'mpa' disables Vite's blanket SPA fallback. Register after static files/API
            // handling but before HTML transformation, so known routes still use the dev entry.
            return () => server.middlewares.use(async (req, res, next) => {
                if (!['GET', 'HEAD'].includes(req.method ?? '') || !req.headers.accept?.includes('text/html')) return next();
                const url = new URL(req.url ?? '/', 'http://localhost');
                if (url.pathname === '/index.html' || url.pathname === '/api' || url.pathname.startsWith('/api/')) return next();
                if (isPagePath(url.pathname)) {
                    req.url = `/index.html${url.search}`;
                    return next();
                }
                try {
                    const source = await readFile(resolve(server.config.root, 'index.html'), 'utf8');
                    const html = await server.transformIndexHtml(url.pathname, notFoundHtml(source));
                    sendNotFound(req, res, html);
                } catch (error) { next(error); }
            });
        },
        configurePreviewServer(server) {
            // Unlike an unknown URL, the physical 404 page must override static file serving.
            server.middlewares.use(async (req, res, next) => {
                if (!isNotFoundPath(new URL(req.url ?? '/', 'http://localhost').pathname)) return next();
                if (!['GET', 'HEAD'].includes(req.method ?? '')) return next();
                try {
                    const html = await readFile(resolve(server.config.root, server.config.build.outDir, '404.html'), 'utf8');
                    sendNotFound(req, res, html);
                } catch (error) { next(error); }
            });
            return () => server.middlewares.use(async (req, res, next) => {
                if (!['GET', 'HEAD'].includes(req.method ?? '') || !req.headers.accept?.includes('text/html')) return next();
                try {
                    const directory = resolve(server.config.root, server.config.build.outDir);
                    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
                    if (isPagePath(pathname)) {
                        req.url = `${pathname.replace(/\/$/, '')}/index.html`;
                        return next();
                    }
                    const file = resolve(directory, `.${decodeURIComponent(pathname)}`);
                    // Vite's HTML middleware serves directory indexes after this hook.
                    if (file.startsWith(`${directory}${sep}`) && (await stat(file).catch(() => null))?.isFile()) return next();
                    const html = await readFile(resolve(directory, '404.html'), 'utf8');
                    sendNotFound(req, res, html);
                } catch (error) { next(error); }
            });
        },
    };
}
