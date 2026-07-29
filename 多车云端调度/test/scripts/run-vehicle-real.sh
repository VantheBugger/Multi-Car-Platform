#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-start}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$SCRIPT_DIR/.runtime/real-vehicle"
LOG_DIR="$RUNTIME_DIR/logs"
PID_DIR="$RUNTIME_DIR/pids"
STATE_DIR="$RUNTIME_DIR/state"

ROS_WS="${ROS_WS:-/home/van/ros1_src0702}"
ROS_SETUP="${ROS_SETUP:-/opt/ros/noetic/setup.bash}"
ROBOT_ID="${ROBOT_ID:-robot_0}"
MQTT_HOST="${MQTT_HOST:-127.0.0.1}"
MQTT_PORT="${MQTT_PORT:-1883}"
CAR_REMOTE_IP="${CAR_REMOTE_IP:-192.168.1.101}"
LOCALIZATION_MODE="${LOCALIZATION_MODE:-lio_sam}"
LOCALIZATION_CUSTOM_CMD="${LOCALIZATION_CUSTOM_CMD:-}"
START_ROSCORE="${START_ROSCORE:-true}"
START_LOCALIZATION="${START_LOCALIZATION:-true}"
START_CAR_CTR="${START_CAR_CTR:-true}"
START_PATHTRACK="${START_PATHTRACK:-true}"
START_TASK_MANAGER="${START_TASK_MANAGER:-true}"
START_MQTT_COMM="${START_MQTT_COMM:-true}"
PATHTRACK_RUN_ENABLE="${PATHTRACK_RUN_ENABLE:-true}"
MQTT_START_SUB="${MQTT_START_SUB:-false}"
MQTT_START_GOAL_SUB="${MQTT_START_GOAL_SUB:-true}"
MQTT_START_PATH_SUB="${MQTT_START_PATH_SUB:-true}"
MQTT_START_PUB="${MQTT_START_PUB:-true}"

mkdir -p "$LOG_DIR" "$PID_DIR" "$STATE_DIR"

log() {
  printf '[vehicle-real] %s\n' "$*"
}

warn() {
  printf '[vehicle-real][warn] %s\n' "$*" >&2
}

fail() {
  printf '[vehicle-real][error] %s\n' "$*" >&2
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

state_file() {
  printf '%s/%s.state\n' "$STATE_DIR" "$1"
}

write_state() {
  printf '%s\n' "$2" > "$(state_file "$1")"
}

read_state() {
  local file
  file="$(state_file "$1")"
  [[ -f "$file" ]] && cat "$file"
}

clear_state() {
  rm -f -- "$(state_file "$1")"
}

pid_running() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
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

ros_env_cmd() {
  cat <<INNER_EOF
set -e
source "$ROS_SETUP"
cd "$ROS_WS"
[ ! -f devel/setup.bash ] || source devel/setup.bash
INNER_EOF
}

ros_ok() {
  bash -lc "$(ros_env_cmd)
rostopic list >/dev/null 2>&1"
}

topic_ready() {
  local topic="$1"
  bash -lc "$(ros_env_cmd)
timeout 3 rostopic echo -n 1 '$topic' >/dev/null 2>&1"
}

show_log_hints() {
  log "logs:"
  log "  roscore:      $LOG_DIR/roscore.log"
  log "  localization: $LOG_DIR/localization.log"
  log "  car_ctr:      $LOG_DIR/car_ctr.log"
  log "  pathtrack:    $LOG_DIR/pathtrack.log"
  log "  task_manager: $LOG_DIR/task_manager.log"
  log "  mqtt_comm:    $LOG_DIR/mqtt_comm.log"
}

ensure_prereqs() {
  require_cmd bash
  require_cmd setsid
  require_cmd timeout
  [[ -f "$ROS_SETUP" ]] || fail "ROS setup not found: $ROS_SETUP"
  [[ -d "$ROS_WS/src" ]] || fail "ROS workspace not found: $ROS_WS"
}

start_background_ros() {
  local name="$1"
  local log_file="$2"
  shift 2
  local cmd="$*"
  local pid
  pid="$(read_pid "$name" || true)"
  if pid_running "$pid"; then
    log "$name already running"
    return 0
  fi

  : >"$log_file"
  setsid bash -lc "$(ros_env_cmd)
$cmd" >"$log_file" 2>&1 < /dev/null &
  write_pid "$name" "$!"
  log "started $name"
}

start_roscore() {
  [[ "$START_ROSCORE" == "true" ]] || return 0
  if ros_ok; then
    log "roscore already reachable"
    write_state roscore_owned false
    return 0
  fi

  start_background_ros roscore "$LOG_DIR/roscore.log" "roscore"
  write_state roscore_owned true
  wait_for 20 ros_ok || {
    tail -n 120 "$LOG_DIR/roscore.log" >&2 || true
    fail "roscore failed to start"
  }
}

localization_command() {
  if [[ -n "$LOCALIZATION_CUSTOM_CMD" ]]; then
    printf '%s\n' "$LOCALIZATION_CUSTOM_CMD"
    return 0
  fi

  case "$LOCALIZATION_MODE" in
    none)
      return 1
      ;;
    lio_sam)
      printf '%s\n' "roslaunch lio_sam run.launch"
      ;;
    fast_lio)
      printf '%s\n' "roslaunch fast_lio_localization localization_velodyne.launch"
      ;;
    *)
      fail "unsupported LOCALIZATION_MODE=$LOCALIZATION_MODE"
      ;;
  esac
}

start_localization() {
  [[ "$START_LOCALIZATION" == "true" ]] || return 0
  local cmd
  if ! cmd="$(localization_command)"; then
    log "localization startup skipped"
    return 0
  fi
  start_background_ros localization "$LOG_DIR/localization.log" "$cmd"
}

start_car_ctr() {
  [[ "$START_CAR_CTR" == "true" ]] || return 0
  start_background_ros car_ctr "$LOG_DIR/car_ctr.log" "rosrun car_ctr car_ctr _remote_ip:=$CAR_REMOTE_IP __name:=car_ctr"
}

start_pathtrack() {
  [[ "$START_PATHTRACK" == "true" ]] || return 0
  start_background_ros pathtrack "$LOG_DIR/pathtrack.log" "roslaunch pathtrack run.launch run_enable:=$PATHTRACK_RUN_ENABLE"
}

start_task_manager() {
  [[ "$START_TASK_MANAGER" == "true" ]] || return 0
  start_background_ros task_manager "$LOG_DIR/task_manager.log" "roslaunch task_manager run_real.launch"
}

start_mqtt_comm() {
  [[ "$START_MQTT_COMM" == "true" ]] || return 0
  start_background_ros mqtt_comm "$LOG_DIR/mqtt_comm.log" \
    "roslaunch mqtt_comm run.launch robot_id:=$ROBOT_ID mqtt_host:=$MQTT_HOST mqtt_port:=$MQTT_PORT start_pub:=$MQTT_START_PUB start_sub:=$MQTT_START_SUB start_goal_sub:=$MQTT_START_GOAL_SUB start_path_sub:=$MQTT_START_PATH_SUB"
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
  start_roscore
  start_localization
  start_car_ctr
  start_pathtrack
  start_task_manager
  start_mqtt_comm

  log "vehicle stack started"
  if topic_ready /localization; then
    log "/localization is publishing"
  else
    warn "/localization not ready yet"
  fi
  if topic_ready /car_state; then
    log "/car_state is publishing"
  else
    warn "/car_state not ready yet"
  fi
  show_log_hints
}

stop_stack() {
  stop_pid mqtt_comm
  stop_pid task_manager
  stop_pid pathtrack
  stop_pid car_ctr
  stop_pid localization
  if [[ "$(read_state roscore_owned || true)" == "true" ]]; then
    stop_pid roscore
  else
    clear_pid roscore
    log "skipping roscore stop because it was not started by this script"
  fi
  clear_state roscore_owned
}

status_stack() {
  printf 'roscore:      %s\n' "$(ros_ok && echo ready || echo down)"
  printf 'localization: %s\n' "$(topic_ready /localization && echo ready || echo waiting)"
  printf 'car_state:    %s\n' "$(topic_ready /car_state && echo ready || echo waiting)"
  printf 'current_pose: %s\n' "$(topic_ready /current_pose && echo ready || echo waiting)"
  printf 'cloud_path:   %s\n' "$(topic_ready /cloud_planned_path && echo ready || echo idle)"
  show_log_hints
}

case "$ACTION" in
  start)
    start_stack
    ;;
  stop)
    stop_stack
    ;;
  restart)
    stop_stack
    start_stack
    ;;
  status)
    status_stack
    ;;
  *)
    fail "unknown action: $ACTION (expected start|stop|restart|status)"
    ;;
esac
