#!/bin/sh
# Starts an XFCE session on the VNC display :1 (port 5901, password `weft`),
# then runs the command.
set -eu

mkdir -p "$HOME/.vnc"
echo weft | vncpasswd -f > "$HOME/.vnc/passwd"
chmod 600 "$HOME/.vnc/passwd"
# Leave room for the example's 844px viewport plus desktop and window chrome.
Xvnc :1 -geometry 1280x960 -depth 24 -rfbport 5901 -rfbauth "$HOME/.vnc/passwd" -localhost=0 -SecurityTypes VncAuth \
  > /tmp/xvnc.log 2>&1 &
for _ in $(seq 50); do
  [ -S /tmp/.X11-unix/X1 ] && break
  sleep 0.1
done
dbus-launch --exit-with-session startxfce4 > /tmp/xfce.log 2>&1 &

exec "$@"
