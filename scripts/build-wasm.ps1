#!/usr/bin/env pwsh
#Requires -Version 5.1
param(
    [switch]$Release,
    [switch]$Optimize,
    [switch]$PrepareRelease,
    [switch]$BumpPatch,
    [switch]$BumpBeta,
    [string]$Version = ""
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Start stopwatch
$BuildStartTime = Get-Date

# Script description
@"
Subconverter WASM Build & Release Script (PowerShell)
-----------------------------------------------------
Usage Options:
  -Release           Build in release mode
  -Optimize          Development flow (versions untouched, www reinstalled) with release-profile WASM and wasm-opt
                     on the Workers build, e.g. before deploying www to Cloudflare Workers, whose size limit the
                     dev build exceeds
  -PrepareRelease    Prepare a release: Update version, create temporary tag, and trigger GitHub Actions
  -BumpPatch         Bump patch version number, commit change and prepare release
  -BumpBeta          Bump version for beta/preview release on current branch (not main), build locally, and deploy www to Netlify preview
  -Version X.Y.Z     Specify version (used with -Release or -PrepareRelease)

Examples:
  .\build-wasm.ps1                      # Build in development mode
  .\build-wasm.ps1 -Release             # Build in release mode
  .\build-wasm.ps1 -Optimize            # Optimized build for local use or a Workers deploy, no version changes
  .\build-wasm.ps1 -BumpPatch           # Auto-bump patch version and prepare release
  .\build-wasm.ps1 -BumpBeta            # Build beta version from current branch and deploy www preview
  .\build-wasm.ps1 -PrepareRelease -Version 0.3.0
"@

# Derive implied flags (cannot reassign [switch] parameters, use separate variables)
$releaseMode = $Release -or $PrepareRelease -or $BumpPatch -or $BumpBeta
$prepareRelease = $PrepareRelease -or $BumpPatch
$bumpPatch = $BumpPatch
$bumpBeta = $BumpBeta

# --- Helper Functions ---

function Test-CommandExists {
    param([string]$Command)
    $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

function Get-GitStatusClean {
    $status = git status --porcelain
    return [string]::IsNullOrEmpty($status)
}

# Write text as UTF-8 without BOM, LF line endings (matches wasm-pack / jq output)
function Write-JsonFile {
    param([string]$Path, [string[]]$Lines)
    $fullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    [System.IO.File]::WriteAllText($fullPath, ($Lines -join "`n") + "`n")
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
}

# Cloudflare Workers build, published as `@jat/subconverter-wasm/workers`: the same crate through
# `--target web`, plus the entry in wasm-host/workers/ that instantiates the precompiled module
# (Workers cannot compile WebAssembly from bytes at runtime).
function Build-WorkersPkg {
    param([string]$Mode) # --release or --dev
    Write-Host "Building Cloudflare Workers wasm package ($Mode)..."
    if (Test-Path 'pkg/workers') { Remove-Item 'pkg/workers' -Recurse -Force }
    wasm-pack build $Mode --target web --out-dir pkg/workers --no-pack
    if ($LASTEXITCODE -ne 0) { throw "wasm-pack build for Workers failed" }
    # wasm-pack writes a `*` .gitignore, which would make npm drop the whole directory when publishing
    if (Test-Path 'pkg/workers/.gitignore') { Remove-Item 'pkg/workers/.gitignore' -Force }
    Copy-Item 'wasm-host/workers/*' 'pkg/workers/' -Force
}

# --- Check Required Tools ---

if (-not (Test-CommandExists 'wasm-pack')) {
    Write-Error "wasm-pack is required. Install it with 'cargo install wasm-pack' (see https://github.com/wasm-bindgen/wasm-pack)."
    exit 1
}

if (-not (Test-CommandExists 'jq')) {
    Write-Error "jq is required. Please install it (e.g., 'scoop install jq' or 'choco install jq')."
    exit 1
}

if (-not (Test-CommandExists 'pnpm')) {
    Write-Error "pnpm is required. Please install it (e.g., 'npm install -g pnpm')."
    exit 1
}

# --- Get Current Version from Cargo.toml ---

$currentVersion = (Select-String -Path 'Cargo.toml' -Pattern '^\s*version\s*=' | Select-Object -First 1) -replace '.*"([^"]+)".*', '$1'
Write-Host "Current package version: $currentVersion"

# --- Beta Bump and Deploy Logic ---

if ($bumpBeta) {
    $currentBranch = git rev-parse --abbrev-ref HEAD
    if ($currentBranch -eq 'main') {
        Write-Error "--bump-beta cannot be used on the main branch."
        exit 1
    }

    if (-not (Get-GitStatusClean)) {
        Write-Error "Git working directory is not clean. Please commit or stash your changes before running --bump-beta."
        exit 1
    }

    # Generate beta version
    $baseVersion = ($currentVersion -replace '(\d+\.\d+\.\d+).*', '$1')
    $branchSanitized = $currentBranch -replace '[^a-zA-Z0-9]', '-'
    $gitHash = git rev-parse --short HEAD
    $Version = "${baseVersion}-beta.${branchSanitized}.${gitHash}"
    Write-Host "Generating beta version: $Version for branch $currentBranch"

    # Update version in Cargo.toml
    Write-Host "Updating version to $Version in Cargo.toml"
    (Get-Content 'Cargo.toml') -replace "version = `"$currentVersion`"", "version = `"$Version`"" | Set-Content 'Cargo.toml'

    # Update @jat/subconverter-wasm dependency version in www/package.json
    # Only touches entries that already exist, and leaves the file alone if nothing changes
    if (Test-Path 'www/package.json') {
        $wwwFilter = '(if .dependencies["@jat/subconverter-wasm"] then .dependencies["@jat/subconverter-wasm"] = $v else . end) | (if .devDependencies["@jat/subconverter-wasm"] then .devDependencies["@jat/subconverter-wasm"] = $v else . end)'
        $lines = jq --arg v $Version $wwwFilter 'www/package.json'
        if ($LASTEXITCODE -ne 0) { throw "jq failed to update www/package.json" }
        Write-JsonFile 'www/package.json.tmp' $lines
        if (Test-JsonEqual 'www/package.json' 'www/package.json.tmp') {
            Remove-Item 'www/package.json.tmp' -Force
        }
        else {
            Write-Host "Updating @jat/subconverter-wasm dependency to $Version in www/package.json"
            Move-Item 'www/package.json.tmp' 'www/package.json' -Force
        }
    }

    Write-Host "Running cargo check to update Cargo.lock"
    cargo check

    # Clean pkg directory
    if (Test-Path 'pkg') {
        Remove-Item 'pkg' -Recurse -Force
    }
    Build-WasmHost
    Backup-PkgJson

    # Build WASM locally (Release mode)
    Write-Host "Building wasm package locally in release mode..."
    wasm-pack build --release --target nodejs
    Build-WorkersPkg '--release'
    Write-Host "WASM beta build complete! Output is in the 'pkg' directory."

    # Update package.json in pkg
    Write-Host "Updating pkg/package.json..."
    Update-PkgJson $Version

    # Publish beta version to npm
    Write-Host "Publishing beta version $Version to npm..."
    Push-Location 'pkg'
    try {
        pnpm publish --tag beta --no-git-checks
        Write-Host "Successfully published $Version to npm."
    }
    catch {
        Write-Error "Failed to publish $Version to npm."
        Pop-Location
        exit 1
    }
    Pop-Location

    # Copy WASM package to www project
    if (Test-Path 'www') {
        Write-Host "Copying WASM files to www project..."
        $dest = 'www/node_modules/@jat/subconverter-wasm'
        # if (-not (Test-Path $dest)) {
        #     New-Item -ItemType Directory -Path $dest -Force | Out-Null
        # }
        # Get-ChildItem $dest | Remove-Item -Recurse -Force
        # Copy-Item -Path 'pkg\*' -Destination $dest -Recurse -Force
        Write-Host "Successfully copied WASM files to $dest"

        # Deploy www project to Netlify preview
        Write-Host "Deploying www project to Netlify preview..."
        Push-Location 'www'

        $maxRetries = 5
        $retryDelay = 3
        $retryCount = 0
        $installed = $false

        Write-Host "Running pnpm install in www (will retry up to $maxRetries times)..."
        while (-not $installed -and $retryCount -lt $maxRetries) {
            try {
                pnpm install
                $installed = $true
            }
            catch {
                $retryCount++
                if ($retryCount -ge $maxRetries) {
                    Write-Error "pnpm install failed after $maxRetries attempts."
                    Pop-Location
                    exit 1
                }
                Write-Host "pnpm install failed. Retrying in $retryDelay seconds (attempt $($retryCount + 1)/$maxRetries)..."
                Start-Sleep -Seconds $retryDelay
            }
        }
        Write-Host "pnpm install successful."

        Pop-Location

        # Commit version changes
        Write-Host "Committing beta version update..."
        git add Cargo.toml Cargo.lock
        if (Test-Path 'www/package.json') {
            git add www/package.json www/pnpm-lock.yaml
        }
        git commit -m "Bump version to $Version for beta build"
    }
    else {
        Write-Warning "www directory not found, skipping copy and Netlify deploy."
    }

    Write-Host "Beta build and deployment process completed for version $Version."
    $buildDuration = (Get-Date) - $BuildStartTime
    Write-Host "Total beta process time: $($buildDuration.Minutes) minutes and $($buildDuration.Seconds) seconds"
    exit 0
}
# --- End Beta Bump and Deploy Logic ---

# Bump patch version if requested
if ($bumpPatch) {
    $versionParts = $currentVersion -split '\.'
    $major = $versionParts[0]
    $minor = $versionParts[1]
    $patch = ($versionParts[2] -split '-')[0]
    $newPatch = [int]$patch + 1
    $Version = "${major}.${minor}.${newPatch}"
    Write-Host "Bumping patch version from $currentVersion to $Version"
}

# If version is provided but we're not in release mode, switch to release mode
if ($Version -and -not $releaseMode) {
    Write-Host "Version specified, switching to release mode"
    $releaseMode = $true
}

# If we're in release mode and no version is provided, generate a pre-release version
if ($releaseMode -and -not $Version) {
    $baseVersion = ($currentVersion -replace '(\d+\.\d+\.\d+).*', '$1')
    $gitHash = git rev-parse --short HEAD
    $datePart = Get-Date -Format 'yyyyMMdd'
    $Version = "${baseVersion}-pre.${datePart}.${gitHash}"
    Write-Host "Auto-generated pre-release version: $Version"
}

# Variable to track if version was updated
$versionUpdated = $false

# Prepare release (create temporary tag for CI)
if ($prepareRelease) {
    if (-not (Get-GitStatusClean)) {
        Write-Error "Git working directory is not clean. Please commit or stash your changes before running version release."
        exit 1
    }

    # Update version in Cargo.toml if needed
    if ($Version -and $Version -ne $currentVersion) {
        Write-Host "Updating version to $Version in Cargo.toml"
        (Get-Content 'Cargo.toml') -replace "version = `"$currentVersion`"", "version = `"$Version`"" | Set-Content 'Cargo.toml'
        Write-Host "Running cargo check to update Cargo.lock"
        cargo check
        $versionUpdated = $true
    }

    # Fetch remote tags to check for previous release attempts
    git fetch --tags

    # Count previous release attempts for this version
    $baseTag = "v${Version}"
    $attemptCount = (git tag -l "${baseTag}-attempt*").Count + 1

    # Create a temporary tag for this release attempt
    $tempTag = "${baseTag}-attempt${attemptCount}"

    Write-Host "Creating temporary tag $tempTag for CI workflow..."
    git add Cargo.toml
    git add Cargo.lock
    git commit -m "Prepare release $Version (attempt $attemptCount)"
    git tag -a $tempTag -m "Preparing release $Version (attempt $attemptCount)"

    Write-Host "Pulling latest changes from remote repository..."
    git pull --rebase origin main

    Write-Host "Pushing changes and temporary tag to remote repository..."
    git push origin main
    git push origin $tempTag

    Write-Host "Temporary tag created. CI workflow will handle the rest of the release process."

    # Output variables for GitHub Actions
    Write-Host "::set-output name=new_version::$Version"
    Write-Host "::set-output name=temp_tag::$tempTag"

    exit 0
}

# Build the wasm package
Build-WasmHost
Backup-PkgJson
# wasm-pack does not clean pkg/; drop snippets left over from earlier builds so they are not published
if (Test-Path 'pkg/snippets') { Remove-Item 'pkg/snippets' -Recurse -Force }
if ($releaseMode) {
    Write-Host "Building wasm package in release mode..."

    # Update version in Cargo.toml if needed
    $pkgVersion = if ($Version) { $Version } else { $currentVersion }
    if ($pkgVersion -ne $currentVersion) {
        # Check if git work area is clean ONLY if not already handled by BumpBeta
        if (-not $bumpBeta -and -not (Get-GitStatusClean)) {
            Write-Error "Git working directory is not clean. Please commit or stash your changes before running version release."
            exit 1
        }

        # Update only if not already updated by BumpBeta
        if (-not $bumpBeta) {
            Write-Host "Updating version to $pkgVersion in Cargo.toml"
            (Get-Content 'Cargo.toml') -replace "version = `"$currentVersion`"", "version = `"$pkgVersion`"" | Set-Content 'Cargo.toml'
            Write-Host "Running cargo check to update Cargo.lock"
            cargo check
            $versionUpdated = $true
        }
    }

    wasm-pack build --release --target nodejs
    Build-WorkersPkg '--release'
    Write-Host "WASM release build complete! Output is in the 'pkg' directory."
}
else {
    # wasm-pack profile for development builds; -Optimize switches it to release
    $devProfile = if ($Optimize) { '--release' } else { '--dev' }
    Write-Host "Building wasm package in development mode ($devProfile)..."
    # wasm-opt (about a minute per build) is only worth it for the Workers build, which has a size limit;
    # dev builds skip it anyway, so this only matters for -Optimize
    wasm-pack build $devProfile --target nodejs --no-opt
    if ($LASTEXITCODE -ne 0) { throw "wasm-pack build failed" }
    Build-WorkersPkg $devProfile
    Write-Host "WASM development build complete! Output is in the 'pkg' directory."
}

# Update package.json in pkg
Write-Host "Updating package.json..."
$pkgVersion = if ($Version) { $Version } else { $currentVersion }
Update-PkgJson $pkgVersion

# Install dependencies in pkg
Push-Location 'pkg'
pnpm install
Pop-Location

# Setup development environment if in dev mode
if (-not $releaseMode) {
    Write-Host "Setting up development environment..."

    if (Test-Path 'www') {
        # www depends on file:../pkg (pnpm-workspace.yaml override), which pnpm copies into
        # node_modules; reinstalling refreshes that copy with the new build
        Write-Host "Installing the new WASM package into www..."
        pnpm --dir www install
        if ($LASTEXITCODE -ne 0) { throw "pnpm install in www failed" }
        Write-Host "Note: You'll need to run this script again after any changes to the WASM code"
    }
    else {
        Write-Warning "www directory not found, skipping copy to www project"
    }
}

Write-Host "Build script completed successfully!"

# Calculate and print build time
$buildDuration = (Get-Date) - $BuildStartTime
Write-Host "Total build time: $($buildDuration.Minutes) minutes and $($buildDuration.Seconds) seconds"
