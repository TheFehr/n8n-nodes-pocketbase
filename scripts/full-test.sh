#!/bin/bash
set -e

# Load fnm so that `node` and `npm` are on PATH (non-interactive bash skips .bashrc)
if command -v fnm &>/dev/null; then
    eval "$(fnm env --shell bash)"
fi

# EXIT trap for teardown
ISOLATED_OUTPUT_FILES="expired_token_output.txt notfound_error_output.txt validation_error_output.txt duplicate_error_output.txt"
ALL_OUTPUT_FILES="workflow_output.txt $ISOLATED_OUTPUT_FILES test_run_output.txt"

# Heuristic verdict on whether a failure is inside this node's own
# verification/tests (a real compat issue to fix here) or a crash we hit
# before ever reaching that point (docker/n8n/PocketBase itself misbehaving -
# not evidence of a bug in this node). Keeps us from re-diagnosing the same
# upstream n8n/PocketBase bug from scratch every time the nightly job fails.
classify_failure() {
	local combined=""
	for f in $ALL_OUTPUT_FILES; do
		[ -f "$f" ] && combined+="$(cat "$f")"$'\n'
	done

	if echo "$combined" | grep -qE "❌ (Verification failed|.* did not (succeed|fail) as expected)" \
		|| echo "$combined" | grep -qE "^\s*(FAIL|✗|✕) |AssertionError"; then
		echo "node"
	elif echo "$combined" | grep -qE "SQLITE_ERROR|There was an error running database migrations|ECONNREFUSED|did not start in time|Cannot find module|panic:|docker: [Ee]rror|Error response from daemon|exitWithCrash"; then
		echo "upstream"
	else
		echo "unknown"
	fi
}

on_exit() {
	EXIT_CODE=$?
	if [ $EXIT_CODE -ne 0 ]; then
		echo "Integration test failed with exit code $EXIT_CODE"
		if [ -f workflow_output.txt ]; then
			echo "--- Workflow Execution Output ---"
			cat workflow_output.txt
			echo "--------------------------------"
		fi
		for f in $ISOLATED_OUTPUT_FILES; do
			if [ -f "$f" ]; then
				echo "--- $f ---"
				cat "$f"
				echo "--------------------------------"
			fi
		done
		echo "--- PocketBase Logs ---"
		docker compose -f docker-compose.test.yml logs pocketbase
		echo "-----------------------"

		case "$(classify_failure)" in
		upstream)
			VERDICT="🔺 Looks like an upstream/environment issue (n8n, PocketBase, or Docker itself) — the failure happened before this node's own verification steps ran. Probably not a bug in n8n-nodes-pocketbase; check n8n/PocketBase release notes or file an upstream issue."
			ANNOTATION="warning"
			;;
		node)
			VERDICT="⚠️ Failure happened inside this node's own verification/test assertions — likely a real compatibility issue in n8n-nodes-pocketbase (or a behavior change upstream this node needs to adapt to). Worth investigating here."
			ANNOTATION="error"
			;;
		*)
			VERDICT="❓ Could not automatically classify this failure — check the logs above."
			ANNOTATION=""
			;;
		esac

		echo ""
		echo "=================================================="
		echo "$VERDICT"
		echo "=================================================="

		if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
			{
				echo "## Nightly pipeline failure classification"
				echo ""
				echo "$VERDICT"
			} >>"$GITHUB_STEP_SUMMARY"
		fi
		if [ -n "$ANNOTATION" ] && [ -n "${GITHUB_ACTIONS:-}" ]; then
			echo "::${ANNOTATION}::${VERDICT}"
		fi
	fi
	echo "Cleaning up..."
	docker compose -f docker-compose.test.yml down -v
	rm -f $ALL_OUTPUT_FILES
	exit $EXIT_CODE
}
trap on_exit EXIT

# Sync versions and package name (non-fatal: may fail locally due to GitHub API rate limits)
echo "Synchronizing versions and package name..."
npm run version:update || echo "⚠️  Version sync skipped (GitHub API rate limit or network issue)"

# Get package name from package.json
PACKAGE_NAME=$(node -p "require('./package.json').name")
echo "Package name: $PACKAGE_NAME"

# Build nodes
echo "Building nodes..."
npm run build

# Ensure a clean slate: if a previous run was killed before its exit trap
# could tear down volumes, stale PocketBase/n8n data (e.g. leftover workflow
# IDs, or the duptest@example.com record the duplicate-email test relies on
# being absent) could cause spurious failures in this run.
echo "Ensuring a clean Docker Compose state..."
docker compose -f docker-compose.test.yml down -v --remove-orphans 2>/dev/null || true

# Spin up services
docker compose -f docker-compose.test.yml up -d

# Readiness loop helper
wait_for_service() {
	local name=$1
	local url=$2
	local max_attempts=30
	local attempt=1
	echo "Waiting for $name to start..."
	until [ $attempt -gt $max_attempts ]; do
		status=$(curl -s -o /dev/null -w "%{http_code}" "$url" || echo "000")
		if [[ "$status" =~ ^2 ]]; then
			echo "$name is ready!"
			return 0
		fi
		sleep 1
		attempt=$((attempt+1))
	done
	echo "Error: $name did not start in time at $url (Status: $status)"
	docker compose -f docker-compose.test.yml logs "$name"
	return 1
}

wait_for_service "pocketbase" "http://localhost:8090/api/health"
wait_for_service "n8n" "http://localhost:5678/healthz"

# Create a superuser in PocketBase via CLI (decoupled from API)
echo "Setting up PocketBase superuser..."
docker compose -f docker-compose.test.yml exec -T pocketbase /usr/local/bin/pocketbase --dir=/pb_data superuser upsert test@example.com password123

# Restrict the users collection list rule to superusers-only, matching the
# production scenario where collections require valid superuser authentication.
echo "Restricting users collection list rule..."
ADMIN_TOKEN=$(curl -sf -X POST "http://localhost:8090/api/collections/_superusers/auth-with-password" \
  -H "Content-Type: application/json" \
  -d '{"identity":"test@example.com","password":"password123"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
curl -sf -X PATCH "http://localhost:8090/api/collections/users" \
  -H "Content-Type: application/json" \
  -H "Authorization: ${ADMIN_TOKEN}" \
  -d '{"listRule": null}' > /dev/null
echo "✓ Users list rule set to superusers-only"

# Stop n8n to avoid port conflicts with docker compose run
docker compose -f docker-compose.test.yml stop n8n

# Process 1: import credentials + workflows, run the main CRUD test
echo "Running Integration Workflow (process 1)..."
docker compose -f docker-compose.test.yml run --rm \
  --entrypoint /bin/sh n8n -c "
    mkdir -p /home/node/.n8n/nodes/node_modules && \
    rm -f \"/home/node/.n8n/nodes/node_modules/$PACKAGE_NAME\" && \
    ln -sf /home/node/custom-nodes \"/home/node/.n8n/nodes/node_modules/$PACKAGE_NAME\" && \
    n8n import:credentials --input=/home/node/custom-nodes/tests/workflows/integration_credentials.json && \
    n8n import:credentials --input=/home/node/custom-nodes/tests/workflows/integration_credentials_expired.json && \
    n8n import:workflow --input=/home/node/custom-nodes/tests/workflows/integration_test.json && \
    n8n import:workflow --input=/home/node/custom-nodes/tests/workflows/integration_expired_token_test.json && \
    n8n import:workflow --input=/home/node/custom-nodes/tests/workflows/integration_error_notfound_test.json && \
    n8n import:workflow --input=/home/node/custom-nodes/tests/workflows/integration_error_validation_test.json && \
    n8n import:workflow --input=/home/node/custom-nodes/tests/workflows/integration_error_duplicate_test.json && \
    n8n execute --id=1
" > workflow_output.txt 2>&1

# Verify main workflow via PocketBase logs
echo "Verifying results in PocketBase logs..."
PB_LOGS=$(docker compose -f docker-compose.test.yml logs pocketbase)

VERIFIED=true

if ! echo "$PB_LOGS" | grep -qE "POST /api/collections/users/records"; then
  echo "❌ Verification failed: 'POST /api/collections/users/records' (user create) not found in logs."
  VERIFIED=false
fi

if ! echo "$PB_LOGS" | grep -iq "INSERT INTO .*users.*user[0-9]*@example.com"; then
  echo "❌ Verification failed: INSERT statement for user create not found in logs."
  VERIFIED=false
fi

if ! echo "$PB_LOGS" | grep -qE "PATCH /api/collections/users/records/"; then
  echo "❌ Verification failed: 'PATCH /api/collections/users/records/' (user update) not found in logs."
  VERIFIED=false
fi

if ! echo "$PB_LOGS" | grep -iq "UPDATE .*users.*Updated User"; then
  echo "❌ Verification failed: UPDATE statement for user update not found in logs."
  VERIFIED=false
fi

if ! echo "$PB_LOGS" | grep -qE "DELETE /api/collections/users/records/"; then
  echo "❌ Verification failed: 'DELETE /api/collections/users/records/' (user delete) not found in logs."
  VERIFIED=false
fi

if [ "$VERIFIED" = "true" ]; then
  echo "✅ Verification successful: Specific CRUD patterns and data found in PocketBase logs!"
else
  echo "Execution output summary:"
  tail -n 20 workflow_output.txt
  exit 1
fi

# Process 2+: each runs in a completely fresh n8n process — no shared memory,
# DB persisted via volume. This simulates a cold-started scheduled execution
# and is also how we isolate error-path workflows from the main CRUD chain
# (n8n aborts a workflow on the first node error, so a failing node can't
# share a workflow with the happy-path assertions above).
run_isolated_workflow() {
  local id=$1
  local output_file=$2
  set +e
  docker compose -f docker-compose.test.yml run --rm \
    --entrypoint /bin/sh n8n -c "
      mkdir -p /home/node/.n8n/nodes/node_modules && \
      rm -f \"/home/node/.n8n/nodes/node_modules/$PACKAGE_NAME\" && \
      ln -sf /home/node/custom-nodes \"/home/node/.n8n/nodes/node_modules/$PACKAGE_NAME\" && \
      n8n execute --id=$id
  " > "$output_file" 2>&1
  local exit_code=$?
  set -e
  return $exit_code
}

expect_isolated_success() {
  local id=$1 label=$2 output_file=$3
  echo ""
  echo "--- $label (isolated) ---"
  local exit_code=0
  run_isolated_workflow "$id" "$output_file" || exit_code=$?
  if [ $exit_code -eq 0 ] && grep -q '"status": *"success"' "$output_file" 2>/dev/null; then
    echo "✅ $label SUCCEEDED as expected"
  else
    echo "❌ $label did not succeed as expected (exit $exit_code)"
    echo "   n8n output (last 20 lines, excluding sourcemap noise):"
    grep -v "Sourcemap" "$output_file" | tail -20 | sed 's/^/   /'
    echo "--------------------------------------------------------"
    exit 1
  fi
  echo "--------------------------------------------------------"
}

expect_isolated_failure() {
  local id=$1 label=$2 output_file=$3 expected_substring=$4
  echo ""
  echo "--- $label (isolated) ---"
  local exit_code=0
  run_isolated_workflow "$id" "$output_file" || exit_code=$?
  if [ $exit_code -ne 0 ] && grep -qi "$expected_substring" "$output_file" 2>/dev/null; then
    echo "✅ $label FAILED as expected (exit $exit_code), matched: \"$expected_substring\""
  else
    echo "❌ $label did not fail as expected (exit $exit_code); expected output to contain: \"$expected_substring\""
    echo "   n8n output (last 20 lines, excluding sourcemap noise):"
    grep -v "Sourcemap" "$output_file" | tail -20 | sed 's/^/   /'
    echo "--------------------------------------------------------"
    exit 1
  fi
  echo "--------------------------------------------------------"
}

# This simulates a scheduled execution that starts cold with an expired stored token;
# a successful run proves the token was refreshed via preSend without any shared
# in-memory state.
expect_isolated_success 2 "Expired Token Refresh Test" expired_token_output.txt

expect_isolated_failure 3 "Not Found Error Test" notfound_error_output.txt "wasn't found"
expect_isolated_failure 4 "Validation Error Test" validation_error_output.txt "Values don't match"
expect_isolated_failure 5 "Duplicate Field Error Test" duplicate_error_output.txt "Value must be unique"

# Run unit and integration tests
export RUN_POCKETBASE_INTEGRATION="true"
export POCKETBASE_TEST_URL="http://localhost:8090"
export POCKETBASE_TEST_USER="test@example.com"
export POCKETBASE_TEST_PASS="password123"
export N8N_TEST_URL="http://localhost:5678"

set +e
npm run test:run 2>&1 | tee test_run_output.txt
TEST_EXIT=${PIPESTATUS[0]}
set -e

# If tests passed
if [ $TEST_EXIT -eq 0 ]; then
	echo "Tests passed!"
else
	echo "Tests failed."
	exit $TEST_EXIT
fi
