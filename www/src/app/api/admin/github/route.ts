import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/admin-auth';
import { loadWasmSingleton } from '@/lib/wasm';

// Add a type definition for the WASM module
interface AdminWasmModule {
    admin_load_github_directory: (path: string, shallow: boolean) => Promise<any>;
    admin_load_github_directory_flat?: (path: string, shallow: boolean) => Promise<any>;
    // Add other methods as needed
}

/**
 * Handle GitHub content loading requests
 */
export async function POST(request: NextRequest) {
    const denied = await checkAdminAuth(request);
    if (denied) return denied;

    let wasmModule: AdminWasmModule;
    try {
        wasmModule = await loadWasmSingleton('Admin') as AdminWasmModule;
    } catch (error) {
        console.error("Failed to load WASM module:", error);
        return NextResponse.json(
            {
                error: 'Failed to load WASM module',
                details: error instanceof Error ? error.message : String(error)
            },
            { status: 500 }
        );
    }

    try {
        // Parse request body
        const body = await request.json();
        const { path, shallow = true, recursive = true } = body;

        if (!path) {
            return NextResponse.json({ error: 'Path parameter is required' }, { status: 400 });
        }

        console.log(`Admin API request: POST /api/admin/github, loading path: ${path}, shallow: ${shallow}, recursive: ${recursive}`);

        // Call the appropriate WASM function based on recursive flag
        let result;
        if (recursive) {
            result = await wasmModule.admin_load_github_directory(path, !!shallow);
        } else if ('admin_load_github_directory_flat' in wasmModule) {
            result = await wasmModule.admin_load_github_directory_flat!(path, !!shallow);
        } else {
            // Fallback if flat function is not available
            console.log('admin_load_github_directory_flat not available, using recursive mode');
            result = await wasmModule.admin_load_github_directory(path, !!shallow);
        }

        return NextResponse.json({
            success: true,
            path,
            result
        });
    } catch (error: any) {
        console.error(`Error loading from GitHub:`, error);
        const errorMessage = typeof error === 'string' ? error : (error.message || 'Unknown WASM error');

        return NextResponse.json(
            { error: 'Failed to load content from GitHub', details: errorMessage },
            { status: 500 }
        );
    }
}

/**
 * Support GET for convenience, using query parameters
 */
export async function GET(request: NextRequest) {
    const denied = await checkAdminAuth(request);
    if (denied) return denied;

    let wasmModule: AdminWasmModule;
    try {
        wasmModule = await loadWasmSingleton('Admin-GitHubAPI') as AdminWasmModule;
    } catch (error) {
        console.error("Failed to load WASM module:", error);
        return NextResponse.json(
            {
                error: 'Failed to load WASM module',
                details: error instanceof Error ? error.message : String(error)
            },
            { status: 500 }
        );
    }

    // Get parameters from search params
    const path = request.nextUrl.searchParams.get('path');
    const shallow = request.nextUrl.searchParams.get('shallow') !== 'false'; // Default to true
    const recursive = request.nextUrl.searchParams.get('recursive') !== 'false'; // Default to true

    if (!path) {
        return NextResponse.json({ error: 'Path parameter is required' }, { status: 400 });
    }

    console.log(`Admin API request: GET /api/admin/github?path=${path}&shallow=${shallow}&recursive=${recursive}`);

    try {
        // Call the appropriate WASM function based on recursive flag
        let result;
        if (recursive) {
            result = await wasmModule.admin_load_github_directory(path, shallow);
        } else if ('admin_load_github_directory_flat' in wasmModule) {
            result = await wasmModule.admin_load_github_directory_flat!(path, shallow);
        } else {
            // Fallback if flat function is not available
            console.log('admin_load_github_directory_flat not available, using recursive mode');
            result = await wasmModule.admin_load_github_directory(path, shallow);
        }

        return NextResponse.json({
            success: true,
            path,
            result
        });
    } catch (error: any) {
        console.error(`Error loading from GitHub:`, error);
        const errorMessage = typeof error === 'string' ? error : (error.message || 'Unknown WASM error');

        return NextResponse.json(
            { error: 'Failed to load content from GitHub', details: errorMessage },
            { status: 500 }
        );
    }
} 