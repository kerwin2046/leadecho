#!/usr/bin/env bash
# Start the leadecho API on :8090 with the isolated e2e env.
set -a
# shellcheck disable=SC1091
source /opt/leadecho/.e2e/backend.e2e.env
set +a
exec /opt/leadecho/.e2e/leadecho-api
