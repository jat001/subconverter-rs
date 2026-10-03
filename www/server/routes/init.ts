import { loadWasmSingleton } from '../wasm.js'; // Assuming a similar loader utility exists

/**
 * API route to initialize the Subconverter Webapp VFS.
 * This might trigger a one-time load from GitHub on initial deployment.
 */
export async function GET() {
    const wasmModule = await loadWasmSingleton('Init');

    console.log('API request: GET /api/init');

    try {
        console.log('Calling initialize_subconverter_webapp...');
        const initialized = await wasmModule.initialize_subconverter_webapp();
        console.log(`Initialization result: ${initialized}`);

        // This GET has side effects, so it must never be answered from a cache
        return Response.json({
            success: true,
            githubLoadTriggered: initialized, // Return whether the load was triggered
            message: initialized
                ? 'VFS initialized, GitHub load was triggered.'
                : 'VFS already initialized or GitHub load not needed.',
        }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error: any) {
        console.error('Error initializing VFS:', error);
        const errorMessage = typeof error === 'string' ? error : (error.message || 'Unknown WASM error');

        // Try to parse Rust error details if available
        let details = errorMessage;
        try {
            const errObj = JSON.parse(errorMessage); // Rust side sends JSON string in JsValue::from_str
            if (errObj && errObj.message) {
                details = `[${errObj.type}] ${errObj.message}`;
            }
        } catch {
            // Ignore parsing errors, use original message
        }

        return Response.json(
            {
                success: false,
                error: 'Failed to initialize VFS',
                details: details,
            },
            { status: 500 }
        );
    }
}
