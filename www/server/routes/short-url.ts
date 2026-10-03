import { checkAdminAuth } from '../admin-auth.js';
import { loadWasmSingleton } from '../wasm.js';

type RouteParams = any;

/**
 * Handle short URL redirect requests
 */
export async function GET(
    request: Request,
    context: RouteParams
) {
    // Get the short URL ID from the route parameter
    const { id } = await context.params;

    if (!id) {
        return Response.json(
            { error: 'Missing short URL ID' },
            { status: 400 }
        );
    }

    console.log(`Short URL redirect request: GET /api/s/${id}`);

    try {
        // Load the WASM module
        const wasmModule = await loadWasmSingleton('ShortURL');

        // Call the WASM function to resolve the short URL
        const response = await wasmModule.short_url_resolve(id);

        // Parse the response
        const data = JSON.parse(response);

        if (!data.target_url) {
            return Response.json(
                { error: 'Invalid short URL' },
                { status: 404 }
            );
        }

        // Return a redirect response
        return Response.redirect(data.target_url, 307);
    } catch (error: any) {
        console.error(`Error resolving short URL:`, error);
        const errorMessage = typeof error === 'string' ? error : (error.message || 'Unknown error');

        return Response.json(
            { error: 'Failed to resolve short URL', details: errorMessage },
            { status: 500 }
        );
    }
}

/**
 * Handle short URL deletion
 */
export async function DELETE(
    request: Request,
    context: RouteParams
) {
    const denied = await checkAdminAuth(request);
    if (denied) return denied;

    // Get the short URL ID from the route parameter
    const { id } = await context.params;

    if (!id) {
        return Response.json(
            { error: 'Missing short URL ID' },
            { status: 400 }
        );
    }

    console.log(`Short URL delete request: DELETE /api/s/${id}`);

    try {
        // Load the WASM module
        const wasmModule = await loadWasmSingleton('ShortURL');

        // Call the WASM function to delete the short URL
        const response = await wasmModule.short_url_delete(id);

        // Parse the response
        const data = JSON.parse(response);

        return Response.json(data);
    } catch (error: any) {
        console.error(`Error deleting short URL:`, error);
        const errorMessage = typeof error === 'string' ? error : (error.message || 'Unknown error');

        return Response.json(
            { error: 'Failed to delete short URL', details: errorMessage },
            { status: 500 }
        );
    }
}

/**
 * Handle short URL updates
 */
export async function PUT(
    request: Request,
    context: RouteParams
) {
    const denied = await checkAdminAuth(request);
    if (denied) return denied;

    // Get the short URL ID from the route parameter
    const { id } = await context.params;

    if (!id) {
        return Response.json(
            { error: 'Missing short URL ID' },
            { status: 400 }
        );
    }

    console.log(`Short URL update request: PUT /api/s/${id}`);

    try {
        // Load the WASM module
        const wasmModule = await loadWasmSingleton('ShortURL');

        // Parse the request body
        const body = await request.text();

        // Call the WASM function to update the short URL
        const response = await wasmModule.short_url_update(id, body);

        // Parse the response
        const data = JSON.parse(response);

        return Response.json(data);
    } catch (error: any) {
        console.error(`Error updating short URL:`, error);
        const errorMessage = typeof error === 'string' ? error : (error.message || 'Unknown error');

        return Response.json(
            { error: 'Failed to update short URL', details: errorMessage },
            { status: 500 }
        );
    }
} 