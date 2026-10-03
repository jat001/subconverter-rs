import { loadWasmSingleton } from '../wasm.js';

/**
 * Initialize subconverter settings
 * This endpoint allows initializing the subconverter settings with a custom preference path
 */
export async function POST(request: Request) {
    let wasmModule;
    try {
        wasmModule = await loadWasmSingleton('SubAPI');
    } catch (error) {
        console.error("Failed to load WASM module:", error);
        return Response.json(
            {
                error: 'Failed to load WASM module',
                details: error instanceof Error ? error.message : String(error)
            },
            { status: 500 }
        );
    }

    try {
        // Parse request body as JSON
        const requestData = await request.json();
        const prefPath = requestData.pref_path || '';

        // Call the WASM function to initialize settings
        await wasmModule.init_settings_wasm(prefPath);

        return Response.json({ success: true }, { status: 200 });
    } catch (error: any) {
        console.error(`Error initializing settings:`, error);
        const errorMessage = typeof error === 'string' ? error : (error.message || 'Unknown WASM error');

        return Response.json(
            { error: 'Failed to initialize settings', details: errorMessage },
            { status: 500 }
        );
    }
} 