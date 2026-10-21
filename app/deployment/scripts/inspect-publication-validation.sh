set -eu
python3 -u - <<'PY'
import collections, datetime, http.client, json
from pathlib import Path

credentials = json.loads(Path('/opt/square-platform/deploy/bootstrap.json').read_text())
headers = {'Origin': 'https://bn.sid.mom', 'Content-Type': 'application/json'}

def call(method, route, body=None):
    client = http.client.HTTPConnection('127.0.0.1', 39410, timeout=30)
    try:
        client.request(method, '/api/v1' + route, json.dumps(body) if body is not None else None, headers)
        response = client.getresponse()
        payload = json.loads(response.read())
        assert response.status < 400, {'status': response.status, 'route': route, 'error': payload.get('error')}
        return payload['data'], {k.lower(): v for k, v in response.getheaders()}
    finally:
        client.close()

def fields(row, names):
    return {key: row.get(key) for key in names}

login, response_headers = call('POST', '/auth/login', {'username': credentials['adminUsername'], 'password': credentials['adminPassword']})
headers.update({'Cookie': response_headers['set-cookie'].split(';', 1)[0], 'X-CSRF-Token': login['csrf']})
try:
    report = {'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'accounts': [], 'jobs': []}
    report['runtime'], _ = call('GET', '/runtime')
    report['health'], _ = call('GET', '/health')
    for account in call('GET', '/accounts?limit=1000')[0]:
        details, _ = call('GET', '/accounts/' + account['id'])
        report['accounts'].append({**fields(details, ['id', 'name', 'status', 'blockReason', 'cooldownUntil', 'lastPublishedAt']), 'schedule': details['schedule'], 'recentJobs': [fields(j, ['id', 'kind', 'state', 'stage', 'updatedAt', 'error']) for j in details['recentJobs']]})
    jobs, _ = call('GET', '/publication-jobs?limit=100')
    report['jobStateCounts'] = dict(collections.Counter(j['state'] for j in jobs))
    for row in jobs[:35]:
        job, _ = call('GET', '/publication-jobs/' + row['id'])
        detail = fields(job, ['id', 'accountId', 'kind', 'state', 'stage', 'error', 'createdAt', 'startedAt', 'finishedAt', 'updatedAt', 'attempt', 'retryAt', 'rules', 'tokens', 'facts', 'sourceWarnings', 'validationId', 'capabilities', 'content', 'validation', 'validationHistory', 'attempts', 'events', 'sources'])
        detail['generationRuns'] = [fields(r, ['id', 'type', 'state', 'requestedModel', 'reportedModel', 'promptVersion', 'startedAt', 'finishedAt', 'output', 'error', 'messages']) for r in job['generationRuns']]
        report['jobs'].append(detail)
    report['posts'], _ = call('GET', '/posts?limit=20')
    destination = Path('/opt/square-platform/deploy/publication-validation-latest.json')
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    summaries = []
    for j in report['jobs']:
        summaries.append({**fields(j, ['id', 'accountId', 'kind', 'state', 'stage', 'error', 'createdAt', 'updatedAt']), 'contentLength': len((j.get('content') or {}).get('text', '')), 'validation': fields(j.get('validation') or {}, ['id', 'passed', 'validationMode', 'errors', 'warnings']), 'validationRounds': len(j.get('validationHistory') or []), 'promptVersions': list(dict.fromkeys(r['promptVersion'] for r in j['generationRuns'])), 'attempts': [fields(a, ['id', 'state', 'error']) for a in j.get('attempts') or []]})
    accounts = [{**fields(a, ['id', 'name', 'status', 'blockReason', 'lastPublishedAt']), 'nextDueAt': a['schedule'].get('nextDueAt'), 'activeJobId': a['schedule'].get('activeJobId')} for a in report['accounts']]
    print(json.dumps({'checkedAt': report['checkedAt'], 'worker': report['health']['worker']['state'], 'paused': report['runtime']['paused'], 'contentValidationMode': report['runtime'].get('contentValidationMode', 'strict'), 'publishTransportEnabled': report['health']['publishTransportEnabled'], 'accounts': accounts, 'jobStateCounts': report['jobStateCounts'], 'jobs': summaries, 'posts': [fields(p, ['id', 'jobId', 'publishStatus', 'verificationStatus', 'url', 'remoteId', 'createdAt']) for p in report['posts']]}, ensure_ascii=False))
finally:
    call('POST', '/auth/logout', {})
PY
install -o ubuntu -g ubuntu -m 600 /opt/square-platform/deploy/publication-validation-latest.json /home/ubuntu/square-platform-upload/publication-validation-latest.json
