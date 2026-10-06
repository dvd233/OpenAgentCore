#!/usr/bin/env bash
set -euo pipefail
phase=${1:?baseline or candidate required}
[[ "$phase" == baseline || "$phase" == candidate ]]
root=${GITHUB_WORKSPACE:?}
evidence=${OAC_EVIDENCE:?}
tools="$root/validation-runner/validation/oac-skip-link"
export CI=1 AGENTS_REUSE_E2E_SERVERS=0
mkdir -p "$evidence"

# Capture each exact command and its actual exit status, including the expected red run.
run_logged() {
  local name=$1 directory=$2 code
  shift 2
  printf 'Started %s\nDirectory: %s\nCommand:' "$(date -u +%FT%TZ)" "$directory" > "$evidence/$name.log"
  printf ' %q' "$@" >> "$evidence/$name.log"
  printf '\n' >> "$evidence/$name.log"
  set +e
  (cd "$directory" && "$@") 2>&1 | tee -a "$evidence/$name.log"
  code=${PIPESTATUS[0]}
  set -e
  printf '%s\n' "$code" > "$evidence/$name.exit"
  printf 'Exit: %s\nEnded %s\n' "$code" "$(date -u +%FT%TZ)" >> "$evidence/$name.log"
  return "$code"
}

test ! -e "$root/baseline/apps/web/e2e/skip-link.spec.ts"
cp "$root/candidate/apps/web/e2e/skip-link.spec.ts" "$root/baseline/apps/web/e2e/skip-link.spec.ts"
run_logged initial-source "$root" node "$tools/check-source.mjs" "$root"
{
  node --version
  pnpm --version
  git -C "$root/candidate" rev-parse HEAD HEAD^{tree}
  git -C "$root/baseline" rev-parse HEAD HEAD^{tree}
  sha256sum "$tools/reviewed.patch"
} > "$evidence/toolchain-and-source.txt"
[[ "$(pnpm --version)" == 10.30.3 ]]
cp "$tools/reviewed.patch" "$evidence/reviewed.patch"
git -C "$root/candidate" diff --binary "$BASE_SHA" "$FEATURE_SHA" > "$evidence/committed-source.diff"
checkout="$root/$phase"
run_logged dependencies "$checkout" pnpm --filter @oac/web... install --frozen-lockfile
run_logged browser-install "$checkout" pnpm --filter @oac/web exec playwright install --with-deps chrome
command -v google-chrome > "$evidence/chrome-path.txt"
google-chrome --version >> "$evidence/toolchain-and-source.txt"
run_logged installed-source "$root" node "$tools/check-source.mjs" "$root"

export AGENTS_FIXTURE_PORT=18397 AGENTS_WEB_PORT=4397
export PLAYWRIGHT_JSON_OUTPUT_FILE="$evidence/focused.json"
if run_logged focused "$checkout" timeout --signal=TERM --kill-after=30s 5m pnpm --filter @oac/web exec playwright test e2e/skip-link.spec.ts --reporter=line,json --trace=on --output="$evidence/focused-results"; then
  focused_exit=0
else
  focused_exit=$?
fi
run_logged focused-shutdown "$checkout" node "$tools/assert-servers-stopped.mjs" "$AGENTS_FIXTURE_PORT" "$AGENTS_WEB_PORT"
run_logged focused-gate "$checkout" node "$tools/verify-browser-report.mjs" "$phase" "$evidence/focused.json" "$focused_exit" "$checkout/apps/web/e2e/skip-link.spec.ts"

if [[ "$phase" == candidate ]]; then
  run_logged hygiene "$checkout" make check-names check-docs check-ci
  run_logged web-native "$checkout" make check-web-unit
  export PLAYWRIGHT_JSON_OUTPUT_FILE="$evidence/full-discovery.json"
  run_logged full-discovery "$checkout" pnpm --filter @oac/web exec playwright test --list --reporter=json
  export AGENTS_FIXTURE_PORT=18398 AGENTS_WEB_PORT=4398
  export PLAYWRIGHT_JSON_OUTPUT_FILE="$evidence/full-browser.json"
  if run_logged full-browser "$checkout" timeout --signal=TERM --kill-after=30s 20m pnpm test:web:acceptance --reporter=line,json --trace=retain-on-failure --output="$evidence/full-browser-results"; then
    full_exit=0
  else
    full_exit=$?
  fi
  run_logged full-shutdown "$checkout" node "$tools/assert-servers-stopped.mjs" "$AGENTS_FIXTURE_PORT" "$AGENTS_WEB_PORT"
  # No allowance for a baseline-equivalent failure is built into this workflow.
  [[ "$full_exit" == 0 ]]
  run_logged full-browser-gate "$checkout" node "$tools/verify-full-browser-report.mjs" "$evidence/full-browser.json" "$evidence/full-discovery.json" "$tools/expected-browser-tests.json"
fi
run_logged final-source "$root" node "$tools/check-source.mjs" "$root"
printf '%s phase passed at %s\n' "$phase" "$(date -u +%FT%TZ)" > "$evidence/RESULT.txt"
