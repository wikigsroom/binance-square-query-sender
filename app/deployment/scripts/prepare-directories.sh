set -eu
if ! id square-platform >/dev/null 2>&1; then
  useradd --system --home-dir /opt/square-platform --shell /usr/sbin/nologin square-platform
fi
install -d -m 0755 /opt/square-platform /opt/square-platform/releases
install -d -m 0750 -o square-platform -g square-platform /opt/square-platform/data /opt/square-platform/npm-cache
install -d -m 0700 /opt/square-platform/deploy /opt/square-platform/backups /etc/square-platform
install -d -m 0700 -o ubuntu -g ubuntu /home/ubuntu/square-platform-upload
printf 'Square Platform deployment directories ready.\n'
