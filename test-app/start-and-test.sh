#!/usr/bin/env bash
set -e

cd /home/joe/vesk/test-app

# Kill any existing node servers
pkill -f "node.*index.js dev" 2>/dev/null || true
sleep 1

echo "Starting dev server..."
node --experimental-vm-modules node_modules/@vesk/cli/src/index.js dev 3002 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Wait for server
for i in $(seq 1 30); do
  if curl -s -o /dev/null http://localhost:3002/ 2>/dev/null; then
    echo "Server ready after ${i}s"
    break
  fi
  sleep 1
done

# Test 1: Root page
echo ""
echo "=== Test 1: Root page (security headers, SSR) ==="
curl -s -i http://localhost:3002/ | head -30

# Test 2: API hello with VeskResponse
echo ""
echo "=== Test 2: API hello (VeskResponse cookies, status, cors) ==="
curl -s -i http://localhost:3002/api/hello | head -30

# Test 3: API hello POST
echo ""
echo "=== Test 3: API hello POST (VeskResponse body + cookie) ==="
curl -s -i -X POST -H 'Content-Type: application/json' -d '{"test":true}' http://localhost:3002/api/hello | head -25

# Test 4: Protected API route
echo ""
echo "=== Test 4: Protected API (security overrides) ==="
curl -s -i http://localhost:3002/api/protected | head -25

# Test 5: Dynamic echo route
echo ""
echo "=== Test 5: Dynamic echo route ==="
curl -s http://localhost:3002/api/echo/hello-world

# Test 6: Bench route (performance)
echo ""
echo ""
echo "=== Test 6: Bench route (10 requests) ==="
for i in $(seq 1 10); do
  curl -s -w "\nTIME: %{time_total}s\n" http://localhost:3002/api/bench
done

# Test 7: Blog page
echo ""
echo "=== Test 7: Blog listing page ==="
curl -s -o /dev/null -w 'Status: %{http_code}, Size: %{size_download} bytes\n' http://localhost:3002/blog

# Test 8: Blog dynamic post
echo ""
echo "=== Test 8: Blog dynamic post ==="
curl -s http://localhost:3002/blog/hello-world | head -20

# Test 9: About page
echo ""
echo "=== Test 9: About page ==="
curl -s http://localhost:3002/about | head -15

echo ""
echo "=== Tests complete ==="

# Kill server
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true
echo "Server stopped"
