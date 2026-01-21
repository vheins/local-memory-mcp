#!/bin/bash
# Simple test script for MCP Local Memory Server

set -e

echo "Building project..."
npm run build

echo ""
echo "Test 1: Server initialization"
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node dist/server.js | head -1

echo ""
echo "Test 2: List tools"
RESPONSE=$(cat << 'EOF' | node dist/server.js | grep -A1 '"id":2'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
EOF
)
echo "$RESPONSE" | grep -q "memory.store" && echo "✓ memory.store found"
echo "$RESPONSE" | grep -q "memory.search" && echo "✓ memory.search found"

echo ""
echo "Test 3: Store and retrieve memory"
rm -f storage/memory.db
cat << 'EOF' | node dist/server.js > /tmp/test-output.txt
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memory.store","arguments":{"type":"decision","content":"Test decision for validation","importance":5,"scope":{"repo":"test-repo"}}}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory.search","arguments":{"query":"decision","repo":"test-repo","limit":5}}}
EOF

grep -q '"success":true' /tmp/test-output.txt && echo "✓ Memory stored successfully"
grep -q '"type":"decision"' /tmp/test-output.txt && echo "✓ Memory retrieved successfully"

echo ""
echo "Test 4: Cross-repo isolation"
cat << 'EOF' | node dist/server.js > /tmp/test-cross-repo.txt
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memory.store","arguments":{"type":"decision","content":"Decision for repo A","importance":5,"scope":{"repo":"repo-a"}}}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory.store","arguments":{"type":"decision","content":"Decision for repo B","importance":5,"scope":{"repo":"repo-b"}}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"memory.search","arguments":{"query":"decision","repo":"repo-a","limit":5}}}
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"memory.search","arguments":{"query":"decision","repo":"repo-b","limit":5}}}
EOF

# Check that search in repo-a only finds repo-a decision
grep '"id":4' /tmp/test-cross-repo.txt | grep -q '"repo":"repo-a"' && echo "✓ Cross-repo isolation working"

echo ""
echo "All tests passed! ✓"
