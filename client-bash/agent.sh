#!/usr/bin/env bash

# Config
SERVER_URL="http://localhost:3000"
SECRET_TOKEN="p2p_secure_agent_token_2026"
POLL_INTERVAL=1

# Read local config.json if available
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
CONFIG_PATH="${SCRIPT_DIR}/../config.json"

if [ -f "$CONFIG_PATH" ]; then
  # Simple parser for JSON keys port and secret_token
  PORT_VAL=$(grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]*' "$CONFIG_PATH" | grep -o '[0-9]*')
  TOKEN_VAL=$(grep -o '"secret_token"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_PATH" | cut -d'"' -f4)
  
  if [ -n "$PORT_VAL" ]; then
    SERVER_URL="http://localhost:${PORT_VAL}"
  fi
  if [ -n "$TOKEN_VAL" ]; then
    SECRET_TOKEN="${TOKEN_VAL}"
  fi
fi

# Strip trailing slash from SERVER_URL if present
SERVER_URL="${SERVER_URL%/}"

# Set up Persistent Agent ID
ID_FILE="${HOME}/.p2p_bash_agent_id"
if [ -f "$ID_FILE" ]; then
  AGENT_ID=$(cat "$ID_FILE")
else
  # Generate unique identifier (UUID/random hex fallback)
  if command -v uuidgen >/dev/null 2>&1; then
    AGENT_ID="bash_$(uuidgen)"
  else
    AGENT_ID="bash_$(od -x /dev/urandom | head -n 1 | awk '{print $2$3$4$5}')"
  fi
  echo "$AGENT_ID" > "$ID_FILE"
fi

HOSTNAME=$(hostname 2>/dev/null || echo "unknown-bash-host")
PLATFORM=$(uname -s 2>/dev/null || echo "linux")
if [ "$PLATFORM" = "Darwin" ]; then
  PLATFORM="macOS"
fi

# Helpers for system resource metrics
get_cpu() {
  if [ "$PLATFORM" = "macOS" ]; then
    if command -v top >/dev/null 2>&1; then
      top -l 1 | awk '/CPU usage/ {print $3}' | cut -d% -f1 | awk '{print ($1 == "" ? 0.0 : $1)}'
    else
      echo "0.0"
    fi
  else
    # Linux CPU usage extraction
    if command -v top >/dev/null 2>&1; then
      top -bn1 | grep "Cpu(s)" | sed "s/.*, *\([0-9.]*\)%* id.*/\1/" | awk '{print 100 - $1}'
    else
      echo "0.0"
    fi
  fi
}

get_ram() {
  if [ "$PLATFORM" = "macOS" ]; then
    # Memory percentage approximation via ps on macOS
    ps -A -o %mem | awk '{s+=$1} END {print (s == "" ? 0.0 : s)}'
  else
    # Linux Memory percentage calculation
    if [ -f /proc/meminfo ]; then
      free | grep Mem | awk '{print ($3/$2 * 100)}'
    else
      echo "0.0"
    fi
  fi
}

get_ip() {
  local ip=""
  if command -v ip >/dev/null 2>&1; then
    ip=$(ip route get 8.8.8.8 2>/dev/null | awk '{print $7}')
  fi
  if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then
    ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  fi
  if [ -z "$ip" ] && command -v ifconfig >/dev/null 2>&1; then
    ip=$(ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1 | head -n 1 | awk '{print $2}')
  fi
  if [ -z "$ip" ]; then
    ip="127.0.0.1"
  fi
  echo "$ip"
}

# Extraction utility for string/number JSON values
parse_json_value() {
  local key="$1"
  local json="$2"
  local temp=$(echo "$json" | sed 's/\\"/__ESC_QUOTE__/g')
  local val=$(echo "$temp" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | cut -d'"' -f4)
  echo "$val" | sed 's/__ESC_QUOTE__/"/g'
}

echo "=============================================="
echo " Starting P2P Bash Agent                      "
echo " Agent ID:   $AGENT_ID"
echo " Hostname:   $HOSTNAME"
echo " Platform:   $PLATFORM"
echo " Server URL: $SERVER_URL"
echo "=============================================="

# Active command state tracking
ACTIVE_CMD_ID=""
ACTIVE_CMD_PID=""

# Get static IP once at startup
IP=$(get_ip)

# Background metrics collector (runs every 10 seconds to avoid blocking the main loop)
METRICS_FILE="/tmp/p2p_bash_metrics_${AGENT_ID}"
echo "0.0 0.0" > "$METRICS_FILE"
(
  # Exit automatically if the parent process dies
  while kill -0 $$ 2>/dev/null; do
    CPU_VAL=$(get_cpu)
    RAM_VAL=$(get_ram)
    echo "$CPU_VAL $RAM_VAL" > "$METRICS_FILE"
    sleep 10
  done
) &
METRICS_PID=$!

# Ensure background processes are cleaned up on exit
cleanup() {
  kill "$METRICS_PID" 2>/dev/null
  rm -f "$METRICS_FILE"
}
trap cleanup EXIT INT TERM

# Main Loop
while true; do
  # Read metrics from the background file instantly
  read -r CPU RAM < "$METRICS_FILE" 2>/dev/null
  [ -z "$CPU" ] && CPU="0.0"
  [ -z "$RAM" ] && RAM="0.0"

  # URL encode parameters manually for curl compatibility
  POLL_URL="${SERVER_URL}/api/agent/poll?token=${SECRET_TOKEN}&id=${AGENT_ID}&hostname=${HOSTNAME}&platform=${PLATFORM}&ip=${IP}&cpu=${CPU}&ram=${RAM}"
  
  # Connect to Server
  RESPONSE=$(curl -s -g "$POLL_URL")
  
  SLEEP_TIME="$POLL_INTERVAL"
  if [ $? -eq 0 ] && [ -n "$RESPONSE" ]; then
    COMMAND_ID=$(parse_json_value "commandId" "$RESPONSE")
    CMD=$(parse_json_value "cmd" "$RESPONSE")
    ACTION=$(parse_json_value "action" "$RESPONSE")
    
    if [ "$ACTION" = "kill" ]; then
      if [ "$COMMAND_ID" = "$ACTIVE_CMD_ID" ] && [ -n "$ACTIVE_CMD_PID" ]; then
        echo "Received cancel signal. Terminating active command $ACTIVE_CMD_ID (PID: $ACTIVE_CMD_PID)..."
        kill -9 "$ACTIVE_CMD_PID" 2>/dev/null
        ACTIVE_CMD_ID=""
        ACTIVE_CMD_PID=""
      fi
      # Poll again soon to acknowledge/reset state quickly
      SLEEP_TIME=0.2
    elif [ -n "$COMMAND_ID" ] && [ "$COMMAND_ID" != "null" ]; then
      echo "Received command execution request: $CMD (ID: $COMMAND_ID)"
      
      LOG_FILE="/tmp/p2p_cmd_${COMMAND_ID}.log"
      touch "$LOG_FILE"
      
      EXIT_FILE="/tmp/p2p_exit_${COMMAND_ID}"
      # Spawn execution subshell in background
      if command -v stdbuf >/dev/null 2>&1; then
        ( stdbuf -oL -eL bash -c "$CMD"; echo $? > "$EXIT_FILE" ) > "$LOG_FILE" 2>&1 &
      else
        ( bash -c "$CMD"; echo $? > "$EXIT_FILE" ) > "$LOG_FILE" 2>&1 &
      fi
      CMD_PID=$!
      
      ACTIVE_CMD_ID="$COMMAND_ID"
      ACTIVE_CMD_PID="$CMD_PID"
      
      # Stream output asynchronously so the main loop can continue polling immediately
      (
        exec 3< "$LOG_FILE"
        while true; do
          if IFS= read -r line <&3; then
            curl -s -X POST "${SERVER_URL}/api/agent/response" \
              --data-urlencode "token=${SECRET_TOKEN}" \
              --data-urlencode "id=${AGENT_ID}" \
              --data-urlencode "commandId=${COMMAND_ID}" \
              --data-urlencode "output=${line}
" \
              --data-urlencode "isEof=false" > /dev/null
          elif ! kill -0 $CMD_PID 2>/dev/null; then
            # Stream any final remaining lines after exit
            while IFS= read -r line <&3 || [ -n "$line" ]; do
              curl -s -X POST "${SERVER_URL}/api/agent/response" \
                --data-urlencode "token=${SECRET_TOKEN}" \
                --data-urlencode "id=${AGENT_ID}" \
                --data-urlencode "commandId=${COMMAND_ID}" \
                --data-urlencode "output=${line}
" \
                --data-urlencode "isEof=false" > /dev/null
            done
            break
          else
            sleep 0.1
          fi
        done
        exec 3<&-
        
        # Capture exit code from exit code file safely (avoiding sibling wait 127 bug)
        if [ -f "$EXIT_FILE" ]; then
          EXIT_CODE=$(cat "$EXIT_FILE")
          rm -f "$EXIT_FILE"
        else
          EXIT_CODE=137 # Default SIGKILL / fallback exit code
        fi
        
        # Submit EOF and final exit code
        curl -s -X POST "${SERVER_URL}/api/agent/response" \
          --data-urlencode "token=${SECRET_TOKEN}" \
          --data-urlencode "id=${AGENT_ID}" \
          --data-urlencode "commandId=${COMMAND_ID}" \
          --data-urlencode "isEof=true" \
          --data-urlencode "exitCode=${EXIT_CODE}" > /dev/null
          
        rm -f "$LOG_FILE"
        echo "Finished command ($COMMAND_ID) with exit code $EXIT_CODE"
      ) &
      
      # Poll again immediately to check if there are more queued commands
      SLEEP_TIME=0.2
    fi
  else
    echo "Connection to server failed. Retrying in 5 seconds..."
    SLEEP_TIME=5
  fi

  sleep "$SLEEP_TIME"
done
