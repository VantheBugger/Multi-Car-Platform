#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-start}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TEST_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="$TEST_ROOT/.runtime/real-cloud"
LOG_DIR="$RUNTIME_DIR/logs"
PID_DIR="$RUNTIME_DIR/pids"
STATE_DIR="$RUNTIME_DIR/state"
MQTT_CONFIG="$RUNTIME_DIR/mosquitto.conf"

NODE_BIN_DIR="${NODE_BIN_DIR:-/home/van/miniconda3/bin}"
WEB_PORT="${WEB_PORT:-5173}"
WEB_URL="${WEB_URL:-http://127.0.0.1:${WEB_PORT}}"
BRIDGE_PORT="${BRIDGE_PORT:-8788}"
BRIDGE_HEALTH_URL="${BRIDGE_HEALTH_URL:-http://127.0.0.1:${BRIDGE_PORT}/health}"
BRIDGE_HOST="${BRIDGE_HOST:-0.0.0.0}"
BRIDGE_TOKEN="${BRIDGE_TOKEN:-}"
VEHICLE_ROS_VERSION="${VEHICLE_ROS_VERSION:-ros1}"

USE_LOCAL_MQTT="${USE_LOCAL_MQTT:-true}"
MQTT_HOST="${MQTT_HOST:-127.0.0.1}"
MQTT_PORT="${MQTT_PORT:-1883}"
MQTT_URL="${MQTT_URL:-mqtt://${MQTT_HOST}:${MQTT_PORT}}"
MQTT_CONTAINER="${MQTT_CONTAINER:-realcar_mqtt}"
MQTT_IMAGE="${MQTT_IMAGE:-docker.m.daocloud.io/library/eclipse-mosquitto:2}"

BRIDGE_LOG="$LOG_DIR/bridge.log"
WEB_LOG="$LOG_DIR/web.log"
MQTT_LOG="$LOG_DIR/mqtt.log"
DOCKERD_LOG="$LOG_DIR/dockerd.log"

if [[ -d "$NODE_BIN_DIR" ]]; then
  export PATH="$NODE_BIN_DIR:$PATH"
fi

mkdir -p "$LOG_DIR" "$PID_DIR" "$STATE_DIR"

LOCK_FILE="$RUNTIME_DIR/run-cloud-real.lock"
RUN_LOCK_HELD=false
exec 9>"$LOCK_FILE"

log() {
  printf '[cloud-real] %s\n' "$*"
}

warn() {
  printf '[cloud-real][warn] %s\n' "$*" >&2
}

fail() {
  printf '[cloud-real][error] %s\n' "$*" >&2
  exit 1
}

case "$VEHICLE_ROS_VERSION" in
  1|ros1)
    VEHICLE_ROS_VERSION="ros1"
    ;;
  2|ros2)
    VEHICLE_ROS_VERSION="ros2"
    ;;
  *)
    fail "unsupported VEHICLE_ROS_VERSION=$VEHICLE_ROS_VERSION (expected ros1 or ros2)"
    ;;
esac

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"
}

pid_file() {
  printf '%s/%s.pid\n' "$PID_DIR" "$1"
}

write_pid() {
  printf '%s\n' "$2" > "$(pid_file "$1")"
}

read_pid() {
  local file
  file="$(pid_file "$1")"
  [[ -f "$file" ]] && cat "$file"
}

clear_pid() {
  rm -f -- "$(pid_file "$1")"
}

pid_running() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

try_acquire_run_lock() {
  [[ "$RUN_LOCK_HELD" == "true" ]] && return 0
  command -v flock >/dev/null 2>&1 || return 0
  flock -n 9 || return 1
  RUN_LOCK_HELD=true
}

lock_holder_pids() {
  {
    if command -v fuser >/dev/null 2>&1; then
      fuser "$LOCK_FILE" 2>/dev/null | tr ' ' '\n'
    fi
    if command -v lsof >/dev/null 2>&1; then
      lsof -t "$LOCK_FILE" 2>/dev/null
    fi
  } | awk '/^[0-9]+$/' | sort -u
}

is_cloud_launcher_process() {
  local pid="$1"
  local cmdline
  cmdline="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ "$cmdline" == *"run-cloud-real.sh"* ]]
}

stop_active_cloud_launchers() {
  local pid pids
  pids="$(lock_holder_pids || true)"

  while read -r pid; do
    [[ -n "$pid" && "$pid" != "$BASHPID" ]] || continue
    is_cloud_launcher_process "$pid" || continue

    local cmdline
    cmdline="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    if [[ "$cmdline" == *" run-cloud-real.sh stop"* ]]; then
      warn "another stop command is already running (pid=$pid); waiting for it"
      continue
    fi

    warn "stopping active cloud launcher pid=$pid so $ACTION can proceed"
    kill -TERM "$pid" >/dev/null 2>&1 || true
  done <<< "$pids"

  wait_for 12 try_acquire_run_lock || true
}

prepare_action_lock() {
  command -v flock >/dev/null 2>&1 || return 0
  try_acquire_run_lock && return 0

  case "$ACTION" in
    status)
      warn "another cloud command holds the lock; reporting current process state"
      return 0
      ;;
    stop|restart)
      warn "cloud lock is held; checking whether an earlier launcher must be stopped"
      stop_active_cloud_launchers
      if [[ "$RUN_LOCK_HELD" != "true" ]]; then
        warn "lock is still held by an existing project child; continuing with targeted cleanup"
      fi
      return 0
      ;;
    *)
      fail "another run-cloud-real.sh is already running; use '$0 stop' to clean the existing stack"
      ;;
  esac
}

wait_for() {
  local timeout="$1"
  shift
  local start now
  start="$(date +%s)"
  while true; do
    if "$@"; then
      return 0
    fi
    now="$(date +%s)"
    if (( now - start >= timeout )); then
      return 1
    fi
    sleep 2
  done
}

http_ok() {
  curl --max-time 2 -fsS "$1" >/dev/null 2>&1
}

port_ok() {
  nc -z -w 2 "$1" "$2" >/dev/null 2>&1
}

docker_ready() {
  docker info >/dev/null 2>&1
}

container_running() {
  docker ps --format '{{.Names}}' | grep -qx "$1"
}

bridge_health_json() {
  curl --max-time 2 -fsS "$BRIDGE_HEALTH_URL" 2>/dev/null || true
}

bridge_health_ok() {
  bridge_health_json | grep -q '"mqttConnected":true'
}

bridge_target_ok() {
  local health
  health="$(bridge_health_json)"
  [[ "$health" == *'"mqttConnected":true'* \
    && "$health" == *"\"mqttUrl\":\"$MQTT_URL\""* \
    && "$health" == *"\"vehicleRosVersion\":\"$VEHICLE_ROS_VERSION\""* ]]
}

bridge_script_pids() {
  ps -eo pid=,args= 2>/dev/null | while read -r pid args; do
    [[ -n "${pid:-}" ]] || continue
    [[ "$args" == *"mqtt-bridge.js"* && "$args" == *"$TEST_ROOT"* ]] || continue
    printf '%s\n' "$pid"
  done | sort -u
}

bridge_port_pids() {
  {
    if command -v ss >/dev/null 2>&1; then
      ss -ltnp "sport = :$BRIDGE_PORT" 2>/dev/null \
        | sed -n 's/.*pid=\([0-9]\+\).*/\1/p'
    fi

    if command -v lsof >/dev/null 2>&1; then
      lsof -tiTCP:"$BRIDGE_PORT" -sTCP:LISTEN 2>/dev/null
    fi

    if command -v fuser >/dev/null 2>&1; then
      fuser -n tcp "$BRIDGE_PORT" 2>/dev/null | tr ' ' '\n' | sed '/^$/d'
    fi
  } | sed '/^$/d' | sort -u
}

bridge_port_bindable() {
  python3 - "$BRIDGE_PORT" <<'PY_INNER'
import socket
import sys

port = int(sys.argv[1])
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    sock.bind(('0.0.0.0', port))
except OSError:
    sys.exit(1)
finally:
    sock.close()
PY_INNER
}

show_bridge_port_diagnostics() {
  warn "diagnostics for bridge port $BRIDGE_PORT:"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$BRIDGE_PORT" >&2 || true
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$BRIDGE_PORT" -sTCP:LISTEN >&2 || true
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -v -n tcp "$BRIDGE_PORT" >&2 || true
  fi
}

is_bridge_process() {
  local pid="$1"
  local cmdline
  cmdline="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ "$cmdline" == *"scripts/mqtt-bridge.js"* || "$cmdline" == *"mqtt-bridge.js"* ]]
}

stop_bridge_processes() {
  local pid pids=""
  pid="$(read_pid bridge || true)"
  if [[ -n "$pid" ]]; then
    pids="$pids
$pid"
  fi
  pids="$pids
$(bridge_script_pids || true)"
  pids="$pids
$(bridge_port_pids || true)"

  pids="$(printf '%s\n' "$pids" | sed '/^$/d' | sort -u)"
  [[ -n "$pids" ]] || {
    clear_pid bridge
    return 0
  }

  while read -r pid; do
    [[ -n "$pid" ]] || continue
    if ! pid_running "$pid"; then
      continue
    fi
    if is_bridge_process "$pid"; then
      log "stopping bridge pid=$pid"
      kill "$pid" >/dev/null 2>&1 || true
    else
      warn "port $BRIDGE_PORT is occupied by a non-bridge process pid=$pid; leaving it running"
    fi
  done <<< "$pids"

  wait_for 10 bridge_port_bindable || true

  while read -r pid; do
    [[ -n "$pid" ]] || continue
    if pid_running "$pid" && is_bridge_process "$pid"; then
      warn "bridge pid=$pid did not exit after SIGTERM; sending SIGKILL"
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  done <<< "$pids"

  clear_pid bridge
}

web_script_pids() {
  ps -eo pid=,args= 2>/dev/null | while read -r pid args; do
    [[ -n "${pid:-}" ]] || continue
    [[ "$args" == *"node_modules/.bin/vite"* || "$args" == *"vite --host"* || "$args" == *"npm run dev"* ]] || continue
    printf '%s\n' "$pid"
  done | sort -u
}

web_port_pids() {
  {
    if command -v ss >/dev/null 2>&1; then
      ss -ltnp "sport = :$WEB_PORT" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p'
    fi
    if command -v lsof >/dev/null 2>&1; then
      lsof -tiTCP:"$WEB_PORT" -sTCP:LISTEN 2>/dev/null
    fi
    if command -v fuser >/dev/null 2>&1; then
      fuser -n tcp "$WEB_PORT" 2>/dev/null | tr ' ' '\n'
    fi
  } | awk '/^[0-9]+$/' | sort -u
}

is_web_process() {
  local pid="$1"
  local cmdline cwd
  cmdline="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
  [[ "$cmdline" == *"node_modules/.bin/vite"* || "$cmdline" == *"vite --host"* ||
     "$cmdline" == *"npm run dev"* ]] &&
    [[ "$cwd" == "$TEST_ROOT" || "$cmdline" == *"$TEST_ROOT"* ]]
}

stop_web_processes() {
  local pid pids=""
  pid="$(read_pid web || true)"
  [[ -n "$pid" ]] && pids="$pids
$pid"
  pids="$pids
$(web_script_pids || true)"
  pids="$pids
$(web_port_pids || true)"
  pids="$(printf '%s\n' "$pids" | sed '/^$/d' | sort -u)"

  while read -r pid; do
    [[ -n "$pid" ]] || continue
    if pid_running "$pid" && is_web_process "$pid"; then
      log "stopping web pid=$pid"
      kill -TERM "$pid" >/dev/null 2>&1 || true
    elif pid_running "$pid"; then
      warn "web port $WEB_PORT is occupied by a non-project process pid=$pid; leaving it running"
    fi
  done <<< "$pids"

  wait_for 10 bash -lc "! nc -z -w 1 127.0.0.1 '$WEB_PORT' >/dev/null 2>&1" || true

  while read -r pid; do
    [[ -n "$pid" ]] || continue
    if pid_running "$pid" && is_web_process "$pid"; then
      warn "web pid=$pid did not exit after SIGTERM; sending SIGKILL"
      kill -KILL "$pid" >/dev/null 2>&1 || true
    fi
  done <<< "$pids"

  clear_pid web
}

show_log_hints() {
  log "logs:"
  log "  web:     $WEB_LOG"
  log "  bridge:  $BRIDGE_LOG"
  if [[ "$USE_LOCAL_MQTT" == "true" ]]; then
    log "  mqtt:    $MQTT_LOG"
    log "  dockerd: $DOCKERD_LOG"
  fi
}

ensure_prereqs() {
  require_cmd bash
  require_cmd curl
  require_cmd nc
  require_cmd node
  require_cmd npm
  require_cmd python3
  require_cmd setsid

  [[ -d "$TEST_ROOT/node_modules" ]] || fail "node_modules not found. Run: cd '$TEST_ROOT' && npm install"
}

prepare_mqtt_config() {
  cat > "$MQTT_CONFIG" <<'INNER_EOF'
listener 1883 0.0.0.0
allow_anonymous true
persistence false
log_dest stdout
INNER_EOF
}

start_dockerd_if_needed() {
  [[ "$USE_LOCAL_MQTT" == "true" ]] || return 0
  require_cmd docker

  if docker_ready; then
    return 0
  fi

  local existing_pid
  existing_pid="$(pgrep -f 'dockerd --host=unix:///var/run/docker.sock' | head -n1 || true)"
  if [[ -n "$existing_pid" ]]; then
    wait_for 60 docker_ready || fail "dockerd exists but did not become ready"
    return 0
  fi

  log "starting dockerd"
  setsid env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
    dockerd --host=unix:///var/run/docker.sock --max-concurrent-downloads=2 \
    9>&- >"$DOCKERD_LOG" 2>&1 < /dev/null &
  write_pid dockerd "$!"

  wait_for 90 docker_ready || {
    tail -n 80 "$DOCKERD_LOG" >&2 || true
    fail "dockerd failed to start"
  }
}

start_local_mqtt_if_needed() {
  [[ "$USE_LOCAL_MQTT" == "true" ]] || return 0

  prepare_mqtt_config
  if container_running "$MQTT_CONTAINER" && port_ok "$MQTT_HOST" "$MQTT_PORT"; then
    log "mqtt broker already running"
    return 0
  fi

  log "starting local mqtt broker"
  docker rm -f "$MQTT_CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$MQTT_CONTAINER" --network host \
    -v "$MQTT_CONFIG:/mosquitto/config/mosquitto.conf:ro" \
    "$MQTT_IMAGE" >/dev/null

  wait_for 30 port_ok "$MQTT_HOST" "$MQTT_PORT" || fail "mqtt broker did not open ${MQTT_HOST}:${MQTT_PORT}"
  docker logs "$MQTT_CONTAINER" >"$MQTT_LOG" 2>&1 || true
}

start_web() {
  if http_ok "$WEB_URL"; then
    log "web already reachable: $WEB_URL"
    return 0
  fi

  log "starting web"
  : >"$WEB_LOG"
  setsid bash -lc "cd '$TEST_ROOT' && export PATH='$PATH' && npm run dev -- --host 0.0.0.0" \
    9>&- >"$WEB_LOG" 2>&1 < /dev/null &
  write_pid web "$!"

  wait_for 60 http_ok "$WEB_URL" || {
    tail -n 120 "$WEB_LOG" >&2 || true
    fail "web failed to become reachable"
  }
}

start_bridge() {
  if bridge_target_ok; then
    log "bridge already healthy -> $MQTT_URL"
    return 0
  fi

  if bridge_health_ok; then
    warn "bridge target differs from requested MQTT/profile; restarting bridge"
  fi

  stop_bridge_processes
  if ! bridge_port_bindable; then
    show_bridge_port_diagnostics
    fail "bridge port $BRIDGE_PORT is still occupied; set BRIDGE_PORT=8788 or stop the process shown above"
  fi

  log "starting bridge -> $MQTT_URL"
  : >"$BRIDGE_LOG"
  setsid bash -lc "cd '$TEST_ROOT' && export PATH='$PATH' && node scripts/mqtt-bridge.js --mqtt='$MQTT_URL' --host='$BRIDGE_HOST' --port='$BRIDGE_PORT' --sim-backend=none --vehicle-ros-version='$VEHICLE_ROS_VERSION' ${BRIDGE_TOKEN:+--bridge-token='$BRIDGE_TOKEN'}" \
    9>&- >"$BRIDGE_LOG" 2>&1 < /dev/null &
  write_pid bridge "$!"

  wait_for 60 bridge_health_ok || {
    tail -n 160 "$BRIDGE_LOG" >&2 || true
    fail "bridge failed to become healthy"
  }
}

stop_pid() {
  local name="$1"
  local pid
  pid="$(read_pid "$name" || true)"
  if ! pid_running "$pid"; then
    clear_pid "$name"
    return 0
  fi

  log "stopping $name pid=$pid"
  kill "$pid" >/dev/null 2>&1 || true
  wait_for 15 bash -lc "! kill -0 '$pid' >/dev/null 2>&1" || true
  if pid_running "$pid"; then
    warn "$name pid=$pid did not exit after SIGTERM; sending SIGKILL"
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi
  clear_pid "$name"
}

start_stack() {
  ensure_prereqs
  start_dockerd_if_needed
  start_local_mqtt_if_needed
  start_web
  start_bridge
  log "all cloud services are ready"
  log "vehicle ROS profile: $VEHICLE_ROS_VERSION"
  log "urls: $WEB_URL  ws://127.0.0.1:${BRIDGE_PORT}/bridge"
  show_log_hints
}

stop_stack() {
  stop_bridge_processes
  stop_web_processes
  if [[ "$USE_LOCAL_MQTT" == "true" ]]; then
    docker rm -f "$MQTT_CONTAINER" >/dev/null 2>&1 || true
  fi
}

status_stack() {
  printf 'vehicle:  %s\n' "$VEHICLE_ROS_VERSION"
  printf 'web:      %s\n' "$(http_ok "$WEB_URL" && echo ready || echo down)"
  printf 'bridge:   %s\n' "$(bridge_health_ok && echo healthy || echo down)"
  if [[ "$USE_LOCAL_MQTT" == "true" ]]; then
    printf 'mqtt:     %s\n' "$(port_ok "$MQTT_HOST" "$MQTT_PORT" && echo ready || echo down)"
  else
    printf 'mqtt:     external (%s)\n' "$MQTT_URL"
  fi
  show_log_hints
}

case "$ACTION" in
  start)
    prepare_action_lock
    start_stack
    ;;
  stop)
    prepare_action_lock
    stop_stack
    ;;
  restart)
    prepare_action_lock
    stop_stack
    try_acquire_run_lock || fail "cloud lock remained occupied after cleanup"
    start_stack
    ;;
  status)
    prepare_action_lock
    status_stack
    ;;
  *)
    fail "unknown action: $ACTION (expected start|stop|restart|status)"
    ;;
esac
