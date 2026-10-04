import { checkAdminAuth } from '../admin-auth.js';

import { loadWasmSingleton } from '../wasm.js';

// Define interface for the wasm module with additional properties
interface WasmModule {
    admin_update_rules?: (config_path?: string) => Promise<string>;
    [key: string]: any;
}

export async function POST(request: Request) {
    const denied = await checkAdminAuth(request);
    if (denied) return denied;

    try {
        // Load the WASM module and get the admin_update_rules function
        const wasm = await loadWasmSingleton('Admin') as unknown as WasmModule;

        // Check if the function exists
        if (typeof wasm.admin_update_rules !== 'function') {
            console.error('admin_update_rules function not found in WASM module');
            return Response.json(
                {
                    success: false,
                    message: 'Required WASM function not available',
                },
                {
                    status: 500,
                    headers: {
                        'Cache-Control': 'no-store'
                    }
                }
            );
        }

        const body = await request.json();
        const config_path = body.config_path;

        // Call the Rust WASM function to update rules
        const result = await wasm.admin_update_rules(config_path);

        // Parse the JSON result from the Rust function
        const resultData = JSON.parse(result);

        // Return the response with appropriate status code
        const statusCode = resultData.success ? 200 : 207; // 207 for partial content/success

        return Response.json(resultData, {
            status: statusCode,
            headers: {
                'Cache-Control': 'no-store'
            }
        });
    } catch (error) {
        console.error('Error updating rules:', error);
        return Response.json(
            {
                success: false,
                message: 'Error updating rules',
                error: error instanceof Error ? error.message : String(error)
            },
            {
                status: 500,
                headers: {
                    'Cache-Control': 'no-store'
                }
            }
        );
    }
}

export async function GET(request: Request) {
    const denied = await checkAdminAuth(request);
    if (denied) return denied;

    return Response.json(
        {
            message: 'Rules update endpoint is available',
            usage: 'Send a POST request with an optional config_path parameter'
        },
        {
            status: 200,
            headers: {
                'Cache-Control': 'no-store'
            }
        }
    );
} 