#!/bin/bash

# Smart Inventory Agent - Start Script
# Launches: OpenClaw Gateway, Express Server, React Dev Server

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# Load environment variables
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

echo -e "${PURPLE}🦞 Smart Inventory Agent - Starting Services${NC}"
echo "============================================="

# Cleanup function
cleanup() {
  echo -e "\n${RED}Shutting down all services...${NC}"
  kill $GATEWAY_PID $SERVER_PID $CLIENT_PID 2>/dev/null
  wait $GATEWAY_PID $SERVER_PID $CLIENT_PID 2>/dev/null
  echo -e "${GREEN}All services stopped.${NC}"
}
trap cleanup EXIT INT TERM

# 1. Start OpenClaw Gateway
echo -e "\n${BLUE}[1/3] Starting OpenClaw Gateway on port 18789...${NC}"
openclaw gateway --port 18789 &
GATEWAY_PID=$!
sleep 3

# 2. Start Express Server
echo -e "${BLUE}[2/3] Starting Express Server on port 3001...${NC}"
cd "$PROJECT_DIR/server"
node index.js &
SERVER_PID=$!
cd "$PROJECT_DIR"
sleep 2

# 3. Start React Dev Server
echo -e "${BLUE}[3/3] Starting React Dev Server on port 5173...${NC}"
cd "$PROJECT_DIR/client"
npx vite --host &
CLIENT_PID=$!
cd "$PROJECT_DIR"

echo -e "\n${GREEN}=============================================${NC}"
echo -e "${GREEN}All services running!${NC}"
echo -e "${GREEN}  🌐 Web UI:          http://localhost:5173${NC}"
echo -e "${GREEN}  🖥  Express API:     http://localhost:3001${NC}"
echo -e "${GREEN}  🦞 OpenClaw Gateway: http://localhost:18789${NC}"
echo -e "${GREEN}=============================================${NC}"
echo -e "${PURPLE}Press Ctrl+C to stop all services${NC}"

# Wait for any process to exit
wait
