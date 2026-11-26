# Linux desktop for building and testing Weft apps: the GTK 4 toolchain,
# kernel build dependencies, Node.js with pnpm, and an XFCE session served
# over VNC (display :1, port 5901). See compose.yaml.
FROM ubuntu:26.04

ARG NODE_VERSION=26.13.1
ARG PNPM_VERSION=11.28.12

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake ninja-build pkg-config python3 git ca-certificates curl xz-utils \
      libgtk-4-dev libsoup-3.0-dev libjson-glib-dev libfontconfig-dev librsvg2-common \
      xfce4 xfce4-terminal dbus-x11 at-spi2-core \
      tigervnc-standalone-server tigervnc-tools xdotool \
      fonts-noto-core fonts-noto-cjk fonts-inter-variable imagemagick \
    && rm -rf /var/lib/apt/lists/*

RUN arch=$(uname -m | sed -e s/x86_64/x64/ -e s/aarch64/arm64/) \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz" \
      | tar -xJ -C /usr/local --strip-components=1 \
    && npm install -g "pnpm@${PNPM_VERSION}"

COPY desktop.sh /usr/local/bin/weft-desktop

# Named volumes start with the ownership of their mount point in the image.
RUN for dir in node_modules packages/compiler/node_modules packages/content-mapper/node_modules \
      packages/platform/node_modules packages/runtime/node_modules packages/vite/node_modules \
      docs/node_modules example/node_modules tests/node_modules \
      native/apple/node_modules native/android/node_modules native/windows/node_modules \
      native/linux/node_modules; do mkdir -p "/workspace/$dir"; done \
    && mkdir -p /home/ubuntu/.local/share/pnpm \
    && chown -R ubuntu:ubuntu /workspace /home/ubuntu/.local

# Ubuntu images have the user `ubuntu` with uid 1000, the usual desktop uid.
USER ubuntu
ENV DISPLAY=:1
ENTRYPOINT ["weft-desktop"]
CMD ["sleep", "infinity"]
