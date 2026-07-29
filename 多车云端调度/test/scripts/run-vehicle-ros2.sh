#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-start}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$SCRIPT_DIR/.runtime/real-vehicle-ros2"
LOG_DIR="$RUNTIME_DIR/logs"
PID_DIR="$RUNTIME_DIR/pids"

ROS_DISTRO="${ROS_DISTRO:-jazzy}"
ROS2_WS="${ROS2_WS:-/home/van/platformm_wang/ros2_vehicle_ws}"
ROS2_SETUP="${ROS2_SETUP:-/opt/ros/${ROS_DISTRO}/setup.bash}"
ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-0}"
ROS_LOCALHOST_ONLY="${ROS_LOCALHOST_ONLY:-0}"
RMW_IMPLEMENTATION="${RMW_IMPLEMENTATION:-}"
AUTO_BUILD="${AUTO_BUILD:-true}"
ROBOT_ID="${ROBOT_ID:-robot_0}"
MQTT_HOST="${MQTT_HOST:-127.0.0.1}"
MQTT_PORT="${MQTT_PORT:-1883}"
CAR_REMOTE_IP="${CAR_REMOTE_IP:-192.168.1.101}"
START_CHASSIS_DRIVER="${START_CHASSIS_DRIVER:-true}"
START_NAVIGATION="${START_NAVIGATION:-true}"
START_MQTT="${START_MQTT:-true}"
LOCALIZATION_COMMAND="${LOCALIZATION_COMMAND:-}"

mkdir -p "$LOG_DIR" "$PID_DIR"

log() {
  printf '[vehicle-ros2] %s\n' "$*"
}

warn() {
  printf '[vehicle-ros2][warn] %s\n' "$*" >&2
}

fail() {
  printf '[vehicle-ros2][error] %s\n' "$*" >&2
  exit 1
}

pid_file() {
  printf '%s/%s.pid\n' "$PID_DIR" "$1"
}

read_pid() {
  local file
  file="$(pid_file "$1")"
  [[ -f "$file" ]] && cat "$file"
}

pid_running() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

ros_env() {
  cat <<INNER_EOF
set -e
source "$ROS2_SETUP"
export ROS_DOMAIN_ID="$ROS_DOMAIN_ID"
export ROS_LOCALHOST_ONLY="$ROS_LOCALHOST_ONLY"
${RMW_IMPLEMENTATION:+export RMW_IMPLEMENTATION="$RMW_IMPLEMENTATION"}
cd "$ROS2_WS"
[ ! -f install/setup.bash ] || source install/setup.bash
INNER_EOF
}

ensure_prerequisites() {
  [[ -f "$ROS2_SETUP" ]] || fail "ROS 2 setup not found: $ROS2_SETUP"
  [[ -d "$ROS2_WS/src" ]] || fail "ROS 2 workspace not found: $ROS2_WS"
  command -v setsid >/dev/null 2>&1 || fail "missing command: setsid"

  if [[ ! -f "$ROS2_WS/install/setup.bash" ]]; then
    [[ "$AUTO_BUILD" == "true" ]] || fail "workspace is not built: $ROS2_WS"
    command -v colcon >/dev/null 2>&1 || fail "missing command: colcon"
    log "building ROS 2 workspace (sequential executor)"
    bash -lc "source '$ROS2_SETUP' && cd '$ROS2_WS' && colcon build --symlink-install --executor sequential"
  fi
}

start_process() {
  local name="$1"
  local command="$2"
  local pid
  pid="$(read_pid "$name" || true)"
  if pid_running "$pid"; then
    log "$name already running"
    return 0
  fi
  setsid bash -lc "$(ros_env)
$command" >"$LOG_DIR/$name.log" 2>&1 < /dev/null &
  printf '%s\n' "$!" >"$(pid_file "$name")"
  log "started $name"
}

start_stack() {
  ensure_prerequisites
  if [[ -n "$LOCALIZATION_COMMAND" ]]; then
    start_process localization "$LOCALIZATION_COMMAND"
  else
    warn "LOCALIZATION_COMMAND is empty; an external ROS 2 node must publish /localization"
  fi
  start_process vehicle_stack "ros2 launch fleet_vehicle vehicle_stack.launch.py robot_id:=$ROBOT_ID mqtt_host:=$MQTT_HOST mqtt_port:=$MQTT_PORT car_remote_ip:=$CAR_REMOTE_IP start_chassis_driver:=$START_CHASSIS_DRIVER start_navigation:=$START_NAVIGATION start_mqtt:=$START_MQTT"
  log "ROS 2 vehicle stack started (domain=$ROS_DOMAIN_ID robot=$ROBOT_ID)"
  log "logs: $LOG_DIR"
}

stop_process() {
  local name="$1"
  local pid
  pid="$(read_pid "$name" || true)"
  if pid_running "$pid"; then
    log "stopping $name pid=$pid"
    kill -- "-$pid" >/dev/null 2>&1 || kill "$pid" >/dev/null 2>&1 || true
    for _ in {1..20}; do
      pid_running "$pid" || break
      sleep 0.5
    done
    if pid_running "$pid"; then
      warn "$name did not stop; sending SIGKILL"
      kill -9 -- "-$pid" >/dev/null 2>&1 || kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  fi
  rm -f -- "$(pid_file "$name")"
}

topic_ready() {
  local topic="$1"
  bash -lc "$(ros_env)
timeout 3 ros2 topic echo --once '$topic' >/dev/null 2>&1"
}

status_stack() {
  local pid
  pid="$(read_pid vehicle_stack || true)"
  printf 'vehicle_stack: %s\n' "$(pid_running "$pid" && echo running || echo stopped)"
  printf 'localization:  %s\n' "$(topic_ready /localization && echo ready || echo waiting)"
  printf 'current_pose:  %s\n' "$(topic_ready /current_pose && echo ready || echo waiting)"
  printf 'car_state:     %s\n' "$(topic_ready /car_state && echo ready || echo waiting)"
  printf 'cloud_path:    %s\n' "$(topic_ready /cloud_planned_path && echo active || echo idle)"
  printf 'ros_domain_id: %s\n' "$ROS_DOMAIN_ID"
}

case "$ACTION" in
  start)
    start_stack
    ;;
  stop)
    stop_process vehicle_stack
    stop_process localization
    ;;
  restart)
    stop_process vehicle_stack
    stop_process localization
    start_stack
    ;;
  status)
    ensure_prerequisites
    status_stack
    ;;
  *)
    fail "unknown action: $ACTION (expected start|stop|restart|status)"
    ;;
esac
