set -eu
python3 -u - <<'PY'
import datetime, http.client, json, time
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
report = {'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'recovery': []}
destination = Path('/opt/square-platform/deploy/publish-first-operation.json')
def save():
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
try:
    runtime, _ = call('GET', '/runtime')
    previous_report = json.loads(destination.read_text()) if destination.exists() else {}
    report['previousRuntime'] = previous_report.get('previousRuntime', runtime)
    if runtime.get('contentValidationMode') != 'publish_first':
        runtime, _ = call('PATCH', '/runtime', {'expectedVersion': runtime['version'], 'contentValidationMode': 'publish_first'})
    runtime, _ = call('GET', '/runtime')
    assert runtime.get('contentValidationMode') == 'publish_first', 'Server does not support the requested validation mode'
    report['runtime'] = runtime
    save()
    print(json.dumps({'contentValidationMode': runtime['contentValidationMode'], 'paused': runtime['paused'], 'publishTransportEnabled': runtime['publishTransportEnabled']}, ensure_ascii=False), flush=True)
    rows, _ = call('GET', '/publication-jobs?limit=100')
    seen = set()
    targets = []
    for row in rows:
        account_id = row.get('accountId')
        if row['kind'] == 'preview' or not account_id or account_id in seen:
            continue
        seen.add(account_id)
        if row['state'] == 'failed' and (row.get('error') or {}).get('code') == 'TEXT_VALIDATION_FAILED':
            targets.append(row['id'])
    for job_id in targets:
        entry = {'jobId': job_id}
        report['recovery'].append(entry)
        try:
            job, _ = call('GET', '/publication-jobs/' + job_id)
            account, _ = call('GET', '/accounts/' + job['accountId'])
            entry['accountName'] = account['name']
            if job['state'] != 'failed' or job['attempts'] or account['schedule'].get('activeJobId') or (account.get('lastPublishedAt') and account['lastPublishedAt'] > job['updatedAt']):
                entry.update({'state': 'skipped', 'reason': 'Task already changed, submitted, superseded by a successful post, or account has an active task'})
                save()
                continue
            assert job['error']['code'] == 'TEXT_VALIDATION_FAILED' and job['capabilities']['retry']
            entry['priorError'] = job['error']
            entry['priorPublishAttemptCount'] = len(job['attempts'])
            headers['Idempotency-Key'] = '20261022-publish-first-' + job_id
            retried, _ = call('POST', '/publication-jobs/' + job_id + '/retry', {})
            headers.pop('Idempotency-Key', None)
            entry['requestedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            entry['state'] = retried['state']
            save()
            print(json.dumps({'jobId': job_id, 'account': account['name'], 'state': retried['state']}, ensure_ascii=False), flush=True)
            deadline = time.monotonic() + 360
            previous = retried['state']
            while time.monotonic() < deadline:
                time.sleep(5)
                current, _ = call('GET', '/publication-jobs/' + job_id)
                if current['state'] != previous:
                    print(json.dumps({'jobId': job_id, 'state': current['state'], 'error': current.get('error')}, ensure_ascii=False), flush=True)
                    previous = current['state']
                if current['state'] in ['published', 'failed', 'blocked', 'cancelled', 'submission_unknown']:
                    entry.update({'state': current['state'], 'error': current.get('error'), 'validationMode': (current.get('validation') or {}).get('validationMode'), 'validationPassed': (current.get('validation') or {}).get('passed'), 'warningCodes': [w['code'] for w in (current.get('validation') or {}).get('warnings', [])], 'publishAttempts': [{'id': a['id'], 'state': a['state']} for a in current['attempts']]})
                    break
            else:
                entry.update({'state': 'still_active', 'reason': 'Original task remains active; no second submission was requested'})
            save()
        except Exception as error:
            headers.pop('Idempotency-Key', None)
            entry['operationError'] = str(error)
            save()
            print(json.dumps({'jobId': job_id, 'operationError': str(error)}, ensure_ascii=False), flush=True)
    report['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save()
    print(json.dumps({'finishedAt': report['finishedAt'], 'recovery': report['recovery']}, ensure_ascii=False), flush=True)
finally:
    headers.pop('Idempotency-Key', None)
    call('POST', '/auth/logout', {})
PY
install -o ubuntu -g ubuntu -m 600 /opt/square-platform/deploy/publish-first-operation.json /home/ubuntu/square-platform-upload/publish-first-operation.json
