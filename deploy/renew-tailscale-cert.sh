#!/usr/bin/env bash
# Fetch or renew the Tailscale HTTPS certificate used by nginx and reload nginx.
#
# `tailscale cert` is idempotent: it only contacts Let's Encrypt when the existing cert is
# missing or close to expiry (certs last ~90 days). Run it daily from root's crontab:
#
#   0 4 * * * /home/jetson/auto-print/deploy/renew-tailscale-cert.sh >> /var/log/autoprint-cert.log 2>&1
#
# Requires MagicDNS and "HTTPS Certificates" to be enabled for the tailnet (admin console → DNS).
set -euo pipefail

CERT_DIR=/etc/ssl/tailscale
NAME="${1:-$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')}"

mkdir -p "$CERT_DIR"
tailscale cert --cert-file "$CERT_DIR/$NAME.crt" --key-file "$CERT_DIR/$NAME.key" "$NAME"
chmod 640 "$CERT_DIR/$NAME.key"
chgrp www-data "$CERT_DIR/$NAME.key" 2>/dev/null || true

if nginx -t >/dev/null 2>&1; then
	systemctl reload nginx
	echo "$(date -Is) certificate for $NAME ok, nginx reloaded"
else
	echo "$(date -Is) nginx config test failed; not reloading" >&2
	exit 1
fi
