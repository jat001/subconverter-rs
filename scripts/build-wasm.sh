#!/bin/bash
set -e

# Start stopwatch
BUILD_START_TIME=$SECONDS

# Script description
cat <<"EOF"
Subconverter WASM Build & Release Script
---------------------------------------
Usage Options:
  --release          Build in release mode
  --prepare-release  Prepare a release: Update version, create temporary tag, and trigger GitHub Actions
  --bump-patch       Bump patch version number, commit change and prepare release (convenient for routine updates)
  --bump-beta        Bump version for beta/preview release on current branch (not main), build locally, and deploy www to Netlify preview
  --version X.Y.Z    Specify version (used with --release or --prepare-release)

Examples:
  ./build-wasm.sh                      # Build in development mode
  ./build-wasm.sh --release            # Build in release mode
  ./build-wasm.sh --bump-patch         # Auto-bump patch version and prepare release
  ./build-wasm.sh --bump-beta          # Build beta version from current branch and deploy www preview
  ./build-wasm.sh --prepare-release --version 0.3.0  # Prepare specific version release
EOF

# Check if wasm-pack is installed
if ! command -v wasm-pack &>/dev/null; then
  echo "wasm-pack is required. Install it with 'cargo install wasm-pack' (see https://github.com/wasm-bindgen/wasm-pack)."
  exit 1
fi

# Check if jq is installed
if ! command -v jq &>/dev/null; then
  echo "jq is required. Please install it using your package manager."
  exit 1
fi

# Check if pnpm is installed
if ! command -v pnpm &>/dev/null; then
  echo "pnpm is required for beta deployments. Please install it (e.g., 'npm install -g pnpm')."
  exit 1
fi

# wasm-pack regenerates pkg/package.json on every build. Stash the current one first so it can be kept
# as-is (content and mtime) when the patched result is identical, avoiding needless reinstalls in www.
PKG_JSON_BACKUP=target/pkg-package.json.bak
# Runtime dependencies of the wasm-host bindings (shipped in pkg/snippets/) are declared in wasm-host/package.json
HOST_PKG_JSON=wasm-host/package.json

# Compile the TypeScript bindings (wasm-host/src -> wasm-host/dist) that wasm-bindgen embeds
build_wasm_host() {
  echo "Building wasm-host bindings..."
  pnpm --dir wasm-host install --frozen-lockfile
  pnpm --dir wasm-host run build
}

backup_pkg_json() {
  rm -f "$PKG_JSON_BACKUP"
  if [ -f pkg/package.json ]; then
    mkdir -p target
    cp -p pkg/package.json "$PKG_JSON_BACKUP"
  fi
}

# Apply our changes on top of the wasm-pack output, only replacing the previous file when something differs
update_pkg_json() {
  local pkg_version="$1"
  local tmp=pkg/package.json.tmp
  jq --arg ver "$pkg_version" --slurpfile host "$HOST_PKG_JSON" '
    .name = "@jat/subconverter-wasm"
    | .publishConfig = {"access": "public"}
    | .version = $ver
    | .files = ((.files // []) as $f | $f + (["snippets/", "workers/"] - $f))
    | .dependencies = ((.dependencies // {}) + ($host[0].dependencies // {}))
  ' pkg/package.json >"$tmp"

  if [ -f "$PKG_JSON_BACKUP" ] && [ "$(jq -S . "$PKG_JSON_BACKUP")" = "$(jq -S . "$tmp")" ]; then
    mv "$PKG_JSON_BACKUP" pkg/package.json
    rm -f "$tmp"
    echo "pkg/package.json unchanged, kept existing file"
  else
    mv "$tmp" pkg/package.json
    rm -f "$PKG_JSON_BACKUP"
    echo "pkg/package.json updated"
  fi
}

# Cloudflare Workers build, published as `@jat/subconverter-wasm/workers`: the same crate through
# `--target web`, plus the entry in wasm-host/workers/ that instantiates the precompiled module
# (Workers cannot compile WebAssembly from bytes at runtime).
build_workers_pkg() {
  local mode="$1" # --release or --dev
  echo "Building Cloudflare Workers wasm package ($mode)..."
  rm -rf pkg/workers
  wasm-pack build "$mode" --target web --out-dir pkg/workers --no-pack
  # wasm-pack writes a `*` .gitignore, which would make npm drop the whole directory when publishing
  rm -f pkg/workers/.gitignore
  cp wasm-host/workers/* pkg/workers/
}

# Parse arguments
RELEASE_MODE=false
VERSION=""
PREPARE_RELEASE=false
BUMP_PATCH=false
BUMP_BETA=false

while [[ $# -gt 0 ]]; do
  case $1 in
  --release)
    RELEASE_MODE=true
    shift
    ;;
  --prepare-release)
    PREPARE_RELEASE=true
    RELEASE_MODE=true
    shift
    ;;
  --bump-patch)
    BUMP_PATCH=true
    PREPARE_RELEASE=true
    RELEASE_MODE=true
    shift
    ;;
  --bump-beta)
    BUMP_BETA=true
    RELEASE_MODE=true
    shift
    ;;
  --version)
    VERSION="$2"
    shift 2
    ;;
  *)
    echo "Unknown option: $1"
    echo "Usage: $0 [--release] [--prepare-release] [--bump-patch] [--bump-beta] [--version X.Y.Z]"
    exit 1
    ;;
  esac
done

# Get current version from Cargo.toml
CURRENT_VERSION=$(grep -m 1 "version" Cargo.toml | sed 's/.*"\(.*\)".*/\1/')
echo "Current package version: $CURRENT_VERSION"

# --- Beta Bump and Deploy Logic ---
if [ "$BUMP_BETA" = true ]; then
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  if [ "$CURRENT_BRANCH" = "main" ]; then
    echo "Error: --bump-beta cannot be used on the main branch."
    exit 1
  fi

  # Check if git work area is clean
  if [ -n "$(git status --porcelain)" ]; then
    echo "Error: Git working directory is not clean."
    echo "Please commit or stash your changes before running --bump-beta."
    exit 1
  fi

  # Generate beta version
  BASE_VERSION=$(echo "$CURRENT_VERSION" | sed 's/\([0-9]\+\.[0-9]\+\.[0-9]\+\).*/\1/')
  BRANCH_NAME_SANITIZED=$(echo "$CURRENT_BRANCH" | sed 's/[^a-zA-Z0-9]/-/g') # Sanitize branch name for version
  GIT_HASH=$(git rev-parse --short HEAD)
  VERSION="${BASE_VERSION}-beta.${BRANCH_NAME_SANITIZED}.${GIT_HASH}"
  echo "Generating beta version: $VERSION for branch $CURRENT_BRANCH"

  # Update version in Cargo.toml
  echo "Updating version to $VERSION in Cargo.toml"
  sed -i "s/^version = \"$CURRENT_VERSION\"/version = \"$VERSION\"/" Cargo.toml

  # Update @jat/subconverter-wasm dependency version in www/package.json if it exists
  # Only touches entries that already exist, and leaves the file alone if nothing changes
  if [ -f "www/package.json" ]; then
    jq --arg v "$VERSION" '
      (if .dependencies["@jat/subconverter-wasm"] then .dependencies["@jat/subconverter-wasm"] = $v else . end)
      | (if .devDependencies["@jat/subconverter-wasm"] then .devDependencies["@jat/subconverter-wasm"] = $v else . end)
    ' www/package.json >www/package.json.tmp
    if [ "$(jq -S . www/package.json)" = "$(jq -S . www/package.json.tmp)" ]; then
      rm -f www/package.json.tmp
    else
      echo "Updating @jat/subconverter-wasm dependency to $VERSION in www/package.json"
      mv www/package.json.tmp www/package.json
    fi
  fi

  echo "Running cargo check to update Cargo.lock"
  cargo check

  # Clean pkg directory
  rm -rf pkg
  build_wasm_host
  backup_pkg_json

  # Build WASM locally (Release mode)
  echo "Building wasm package locally in release mode..."
  wasm-pack build --release --target nodejs
  build_workers_pkg --release
  echo "WASM beta build complete! Output is in the 'pkg' directory."

  # Update package.json in pkg
  echo "Updating pkg/package.json..."
  update_pkg_json "$VERSION"

  # Publish beta version to npm
  echo "Publishing beta version $VERSION to npm..."
  cd pkg
  if pnpm publish --tag beta --no-git-checks; then
    echo "Successfully published $VERSION to npm."
  else
    echo "Error: Failed to publish $VERSION to npm."
    cd .. # Ensure we cd back even on failure
    exit 1
  fi
  cd ..

  # Copy WASM package to www project
  if [ -d "www" ]; then
    echo "Copying WASM files to www project..."
    # mkdir -p www/node_modules/@jat/subconverter-wasm
    # Clear existing content first
    # rm -rf www/node_modules/@jat/subconverter-wasm/*
    # Copy new build
    # cp -r pkg/* www/node_modules/@jat/subconverter-wasm/
    echo "Successfully copied WASM files to www/node_modules/@jat/subconverter-wasm"

    # Deploy www project to Netlify preview
    echo "Deploying www project to Netlify preview..."
    cd www
    # Ensure www dependencies are installed
    # Retry pnpm install as registry propagation might take time
    MAX_RETRIES=5
    RETRY_DELAY=3 # seconds
    RETRY_COUNT=0

    echo "Running pnpm install in www (will retry up to $MAX_RETRIES times)..."
    until pnpm install; do
      RETRY_COUNT=$((RETRY_COUNT + 1))
      if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "Error: pnpm install failed after $MAX_RETRIES attempts."
        cd .. # Go back to root before exiting
        exit 1
      fi
      echo "pnpm install failed. Retrying in $RETRY_DELAY seconds (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)..."
      sleep $RETRY_DELAY
    done
    echo "pnpm install successful."

    # Commit version changes
    echo "Committing beta version update..."
    cd ..
    git add Cargo.toml Cargo.lock
    if [ -f "www/package.json" ]; then
      git add www/package.json www/pnpm-lock.yaml
    fi
    git commit -m "Bump version to $VERSION for beta build"

  else
    echo "Warning: www directory not found, skipping copy and Netlify deploy."
  fi

  echo "Beta build and deployment process completed for version $VERSION."
  # Calculate and print build time
  BUILD_END_TIME=$SECONDS
  BUILD_DURATION=$((BUILD_END_TIME - BUILD_START_TIME))
  echo "Total beta process time: $((BUILD_DURATION / 60)) minutes and $((BUILD_DURATION % 60)) seconds"
  exit 0 # Exit successfully after beta process
fi
# --- End Beta Bump and Deploy Logic ---

# Bump patch version if requested
if [ "$BUMP_PATCH" = true ]; then
  # Extract major, minor and patch numbers
  MAJOR=$(echo "$CURRENT_VERSION" | cut -d. -f1)
  MINOR=$(echo "$CURRENT_VERSION" | cut -d. -f2)
  PATCH=$(echo "$CURRENT_VERSION" | cut -d. -f3 | cut -d- -f1)

  # Bump patch version
  NEW_PATCH=$((PATCH + 1))
  VERSION="${MAJOR}.${MINOR}.${NEW_PATCH}"

  echo "Bumping patch version from $CURRENT_VERSION to $VERSION"
fi

# If version is provided but we're not in release mode, switch to release mode
if [ -n "$VERSION" ] && [ "$RELEASE_MODE" = false ]; then
  echo "Version specified, switching to release mode"
  RELEASE_MODE=true
fi

# If we're in release mode and no version is provided, generate a pre-release version
if [ "$RELEASE_MODE" = true ] && [ -z "$VERSION" ]; then
  # Extract the base version without any pre-release tags (e.g., 0.1.0 from 0.1.0-pre.xxx)
  BASE_VERSION=$(echo "$CURRENT_VERSION" | sed 's/\([0-9]\+\.[0-9]\+\.[0-9]\+\).*/\1/')

  # Generate a pre-release version based on base version + date + short git hash
  GIT_HASH=$(git rev-parse --short HEAD)
  DATE_PART=$(date '+%Y%m%d')
  VERSION="${BASE_VERSION}-pre.${DATE_PART}.${GIT_HASH}"
  echo "Auto-generated pre-release version: $VERSION"
fi

# Variable to track if version was updated
VERSION_UPDATED=false

# Prepare release (create temporary tag for CI)
if [ "$PREPARE_RELEASE" = true ]; then
  # Check if git work area is clean
  if [ -n "$(git status --porcelain)" ]; then
    echo "Error: Git working directory is not clean."
    echo "Please commit or stash your changes before running version release."
    exit 1
  fi

  # Update version in Cargo.toml if needed
  if [ -n "$VERSION" ] && [ "$VERSION" != "$CURRENT_VERSION" ]; then
    echo "Updating version to $VERSION in Cargo.toml"
    sed -i "s/^version = \"$CURRENT_VERSION\"/version = \"$VERSION\"/" Cargo.toml
    echo "Running cargo check to update Cargo.lock"
    cargo check
    VERSION_UPDATED=true
  fi

  # Fetch remote tags to check for previous release attempts
  git fetch --tags

  # Count previous release attempts for this version
  BASE_TAG="v${VERSION}"
  ATTEMPT_COUNT=$(git tag -l "${BASE_TAG}-attempt*" | wc -l)
  ATTEMPT_COUNT=$((ATTEMPT_COUNT + 1))

  # Create a temporary tag for this release attempt
  TEMP_TAG="${BASE_TAG}-attempt${ATTEMPT_COUNT}"

  echo "Creating temporary tag ${TEMP_TAG} for CI workflow..."
  git add Cargo.toml
  git add Cargo.lock
  git commit -m "Prepare release $VERSION (attempt $ATTEMPT_COUNT)"
  git tag -a "${TEMP_TAG}" -m "Preparing release $VERSION (attempt $ATTEMPT_COUNT)"

  echo "Pulling latest changes from remote repository..."
  git pull --rebase origin main

  echo "Pushing changes and temporary tag to remote repository..."
  git push origin main
  git push origin "${TEMP_TAG}"

  echo "Temporary tag created. CI workflow will handle the rest of the release process."

  # Output variables for GitHub Actions
  echo "::set-output name=new_version::$VERSION"
  echo "::set-output name=temp_tag::$TEMP_TAG"

  exit 0
fi

# Build the wasm package
build_wasm_host
backup_pkg_json
# wasm-pack does not clean pkg/; drop snippets left over from earlier builds so they are not published
rm -rf pkg/snippets
if [ "$RELEASE_MODE" = true ]; then
  echo "Building wasm package in release mode..."

  # Update version in Cargo.toml if needed (Ensure this doesn't conflict with beta bump)
  # Use PKG_VERSION which prioritizes explicitly set VERSION over CURRENT_VERSION
  PKG_VERSION=${VERSION:-$CURRENT_VERSION}
  if [ "$PKG_VERSION" != "$CURRENT_VERSION" ]; then
    # Check if git work area is clean ONLY if not already handled by BUMP_BETA
    if [ "$BUMP_BETA" = false ] && [ -n "$(git status --porcelain)" ]; then
      echo "Error: Git working directory is not clean."
      echo "Please commit or stash your changes before running version release."
      exit 1
    fi

    # Update only if not already updated by BUMP_BETA
    if [ "$BUMP_BETA" = false ]; then
      echo "Updating version to $PKG_VERSION in Cargo.toml"
      sed -i "s/^version = \"$CURRENT_VERSION\"/version = \"$PKG_VERSION\"/" Cargo.toml
      echo "Running cargo check to update Cargo.lock"
      cargo check
      VERSION_UPDATED=true # Mark version updated
    fi
  fi

  wasm-pack build --release --target nodejs
  build_workers_pkg --release
  echo "WASM release build complete! Output is in the 'pkg' directory."
else
  echo "Building wasm package in development mode..."
  wasm-pack build --dev --target nodejs
  build_workers_pkg --dev
  echo "WASM development build complete! Output is in the 'pkg' directory."
fi

# Update package.json in pkg
echo "Updating package.json..."
# Use PKG_VERSION calculated earlier
PKG_VERSION=${VERSION:-$CURRENT_VERSION}
update_pkg_json "$PKG_VERSION"

# Install dependencies in pkg
cd pkg
pnpm install
cd ..

# Setup development environment if in dev mode
if [ "$RELEASE_MODE" = false ]; then
  echo "Setting up development environment..."

  # Check if www directory exists and copy files directly
  if [ -d "www" ]; then
    echo "Copying WASM files to www project..."

    # Create necessary directories
    # mkdir -p www/node_modules/@jat/subconverter-wasm

    # Copy all files from pkg to www/node_modules/@jat/subconverter-wasm
    # cp -r pkg/* www/node_modules/@jat/subconverter-wasm/

    echo "Successfully copied WASM files to www/node_modules/@jat/subconverter-wasm"
    echo "Note: You'll need to run this script again after any changes to the WASM code"
  else
    echo "Warning: www directory not found, skipping copy to www project"
  fi
fi

echo "Build script completed successfully!"

# Calculate and print build time
BUILD_END_TIME=$SECONDS
BUILD_DURATION=$((BUILD_END_TIME - BUILD_START_TIME))
echo "Total build time: $((BUILD_DURATION / 60)) minutes and $((BUILD_DURATION % 60)) seconds"
