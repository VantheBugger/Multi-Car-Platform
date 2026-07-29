#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-start}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLOUD_SCRIPT="$SCRIPT_DIR/run-cloud-real.sh"
ROS1_VEHICLE_SCRIPT="${ROS1_VEHICLE_SCRIPT:-$SCRIPT_DIR/run-vehicle-real.sh}"
ROS2_VEHICLE_SCRIPT="${ROS2_VEHICLE_SCRIPT:-$SCRIPT_DIR/run-vehicle-ros2.sh}"

VEHICLE_MODE="${VEHICLE_MODE:-local}"
VEHICLE_SSH="${VEHICLE_SSH:-}"
VEHICLE_ROS_VERSION="${VEHICLE_ROS_VERSION:-ros1}"

log() {
  printf '[real-stack] %s\n' "$*"
}

fail() {
  printf '[real-stack][error] %s\n' "$*" >&2
  exit 1
}

case "$VEHICLE_ROS_VERSION" in
  1|ros1)
    VEHICLE_ROS_VERSION="ros1"
    VEHICLE_SCRIPT="${VEHICLE_SCRIPT:-$ROS1_VEHICLE_SCRIPT}"
    ;;
  2|ros2)
    VEHICLE_ROS_VERSION="ros2"
    VEHICLE_SCRIPT="${VEHICLE_SCRIPT:-$ROS2_VEHICLE_SCRIPT}"
    ;;
  *)
    fail "unsupported VEHICLE_ROS_VERSION=$VEHICLE_ROS_VERSION (expected ros1 or ros2)"
    ;;
esac

REMOTE_VEHICLE_SCRIPT="${REMOTE_VEHICLE_SCRIPT:-$VEHICLE_SCRIPT}"

ssh_env_prefix() {
  local vars=(
    ROS_WS ROS_SETUP ROS_DISTRO ROS2_WS ROS2_SETUP ROS_DOMAIN_ID ROS_LOCALHOST_ONLY RMW_IMPLEMENTATION AUTO_BUILD
    ROBOT_ID MQTT_HOST MQTT_PORT CAR_REMOTE_IP
    LOCALIZATION_MODE LOCALIZATION_CUSTOM_CMD LOCALIZATION_COMMAND
    START_ROSCORE START_LOCALIZATION START_CAR_CTR START_PATHTRACK START_TASK_MANAGER START_MQTT_COMM
    START_CHASSIS_DRIVER START_NAVIGATION START_MQTT
    PATHTRACK_RUN_ENABLE MQTT_START_SUB MQTT_START_GOAL_SUB MQTT_START_PATH_SUB MQTT_START_PUB
  )
  local name value out=""
  for name in "${vars[@]}"; do
    value="${!name-}"
    [[ -n "${value}" ]] || continue
    printf -v out '%s %s=%q' "$out" "$name" "$value"
  done
  printf '%s\n' "${out# }"
}

run_vehicle() {
  case "$VEHICLE_MODE" in
    local)
      "$VEHICLE_SCRIPT" "$ACTION"
      ;;
    ssh)
      [[ -n "$VEHICLE_SSH" ]] || fail "VEHICLE_SSH is required when VEHICLE_MODE=ssh"
      local env_prefix
      env_prefix="$(ssh_env_prefix)"
      ssh "$VEHICLE_SSH" "env ${env_prefix} bash -lc '$REMOTE_VEHICLE_SCRIPT $ACTION'"
      ;;
    none)
      log "vehicle step skipped (VEHICLE_MODE=none)"
      ;;
    *)
      fail "unsupported VEHICLE_MODE=$VEHICLE_MODE"
      ;;
  esac
}

case "$ACTION" in
  start|stop|restart|status)
    VEHICLE_ROS_VERSION="$VEHICLE_ROS_VERSION" "$CLOUD_SCRIPT" "$ACTION"
    log "vehicle ROS profile: $VEHICLE_ROS_VERSION"
    run_vehicle
    ;;
  *)
    fail "unknown action: $ACTION (expected start|stop|restart|status)"
    ;;
esac
