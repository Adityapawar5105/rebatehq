#!/usr/bin/env bash
# CI only: install one Playwright browser within the step's time limit. A stalled Ubuntu package mirror can hang
# `playwright install --with-deps` for the whole step (CI #87, #145): the root apt-get started through sudo ignores
# `timeout`. So: one bounded attempt with system packages; if it fails, stop a still-downloading apt-get (never dpkg
# mid-install), then fetch only the browser from Playwright's CDN (no apt; the runner image already has the system
# libraries) and prove it launches. A launch failure is reported as an install problem, not a test failure.
set -uo pipefail
browser="${1:?usage: ci-install-browser.sh chromium|firefox}"
printf 'Acquire::Retries "3";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nDPkg::Lock::Timeout "120";\n' | sudo tee /etc/apt/apt.conf.d/99rebatehq-network-timeouts > /dev/null
launches() { pnpm exec node -e "require('@playwright/test').${browser}.launch().then(b=>b.close()).then(()=>console.log('${browser} launches'))"; }
if timeout -k 20 420 pnpm exec playwright install --with-deps "$browser" && launches; then exit 0; fi
echo "::warning::Installing ${browser} with system packages failed or timed out (package mirror); falling back to the browser download only."
for _ in $(seq 1 24); do pgrep -x dpkg > /dev/null || break; sleep 5; done
pgrep -x dpkg > /dev/null || sudo pkill -9 -x apt-get || true
for attempt in 1 2 3; do
  if timeout -k 20 300 pnpm exec playwright install "$browser" && launches; then exit 0; fi
  echo "::warning::Browser-only install attempt $attempt failed; retrying."
  sleep 10
done
echo "::error::Playwright ${browser} could not be installed (package mirror or download problem, not a test failure)."
exit 1
