set -eu
systemctl restart square-platform.service
systemctl is-active square-platform.service
