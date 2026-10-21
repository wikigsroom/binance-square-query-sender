set -eu
systemctl show square-platform.service -p ActiveState -p SubState -p MemoryCurrent
readlink -f /opt/square-platform/current
sudo -u postgres psql -X -p 5433 -d square_platform -tAc "SELECT json_build_object('accounts',(SELECT count(*) FROM accounts),'presets',(SELECT count(*) FROM presets),'connections',(SELECT count(*) FROM connections),'activeSteps',(SELECT count(*) FROM jobs WHERE data->>'state' IN ('preparing','generating_text','validating','preparing_media','ready','submitting')),'publishingPaused',(SELECT data->'paused' FROM runtime WHERE id='main'));"
curl -sS --max-time 15 -o /dev/null -w 'Public API domain HTTP %{http_code}\n' https://bn-api.sid.mom/api/v1/auth/me
