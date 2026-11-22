# Headless Chromium for the showcase's Web screenshots. Fonts render the same
# on every host and architecture here, unlike on macOS, where an OS update
# changes font fallback. See compose.yaml.
#
# Keep the tag in sync with `playwright` in showcase/package.json; the image
# ships that version's browsers in /ms-playwright, and Node.js 26.
FROM mcr.microsoft.com/playwright:v1.65.1-noble

# Keep in sync with Dockerfile.
ARG PNPM_VERSION=11.28.12

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends fonts-inter-variable fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g "pnpm@${PNPM_VERSION}"

# system-ui and sans-serif otherwise resolve to WenQuanYi Zen Hei, which has
# a single weight. Inter is variable and Noto Sans CJK SC has a bold face.
COPY <<EOF /etc/fonts/local.conf
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <alias binding="strong">
    <family>system-ui</family>
    <prefer><family>Inter Variable</family><family>Noto Sans CJK SC</family></prefer>
  </alias>
  <alias binding="strong">
    <family>sans-serif</family>
    <prefer><family>Inter Variable</family><family>Noto Sans CJK SC</family></prefer>
  </alias>
</fontconfig>
EOF

# Named volumes start with the ownership of their mount point in the image.
RUN for dir in node_modules packages/compiler/node_modules packages/platform/node_modules \
      packages/runtime/node_modules packages/vite/node_modules example/node_modules \
      showcase/node_modules tests/node_modules native/apple/node_modules native/android/node_modules \
      native/windows/node_modules native/linux/node_modules; do mkdir -p "/workspace/$dir"; done \
    && mkdir -p /home/ubuntu/.local/share/pnpm \
    && chown -R ubuntu:ubuntu /workspace /home/ubuntu/.local

USER ubuntu
CMD ["sleep", "infinity"]
