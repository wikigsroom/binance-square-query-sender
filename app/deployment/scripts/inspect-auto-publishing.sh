set -eu
python3 -u - <<'PY'
import datetime, http.client, json
from pathlib import Path
credentials = json.loads(Path('/opt/square-platform/deploy/bootstrap.json').read_text())
headers = {'Origin': 'https://bn.sid.mom', 'Content-Type': 'application/json'}
def call(method, route, body=None):
    client = http.client.HTTPConnection('127.0.0.1', 39410, timeout=25)
    try:
        client.request(method, '/api/v1' + route, json.dumps(body) if body is not None else None, headers)
        response = client.getresponse()
        payload = json.loads(response.read())
        assert response.status < 400, {'status': response.status, 'route': route, 'error': payload.get('error')}
        return payload['data'], {k.lower(): v for k, v in response.getheaders()}
    finally:
        client.close()
login, response_headers = call('POST', '/auth/login', {'username': credentials['adminUsername'], 'password': credentials['adminPassword']})
headers.update({'Cookie': response_headers['set-cookie'].split(';', 1)[0], 'X-CSRF-Token': login['csrf']})
try:
    report = {'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'accounts': []}
    account_rows, _ = call('GET', '/accounts?limit=1000')
    for account in account_rows:
        details, _ = call('GET', '/accounts/' + account['id'])
        report['accounts'].append({
            **{key: details.get(key) for key in ['id', 'name', 'status', 'version', 'updatedAt', 'createdAt', 'blockReason', 'cooldownUntil', 'lastPublishedAt']},
            'bindings': details['bindings'], 'schedule': details['schedule'],
            'recentJobs': [{key: j.get(key) for key in ['id', 'kind', 'state', 'updatedAt', 'error']} for j in details['recentJobs']],
        })
    report['runtime'], _ = call('GET', '/runtime')
    report['health'], _ = call('GET', '/health')
    report['aiSettings'], _ = call('GET', '/ai/settings')
    report['presets'] = [{key: p.get(key) for key in ['id', 'name', 'enabled', 'publishedVersionId', 'publishedNumber']} for p in call('GET', '/presets?limit=1000')[0]]
    report['connections'] = [{key: c.get(key) for key in ['id', 'name', 'enabled', 'concurrency', 'timeoutMs', 'protocol']} for c in call('GET', '/model-connections?limit=100')[0]]
    destination = Path('/opt/square-platform/deploy/auto-publishing-before.json')
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))
finally:
    call('POST', '/auth/logout', {})
PY
install -o ubuntu -g ubuntu -m 600 /opt/square-platform/deploy/auto-publishing-before.json /home/ubuntu/square-platform-upload/auto-publishing-before.json
