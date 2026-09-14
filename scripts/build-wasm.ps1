#!/usr/bin/env pwsh
#Requires -Version 5.1
param(
    [switch]$Release,
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
  -PrepareRelease    Prepare a release: Update version, create temporary tag, and trigger GitHub Actions
  -BumpPatch         Bump patch version number, commit change and prepare release
  -BumpBeta          Bump version for beta/preview release on current branch (not main), build locally, and deploy www to Netlify preview
  -Version X.Y.Z     Specify version (used with -Release or -PrepareRelease)

Examples:
  .\build-wasm.ps1                      # Build in development mode
  .\build-wasm.ps1 -Release             # Build in release mode
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

# --- Check Required Tools ---

if (-not (Test-CommandExists 'wasm-pack')) {
    Write-Host "wasm-pack not found. Installing..."
    Invoke-WebRequest -Uri 'https://rustwasm.github.io/wasm-pack/installer/init.sh' -UseBasicParsing | Invoke-Expression
    # Re-check after install; if still missing, prompt user
    if (-not (Test-CommandExists 'wasm-pack')) {
        Write-Error "wasm-pack installation failed. Please install manually."
        exit 1
    }
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

    # Update subconverter-wasm dependency version in www/package.json
    if (Test-Path 'www/package.json') {
        Write-Host "Updating subconverter-wasm dependency to $Version in www/package.json"
        $pkgJson = Get-Content 'www/package.json' -Raw
        $pkgJson = $pkgJson | jq --arg new_version "$Version" '(.dependencies? | ."subconverter-wasm") |= $new_version | (.devDependencies? | ."subconverter-wasm") |= $new_version'
        $pkgJson | Set-Content 'www/package.json'
    }

    Write-Host "Running cargo check to update Cargo.lock"
    cargo check

    # Clean pkg directory
    if (Test-Path 'pkg') {
        Remove-Item 'pkg' -Recurse -Force
    }

    # Build WASM locally (Release mode)
    Write-Host "Building wasm package locally in release mode..."
    wasm-pack build --release --target nodejs
    Write-Host "WASM beta build complete! Output is in the 'pkg' directory."

    # Update package.json in pkg
    Write-Host "Updating pkg/package.json..."
    $pkgJsonPath = 'pkg/package.json'
    $json = Get-Content $pkgJsonPath -Raw | jq '.files += ["snippets/"]'
    $json = $json | jq '.name = "subconverter-wasm"'
    $json = $json | jq '.dependencies = {"@upstash/redis": "^1.38.4"}'
    $json = $json | jq '.dependencies["@netlify/blobs"] = "^11.0.3"'
    $json = $json | jq --arg ver "$Version" '.version = $ver'
    $json | Set-Content $pkgJsonPath

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
        $dest = 'www/node_modules/subconverter-wasm'
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
    Write-Host "WASM release build complete! Output is in the 'pkg' directory."
}
else {
    Write-Host "Building wasm package in development mode..."
    wasm-pack build --dev --target nodejs
    Write-Host "WASM development build complete! Output is in the 'pkg' directory."
}

# Update package.json in pkg
Write-Host "Updating package.json..."
$pkgVersion = if ($Version) { $Version } else { $currentVersion }
$pkgJsonPath = 'pkg/package.json'
$json = Get-Content $pkgJsonPath -Raw | jq '.files += ["snippets/"]'
$json = $json | jq '.name = "subconverter-wasm"'
$json = $json | jq '.dependencies = {"@upstash/redis": "^1.38.4"}'
$json = $json | jq '.dependencies["@netlify/blobs"] = "^11.0.3"'
$json = $json | jq --arg ver "$pkgVersion" '.version = $ver'
$json | Set-Content $pkgJsonPath

# Install dependencies in pkg
Push-Location 'pkg'
pnpm install
Pop-Location

# Setup development environment if in dev mode
if (-not $releaseMode) {
    Write-Host "Setting up development environment..."

    if (Test-Path 'www') {
        Write-Host "Copying WASM files to www project..."
        $dest = 'www/node_modules/subconverter-wasm'
        # if (-not (Test-Path $dest)) {
        #     New-Item -ItemType Directory -Path $dest -Force | Out-Null
        # }
        # Copy-Item -Path 'pkg\*' -Destination $dest -Recurse -Force
        Write-Host "Successfully copied WASM files to $dest"
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
