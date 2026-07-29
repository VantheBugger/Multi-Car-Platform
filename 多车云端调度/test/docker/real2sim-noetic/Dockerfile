FROM osrf/ros:noetic-desktop-full

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    python3-pip \
    python3-networkx \
    python3-numpy \
    python3-empy \
    python3-catkin-tools \
    python3-rosdep \
    python3-vcstool \
    libmosquitto-dev \
    libpcap-dev \
    libpugixml-dev \
    libgeographic-dev \
    libyaml-cpp-dev \
    libeigen3-dev \
    libboost-python-dev \
    libboost-all-dev \
    libpcl-dev \
    ros-noetic-mrt-cmake-modules \
    ros-noetic-serial \
    ros-noetic-gtsam \
    ros-noetic-gazebo-ros \
    ros-noetic-gazebo-plugins \
    ros-noetic-gazebo-ros-control \
    ros-noetic-map-server \
    ros-noetic-rosbridge-server \
    ros-noetic-ros-numpy \
    ros-noetic-velodyne \
    ros-noetic-velodyne-description \
    ros-noetic-pcl-ros \
    ros-noetic-pcl-conversions \
    ros-noetic-tf2-ros \
    ros-noetic-tf2-geometry-msgs \
    ros-noetic-tf2-sensor-msgs \
    ros-noetic-robot-state-publisher \
    ros-noetic-joint-state-publisher \
    ros-noetic-xacro \
    ros-noetic-controller-manager \
    ros-noetic-ros-control \
    ros-noetic-ros-controllers \
    ros-noetic-four-wheel-steering-msgs \
    ros-noetic-four-wheel-steering-controller \
    ros-noetic-hector-xacro-tools \
    ros-noetic-geographic-msgs \
    ros-noetic-gps-common \
    ros-noetic-nmea-navsat-driver \
    ros-noetic-move-base \
    ros-noetic-uuid-msgs \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir paho-mqtt networkx numpy

WORKDIR /workspace/real2sim0702
