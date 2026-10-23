set -eu
umask 077
exec 9>/opt/square-platform/deploy/library-only-presets.lock
flock -n 9
python3 -u - <<'PY'
import copy, datetime, hashlib, http.client, json
from pathlib import Path

root = Path('/opt/square-platform/deploy')
credentials = json.loads((root / 'bootstrap.json').read_text())
headers = {'Origin':'https://bn.sid.mom', 'Content-Type':'application/json'}
operation = 'library-only-20261023'
report_path = root / 'library-only-presets.json'
report = {'operation':operation, 'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'status':'running', 'presets':[], 'cancelledOldJobs':[], 'submittedOldJobs':[],
          'modelCallsRequestedByOperation':0, 'publicationsRequestedByOperation':0}

def save():
    temporary = report_path.with_suffix('.tmp')
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(report_path)

def call(method, route, body=None, key=None):
    client = http.client.HTTPConnection('127.0.0.1', 39410, timeout=40)
    request_headers = dict(headers)
    if key:
        request_headers['Idempotency-Key'] = key
    try:
        client.request(method, '/api/v1' + route,
                       json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
                       request_headers)
        response = client.getresponse()
        payload = json.loads(response.read())
        if response.status >= 400:
            error = payload.get('error', {})
            raise RuntimeError(f"{method} {route}: HTTP {response.status} {error.get('code', '')}: {error.get('message', '')}")
        return payload['data'], {k.lower():v for k,v in response.getheaders()}, payload.get('meta', {})
    finally:
        client.close()

def read(route):
    return call('GET', route)[0]

def rows(route):
    from urllib.parse import quote
    result, cursor = [], None
    while True:
        data, _, meta = call('GET', route + ('&' if '?' in route else '?') + 'limit=100' +
                             ('&cursor=' + quote(cursor, safe='') if cursor else ''))
        result.extend(data)
        if not meta.get('hasMore'):
            return result
        assert meta.get('nextCursor') and meta['nextCursor'] != cursor, 'Invalid pagination cursor'
        cursor = meta['nextCursor']

def desired(rules):
    updated = copy.deepcopy(rules)
    updated['image'].update({'mode':'library', 'fallback':'any_library'})
    return updated

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

def configured_accounts():
    result = []
    for account in rows('/accounts'):
        bindings = read('/accounts/' + account['id'] + '/preset-bindings')['bindings']
        schedule = read('/accounts/' + account['id'] + '/schedule')
        result.append({'id':account['id'], 'status':account['status'],
                       'schedule':{k:schedule.get(k) for k in ['enabled','minIntervalSeconds','maxIntervalSeconds']},
                       'bindings':[{k:b.get(k) for k in ['presetId','weight','enabled']} for b in bindings]})
    return sorted(result, key=lambda item:item['id'])

logged_in = False
try:
    login, response_headers, _ = call('POST', '/auth/login', {
        'username':credentials['adminUsername'], 'password':credentials['adminPassword']})
    headers.update({'Cookie':response_headers['set-cookie'].split(';',1)[0], 'X-CSRF-Token':login['csrf']})
    logged_in = True
    runtime_before, accounts_before = read('/runtime'), configured_accounts()
    details = [read('/presets/' + p['id']) for p in rows('/presets')]
    assert details, 'No presets found'
    assets = rows('/assets')
    report['enabledLibraryImages'] = sum(a.get('enabled') is True for a in assets)
    assert report['enabledLibraryImages'] > 0, 'No enabled library images; no presets changed'
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = root / ('library-only-before-' + stamp + '.json')
    backup.write_text(json.dumps({'presets':details, 'runtime':runtime_before, 'accounts':accounts_before},
                                 ensure_ascii=False, indent=2) + '\n')
    backup.chmod(0o600)
    report['backup'] = str(backup)
    report['accountCount'] = len(accounts_before)
    save()
    for detail in details:
        published = next((v for v in detail['versions'] if v['id'] == detail.get('publishedVersionId')), None)
        before_rules = published['rules'] if published else detail['draftRules']
        live_rules, pending_draft = desired(before_rules), desired(detail['draftRules'])
        entry = {'id':detail['id'], 'name':detail['name'], 'previousPublishedVersionId':detail.get('publishedVersionId'),
                 'previousImageMode':before_rules['image']['mode'], 'phase':'prepared'}
        report['presets'].append(entry)
        save()
        current = detail
        def patch(rules):
            return call('PATCH', '/presets/' + detail['id'], {
                'expectedVersion':current['version'], 'name':detail['name'],
                'description':detail.get('description',''), 'enabled':detail['enabled'], 'rules':rules})[0]
        if not published or published['rules'] != live_rules:
            if current['draftRules'] != live_rules:
                current = patch(live_rules)
            entry['phase'] = 'publishing'
            save()
            current = call('POST', '/presets/' + detail['id'] + '/publish-version', {
                'expectedVersion':current['version'],
                'changeNote':'只用已有图库：优先匹配本预设图库，无匹配时随机选其他已有图片；不调用生图。'},
                operation + ':' + detail['id'] + ':' + str(detail.get('publishedVersionId') or 'new'))[0]
        if current['draftRules'] != pending_draft:
            current = patch(pending_draft)
        verified = read('/presets/' + detail['id'])
        version = next(v for v in verified['versions'] if v['id'] == verified['publishedVersionId'])
        assert version['rules'] == live_rules, 'Published rules mismatch'
        assert verified['draftRules'] == pending_draft and verified['enabled'] == detail['enabled'], 'Draft or enabled state mismatch'
        restored = copy.deepcopy(version['rules'])
        restored['image'].update({k:before_rules['image'][k] for k in ['mode','fallback']})
        assert restored == before_rules, 'Unrelated preset fields changed'
        entry.update({'phase':'verified', 'publishedVersionId':version['id'], 'publishedNumber':version['number'],
                      'imageMode':version['rules']['image']['mode'], 'imageFallback':version['rules']['image']['fallback'],
                      'rulesSha256':digest(version['rules']), 'verified':True})
        save()
        print(json.dumps({'name':entry['name'], 'publishedNumber':entry['publishedNumber'], 'imageMode':'library', 'verified':True},ensure_ascii=False),flush=True)
    active = {'queued','preparing','generating_text','validating','preparing_media','ready','retry_wait','submitting','submission_unknown'}
    for job in rows('/publication-jobs'):
        if job.get('state') not in active or job.get('rules',{}).get('image',{}).get('mode') == 'library':
            continue
        current_job = read('/publication-jobs/' + job['id'])
        if current_job['state'] in {'submitting','submission_unknown','published'} or current_job['attempts']:
            report['submittedOldJobs'].append({'id':job['id'], 'state':current_job['state']})
        elif current_job['state'] in active:
            result = call('POST', '/publication-jobs/' + job['id'] + '/cancel', {}, operation + ':cancel:' + job['id'])[0]
            report['cancelledOldJobs'].append({'id':job['id'], 'previousState':current_job['state'], 'state':result['state']})
            save()
    for preset in rows('/presets'):
        detail = read('/presets/' + preset['id'])
        version = next(v for v in detail['versions'] if v['id'] == detail['publishedVersionId'])
        assert detail['draftRules']['image']['mode'] == version['rules']['image']['mode'] == 'library'
        assert detail['draftRules']['image']['fallback'] == version['rules']['image']['fallback'] == 'any_library'
    report['accountConfigurationPreserved'] = configured_accounts() == accounts_before
    report['runtimeSettingsPreserved'] = read('/runtime') == runtime_before
    assert report['accountConfigurationPreserved'] and report['runtimeSettingsPreserved']
    report.update({'status':'passed','finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
except Exception as error:
    report.update({'status':'failed','error':str(error)})
    raise
finally:
    save()
    if logged_in:
        call('POST', '/auth/logout', {})
print(json.dumps({'status':report['status'], 'verifiedPresets':len(report['presets']),
                  'cancelledOldJobs':len(report['cancelledOldJobs']), 'submittedOldJobs':report['submittedOldJobs'],
                  'enabledLibraryImages':report['enabledLibraryImages'],
                  'accountConfigurationPreserved':report['accountConfigurationPreserved'],
                  'runtimeSettingsPreserved':report['runtimeSettingsPreserved']},ensure_ascii=False),flush=True)
PY
install -o ubuntu -g ubuntu -m 600 /opt/square-platform/deploy/library-only-presets.json /home/ubuntu/square-platform-upload/library-only-presets.json
