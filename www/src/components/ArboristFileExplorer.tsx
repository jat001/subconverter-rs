import React, { useState, useEffect, useCallback } from 'react';
import type { DirectoryEntry } from '@jat/subconverter-wasm';
import * as apiClient from '@/lib/api-client';

interface ArboristFileExplorerProps {
    onFileSelect: (path: string) => void;
}

// FileButton component for rendering file/directory items
interface FileButtonProps {
    file: DirectoryEntry;
    onDirClick: (path: string) => void;
    onFileClick: (path: string) => void;
}

const FileButton: React.FC<FileButtonProps> = ({ file, onDirClick, onFileClick }) => {
    return (
        <button
            className="flex items-center flex-grow text-left overflow-hidden text-gray-200"
            onClick={() => file.is_directory ? onDirClick(file.path) : onFileClick(file.path)}
        >
            <span className="mr-2 flex items-center">
                {file.is_directory ? (
                    <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path>
                    </svg>
                ) : (
                    <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd"></path>
                    </svg>
                )}
                {file.attributes?.source_type && (
                    <span className="relative -ml-1">
                        {file.attributes.source_type === 'user' && (
                            <svg className="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"></path>
                            </svg>
                        )}
                        {file.attributes.source_type === 'cloud' && (
                            <svg className="w-3 h-3 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M5.5 16a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.977A4.5 4.5 0 1113.5 16h-8z" clipRule="evenodd"></path>
                            </svg>
                        )}
                        {file.attributes.source_type === 'placeholder' && (
                            <svg className="w-3 h-3 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"></path>
                            </svg>
                        )}
                    </span>
                )}
            </span>
            <span className="truncate">{file.name}</span>
        </button>
    );
};

export default function ArboristFileExplorer({ onFileSelect }: ArboristFileExplorerProps) {
    const [currentPath, setCurrentPath] = useState('');
    const [files, setFiles] = useState<DirectoryEntry[]>([]);
    const [loading, setLoading] = useState(true); // The initial load starts on mount
    const [error, setError] = useState<string | null>(null);
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [newItemName, setNewItemName] = useState('');
    const [newItemType, setNewItemType] = useState<'file' | 'folder'>('file');

    // Helper function to format file size
    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    // Fetch directory contents; state is only updated once the request settles
    const fetchDirectory = useCallback(async (path: string) => {
        try {
            const data = await apiClient.listDirectory(path);
            setFiles(data.entries || []);
            setCurrentPath(path);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load directory');
            console.error('Error loading directory:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    // Load directory contents
    const loadDirectory = useCallback((path: string = '') => {
        setLoading(true);
        setError(null);
        return fetchDirectory(path);
    }, [fetchDirectory]);

    // Initial load
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchDirectory only sets state after its request settles
        fetchDirectory('');
    }, [fetchDirectory]);

    // Handle directory click
    const handleDirClick = (dirPath: string) => {
        loadDirectory(dirPath);
    };

    // Handle file click
    const handleFileClick = (filePath: string) => {
        onFileSelect(filePath);
    };

    // Handle create new item dialog
    const handleCreateNewClick = () => {
        setShowCreateDialog(true);
        setNewItemName('');
    };

    // Create new item
    const handleCreateItem = async () => {
        if (!newItemName) return;

        try {
            setLoading(true);
            const newPath = currentPath
                ? `${currentPath}/${newItemName}`
                : newItemName;

            if (newItemType === 'folder') {
                await apiClient.createDirectory(newPath);
            } else {
                await apiClient.writeFile(newPath, '');
            }

            // Refresh the directory
            await loadDirectory(currentPath);
            setShowCreateDialog(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create item');
            console.error('Error creating item:', err);
        } finally {
            setLoading(false);
        }
    };

    // Handle delete item
    const handleDeleteItem = async (path: string) => {
        if (!confirm(`Are you sure you want to delete ${path}?`)) {
            return;
        }

        try {
            setLoading(true);
            await apiClient.deleteFile(path);
            // Refresh the directory
            await loadDirectory(currentPath);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete item');
            console.error('Error deleting item:', err);
        } finally {
            setLoading(false);
        }
    };

    // Load from GitHub
    const handleLoadFromGitHub = async () => {
        const path = prompt('Enter GitHub repository path to load:');
        if (!path) return;

        try {
            setLoading(true);
            const result = await apiClient.loadGitHubDirectory(path);
            // Refresh the directory
            await loadDirectory(currentPath);
            alert(`Successfully loaded ${result.successful_files} files from GitHub`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load from GitHub');
            console.error('Error loading from GitHub:', err);
        } finally {
            setLoading(false);
        }
    };

    // Breadcrumb navigation
    const renderBreadcrumbs = () => {
        return (
            <div className="flex items-center text-xs overflow-x-auto text-gray-300">
                <button
                    className="hover:text-blue-400"
                    onClick={() => loadDirectory('')}
                >
                    root
                </button>
                {currentPath && currentPath.split('/').filter(Boolean).map((segment, index, array) => {
                    const path = array.slice(0, index + 1).join('/');
                    return (
                        <React.Fragment key={index}>
                            <span className="mx-1">/</span>
                            <button
                                className="hover:text-blue-400"
                                onClick={() => loadDirectory(path)}
                            >
                                {segment}
                            </button>
                        </React.Fragment>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col">
            {/* Toolbar */}
            <div className="flex items-center justify-between p-2 border-b border-gray-700">
                <div className="flex space-x-2">
                    <button
                        className="text-sm px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded"
                        onClick={handleCreateNewClick}
                    >
                        New
                    </button>
                    <button
                        className="text-sm px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded"
                        onClick={handleLoadFromGitHub}
                    >
                        Load from GitHub
                    </button>
                </div>
                <button
                    className="text-sm px-2 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded"
                    onClick={() => loadDirectory(currentPath)}
                >
                    Refresh
                </button>
            </div>

            {/* Breadcrumbs */}
            <div className="px-2 py-1 border-b border-gray-700 text-gray-300">
                {renderBreadcrumbs()}
            </div>

            {/* File list */}
            <div className="flex-grow overflow-auto bg-gray-800">
                {loading ? (
                    <div className="p-4 text-center text-gray-300">
                        <div className="inline-block animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-blue-500 mb-1"></div>
                        <div>Loading...</div>
                    </div>
                ) : error ? (
                    <div className="p-4 text-center text-red-400">{error}</div>
                ) : files.length === 0 ? (
                    <div className="p-4 text-center text-gray-400">No files found</div>
                ) : (
                    <ul>
                        {files.map((file) => (
                            <li
                                key={`${file.path}-${file.attributes?.created_at}`}
                                className="flex items-center justify-between px-2 py-1 hover:bg-gray-700 border-b border-gray-700 last:border-b-0"
                            >
                                <FileButton
                                    file={file}
                                    onDirClick={handleDirClick}
                                    onFileClick={handleFileClick}
                                />
                                <div className="flex items-center mr-2 text-xs">
                                    {file.attributes && !file.is_directory && (
                                        <span className="text-gray-400">
                                            {formatFileSize(file.attributes.size)}
                                        </span>
                                    )}
                                </div>
                                <button
                                    className="text-red-500 hover:text-red-700 p-1"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteItem(file.path);
                                    }}
                                >
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"></path>
                                    </svg>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Create new item dialog */}
            {showCreateDialog && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-gray-800 p-4 rounded max-w-sm w-full text-gray-200">
                        <h3 className="text-lg font-semibold mb-4">Create New Item</h3>
                        <div className="mb-4">
                            <label className="block mb-2">Type</label>
                            <div className="flex space-x-4">
                                <label className="flex items-center">
                                    <input
                                        type="radio"
                                        name="itemType"
                                        value="file"
                                        checked={newItemType === 'file'}
                                        onChange={() => setNewItemType('file')}
                                        className="mr-2"
                                    />
                                    File
                                </label>
                                <label className="flex items-center">
                                    <input
                                        type="radio"
                                        name="itemType"
                                        value="folder"
                                        checked={newItemType === 'folder'}
                                        onChange={() => setNewItemType('folder')}
                                        className="mr-2"
                                    />
                                    Folder
                                </label>
                            </div>
                        </div>
                        <div className="mb-4">
                            <label className="block mb-2">Name</label>
                            <input
                                type="text"
                                value={newItemName}
                                onChange={(e) => setNewItemName(e.target.value)}
                                className="w-full p-2 border border-gray-600 rounded bg-gray-700 text-gray-200"
                                placeholder={newItemType === 'file' ? 'example.txt' : 'example-folder'}
                            />
                        </div>
                        <div className="flex justify-end space-x-2">
                            <button
                                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded"
                                onClick={() => setShowCreateDialog(false)}
                            >
                                Cancel
                            </button>
                            <button
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
                                onClick={handleCreateItem}
                            >
                                Create
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
} 