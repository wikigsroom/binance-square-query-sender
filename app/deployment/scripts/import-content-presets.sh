set -eu
python3 -u - <<'PY'
import copy, datetime, hashlib, http.client, json
from pathlib import Path

pack_path = Path('/home/ubuntu/square-platform-upload/content-presets.json')
pack = json.loads(pack_path.read_text())
assert len(pack['presets']) == 10
assert len({p['key'] for p in pack['presets']}) == 10
assert len({p['name'] for p in pack['presets']}) == 10
credentials = json.loads(Path('/opt/square-platform/deploy/bootstrap.json').read_text())
headers = {'Origin': 'https://bn.sid.mom', 'Content-Type': 'application/json'}
report_path = Path('/opt/square-platform/deploy/content-presets-import.json')
report = {
    'packId': pack['packId'], 'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'packSha256': hashlib.sha256(pack_path.read_bytes()).hexdigest(),
    'status': 'running', 'presets': [], 'realModelGenerationCalls': 0, 'realPublications': 0,
}

def save_report():
    temporary = report_path.with_suffix('.tmp')
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(report_path)

def call(method, route, body=None, idempotency_key=None):
    request_headers = dict(headers)
    if idempotency_key:
        request_headers['Idempotency-Key'] = idempotency_key
    client = http.client.HTTPConnection('127.0.0.1', 39410, timeout=45)
    try:
        client.request(method, '/api/v1' + route,
                       json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
                       request_headers)
        response = client.getresponse()
        payload = json.loads(response.read())
        response_headers = dict(response.getheaders())
        if response.status >= 400:
            error = payload.get('error', {})
            raise RuntimeError(f"{method} {route}: HTTP {response.status} {error.get('code', '')}: {error.get('message', '')}")
        return payload['data'], response_headers
    finally:
        client.close()

def read(route):
    return call('GET', route)[0]

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

def account_state():
    accounts = read('/accounts?limit=1000')
    result = {}
    for account in accounts:
        bindings = read(f"/accounts/{account['id']}/preset-bindings")
        schedule = read(f"/accounts/{account['id']}/schedule")
        result[account['id']] = {
            'accountVersion': account['version'], 'status': account['status'],
            'scheduleVersion': schedule['version'], 'enabled': schedule['enabled'],
            'bindings': [{k: row.get(k) for k in ['presetId', 'weight', 'enabled']} for row in bindings['bindings']],
        }
    return result

logged_in = False
try:
    login, response_headers = call('POST', '/auth/login', {
        'username': credentials['adminUsername'], 'password': credentials['adminPassword'],
    })
    headers.update({'Cookie': response_headers['set-cookie'].split(';', 1)[0], 'X-CSRF-Token': login['csrf']})
    logged_in = True
    models = read('/models?limit=100')
    connections = {c['id']: c for c in read('/model-connections?limit=100')}
    sources = {s['id']: s for s in read('/data-sources?limit=100')}
    settings = read('/ai/settings')
    def resolve_model(kind, external_id):
        candidates = [m for m in models if m['type'] == kind and m['externalId'] == external_id and m['approved'] and connections[m['connectionId']]['enabled']]
        preferred = next((m for m in candidates if m['id'] == settings['default' + kind.title() + 'ModelId']), None)
        assert preferred or len(candidates) == 1, f'No unambiguous approved {kind} model: {external_id}'
        return preferred or candidates[0]
    text_model = resolve_model('text', pack['textModelExternalId'])
    image_model = resolve_model('image', pack['imageModelExternalId'])
    assert image_model['family'] == 'gpt-image-2'
    report['models'] = {'text': {'id': text_model['id'], 'externalId': text_model['externalId']},
                        'image': {'id': image_model['id'], 'externalId': image_model['externalId']}}
    before = account_state()
    runtime_before = read('/runtime')['paused']
    report['accountCount'] = len(before)
    report['globallyPausedBefore'] = runtime_before
    existing = read('/presets?limit=1000')
    prepared = []
    for item in pack['presets']:
        rules = copy.deepcopy(item['rules'])
        rules['modelId'], rules['image']['modelId'] = text_model['id'], image_model['id']
        assert rules['image']['mode'] == 'library' and rules['image']['fallback'] == 'any_library'
        assert rules['preferredMin'] <= rules['preferredMax'] <= rules['maxChars']
        assert set(rules['parameters']) <= set(text_model['allowedParameters'])
        assert set(rules['image']['parameters']) <= set(image_model['allowedParameters'])
        assert all(sources[s['sourceId']]['enabled'] for s in rules['sourceRules'])
        matches = [p for p in existing if p['name'] == item['name']]
        assert len(matches) <= 1, f"Duplicate preset name: {item['name']}"
        if matches:
            assert matches[0]['draftRules'] == rules, f"Existing preset has different rules; left untouched: {item['name']}"
            assert matches[0]['description'] == item['description'], f"Existing preset description differs: {item['name']}"
        prepared.append((item, rules, matches[0] if matches else None))
    save_report()
    for item, rules, existing_row in prepared:
        body = {'name': item['name'], 'description': item['description'], 'rules': rules}
        entry = {'key': item['key'], 'name': item['name'], 'rulesSha256': digest(rules), 'created': existing_row is None}
        report['presets'].append(entry)
        save_report()
        if existing_row is None:
            row, _ = call('POST', '/presets', body, pack['packId'] + ':' + item['key'] + ':create')
        else:
            row = existing_row
        entry['id'] = row['id']
        save_report()
        if not row['publishedVersionId']:
            row, _ = call('POST', f"/presets/{row['id']}/publish-version", {
                'expectedVersion': row['version'],
                'changeNote': '10种独立内容方向：指定文字模型逐篇成稿，只随机使用已有图库，不调用生图。包 ' + pack['packId'],
            }, pack['packId'] + ':' + item['key'] + ':publish')
        detail = read('/presets/' + row['id'])
        version = read(f"/presets/{row['id']}/versions/{detail['publishedVersionId']}")
        assert detail['enabled'] and detail['draftRules'] == rules
        assert version['rules'] == rules, 'Published rules mismatch'
        entry.update({'publishedNumber': version['number'], 'publishedVersionId': version['id'],
                      'verified': True, 'preferredCharacters': [rules['preferredMin'], rules['preferredMax']],
                      'hardLimit': rules['maxChars'], 'imageMode': rules['image']['mode'],
                      'imageStyle': rules['image']['style'], 'imageFallback': rules['image']['fallback']})
        save_report()
        print(json.dumps({'name': item['name'], 'version': version['number'], 'verified': True}, ensure_ascii=False), flush=True)
    report['accountsAndSchedulesUnchanged'] = account_state() == before
    report['globallyPausedAfter'] = read('/runtime')['paused']
    report['runtimePauseUnchanged'] = runtime_before == report['globallyPausedAfter']
    assert report['accountsAndSchedulesUnchanged'] and report['runtimePauseUnchanged']
    report['status'] = 'passed'
except Exception as error:
    report['status'] = 'failed'
    report['error'] = str(error)
    raise
finally:
    save_report()
    if logged_in:
        call('POST', '/auth/logout', {})
print(json.dumps({'status': report['status'], 'verified': len(report['presets']),
                  'created': sum(p['created'] for p in report['presets']),
                  'realModelGenerationCalls': 0, 'realPublications': 0}, ensure_ascii=False))
PY
install -o ubuntu -g ubuntu -m 600 /opt/square-platform/deploy/content-presets-import.json /home/ubuntu/square-platform-upload/content-presets-import.json
