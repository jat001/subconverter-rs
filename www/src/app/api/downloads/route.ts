import { NextRequest, NextResponse } from 'next/server';
import { loadWasmSingleton } from '@/lib/wasm';

const DOWNLOADS_CACHE_FILE = 'downloads/available_downloads.json';
const DOWNLOADS_CACHE_TTL = 3600 * 24; // 24 hours in seconds

// Define types for the downloads data
interface PlatformConfig {
    repo: string;
    asset_pattern: string;
    fallback_url: string;
}

interface AppDownload {
    name: string;
    description: string;
    platforms: Record<string, PlatformConfig>;
}

// Default recommended downloads if none found in cache
const DEFAULT_DOWNLOADS: AppDownload[] = [
    {
        name: 'Clash Verge',
        description: 'A modern GUI client based on Tauri for Windows and macOS',
        platforms: {
            windows: {
                repo: 'clash-verge-rev/clash-verge-rev',
                asset_pattern: '.*_x64-setup\\.exe$',
                fallback_url: 'https://github.com/clash-verge-rev/clash-verge-rev/releases/download/v2.2.3/Clash.Verge_2.2.3_x64-setup.exe'
            },
            macos: {
                repo: 'clash-verge-rev/clash-verge-rev',
                asset_pattern: '.*_aarch64\\.dmg$',
                fallback_url: 'https://github.com/clash-verge-rev/clash-verge-rev/releases/download/v2.2.3/Clash.Verge_2.2.3_aarch64.dmg'
            },
            linux: {
                repo: 'clash-verge-rev/clash-verge-rev',
                asset_pattern: '.*_amd64\\.deb$',
                fallback_url: 'https://github.com/clash-verge-rev/clash-verge-rev/releases/download/v2.2.3/Clash.Verge_2.2.3_arm64.deb'
            }
        }
    },
    {
        name: 'Clash Meta for Android',
        description: 'A rule-based tunnel for Android based on Clash Meta',
        platforms: {
            android: {
                repo: 'MetaCubeX/ClashMetaForAndroid',
                asset_pattern: '.*-universal-release\\.apk$',
                fallback_url: 'https://github.com/MetaCubeX/ClashMetaForAndroid/releases/latest/download/cmfa-2.11.8-meta-universal-release.apk'
            }
        }
    }
];

async function loadDownloadsCacheFromVFS() {
    try {
        const wasmModule = await loadWasmSingleton('Admin');
        const exists = await wasmModule.admin_file_exists(DOWNLOADS_CACHE_FILE);

        if (exists) {
            const cacheData = await wasmModule.admin_read_file(DOWNLOADS_CACHE_FILE);
            const parsedCache = JSON.parse(cacheData);

            // Check if cache is still valid
            if (parsedCache.timestamp &&
                (Date.now() / 1000 - parsedCache.timestamp) < DOWNLOADS_CACHE_TTL &&
                Array.isArray(parsedCache.downloads) &&
                parsedCache.downloads.length > 0) {
                return parsedCache.downloads;
            }
        }

        // If we got here, we need to update the cache
        return await updateDownloadsCache();
    } catch (error) {
        console.error('Error loading downloads cache:', error);
        return DEFAULT_DOWNLOADS; // Fallback to default downloads
    }
}

async function updateDownloadsCache() {
    try {
        const wasmModule = await loadWasmSingleton('Admin');

        // Ensure the downloads directory exists
        try {
            const dirExists = await wasmModule.admin_file_exists('downloads');
            if (!dirExists) {
                await wasmModule.admin_create_directory('downloads');
            }
        } catch (err) {
            console.error('Error creating downloads directory:', err);
        }

        // Store default downloads with current timestamp
        const cacheData = {
            timestamp: Math.floor(Date.now() / 1000),
            downloads: DEFAULT_DOWNLOADS
        };

        await wasmModule.admin_write_file(
            DOWNLOADS_CACHE_FILE,
            JSON.stringify(cacheData, null, 2)
        );

        return DEFAULT_DOWNLOADS;
    } catch (error) {
        console.error('Error updating downloads cache:', error);
        return DEFAULT_DOWNLOADS; // Fallback to default downloads
    }
}

export async function GET(_request: NextRequest) {
    try {
        const downloads = await loadDownloadsCacheFromVFS();

        // Transform the downloads data into a client-friendly format
        const clientDownloads = downloads.flatMap((app: AppDownload) => {
            return Object.keys(app.platforms).map((platform) => {
                return {
                    name: app.name,
                    version: 'latest', // Could be improved by fetching actual latest version
                    platform: platform,
                    size: 0, // Size would need to be fetched from GitHub API
                    download_url: `/api/downloads/${encodeURIComponent(app.name)}/${encodeURIComponent(platform)}`,
                    release_date: new Date().toISOString().split('T')[0], // Placeholder
                    description: app.description
                };
            });
        });

        // Reflect admin changes to the download list immediately (vinext sets no Cache-Control on
        // handlers that do not read the request, and Workers Cache would store the response)
        return NextResponse.json(clientDownloads, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        console.error('Error fetching downloads:', error);
        return NextResponse.json(
            { error: 'Failed to fetch available downloads' },
            { status: 500 }
        );
    }
}

export async function POST(_request: NextRequest) {
    try {
        // This endpoint is for admin use only to force update the downloads cache
        // In a production app, you would add authentication here

        await updateDownloadsCache();
        return NextResponse.json({
            success: true,
            message: 'Downloads cache updated successfully'
        });
    } catch (error) {
        console.error('Error updating downloads cache:', error);
        return NextResponse.json(
            { error: 'Failed to update downloads cache' },
            { status: 500 }
        );
    }
} 