import { loadWasmSingleton } from '../wasm.js';

const DOWNLOADS_CACHE_FILE = 'downloads/available_downloads.json';

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

async function getDownloadInfo(appId: string, platform: string): Promise<PlatformConfig | null> {
    try {
        const wasmModule = await loadWasmSingleton('Admin');
        const exists = await wasmModule.admin_file_exists(DOWNLOADS_CACHE_FILE);

        if (!exists) {
            return null;
        }

        const cacheData = await wasmModule.admin_read_file(DOWNLOADS_CACHE_FILE);
        const parsedCache = JSON.parse(cacheData);

        if (!Array.isArray(parsedCache.downloads)) {
            return null;
        }

        // Find the app and platform in the cached data
        const app = parsedCache.downloads.find((app: AppDownload) =>
            app.name.toLowerCase() === appId.toLowerCase()
        );

        if (!app || !app.platforms || !app.platforms[platform]) {
            console.error(`Download info not found for ${appId} on ${platform}`);
            return null;
        }

        return app.platforms[platform];
    } catch (error) {
        console.error('Error getting download info:', error);
        return null;
    }
}

async function fetchLatestReleaseAsset(repo: string, assetPattern: string): Promise<string | null> {
    try {
        // GitHub API URL for the latest release
        const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;

        // GitHub API requires a User-Agent header
        const response = await fetch(apiUrl, {
            headers: {
                'User-Agent': 'Subconverter-RS-ProxyDownloader/1.0',
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const release = await response.json();

        // Find the matching asset
        const regex = new RegExp(assetPattern);
        const asset = release.assets.find((asset: any) => regex.test(asset.name));

        if (!asset) {
            return null;
        }

        return asset.browser_download_url;
    } catch (error) {
        console.error('Error fetching latest release:', error);
        return null;
    }
}

export async function GET(
    request: Request,
    { params }: any
) {
    try {
        const { appId, platform } = (await params) as { appId: string; platform: string };

        if (!appId || !platform) {
            return Response.json(
                { error: 'App ID and platform are required' },
                { status: 400 }
            );
        }

        // Get download configuration for the requested app and platform
        const downloadInfo = await getDownloadInfo(decodeURIComponent(appId), decodeURIComponent(platform));

        if (!downloadInfo) {
            return Response.json(
                { error: 'Download not found for the specified app and platform' },
                { status: 404 }
            );
        }

        // Try to get the latest release asset URL
        let downloadUrl = await fetchLatestReleaseAsset(
            downloadInfo.repo,
            downloadInfo.asset_pattern
        );

        // If we couldn't get a URL from the GitHub API, use the fallback URL
        if (!downloadUrl) {
            downloadUrl = downloadInfo.fallback_url;
        }

        // Instead of redirecting, we'll proxy the request
        const fileResponse = await fetch(downloadUrl, {
            headers: {
                'User-Agent': 'Subconverter-RS-ProxyDownloader/1.0',
            },
        });

        if (!fileResponse.ok) {
            return Response.json(
                { error: `Failed to download file: ${fileResponse.statusText}` },
                { status: fileResponse.status }
            );
        }

        // Get the filename from the download URL
        const urlParts = downloadUrl.split('/');
        const filename = urlParts[urlParts.length - 1];

        // Create a friendlier sanitized filename using app name and platform
        const sanitizedAppName = decodeURIComponent(appId).replace(/[^a-zA-Z0-9-_.]/g, '_');
        const sanitizedPlatform = decodeURIComponent(platform).replace(/[^a-zA-Z0-9-_.]/g, '_');

        // Extract file extension from original filename
        const fileExt = filename.includes('.') ? filename.split('.').pop() : '';
        const friendlyFilename = `${sanitizedAppName}_${sanitizedPlatform}${fileExt ? '.' + fileExt : ''}`;

        // Get content type and length from the response
        const contentType = fileResponse.headers.get('content-type') || 'application/octet-stream';
        const contentLength = fileResponse.headers.get('content-length');

        // Create a new response with the streamed body
        const response = new Response(fileResponse.body, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename="${friendlyFilename}"; filename*=UTF-8''${encodeURIComponent(friendlyFilename)}`,
            }
        });

        // Add content-length if available
        if (contentLength) {
            response.headers.set('Content-Length', contentLength);
        }

        // Copy any other useful headers
        const headersToCopy = [
            'etag',
            'last-modified',
            'cache-control'
        ];

        for (const header of headersToCopy) {
            const value = fileResponse.headers.get(header);
            if (value) {
                response.headers.set(header, value);
            }
        }

        return response;
    } catch (error) {
        console.error('Error processing download request:', error);
        return Response.json(
            { error: 'Failed to process download request' },
            { status: 500 }
        );
    }
} 