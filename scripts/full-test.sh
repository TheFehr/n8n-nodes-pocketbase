#!/bin/bash
set -e

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
		echo "--- PocketBase Logs ---"
		docker compose -f docker-compose.test.yml logs pocketbase
		echo "-----------------------"
	fi
	echo "Cleaning up..."
	docker compose -f docker-compose.test.yml down
	rm -f workflow_output.txt
	exit $EXIT_CODE
}
trap on_exit EXIT

# Sync versions and package name
echo "Synchronizing versions and package name..."
npm run version:update

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

# Execution: Stop main n8n to avoid port conflicts and run the test via CLI
echo "Running Integration Workflow..."
docker compose -f docker-compose.test.yml stop n8n
docker compose -f docker-compose.test.yml run --rm \
  --entrypoint /bin/sh n8n -c "
    mkdir -p /home/node/.n8n/nodes/node_modules && \
    ln -sf /home/node/custom-nodes \"/home/node/.n8n/nodes/node_modules/$PACKAGE_NAME\" && \
    n8n import:credentials --input=/home/node/custom-nodes/tests/workflows/integration_credentials.json && \
    n8n import:workflow --input=/home/node/custom-nodes/tests/workflows/integration_test.json && \
    n8n execute --id=1
" > workflow_output.txt 2>&1

# Verify via logs (enabled by --dev flag in pocketbase)
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
