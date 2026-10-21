set -eu
python3 -u - <<'PY'
import datetime, http.client, json
from pathlib import Path
origin = 'https://bn.sid.mom'
route = '/api/v1/accounts/acct_530ac324-094d-43fa-ae62-8eaa8d53b7f0/preset-bindings'
headers = {'Origin': origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type,x-csrf-token,idempotency-key'}
client = http.client.HTTPConnection('127.0.0.1', 39410, timeout=20)
client.request('OPTIONS', route, headers=headers)
response = client.getresponse()
report = {'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'method': 'OPTIONS',
          'requestedMethod': 'PUT', 'path': route, 'status': response.status,
          'headers': {k: v for k, v in response.getheaders() if k.lower().startswith('access-control')},
          'body': json.loads(response.read())}
client.close()
destination = Path('/opt/square-platform/deploy/bindings-cors-before.json')
destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
PY
install -o ubuntu -g ubuntu -m 600 /opt/square-platform/deploy/bindings-cors-before.json /home/ubuntu/square-platform-upload/bindings-cors-before.json
