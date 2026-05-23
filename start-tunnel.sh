#!/bin/bash
# start-tunnel.sh — starts the server + localtunnel and wires up the webhook URL

set -e

PORT=3000
SUBDOMAIN="pai-$(date +%s | tail -c 6)"

echo "Starting Personal AI Onboarding server..."
node server.js &
SERVER_PID=$!

echo "Waiting for server..."
sleep 2

# Verify server is up
curl -sf http://localhost:$PORT/health > /dev/null || { echo "Server failed to start"; kill $SERVER_PID; exit 1; }

echo "Starting tunnel..."
# Start localtunnel, capture URL
TUNNEL_URL=$(lt --port $PORT --subdomain $SUBDOMAIN 2>&1 | grep -o 'https://[^[:space:]]*' | head -1) &
LT_PID=$!
sleep 3

# Try to get URL from lt output
TUNNEL_URL=$(lt --port $PORT --print-requests 2>&1 &
sleep 2
lt --port $PORT 2>&1 | grep -oP 'https://[^\s]+' | head -1)

echo ""
echo "================================================================"
echo "  Personal AI Onboarding is live!"
echo "  Tunnel URL : $TUNNEL_URL"
echo "  Frontend   : $TUNNEL_URL/"
echo "  Admin      : $TUNNEL_URL/admin"
echo "  Webhook    : $TUNNEL_URL/webhook/telnyx"
echo "================================================================"
echo ""
echo "→ Copy the Webhook URL above into your Telnyx Messaging Profile"
echo "   Telnyx Dashboard > Messaging > Profiles > Your Profile > Webhook URL"
echo ""
echo "Press Ctrl+C to stop."

wait $SERVER_PID
