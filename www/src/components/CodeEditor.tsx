"use client";

import React, { useState, useEffect, useRef } from 'react';
import { FileAttributes } from '@jat/subconverter-wasm';
import * as apiClient from '@/lib/api-client';
import Editor, { Monaco } from '@monaco-editor/react';
import { editor } from 'monaco-editor';

interface CodeEditorProps {
    filePath?: string | null;
    language?: string;
    theme?: string;
    value?: string;
    readOnly?: boolean;
    options?: editor.IStandaloneEditorConstructionOptions;
    onChange?: (value: string | undefined) => void;
    onSave?: (filePath: string, content: string) => void;
}

// Detect the editor language from a file extension
function detectLanguage(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase();

    switch (extension) {
        case 'js':
        case 'jsx':
            return 'javascript';
        case 'ts':
        case 'tsx':
            return 'typescript';
        case 'json':
            return 'json';
        case 'yml':
        case 'yaml':
            return 'yaml';
        case 'rs':
            return 'rust';
        case 'md':
            return 'markdown';
        case 'html':
            return 'html';
        case 'css':
            return 'css';
        case 'ini':
            return 'ini';
        case 'sh':
        case 'bash':
            return 'shell';
        default:
            return 'plaintext';
    }
}

export default function CodeEditor({
    filePath,
    language,
    theme = 'vs-dark',
    value,
    readOnly = false,
    options,
    onChange,
    onSave
}: CodeEditorProps) {
    const isControlled = value !== undefined;

    const [internalContent, setInternalContent] = useState<string>('');
    const [loading, setLoading] = useState(!isControlled && !!filePath);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fileAttributes, setFileAttributes] = useState<FileAttributes | null>(null);
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

    const displayContent = isControlled ? value : internalContent;

    // Use the language prop, else detect it from the file extension
    const editorLanguage = language || (filePath ? detectLanguage(filePath) : 'plaintext');

    // Reset per-file state while rendering when the content source changes, so stale
    // attributes or errors never render for the new source
    // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
    const [prevSource, setPrevSource] = useState({ filePath, isControlled });
    if (filePath !== prevSource.filePath || isControlled !== prevSource.isControlled) {
        setPrevSource({ filePath, isControlled });
        setFileAttributes(null);
        setError(null);
        if (!isControlled) {
            if (filePath) setLoading(true); // The effect below loads the new file
            else setInternalContent(''); // Clear internal if no path
        }
    }

    // Load file content only if not controlled and filePath changes
    useEffect(() => {
        if (isControlled || !filePath) return;

        const loadFile = async () => {
            try {
                // Get file content
                const fileContent = await apiClient.readFile(filePath);
                setInternalContent(fileContent || '');

                // Get file attributes if available
                try {
                    const attributes = await apiClient.getFileAttributes(filePath);
                    setFileAttributes(attributes);
                } catch (attrError) {
                    console.warn('Could not load file attributes:', attrError);
                } // Non-critical error
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load file');
                console.error('Error loading file:', err);
                setInternalContent('# Error loading file');
            } finally {
                setLoading(false);
            }
        };

        loadFile();
    }, [filePath, isControlled]); // Rerun if filePath changes or becomes controlled/uncontrolled

    // Handle editor mount
    function handleEditorDidMount(editor: editor.IStandaloneCodeEditor, monaco: Monaco) {
        editorRef.current = editor;

        // Add keyboard shortcut for saving (Ctrl+S) only if not readOnly and filePath exists
        if (!readOnly && filePath) {
            editor.addCommand(
                monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
                () => handleSave()
            );
        }
    }

    // Save file content
    const handleSave = async () => {
        if (!filePath || readOnly || isControlled) return; // Don't save if no path, readOnly, or controlled

        setSaving(true);
        setError(null);
        try {
            const contentToSave = internalContent; // In uncontrolled mode, internal state is the source
            await apiClient.writeFile(filePath, contentToSave);

            // Refresh file attributes after save
            try {
                const attributes = await apiClient.getFileAttributes(filePath);
                setFileAttributes(attributes);
            } catch (attrError) {
                console.warn('Could not refresh file attributes:', attrError);
            }

            if (onSave) onSave(filePath, contentToSave);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save file');
            console.error('Error saving file:', err);
        } finally {
            setSaving(false);
        }
    };

    // Handle content change
    const handleEditorChange = (newValue: string | undefined) => {
        const currentVal = newValue || '';
        if (!isControlled) {
            setInternalContent(currentVal); // Update internal state if uncontrolled
        }
        if (onChange) {
            onChange(currentVal); // Always call onChange for parent component
        }
    };

    const finalOptions: editor.IStandaloneEditorConstructionOptions = {
        minimap: { enabled: true },
        fontSize: 14,
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        lineNumbers: 'on',
        readOnly: readOnly, // Set readOnly status
        ...options, // Merge with any additional options passed in
    };

    const showSaveButton = filePath && !readOnly && !isControlled;
    const showFileInfo = fileAttributes && !readOnly; // Show file info only if not readOnly

    return (
        <div className="h-full flex flex-col">
            {/* Header with file info and save button */}
            <div className="flex justify-between items-center p-2 border-b border-gray-700">
                <div className="flex items-center space-x-2 overflow-hidden">
                    <h3 className="text-sm font-semibold truncate text-gray-200">
                        {filePath || 'Unsaved Content'} {readOnly ? '(Read-only)' : ''}
                    </h3>
                    {showFileInfo && (
                        <div className="text-xs bg-gray-700 text-gray-200 px-2 py-0.5 rounded">
                            {apiClient.formatFileSize(fileAttributes.size)}
                        </div>
                    )}
                </div>
                {showSaveButton && (
                    <button
                        className={`px-3 py-1 rounded text-sm ${saving || loading
                            ? 'bg-gray-600 text-gray-300 cursor-not-allowed'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                            }`}
                        onClick={handleSave}
                        disabled={saving || loading}
                    >
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                )}
            </div>

            {/* Editor area */}
            <div className="flex-grow relative">
                {(loading && !isControlled) ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="flex flex-col items-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mb-2"></div>
                            <div className="text-gray-300">Loading...</div>
                        </div>
                    </div>
                ) : error ? (
                    <div className="absolute inset-0 flex items-center justify-center text-red-400 p-4 text-center bg-gray-800">
                        {error}
                    </div>
                ) : (!filePath && !isControlled) ? (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-300 p-4 text-center">
                        Select a file or provide content
                    </div>
                ) : (
                    <Editor
                        height="100%"
                        language={editorLanguage}
                        theme={theme}
                        value={displayContent}
                        onChange={handleEditorChange}
                        onMount={handleEditorDidMount}
                        options={finalOptions}
                    />
                )}
            </div>

            {/* File info footer */}
            {showFileInfo && (
                <div className="border-t border-gray-700 px-2 py-1 text-xs text-gray-300 flex justify-between">
                    <div>Type: {fileAttributes.file_type || 'Unknown'}</div>
                    <div>
                        Modified: {apiClient.formatTimestamp(Number(fileAttributes.modified_at))}
                    </div>
                </div>
            )}
        </div>
    );
} 