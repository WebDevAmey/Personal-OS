#!/usr/bin/env bash
# scripts/ci/audit.sh — fail the build on any high or critical advisory in
# production dependencies (SEC-B-020, SEC-R-010). Fix with an upgrade or a
# pnpm.overrides entry in package.json; never by lowering the level.
set -euo pipefail
cd "$(dirname "$0")/../.."
pnpm audit --prod --audit-level=high
