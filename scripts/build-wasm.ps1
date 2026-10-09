#!/usr/bin/env pwsh
#Requires -Version 5.1
param(
    [switch]$Release,
    [switch]$Optimize,
    [switch]$NoWorkers,
    [string]$Version = ""
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-JsonFile {
    param([string]$Path, [string[]]$Lines)
    $fullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    [IO.File]::WriteAllText($fullPath, ($Lines -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
}

function Remove-BuildDirectory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    $root = (Get-Location).Path.TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Build cleanup target is outside the repository: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

# Compare two JSON files semantically (key order and formatting ignored)
function Test-JsonEqual {
    param([string]$PathA, [string]$PathB)
    $a = (jq -S . $PathA) -join "`n"
    $b = (jq -S . $PathB) -join "`n"
    return $a -eq $b
}

# wasm-pack regenerates pkg/package.json on every build. Stash the current one first so it can be kept
# as-is (content and mtime) when the patched result is identical, avoiding needless reinstalls in www.
$PkgJsonBackup = 'target/pkg-package.json.bak'
# Runtime dependencies of the wasm-host bindings (shipped in pkg/snippets/) are declared in wasm-host/package.json
$HostPkgJson = 'wasm-host/package.json'
$PkgJsonFilterFile = 'scripts/pkg-package.jq'

# Compile the TypeScript bindings (wasm-host/src -> wasm-host/dist) that wasm-bindgen embeds
function Build-WasmHost {
    Write-Host "Building wasm-host bindings..."
    pnpm --dir wasm-host install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "pnpm install in wasm-host failed" }
    pnpm --dir wasm-host run build
    if ($LASTEXITCODE -ne 0) { throw "wasm-host build failed" }
}

function Backup-PkgJson {
    if (Test-Path $PkgJsonBackup) { Remove-Item $PkgJsonBackup -Force }
    if (Test-Path 'pkg/package.json') {
        New-Item -ItemType Directory -Path 'target' -Force | Out-Null
        Copy-Item 'pkg/package.json' $PkgJsonBackup
    }
}

# Apply our changes on top of the wasm-pack output, only replacing the previous file when something differs
function Update-PkgJson {
    param([string]$PkgVersion)
    $path = 'pkg/package.json'
    $tmp = "$path.tmp"
    $lines = jq --arg ver $PkgVersion --slurpfile host $HostPkgJson -f $PkgJsonFilterFile $path
    if ($LASTEXITCODE -ne 0) { throw "jq failed to update $path" }
    Write-JsonFile $tmp $lines

    if ((Test-Path $PkgJsonBackup) -and (Test-JsonEqual $PkgJsonBackup $tmp)) {
        Move-Item $PkgJsonBackup $path -Force
        Remove-Item $tmp -Force
        Write-Host "pkg/package.json unchanged, kept existing file"
    }
    else {
        Move-Item $tmp $path -Force
        if (Test-Path $PkgJsonBackup) { Remove-Item $PkgJsonBackup -Force }
        Write-Host "pkg/package.json updated"
    }
    Copy-Item -LiteralPath 'wasm-host/package-readme.md' -Destination 'pkg/README.md' -Force
}

# Cloudflare Workers build, published as `@jat/subconverter-wasm/workers`: the same crate through
# `--target web`, plus the entry in wasm-host/workers/ that instantiates the precompiled module
# (Workers cannot compile WebAssembly from bytes at runtime).
function Build-WorkersPkg {
    param([string]$Mode) # --release or --dev
    Write-Host "Building Cloudflare Workers wasm package ($Mode)..."
    Remove-BuildDirectory 'pkg/workers'
    wasm-pack build $Mode --target web --out-dir pkg/workers --no-pack
    if ($LASTEXITCODE -ne 0) { throw "wasm-pack build for Workers failed" }
    # wasm-pack writes a `*` .gitignore, which would make npm drop the whole directory when publishing
    if (Test-Path 'pkg/workers/.gitignore') { Remove-Item 'pkg/workers/.gitignore' -Force }
    # Merged into pkg/workers/: the entry files, plus snippets/package.json, which marks the copied host
    # bindings (compiled as CommonJS for the nodejs build) as CommonJS inside this "type": "module" package;
    # spec-following bundlers such as esbuild (wrangler) otherwise treat them as ESM and `exports` is undefined
    Copy-Item 'wasm-host/workers/*' 'pkg/workers/' -Recurse -Force
}


Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    foreach ($tool in @('wasm-pack', 'jq', 'pnpm')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is required" }
    }
    $sourceVersion = (Select-String -Path Cargo.toml -Pattern '^version\s*=' | Select-Object -First 1) -replace '.*"([^"]+)".*', '$1'
    if ($Version -and $Version -ne $sourceVersion) {
        throw "Update and commit the source/documentation version before building $Version (source is $sourceVersion)"
    }
    $profile = if ($Release -or $Optimize) { '--release' } else { '--dev' }
    Build-WasmHost
    Backup-PkgJson
    Remove-BuildDirectory 'pkg/snippets'
    wasm-pack build $profile --target nodejs --no-opt
    if ($LASTEXITCODE -ne 0) { throw 'Node WASM build failed' }
    if ($NoWorkers) { Remove-BuildDirectory 'pkg/workers' }
    else { Build-WorkersPkg $profile }
    Update-PkgJson $sourceVersion
    pnpm --dir pkg install
    if ($LASTEXITCODE -ne 0) { throw 'Package dependency install failed' }
    pnpm --dir www install
    if ($LASTEXITCODE -ne 0) { throw 'Web dependency install failed' }
    Write-Host "Local WASM packages built for $sourceVersion"
}
finally { Pop-Location }
