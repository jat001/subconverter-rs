/**
 * Browser side of the admin API authentication (see admin-auth.ts for the server side).
 *
 * The token is kept in localStorage and sent as `Authorization: Bearer <token>` by adminFetch().
 * When the server rejects a request, adminFetch() asks for a token through requestAdminToken(),
 * which <AdminTokenDialog /> renders; concurrent requests share one prompt.
 */

const STORAGE_KEY = 'subconverterAdminToken';

export function getAdminToken(): string | null {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

function setAdminToken(token: string | null): void {
    try {
        if (token) {
            localStorage.setItem(STORAGE_KEY, token);
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    } catch {
        // Storage unavailable (private mode, blocked site data): the token lasts for this request only
    }
}

export interface AdminTokenRequest {
    /** A stored token was rejected, as opposed to no token having been entered yet */
    invalid: boolean;
}

let pending: { request: AdminTokenRequest; promise: Promise<string | null>; resolve: (token: string | null) => void } | null = null;
const listeners = new Set<() => void>();

function notify(): void {
    listeners.forEach((listener) => listener());
}

export function subscribeAdminTokenRequest(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getAdminTokenRequest(): AdminTokenRequest | null {
    return pending?.request ?? null;
}

function requestAdminToken(invalid: boolean): Promise<string | null> {
    if (!pending) {
        let resolve!: (token: string | null) => void;
        const promise = new Promise<string | null>((r) => {
            resolve = r;
        });
        pending = { request: { invalid }, promise, resolve };
        notify();
    }
    return pending.promise;
}

/** Called by the dialog with the entered token, or null when the user cancels */
export function resolveAdminTokenRequest(token: string | null): void {
    const current = pending;
    if (!current) return;
    pending = null;
    if (token) setAdminToken(token);
    current.resolve(token);
    notify();
}

/**
 * fetch() for /api/admin endpoints: attaches the stored token and, on 401, prompts for a new one and
 * retries. If the user cancels, the 401 response is returned for the caller to handle as an error.
 */
export async function adminFetch(input: string, init: RequestInit = {}): Promise<Response> {
    for (;;) {
        const token = getAdminToken();
        const headers = new Headers(init.headers);
        if (token) headers.set('Authorization', `Bearer ${token}`);

        const response = await fetch(input, { ...init, headers });
        if (response.status !== 401) return response;

        if (token) setAdminToken(null);
        const entered = await requestAdminToken(token !== null);
        if (!entered) return response;
    }
}
