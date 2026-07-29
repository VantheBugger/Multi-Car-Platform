#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-start}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TEST_ROOT="$SCRIPT_DIR"
REAL2SIM_WORKSPACE="/home/van/real2sim0702"
RUNTIME_DIR="$TEST_ROOT/.runtime/e2e"
LOG_DIR="$RUNTIME_DIR/logs"
PID_DIR="$RUNTIME_DIR/pids"
STATE_DIR="$RUNTIME_DIR/state"
MQTT_CONFIG="$RUNTIME_DIR/mosquitto.conf"
NODE_BIN_DIR="/home/van/miniconda3/bin"
BRIDGE_PORT="${BRIDGE_PORT:-8788}"
BRIDGE_HEALTH_URL="http://127.0.0.1:${BRIDGE_PORT}/health"
WEB_PORT="${WEB_PORT:-5173}"
WEB_URL="http://127.0.0.1:${WEB_PORT}"
ROSBRIDGE_HOST="127.0.0.1"
ROSBRIDGE_PORT="6021"
MQTT_HOST="127.0.0.1"
MQTT_PORT="1883"
BRIDGE_MQTT_URL="mqtt://${MQTT_HOST}:${MQTT_PORT}"
MQTT_CONTAINER="real2sim_mqtt"
GAZEBO_CONTAINER="real2sim_gazebo"
SIM_ROBOT_ID="robot_0"
SIM_PROFILE="${SIM_PROFILE:-lite}"
case "$SIM_PROFILE" in
  lite)
    SIM_LAUNCH_FILE="launch/run_task_manager_sim_lite.launch"
    SIM_GUI="${SIM_GUI:-false}"
    SIM_PHYSICS_RATE="${SIM_PHYSICS_RATE:-100}"
    SIM_REQUIRE_ROSBRIDGE="false"
    ;;
  full)
    SIM_LAUNCH_FILE="launch/run_task_manager_sim.launch"
    SIM_GUI="${SIM_GUI:-true}"
    SIM_PHYSICS_RATE="${SIM_PHYSICS_RATE:-1000}"
    SIM_REQUIRE_ROSBRIDGE="true"
    ;;
  *)
    printf '[e2e][error] unknown SIM_PROFILE: %s (use lite or full)\n' "$SIM_PROFILE" >&2
    exit 2
    ;;
esac
MQTT_IMAGE="docker.m.daocloud.io/library/eclipse-mosquitto:2"
DOCKERD_LOG="$LOG_DIR/dockerd.log"
MQTT_LOG="$LOG_DIR/mqtt.log"
BRIDGE_LOG="$LOG_DIR/bridge.log"
WEB_LOG="$LOG_DIR/web.log"

if [[ -d "$NODE_BIN_DIR" ]]; then
  export PATH="$NODE_BIN_DIR:$PATH"
fi

mkdir -p "$LOG_DIR" "$PID_DIR" "$STATE_DIR"

log() {
  printf '[e2e] %s\n' "$*"
}

warn() {
  printf '[e2e][warn] %s\n' "$*" >&2
}

fail() {
  printf '[e2e][error] %s\n' "$*" >&2
  exit 1
}

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

http_ok() {
  curl --max-time 2 -fsS "$1" >/dev/null 2>&1
}

port_ok() {
  nc -z -w 2 "$1" "$2" >/dev/null 2>&1
}

pids_listening_on_port() {
  ss -ltnp 2>/dev/null | grep -E ":$1\s" | grep -o 'pid=[0-9]\+' | cut -d= -f2 | sort -u
}

project_process_matches() {
  local pid="$1"
  local needle="$2"
  local cwd command

  [[ -d "/proc/$pid" ]] || return 1
  cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
  command="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  [[ "$cwd" == "$TEST_ROOT" && "$command" == *"$needle"* ]]
}

process_group_running() {
  local pgid="${1:-}"
  [[ -n "$pgid" ]] && kill -0 -- "-$pgid" >/dev/null 2>&1
}

process_group_stopped() {
  ! process_group_running "$1"
}

pid_stopped() {
  ! pid_running "$1"
}

stop_process_group() {
  local name="$1"
  local pid="$2"
  local pgid current_pgid

  pid_running "$pid" || return 0
  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
  current_pgid="$(ps -o pgid= -p "$$" 2>/dev/null | tr -d '[:space:]')"

  if [[ "$pgid" =~ ^[0-9]+$ && "$pgid" != "$current_pgid" && "$pgid" -gt 1 ]]; then
    log "stopping $name process group pgid=$pgid (pid=$pid)"
    kill -TERM -- "-$pgid" >/dev/null 2>&1 || true
    if ! wait_for 15 process_group_stopped "$pgid"; then
      warn "$name process group pgid=$pgid did not exit after SIGTERM; sending SIGKILL"
      kill -KILL -- "-$pgid" >/dev/null 2>&1 || true
    fi
    return 0
  fi

  log "stopping $name pid=$pid"
  kill -TERM "$pid" >/dev/null 2>&1 || true
  if ! wait_for 15 pid_stopped "$pid"; then
    warn "$name pid=$pid did not exit after SIGTERM; sending SIGKILL"
    kill -KILL "$pid" >/dev/null 2>&1 || true
  fi
}

stop_bridge_instances() {
  local pid
  local recorded_pid
  local bridge_pids

  recorded_pid="$(read_pid bridge || true)"

  bridge_pids="$(
    {
      printf '%s\n' "$recorded_pid"
      pgrep -f 'node scripts/mqtt-bridge\.js' || true
      pids_listening_on_port "$BRIDGE_PORT" || true
    } | awk 'NF' | sort -u
  )"

  if [[ -z "$bridge_pids" ]]; then
    clear_pid bridge
    return 0
  fi

  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    if pid_running "$pid"; then
      if [[ "$pid" == "$recorded_pid" ]] || project_process_matches "$pid" 'scripts/mqtt-bridge.js'; then
        stop_process_group bridge "$pid"
      else
        warn "skipping non-project process pid=$pid discovered on bridge port $BRIDGE_PORT"
      fi
    fi
  done <<< "$bridge_pids"

  clear_pid bridge
}

stop_web_instances() {
  local pid
  local recorded_pid
  local web_pids

  recorded_pid="$(read_pid web || true)"
  web_pids="$(
    {
      printf '%s\n' "$recorded_pid"
      pgrep -f 'node_modules/\.bin/vite' || true
      pids_listening_on_port "$WEB_PORT" || true
    } | awk 'NF' | sort -u
  )"

  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    if pid_running "$pid"; then
      if [[ "$pid" == "$recorded_pid" ]] || project_process_matches "$pid" 'node_modules/.bin/vite'; then
        stop_process_group web "$pid"
      else
        warn "skipping non-project process pid=$pid discovered on web port $WEB_PORT"
      fi
    fi
  done <<< "$web_pids"

  clear_pid web
}

stop_local_sim_instances() {
  local pid
  local sim_pids

  sim_pids="$(pgrep -f 'node scripts/mqtt-sim\.js' || true)"
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    if pid_running "$pid" && project_process_matches "$pid" 'scripts/mqtt-sim.js'; then
      stop_process_group simulator "$pid"
    fi
  done <<< "$sim_pids"
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

bridge_health_ok() {
  curl --max-time 2 -fsS "$BRIDGE_HEALTH_URL" 2>/dev/null | grep -q '"mqttConnected":true'
}

docker_ready() {
  docker info >/dev/null 2>&1
}

container_running() {
  docker ps --format '{{.Names}}' | grep -qx "$1"
}

prepare_mqtt_config() {
  cat > "$MQTT_CONFIG" <<'INNER_EOF'
listener 1883 0.0.0.0
allow_anonymous true
persistence false
log_dest stdout
INNER_EOF
}

show_log_hints() {
  log "logs:"
  log "  dockerd: $DOCKERD_LOG"
  log "  mqtt:    $MQTT_LOG"
  log "  bridge:  $BRIDGE_LOG"
  log "  web:     $WEB_LOG"
}

ensure_prereqs() {
  require_cmd bash
  require_cmd curl
  require_cmd nc
  require_cmd node
  require_cmd npm
  require_cmd docker
  require_cmd setsid

  [[ -d "$TEST_ROOT/node_modules" ]] || fail "node_modules not found. Run: cd '$TEST_ROOT' && npm install"
  [[ -d "$REAL2SIM_WORKSPACE" ]] || fail "workspace not found: $REAL2SIM_WORKSPACE"
  [[ -f "$TEST_ROOT/scripts/gazebo-container-run.sh" ]] || fail "missing runner: $TEST_ROOT/scripts/gazebo-container-run.sh"
}

start_dockerd() {
  if docker_ready; then
    log "docker daemon already ready"
    return 0
  fi

  local existing_pid
  existing_pid="$(pgrep -f 'dockerd --host=unix:///var/run/docker.sock' | head -n1 || true)"
  if [[ -n "$existing_pid" ]]; then
    log "dockerd process exists, waiting for readiness"
    wait_for 60 docker_ready || fail "dockerd exists but did not become ready"
    return 0
  fi

  log "starting dockerd"
  setsid env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
    dockerd --host=unix:///var/run/docker.sock --max-concurrent-downloads=2 \
    >"$DOCKERD_LOG" 2>&1 < /dev/null &
  write_pid dockerd "$!"

  wait_for 90 docker_ready || {
    tail -n 80 "$DOCKERD_LOG" >&2 || true
    fail "dockerd failed to start"
  }
}

start_mqtt() {
  prepare_mqtt_config

  if container_running "$MQTT_CONTAINER" && port_ok "$MQTT_HOST" "$MQTT_PORT"; then
    log "mqtt broker already running"
    return 0
  fi

  log "starting mqtt broker container"
  docker rm -f "$MQTT_CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$MQTT_CONTAINER" --network host \
    -v "$MQTT_CONFIG:/mosquitto/config/mosquitto.conf:ro" \
    "$MQTT_IMAGE" >/dev/null

  wait_for 30 port_ok "$MQTT_HOST" "$MQTT_PORT" || fail "mqtt broker did not open ${MQTT_HOST}:${MQTT_PORT}"
  docker logs "$MQTT_CONTAINER" >"$MQTT_LOG" 2>&1 || true
}

start_bridge() {
  if bridge_health_ok; then
    log "bridge already healthy"
    return 0
  fi

  local pid
  pid="$(read_pid bridge || true)"
  if pid_running "$pid"; then
    log "bridge pid exists, waiting for health"
    wait_for 60 bridge_health_ok || {
      tail -n 120 "$BRIDGE_LOG" >&2 || true
      fail "bridge process exists but health check failed"
    }
    return 0
  fi
  stop_bridge_instances

  log "starting bridge with local mqtt ${BRIDGE_MQTT_URL}"
  : >"$BRIDGE_LOG"
  setsid bash -lc "cd '$TEST_ROOT' && export PATH='$PATH' && node scripts/mqtt-bridge.js --mqtt='$BRIDGE_MQTT_URL' --port='$BRIDGE_PORT' --sim-backend=gazebo-docker --sim-workspace='$REAL2SIM_WORKSPACE' --sim-launch='$SIM_LAUNCH_FILE' --sim-robot-id='$SIM_ROBOT_ID' --sim-gui='$SIM_GUI' --sim-physics-rate='$SIM_PHYSICS_RATE' --sim-docker-runner='$TEST_ROOT/scripts/gazebo-container-run.sh'" \
    >"$BRIDGE_LOG" 2>&1 < /dev/null &
  write_pid bridge "$!"

  wait_for 90 bridge_health_ok || {
    tail -n 160 "$BRIDGE_LOG" >&2 || true
    fail "bridge failed to become healthy"
  }
}

start_web() {
  if http_ok "$WEB_URL"; then
    log "web already reachable: $WEB_URL"
    return 0
  fi

  local pid
  pid="$(read_pid web || true)"
  if pid_running "$pid"; then
    log "web pid exists, waiting for readiness"
    wait_for 60 http_ok "$WEB_URL" || {
      tail -n 120 "$WEB_LOG" >&2 || true
      fail "web process exists but did not become reachable"
    }
    return 0
  fi
  clear_pid web

  log "starting web dev server"
  setsid bash -lc "cd '$TEST_ROOT' && export PATH='$PATH' && npm run dev -- --host 0.0.0.0" \
    >"$WEB_LOG" 2>&1 < /dev/null &
  write_pid web "$!"

  wait_for 90 http_ok "$WEB_URL" || {
    tail -n 160 "$WEB_LOG" >&2 || true
    fail "web dev server failed to start"
  }
}

send_sim_start() {
  BRIDGE_PORT="$BRIDGE_PORT" PATH="$PATH" node <<'NODE'
const WebSocket = require('/home/van/platformm_wang/多车云端调度/test/node_modules/ws');
const ws = new WebSocket(`ws://127.0.0.1:${process.env.BRIDGE_PORT}/bridge`);
let done = false;

function finish(code, message) {
  if (done) return;
  done = true;
  if (message) console.log(message);
  try { ws.close(); } catch {}
  process.exit(code);
}

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'sim_start' }));
  setTimeout(() => ws.send(JSON.stringify({ type: 'sim_status_request' })), 800);
});

ws.on('message', (raw) => {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }

  if (msg.type !== 'sim_status') return;

  if (msg.error) finish(1, `bridge sim error: ${msg.error}`);
  if (msg.exitCode !== undefined && msg.exitCode !== 0) finish(1, `bridge sim exited early: ${msg.exitCode}`);
  if (msg.started || msg.alreadyRunning || msg.active) finish(0, JSON.stringify(msg));
});

ws.on('error', (error) => finish(1, error.message));
setTimeout(() => finish(2, 'bridge sim_start timeout'), 15000);
NODE
}

wait_for_sim_ready() {
  if [[ "$SIM_REQUIRE_ROSBRIDGE" != "true" ]]; then
    log "waiting for lightweight Gazebo container"
    wait_for 180 container_running "$GAZEBO_CONTAINER" || {
      tail -n 200 "$BRIDGE_LOG" >&2 || true
      fail "lightweight Gazebo container did not remain running"
    }
    return 0
  fi

  log "waiting for rosbridge ${ROSBRIDGE_HOST}:${ROSBRIDGE_PORT}; first build may take several minutes"
  wait_for 1800 port_ok "$ROSBRIDGE_HOST" "$ROSBRIDGE_PORT" || {
    tail -n 200 "$BRIDGE_LOG" >&2 || true
    fail "gazebo/rosbridge did not become ready on ${ROSBRIDGE_HOST}:${ROSBRIDGE_PORT}"
  }
}

start_sim() {
  if container_running "$GAZEBO_CONTAINER"; then
    if [[ "$SIM_REQUIRE_ROSBRIDGE" != "true" ]] || port_ok "$ROSBRIDGE_HOST" "$ROSBRIDGE_PORT"; then
      log "gazebo container already ready for profile $SIM_PROFILE"
      return 0
    fi
  fi

  if container_running "$GAZEBO_CONTAINER"; then
    log "gazebo container is already running; waiting for required services"
    wait_for_sim_ready
    return 0
  fi

  log "triggering gazebo docker simulation via bridge"
  send_sim_start || {
    tail -n 200 "$BRIDGE_LOG" >&2 || true
    fail "failed to send sim_start"
  }

  wait_for_sim_ready
}

print_status() {
  local docker_state mqtt_state gazebo_state bridge_state web_state rosbridge_state

  if docker_ready; then
    docker_state="ready"
    mqtt_state="$(container_running "$MQTT_CONTAINER" && echo running || echo stopped)"
    gazebo_state="$(container_running "$GAZEBO_CONTAINER" && echo running || echo stopped)"
  else
    docker_state="down"
    mqtt_state="stopped"
    gazebo_state="stopped"
  fi

  bridge_state="$(bridge_health_ok && echo healthy || echo down)"
  web_state="$(http_ok "$WEB_URL" && echo ready || echo down)"
  if [[ "$SIM_REQUIRE_ROSBRIDGE" == "true" ]]; then
    rosbridge_state="$(port_ok "$ROSBRIDGE_HOST" "$ROSBRIDGE_PORT" && echo ready || echo down)"
  else
    rosbridge_state="not-required"
  fi

  printf 'profile:  %s (gui=%s physics=%sHz)\n' "$SIM_PROFILE" "$SIM_GUI" "$SIM_PHYSICS_RATE"
  printf 'docker:   %s\n' "$docker_state"
  printf 'mqtt:     %s\n' "$mqtt_state"
  printf 'bridge:   %s\n' "$bridge_state"
  printf 'web:      %s\n' "$web_state"
  printf 'gazebo:   %s\n' "$gazebo_state"
  printf 'rosbridge:%s\n' "$rosbridge_state"
  printf 'urls:     %s  ws://127.0.0.1:%s/bridge\n' "$WEB_URL" "$BRIDGE_PORT"
}

stop_pid_service() {
  local name="$1"
  local pid
  pid="$(read_pid "$name" || true)"
  if pid_running "$pid"; then
    stop_process_group "$name" "$pid"
  fi
  clear_pid "$name"
}

stop_all() {
  if docker_ready; then
    log "stopping gazebo and mqtt containers"
    docker rm -f "$GAZEBO_CONTAINER" >/dev/null 2>&1 || true
    docker rm -f "$MQTT_CONTAINER" >/dev/null 2>&1 || true
  else
    warn "docker daemon not ready; skipping container stop"
  fi

  stop_bridge_instances
  stop_local_sim_instances
  stop_web_instances

  local dockerd_pid
  dockerd_pid="$(read_pid dockerd || true)"
  if pid_running "$dockerd_pid"; then
    stop_process_group dockerd "$dockerd_pid"
  fi
  clear_pid dockerd
}

show_logs() {
  for file in "$DOCKERD_LOG" "$MQTT_LOG" "$BRIDGE_LOG" "$WEB_LOG"; do
    if [[ -f "$file" ]]; then
      printf '\n===== %s =====\n' "$file"
      tail -n 60 "$file" || true
    fi
  done
}

start_all() {
  ensure_prereqs
  start_dockerd
  start_mqtt
  start_bridge
  start_web
  start_sim
  log "all services are ready"
  print_status
  show_log_hints
}

case "$ACTION" in
  start)
    start_all
    ;;
  stop)
    stop_all
    ;;
  restart)
    stop_all
    start_all
    ;;
  status)
    print_status
    ;;
  logs)
    show_logs
    ;;
  *)
    cat >&2 <<USAGE
usage: $(basename "$0") [start|stop|restart|status|logs]
USAGE
    exit 2
    ;;
esac
