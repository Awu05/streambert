#!/bin/sh
set -eu

if [ -z "${STREAMBERT_PASSWORD:-}" ]; then
    echo "STREAMBERT_PASSWORD must be set (see docker-compose.web.yml)" >&2
    exit 1
fi

case "$PUID" in 0|""|*[!0-9]*) echo "PUID must be a positive user ID" >&2; exit 1 ;; esac
case "$PGID" in 0|""|*[!0-9]*) echo "PGID must be a positive group ID" >&2; exit 1 ;; esac
groupmod -o -g "$PGID" streambert
usermod -o -u "$PUID" -g "$PGID" streambert

mkdir -p /config/Downloads
for directory in /config /config/Downloads; do
    if [ -n "$(find "$directory" -xdev \( ! -uid "$PUID" -o ! -gid "$PGID" \) -print -quit)" ]; then
        find "$directory" -xdev -exec chown -h "$PUID:$PGID" {} +
    fi
done

exec setpriv --reuid="$PUID" --regid="$PGID" --init-groups \
    xvfb-run -a -s "-screen 0 1280x720x24 -nolisten tcp" \
    /opt/streambert/streambert --no-sandbox --password-store=basic --disable-gpu "$@"
