import { NextRequest, NextResponse } from 'next/server';

/**
 * Authentication for the admin API (/api/admin/*).
 *
 * Requests must send `Authorization: Bearer <token>` matching the ADMIN_TOKEN environment variable
 * (a Worker secret on Cloudflare, read through process.env there too). When ADMIN_TOKEN is not set
 * the admin API is disabled instead of being left open.
 */

const encoder = new TextEncoder();

async function sha256(value: string): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

// Compare fixed-length digests so the time taken does not reveal where the tokens differ
async function tokensEqual(a: string, b: string): Promise<boolean> {
    const [x, y] = await Promise.all([sha256(a), sha256(b)]);
    let diff = 0;
    for (let i = 0; i < x.length; i++) {
        diff |= x[i] ^ y[i];
    }
    return diff === 0;
}

/**
 * Returns an error response when the request is not authorized for the admin API, or null when it is.
 * Call it first thing in every /api/admin route handler.
 */
export async function checkAdminAuth(request: NextRequest): Promise<NextResponse | null> {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected) {
        return NextResponse.json(
            { error: 'Admin API is disabled: set the ADMIN_TOKEN environment variable to enable it' },
            { status: 503 }
        );
    }

    const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '');
    if (!match || !(await tokensEqual(match[1], expected))) {
        return NextResponse.json(
            { error: 'Invalid or missing admin token' },
            { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }
        );
    }

    return null;
}
