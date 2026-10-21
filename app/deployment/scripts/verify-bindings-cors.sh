set -eu
systemctl is-active square-platform.service
python3 -u - <<'PY'
import datetime, http.client, json
from pathlib import Path
credentials = json.loads(Path('/opt/square-platform/deploy/bootstrap.json').read_text())
origin = 'https://bn.sid.mom'
headers = {'Origin': origin, 'Content-Type': 'application/json'}

def call(method, path, body=None, extra=None):
    client = http.client.HTTPConnection('127.0.0.1', 39410, timeout=20)
    try:
        client.request(method, '/api/v1' + path, json.dumps(body) if body is not None else None, headers | (extra or {}))
        response = client.getresponse()
        raw = response.read()
        return response.status, {k.lower(): v for k, v in response.getheaders()}, json.loads(raw) if raw else None
    finally:
        client.close()

login = call('POST', '/auth/login', {'username': credentials['adminUsername'], 'password': credentials['adminPassword']})
assert login[0] == 200
headers.update({'Cookie': login[1]['set-cookie'].split(';', 1)[0], 'X-CSRF-Token': login[2]['data']['csrf']})
report = {'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'status': 'running', 'checks': []}
try:
    accounts = call('GET', '/accounts?limit=100')[2]['data']
    account_id = next((a['id'] for a in accounts if a['id'] == 'acct_530ac324-094d-43fa-ae62-8eaa8d53b7f0'), accounts[0]['id'])
    paths = [f'/accounts/{account_id}/preset-bindings', f'/accounts/{account_id}/schedule']
    preflight_headers = {'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type,x-csrf-token,idempotency-key'}
    for path in paths:
        response = call('OPTIONS', path, extra=preflight_headers)
        assert response[0] == 204, response[2]
        assert response[1]['access-control-allow-origin'] == origin
        assert response[1]['access-control-allow-credentials'] == 'true'
        assert 'PUT' in response[1]['access-control-allow-methods'].split(', ')
        report['checks'].append({'path': path, 'preflightStatus': response[0],
                                 'allowedMethods': response[1]['access-control-allow-methods']})
    forbidden = call('OPTIONS', paths[0], extra=preflight_headers | {'Origin': 'https://untrusted.invalid'})
    assert forbidden[0] == 403
    assert 'access-control-allow-origin' not in forbidden[1]
    report['untrustedOriginRejected'] = True
    before_bindings = call('GET', paths[0])[2]['data']
    before_schedule = call('GET', paths[1])[2]['data']
    # A guaranteed stale version reaches the authenticated route without changing account settings.
    stale = call('PUT', paths[0], {'expectedVersion': -1, 'bindings': []})
    assert stale[0] == 409, stale[2]
    assert stale[1]['access-control-allow-origin'] == origin
    after_bindings = call('GET', paths[0])[2]['data']
    after_schedule = call('GET', paths[1])[2]['data']
    assert before_bindings == after_bindings and before_schedule == after_schedule
    report.update({'authenticatedPutStatus': stale[0], 'authenticatedPutCode': stale[2]['error']['code'],
                   'accountConfigurationUnchanged': True,
                   'globallyPaused': call('GET', '/runtime')[2]['data']['paused'],
                   'publishTransportEnabled': call('GET', '/health')[2]['data']['publishTransportEnabled'],
                   'status': 'passed', 'realPublications': 0})
finally:
    call('POST', '/auth/logout', {})
Path('/opt/square-platform/deploy/bindings-cors-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
PY
install -o ubuntu -g ubuntu -m 600 /opt/square-platform/deploy/bindings-cors-verification.json /home/ubuntu/square-platform-upload/bindings-cors-verification.json
