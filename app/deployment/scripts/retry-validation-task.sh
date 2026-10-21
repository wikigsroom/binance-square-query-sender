set -eu
python3 -u - <<'PY'
import datetime, http.client, json
from pathlib import Path

job_id = 'job_4e9f3e77-8060-4f08-944f-0326c865276d'
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
    job, _ = call('GET', '/publication-jobs/' + job_id)
    assert job['state'] == 'failed' and job['error']['code'] == 'TEXT_VALIDATION_FAILED', 'Target no longer has the diagnosed validation failure; do not replay'
    assert not job['attempts'], 'An external submission already exists; do not replay'
    assert job['capabilities']['retry'], 'Task is not eligible for a safe retry'
    headers['Idempotency-Key'] = '20261022-author-validation-fix-' + job_id
    result, _ = call('POST', '/publication-jobs/' + job_id + '/retry', {})
    report = {'requestedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'jobId': job_id, 'state': result['state'], 'priorError': job['error'], 'priorPublishAttemptCount': len(job['attempts']), 'newTaskCreated': False}
    Path('/opt/square-platform/deploy/validation-retry-request.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))
finally:
    headers.pop('Idempotency-Key', None)
    call('POST', '/auth/logout', {})
PY
install -o ubuntu -g ubuntu -m 600 /opt/square-platform/deploy/validation-retry-request.json /home/ubuntu/square-platform-upload/validation-retry-request.json
