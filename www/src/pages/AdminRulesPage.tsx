import React, { useState } from 'react';
import { updateRules, RulesUpdateResult } from '@/lib/api-client';

export default function RulesAdmin() {
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<RulesUpdateResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleUpdateRules = async () => {
        setIsLoading(true);
        setResult(null);
        setError(null);

        try {
            const data = await updateRules();
            setResult(data);
        } catch (err) {
            console.error("Rules update failed:", err);
            setError(`Error: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="container mx-auto p-4 max-w-4xl">
            <h1 className="text-2xl font-bold mb-6">Rules Management</h1>

            <div className="bg-white p-6 rounded-lg shadow-md mb-6">
                <h2 className="text-xl font-semibold mb-4">Update Rules</h2>
                <p className="mb-4 text-gray-600">
                    Update rules files from configured repositories. This process may take a few minutes.
                </p>

                <button
                    onClick={handleUpdateRules}
                    disabled={isLoading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                    {isLoading ? 'Updating...' : 'Update Rules'}
                </button>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-md mb-6">
                    <h3 className="font-semibold mb-2">Error</h3>
                    <p>{error}</p>
                </div>
            )}

            {result && (
                <div className="bg-white p-6 rounded-lg shadow-md">
                    <h3 className="font-semibold mb-2">Result</h3>
                    <div className="mb-4">
                        <span className={`inline-block px-2 py-1 rounded-full text-sm ${result.success ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                            {result.success ? 'Success' : 'Partial Success/Failure'}
                        </span>
                        <p className="mt-2">{result.message}</p>
                    </div>

                    <div className="border-t pt-4">
                        <h4 className="font-medium mb-2">Repository Details</h4>
                        <div className="space-y-4">
                            {result.details && Object.entries(result.details).map(([repo, details]: [string, any]) => (
                                <div key={repo} className="border rounded-md p-4">
                                    <div className="flex justify-between items-center mb-2">
                                        <h5 className="font-medium">{repo}</h5>
                                        <span className={`px-2 py-1 rounded-full text-xs ${details.status === 'success' ? 'bg-green-100 text-green-800' :
                                            details.status === 'partial' ? 'bg-yellow-100 text-yellow-800' :
                                                'bg-red-100 text-red-800'
                                            }`}>
                                            {details.status}
                                        </span>
                                    </div>

                                    {details.files_updated.length > 0 && (
                                        <div className="mb-2">
                                            <h6 className="text-sm font-medium text-gray-700">Files Updated ({details.files_updated.length})</h6>
                                            <ul className="text-xs text-gray-600 pl-4 mt-1 max-h-32 overflow-y-auto">
                                                {details.files_updated.slice(0, 10).map((file: string) => (
                                                    <li key={file} className="truncate">{file}</li>
                                                ))}
                                                {details.files_updated.length > 10 && (
                                                    <li className="text-gray-500">...and {details.files_updated.length - 10} more</li>
                                                )}
                                            </ul>
                                        </div>
                                    )}

                                    {details.errors.length > 0 && (
                                        <div>
                                            <h6 className="text-sm font-medium text-red-700">Errors ({details.errors.length})</h6>
                                            <ul className="text-xs text-red-600 pl-4 mt-1 max-h-32 overflow-y-auto">
                                                {details.errors.slice(0, 5).map((error: string, i: number) => (
                                                    <li key={i} className="truncate">{error}</li>
                                                ))}
                                                {details.errors.length > 5 && (
                                                    <li className="text-gray-500">...and {details.errors.length - 5} more</li>
                                                )}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
} 