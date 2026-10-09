#!/bin/bash
# Validate the checked-out source before packaging or publishing. Safe for manual build-only runs.
set -euo pipefail

version="$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -n 1)"
requested="${REQUESTED_VERSION:-}"
if [[ "${GITHUB_REF:-}" == refs/tags/* ]]; then
  requested="${GITHUB_REF#refs/tags/v}"
  requested="${requested%-attempt*}"
fi
if [ -z "$version" ] || { [ -n "$requested" ] && [ "$version" != "$requested" ]; }; then
  echo "::error::Source version '$version' does not match requested version '$requested'" >&2
  exit 1
fi
echo "RELEASE_VERSION=$version" >> "$GITHUB_ENV"
echo "Release source version: $version"
