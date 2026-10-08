// Used by both the client router and the static build so their list of pages cannot drift.
export const PAGE_PATHS = [
    '/', '/admin', '/admin/rules', '/config', '/convert',
    '/downloads', '/links', '/settings', '/startup',
] as const;

export type PagePath = (typeof PAGE_PATHS)[number];

export function isNotFoundPath(pathname: string): boolean {
    return /^\/404(?:\.html)?\/?$/i.test(pathname);
}

export function isPagePath(pathname: string): boolean {
    return PAGE_PATHS.some((path) => pathname === path || (path !== '/' && pathname === `${path}/`));
}
