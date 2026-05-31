#!/bin/bash
set -e

# Load fnm so that `node` and `npm` are on PATH (non-interactive bash skips .bashrc)
if command -v fnm &>/dev/null; then
    eval "$(fnm env --shell bash)"
fi

# EXIT trap for teardown
on_exit() {
	EXIT_CODE=$?
	if [ $EXIT_CODE -ne 0 ]; then
		echo "Integration test failed with exit code $EXIT_CODE"
		if [ -f workflow_output.txt ]; then
			echo "--- Workflow Execution Output ---"
			cat workflow_output.txt
			echo "--------------------------------"
		fi
		if [ -f expired_token_output.txt ]; then
			echo "--- Expired Token Test Output ---"
			cat expired_token_output.txt
			echo "--------------------------------"
		fi
		echo "--- PocketBase Logs ---"
		docker compose -f docker-compose.test.yml logs pocketbase
		echo "-----------------------"
	fi
	echo "Cleaning up..."
	docker compose -f docker-compose.test.yml down -v
	rm -f workflow_output.txt expired_token_output.txt
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
    ln -sf /home/node/custom-nodes \"/home/node/.n8n/nodes/node_modules/$PACKAGE_NAME\" && \
    n8n import:credentials --input=/home/node/custom-nodes/tests/workflows/integration_credentials.json && \
    n8n import:credentials --input=/home/node/custom-nodes/tests/workflows/integration_credentials_expired.json && \
    n8n import:workflow --input=/home/node/custom-nodes/tests/workflows/integration_test.json && \
    n8n import:workflow --input=/home/node/custom-nodes/tests/workflows/integration_expired_token_test.json && \
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

if [ "$VERIFIED" = "true" ]; then
  echo "✅ Verification successful: Specific CRUD patterns and data found in PocketBase logs!"
else
  echo "Execution output summary:"
  tail -n 20 workflow_output.txt
  exit 1
fi

# Process 2: completely fresh n8n process — no shared memory, DB persisted via volume.
# This simulates a scheduled execution that starts cold with an expired stored token.
echo ""
echo "--- Expired Token Refresh Test (process 2, isolated) ---"
set +e
docker compose -f docker-compose.test.yml run --rm \
  --entrypoint /bin/sh n8n -c "
    mkdir -p /home/node/.n8n/nodes/node_modules && \
    ln -sf /home/node/custom-nodes \"/home/node/.n8n/nodes/node_modules/$PACKAGE_NAME\" && \
    n8n execute --id=2
" > expired_token_output.txt 2>&1
EXPIRED_EXIT=$?
set -e

if [ $EXPIRED_EXIT -eq 0 ] && grep -q '"status": *"success"' expired_token_output.txt 2>/dev/null; then
  echo "✅ Workflow with expired token SUCCEEDED in isolated process"
  echo "   Token was refreshed via preSend without any shared in-memory state"
else
  echo "❌ Workflow with expired token FAILED in isolated process"
  echo ""
  echo "   n8n output (last 20 lines, excluding sourcemap noise):"
  grep -v "Sourcemap" expired_token_output.txt | tail -20 | sed 's/^/   /'
  echo "--------------------------------------------------------"
  exit 1
fi
echo "--------------------------------------------------------"

# Run unit and integration tests
export RUN_POCKETBASE_INTEGRATION="true"
export POCKETBASE_TEST_URL="http://localhost:8090"
export POCKETBASE_TEST_USER="test@example.com"
export POCKETBASE_TEST_PASS="password123"
export N8N_TEST_URL="http://localhost:5678"

set +e
npm run test:run
TEST_EXIT=$?
set -e

# If tests passed
if [ $TEST_EXIT -eq 0 ]; then
	echo "Tests passed!"
else
	echo "Tests failed."
	exit $TEST_EXIT
fi
