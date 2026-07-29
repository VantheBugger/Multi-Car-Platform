#!/usr/bin/env bash
set -euo pipefail

WORKSPACE="/home/van/real2sim0702"
LAUNCH_FILE="launch/run_task_manager_sim.launch"
ROBOT_ID="robot_0"
MQTT_HOST="127.0.0.1"
MQTT_PORT="1883"
MAP_ID="1"
RUN_ENABLE="true"
GUI="false"
PHYSICS_RATE="100"
CATKIN_BUILD="${CATKIN_BUILD:-auto}"
FORCE_IMAGE_BUILD="${FORCE_IMAGE_BUILD:-false}"
IMAGE_NAME="real2sim-noetic:latest"
CONTAINER_NAME="real2sim_gazebo"
BRIDGE_ROOT="/home/van/platformm_wang/多车云端调度/test"
DOCKER_BIN="${DOCKER_BIN:-docker}"
ROAD_GRAPH_JSON="$BRIDGE_ROOT/public/maps/road_graph_V1.json"
GENERATED_WORLD="$WORKSPACE/src/4WIS-Robot-Simulation-Environment-main/BARN_Env/source/world_files/road_graph_minimal.world"
PLANNER_ROADMAP_PKL="$WORKSPACE/src/path_planner/src/road_graph_web.pkl"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace) WORKSPACE="$2"; shift 2 ;;
    --launch) LAUNCH_FILE="$2"; shift 2 ;;
    --robot-id) ROBOT_ID="$2"; shift 2 ;;
    --mqtt-host) MQTT_HOST="$2"; shift 2 ;;
    --mqtt-port) MQTT_PORT="$2"; shift 2 ;;
    --map-id) MAP_ID="$2"; shift 2 ;;
    --run-enable) RUN_ENABLE="$2"; shift 2 ;;
    --gui) GUI="$2"; shift 2 ;;
    --physics-rate) PHYSICS_RATE="$2"; shift 2 ;;
    --catkin-build) CATKIN_BUILD="$2"; shift 2 ;;
    --image) IMAGE_NAME="$2"; shift 2 ;;
    --container-name) CONTAINER_NAME="$2"; shift 2 ;;
    --bridge-root) BRIDGE_ROOT="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found in PATH" >&2
  exit 1
fi

if docker info >/dev/null 2>&1; then
  DOCKER_BIN="docker"
elif sudo -n docker info >/dev/null 2>&1; then
  DOCKER_BIN="sudo -n docker"
else
  echo "docker requires sudo privileges. Start the bridge with sudo or grant docker access explicitly." >&2
  exit 1
fi

if [[ ! -d "$WORKSPACE" ]]; then
  echo "workspace not found: $WORKSPACE" >&2
  exit 1
fi

if [[ ! -f "$BRIDGE_ROOT/docker/real2sim-noetic/Dockerfile" ]]; then
  echo "Dockerfile not found under $BRIDGE_ROOT/docker/real2sim-noetic" >&2
  exit 1
fi

if [[ ! -f "$ROAD_GRAPH_JSON" ]]; then
  echo "road graph not found: $ROAD_GRAPH_JSON" >&2
  exit 1
fi

node "$BRIDGE_ROOT/scripts/generate-road-world.js" \
  --graph "$ROAD_GRAPH_JSON" \
  --output "$GENERATED_WORLD" \
  --world-name road_graph_minimal \
  --world-offset-y 0.15 \
  --physics-rate "$PHYSICS_RATE"

python3 "$BRIDGE_ROOT/scripts/generate-roadmap-pkl.py" \
  --graph "$ROAD_GRAPH_JSON" \
  --output "$PLANNER_ROADMAP_PKL"

CONTAINER_LAUNCH_FILE="$LAUNCH_FILE"
LAUNCH_BASENAME="$(basename "$LAUNCH_FILE")"
if [[ -f "$BRIDGE_ROOT/ros/real2sim/$LAUNCH_BASENAME" ]]; then
  CONTAINER_LAUNCH_FILE="/bridge/real2sim/$LAUNCH_BASENAME"
fi

if [[ "$DOCKER_BIN" == "docker" ]]; then
  DOCKER_CMD=(docker)
else
  DOCKER_CMD=(sudo -n docker)
fi

if [[ "$FORCE_IMAGE_BUILD" == "true" ]] || ! "${DOCKER_CMD[@]}" image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  echo "building simulation image: $IMAGE_NAME"
  "${DOCKER_CMD[@]}" build -t "$IMAGE_NAME" "$BRIDGE_ROOT/docker/real2sim-noetic"
else
  echo "reusing existing simulation image: $IMAGE_NAME"
fi

"${DOCKER_CMD[@]}" rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

DISPLAY_OPTS=()
if [[ "$GUI" == "true" ]]; then
  XAUTH_OPT=()
  if [[ -n "${XAUTHORITY:-}" && -f "${XAUTHORITY:-}" ]]; then
    XAUTH_OPT=(-e "XAUTHORITY=/tmp/.docker.xauth" -v "$XAUTHORITY:/tmp/.docker.xauth:ro")
  fi
  DISPLAY_OPTS=(-e "DISPLAY=${DISPLAY:-:0}" -e QT_X11_NO_MITSHM=1 -e LIBGL_ALWAYS_SOFTWARE=1 -v /tmp/.X11-unix:/tmp/.X11-unix:rw "${XAUTH_OPT[@]}")
fi

ROS_COMMAND=$(cat <<INNER_EOF
set -e
source /opt/ros/noetic/setup.bash
cd /workspace/real2sim0702
SOURCE_HASH_FILE=.catkin-source.sha256
CURRENT_SOURCE_HASH=\$(find src -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print \$1}')
NEEDS_CATKIN=false
if [[ "$CATKIN_BUILD" == "always" ]]; then
  NEEDS_CATKIN=true
elif [[ "$CATKIN_BUILD" != "never" ]] && { [[ ! -f devel/setup.bash ]] || [[ ! -f "\$SOURCE_HASH_FILE" ]] || [[ "\$(cat "\$SOURCE_HASH_FILE")" != "\$CURRENT_SOURCE_HASH" ]]; }; then
  NEEDS_CATKIN=true
fi
if [[ "\$NEEDS_CATKIN" == "true" ]]; then
  echo "ROS source changed; running incremental catkin build"
  catkin_make -j1 -l1
  printf '%s\n' "\$CURRENT_SOURCE_HASH" > "\$SOURCE_HASH_FILE"
fi
source devel/setup.bash
roslaunch "$CONTAINER_LAUNCH_FILE" map_id:="$MAP_ID" run_enable:="$RUN_ENABLE" robot_id:="$ROBOT_ID" mqtt_host:="$MQTT_HOST" mqtt_port:="$MQTT_PORT" gui:="$GUI" headless:="$([[ "$GUI" == "true" ]] && echo false || echo true)"
INNER_EOF
)

"${DOCKER_CMD[@]}" run --rm --name "$CONTAINER_NAME" \
  --network host \
  "${DISPLAY_OPTS[@]}" \
  -v "$BRIDGE_ROOT/ros/real2sim:/bridge/real2sim:ro" \
  -v "$WORKSPACE:/workspace/real2sim0702:rw" \
  "$IMAGE_NAME" \
  bash -lc "$ROS_COMMAND"
