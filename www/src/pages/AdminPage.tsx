import React, { useState } from 'react';
import { Link } from 'react-router';
import ArboristFileExplorer from '@/components/ArboristFileExplorer';
import CodeEditor from '@/components/CodeEditor';

export default function AdminPage() {
    const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);

    const handleFileSelect = (path: string) => {
        setSelectedFilePath(path);
    };

    return (
        <main className="flex min-h-screen flex-col">
            <div className="p-4 bg-gray-900">
                <div className="flex justify-between items-center">
                    <h1 className="text-xl font-bold">Subconverter Admin</h1>
                    <Link
                        to="/"
                        className="text-sm bg-gray-600 hover:bg-gray-700 text-white font-bold py-1 px-3 rounded"
                    >
                        Back to Home
                    </Link>
                </div>
            </div>

            <div className="flex-grow grid grid-cols-1 md:grid-cols-4 gap-4 p-4">
                {/* File explorer */}
                <div className="md:col-span-1 bg-gray-900 rounded overflow-hidden border border-gray-800 shadow">
                    <ArboristFileExplorer onFileSelect={handleFileSelect} />
                </div>

                {/* Code editor */}
                <div className="md:col-span-3 bg-gray-900 rounded overflow-hidden border border-gray-800 shadow">
                    <CodeEditor filePath={selectedFilePath} />
                </div>
            </div>
        </main>
    );
} 