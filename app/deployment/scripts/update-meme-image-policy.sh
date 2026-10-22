set -eu
python3 -u - <<'PY'
import copy, datetime, hashlib, http.client, json, re
from pathlib import Path

root = Path('/opt/square-platform/deploy')
credentials = json.loads((root / 'bootstrap.json').read_text())
pack = json.loads(Path('/home/ubuntu/square-platform-upload/content-presets.json').read_text())
assert pack['packId'] == 'industry-memes-10-20261022' and len(pack['presets']) == 10
headers = {'Origin':'https://bn.sid.mom', 'Content-Type':'application/json'}
def call(method, route, body=None):
    client = http.client.HTTPConnection('127.0.0.1', 39410, timeout=30)
    try:
        client.request(method, '/api/v1' + route, json.dumps(body) if body is not None else None, headers)
        response = client.getresponse()
        payload = json.loads(response.read())
        assert response.status < 400, {'status':response.status, 'route':route, 'error':payload.get('error')}
        return payload['data'], {k.lower():v for k,v in response.getheaders()}
    finally:
        client.close()
def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
def text_rules(rules):
    return {k:v for k,v in rules.items() if k != 'image'}
def account_config(accounts):
    return sorted([{'id':a['id'], 'status':a['status'], 'schedule':{k:(a.get('schedule') or {}).get(k) for k in ['enabled','minIntervalSeconds','maxIntervalSeconds']}, 'bindings':a.get('bindings')} for a in accounts], key=lambda a:a['id'])

login, response_headers = call('POST', '/auth/login', {'username':credentials['adminUsername'], 'password':credentials['adminPassword']})
headers.update({'Cookie':response_headers['set-cookie'].split(';',1)[0], 'X-CSRF-Token':login['csrf']})
report_path = root / 'industry-meme-operation.json'
report = {'policyVersion':'industry-meme-v1', 'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'presets':[]}
def save():
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
try:
    runtime_before, _ = call('GET', '/runtime')
    accounts_before, _ = call('GET', '/accounts?limit=1000')
    presets, _ = call('GET', '/presets?limit=1000')
    targets = {p['name']:p for p in pack['presets']}
    assert set(targets).issubset({p['name'] for p in presets}), 'Expected ten live presets are missing'
    backup = root / ('industry-meme-before-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.json')
    details = [call('GET', '/presets/' + p['id'])[0] for p in presets if p['name'] in targets]
    backup.write_text(json.dumps(details, ensure_ascii=False, indent=2) + '\n')
    backup.chmod(0o600)
    report['backup'] = str(backup)
    save()
    for detail in details:
        target = targets[detail['name']]
        published = next(v for v in detail['versions'] if v['id'] == detail['publishedVersionId'])
        desired = copy.deepcopy(published['rules'])
        desired['image'].update({k:target['rules']['image'][k] for k in ['prompt','style','tags']})
        pending_draft = copy.deepcopy(detail['draftRules'])
        pending_draft['image'].update({k:target['rules']['image'][k] for k in ['prompt','style','tags']})
        entry = {'id':detail['id'], 'name':detail['name'], 'previousPublishedVersionId':published['id'], 'textRulesHashBefore':digest(text_rules(published['rules']))}
        report['presets'].append(entry)
        description = re.sub(r'[；，]配[^。]*。', '；配各行各业的 meme 梗图。', detail.get('description',''))
        def patch(current, rules):
            return call('PATCH', '/presets/' + detail['id'], {'expectedVersion':current['version'], 'name':detail['name'], 'description':description, 'enabled':detail['enabled'], 'rules':rules})[0]
        current = detail
        if desired != published['rules']:
            current = patch(current, desired)
            headers['Idempotency-Key'] = 'industry-meme-v1-' + detail['id'] + '-' + published['id']
            current, _ = call('POST', '/presets/' + detail['id'] + '/publish-version', {'expectedVersion':current['version'], 'changeNote':'Only industry meme/joke images; preserve all text, model and schedule settings.'})
            headers.pop('Idempotency-Key', None)
        if current['draftRules'] != pending_draft:
            current = patch(current, pending_draft)
        verified, _ = call('GET', '/presets/' + detail['id'])
        version = next(v for v in verified['versions'] if v['id'] == verified['publishedVersionId'])
        assert version['rules'] == desired, 'Published image rules differ from requested update'
        assert verified['draftRules'] == pending_draft, 'Unpublished draft was not preserved'
        assert text_rules(version['rules']) == text_rules(published['rules']), 'Text settings changed'
        entry.update({'publishedVersionId':version['id'], 'publishedNumber':version['number'], 'imageStyle':version['rules']['image']['style'], 'imageMode':version['rules']['image']['mode'], 'textRulesHashAfter':digest(text_rules(version['rules'])), 'verified':True})
        save()
        print(json.dumps(entry, ensure_ascii=False), flush=True)
    accounts_after, _ = call('GET', '/accounts?limit=1000')
    runtime_after, _ = call('GET', '/runtime')
    report['accountConfigurationPreserved'] = account_config(accounts_before) == account_config(accounts_after)
    report['runtimeSettingsPreserved'] = all(runtime_before.get(k) == runtime_after.get(k) for k in ['paused','contentValidationMode','publishTransportEnabled','concurrency','textConcurrency','imageConcurrency'])
    assert report['accountConfigurationPreserved'] and report['runtimeSettingsPreserved']
    report['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    report['status'] = 'passed'
    save()
    print(json.dumps({'status':'passed', 'updatedPresets':len(report['presets']), 'accountConfigurationPreserved':True, 'runtimeSettingsPreserved':True}), flush=True)
finally:
    headers.pop('Idempotency-Key', None)
    call('POST', '/auth/logout', {})
PY
install -o ubuntu -g ubuntu -m 600 /opt/square-platform/deploy/industry-meme-operation.json /home/ubuntu/square-platform-upload/industry-meme-operation.json
