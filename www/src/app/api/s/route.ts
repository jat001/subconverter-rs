import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/admin-auth';
import { loadWasmSingleton } from '@/lib/wasm';

/**
 * Handle short URL creation requests
 */
export async function POST(request: NextRequest) {
    const denied = await checkAdminAuth(request);
    if (denied) return denied;

    try {
        // Load the WASM module
        const wasmModule = await loadWasmSingleton('ShortURL');

        // Get the request URL for generating the full short URL
        const requestUrl = request.url;

        // Parse the request body
        const body = await request.text();

        // Call the WASM function to create a short URL
        const response = await wasmModule.short_url_create(body, requestUrl);

        // Parse the response
        const data = JSON.parse(response);

        return NextResponse.json(data, { status: 201 });
    } catch (error: any) {
        console.error(`Error creating short URL:`, error);
        const errorMessage = typeof error === 'string' ? error : (error.message || 'Unknown error');

        return NextResponse.json(
            { error: 'Failed to create short URL', details: errorMessage },
            { status: 500 }
        );
    }
}

/**
 * Handle listing all short URLs
 */
export async function GET(request: NextRequest) {
    const denied = await checkAdminAuth(request);
    if (denied) return denied;

    try {
        // Load the WASM module
        const wasmModule = await loadWasmSingleton('ShortURL');

        // Call the WASM function to list all short URLs
        const response = await wasmModule.short_url_list();

        // Parse the response
        const data = JSON.parse(response);

        // Add full URLs with the base URL from the request
        const baseUrl = new URL(request.url).origin;
        data.urls = data.urls.map((url: any) => ({
            ...url,
            short_url: `${baseUrl}${url.short_url}`
        }));

        return NextResponse.json(data);
    } catch (error: any) {
        console.error(`Error listing short URLs:`, error);
        const errorMessage = typeof error === 'string' ? error : (error.message || 'Unknown error');

        return NextResponse.json(
            { error: 'Failed to list short URLs', details: errorMessage },
            { status: 500 }
        );
    }
} 