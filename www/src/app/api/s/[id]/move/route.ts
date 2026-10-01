import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/admin-auth';
import { loadWasmSingleton } from '@/lib/wasm';

type RouteParams = any;

/**
 * Handle short URL move requests
 */
export async function POST(
    request: NextRequest,
    context: RouteParams
) {
    const denied = await checkAdminAuth(request);
    if (denied) return denied;

    // Get the source short URL ID from the route parameter
    const { id } = await context.params;

    if (!id) {
        return NextResponse.json(
            { error: 'Missing source short URL ID' },
            { status: 400 }
        );
    }

    console.log(`Short URL move request: POST /api/s/${id}/move`);

    try {
        // Load the WASM module
        const wasmModule = await loadWasmSingleton('ShortURL');

        // Parse the request body
        const body = await request.json();

        // Validate new_id in the request body
        if (!body.new_id) {
            return NextResponse.json(
                { error: 'Missing new_id in request body' },
                { status: 400 }
            );
        }

        // Get the full request URL for generating proper short URL paths
        const requestUrl = request.url;

        // Call the WASM function to move the short URL
        const response = await wasmModule.short_url_move(id, body.new_id, requestUrl);

        // Parse the response
        const data = JSON.parse(response);

        return NextResponse.json(data);
    } catch (error: any) {
        console.error(`Error moving short URL:`, error);
        const errorMessage = typeof error === 'string' ? error : (error.message || 'Unknown error');

        return NextResponse.json(
            { error: 'Failed to move short URL', details: errorMessage },
            { status: 500 }
        );
    }
} 