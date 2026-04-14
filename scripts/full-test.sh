#!/bin/bash
set -e

# Build nodes
echo "Building nodes..."
npm run build

# Spin up services
docker compose -f docker-compose.test.yml up -d

# Wait for pocketbase to be ready
echo "Waiting for PocketBase to start..."
until curl -s http://localhost:8090/api/health > /dev/null; do
  sleep 1
done
echo "PocketBase is ready!"

# Wait for n8n to be ready
echo "Waiting for n8n to start..."
until curl -s http://localhost:5678/healthz > /dev/null; do
  sleep 1
done
echo "n8n is ready!"

# Create a superuser in PocketBase via CLI (decoupled from API)
echo "Setting up PocketBase superuser..."
docker compose -f docker-compose.test.yml exec -T pocketbase /usr/local/bin/pocketbase --dir=/pb_data superuser upsert test@example.com password123

# Execution: Stop main n8n to avoid port conflicts and run the test via CLI
echo "Running Integration Workflow..."
docker compose -f docker-compose.test.yml stop n8n
docker compose -f docker-compose.test.yml run --rm \
  -e N8N_CUSTOM_EXTENSIONS=/home/node/custom-extensions \
  --entrypoint /bin/sh n8n -c "
    mkdir -p /home/node/custom-extensions/node_modules && \
    ln -s /home/node/custom-nodes /home/node/custom-extensions/node_modules/n8n-nodes-pocketbase && \
    n8n import:credentials --input=/home/node/custom-nodes/tests/workflows/integration_credentials.json && \
    n8n import:workflow --input=/home/node/custom-nodes/tests/workflows/integration_test.json && \
    n8n execute --id=1
" > workflow_output.txt 2>&1

# Verify via logs (enabled by --dev flag in pocketbase)
echo "Verifying results in PocketBase logs..."
PB_LOGS=$(docker compose -f docker-compose.test.yml logs pocketbase)

# With --dev, PocketBase prints successful requests and SQL statements to stdout/stderr.
# We look for the creation of a user and its subsequent update, using specific values from the workflow.
# 1. Check for POST request to records endpoint
# 2. Check for SQL INSERT statement containing our test email
# 3. Check for PATCH request to a specific record
# 4. Check for SQL UPDATE statement containing our updated name
if echo "$PB_LOGS" | grep -qE "POST /api/collections/users/records.* 20[01]" && \
   echo "$PB_LOGS" | grep -iq "INSERT INTO .*users.*user@example.com" && \
   echo "$PB_LOGS" | grep -qE "PATCH /api/collections/users/records/.* 200" && \
   echo "$PB_LOGS" | grep -iq "UPDATE .*users.*Updated User"; then
  echo "✅ Verification successful: Specific CRUD patterns and data found in PocketBase logs!"
else
  echo "❌ Verification failed: Expected CRUD patterns or data NOT found in logs."
  echo "Check if the following patterns are present in PB logs:"
  echo "- POST /api/collections/users/records"
  echo "- INSERT INTO ... users ... user@example.com"
  echo "- PATCH /api/collections/users/records/..."
  echo "- UPDATE ... users ... Updated User"
  echo "Execution output summary:"
  tail -n 10 workflow_output.txt
  exit 1
fi

# Run existing unit tests
export POCKETBASE_TEST_URL="http://localhost:8090"
export POCKETBASE_TEST_USER="test@example.com"
export POCKETBASE_TEST_PASS="password123"
export N8N_TEST_URL="http://localhost:5678"
npm run test:run

# If tests passed, update README
if [ $? -eq 0 ]; then
  echo "Tests passed! Updating README.md..."
  npx tsx scripts/update-versions.ts
fi

# Cleanup
docker compose -f docker-compose.test.yml down
rm workflow_output.txt
