set -eu
python3 -u - <<'PY'
import datetime, http.client, json, os, re, shutil, stat, subprocess, time
from pathlib import Path

credentials = json.loads(Path('/opt/square-platform/deploy/bootstrap.json').read_text())
headers = {'Origin': 'https://bn.sid.mom', 'Content-Type': 'application/json'}
report_path = Path('/opt/square-platform/deploy/auto-publishing-enabled.json')
if report_path.exists():
    previous = json.loads(report_path.read_text())
    assert previous.get('status') != 'enabled', 'Already enabled by this operation; inspect its report instead of rerunning'
report = {'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'status': 'preparing', 'accounts': []}

def persist():
    temporary = report_path.with_suffix('.tmp')
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(report_path)

def call(method, route, body=None):
    client = http.client.HTTPConnection('127.0.0.1', 39410, timeout=30)
    try:
        client.request(method, '/api/v1' + route, json.dumps(body) if body is not None else None, headers)
        response = client.getresponse()
        raw = response.read()
        payload = json.loads(raw) if raw else {}
        if response.status >= 400:
            error = payload.get('error', {})
            raise RuntimeError(f"{method} {route}: HTTP {response.status}: {error.get('code')}: {error.get('message')}")
        return payload['data'], {k.lower(): v for k, v in response.getheaders()}
    finally:
        client.close()

def get(route):
    return call('GET', route)[0]

def bindings_of(detail):
    return [{key: b[key] for key in ['presetId', 'weight', 'enabled']} for b in detail['bindings']['bindings']]

logged_in = False
try:
    login, response_headers = call('POST', '/auth/login', {'username': credentials['adminUsername'], 'password': credentials['adminPassword']})
    headers.update({'Cookie': response_headers['set-cookie'].split(';', 1)[0], 'X-CSRF-Token': login['csrf']})
    logged_in = True
    runtime = get('/runtime')
    assert runtime['paused'] is True, 'Expected global pause while copying configuration'
    accounts = [get('/accounts/' + a['id']) for a in get('/accounts?limit=1000')]
    examples = [a for a in accounts if any(b.get('probability', 0) > 0 for b in a['bindings']['bindings'])]
    assert len(examples) == 1, 'The sample account is not unambiguous; no configuration changed'
    sample = examples[0]
    assert all(a['status'] == 'active' and not a.get('blockReason') for a in accounts), 'An account requires individual error resolution'
    assert all(not a['recentJobs'] for a in accounts), 'Unexpected existing jobs; inspect before changing schedules'
    template = bindings_of(sample)
    schedule = sample['schedule']
    assert any(b['enabled'] and b['weight'] > 0 for b in template)
    assert all(b.get('reason') is None for b in sample['bindings']['bindings'] if b['enabled'] and b['weight'] > 0)
    assert 0 < schedule['minIntervalSeconds'] <= schedule['maxIntervalSeconds']
    source_details = []
    for binding in template:
        preset = get('/presets/' + binding['presetId'])
        version = get(f"/presets/{preset['id']}/versions/{preset['publishedVersionId']}")
        rules = version['rules']
        assert rules['image']['mode'] == 'generate', f"Per-post image generation not enabled for {preset['name']}"
        source_details.append({'id': preset['id'], 'name': preset['name'], 'weight': binding['weight'],
                               'publishedVersionId': version['id'], 'textModelId': rules['modelId'],
                               'imageModelId': rules['image']['modelId'], 'imageMode': rules['image']['mode']})
    backup = Path('/opt/square-platform/backups') / ('enable-auto-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(mode=0o700)
    with (backup / 'database.dump').open('wb') as stream:
        subprocess.run(['runuser', '-u', 'postgres', '--', 'pg_dump', '-p', '5433', '-d', 'square_platform', '-Fc'], stdout=stream, check=True)
    environment = Path('/etc/square-platform/square.env')
    shutil.copy2(environment, backup / 'square.env')
    (backup / 'square.env').chmod(0o600)
    baseline = json.loads(Path('/opt/square-platform/deploy/auto-publishing-before.json').read_text())
    (backup / 'configuration-before.json').write_text(json.dumps(baseline, ensure_ascii=False, indent=2) + '\n')
    report.update({'sampleAccountId': sample['id'], 'sampleAccountName': sample['name'],
                   'minIntervalSeconds': schedule['minIntervalSeconds'], 'maxIntervalSeconds': schedule['maxIntervalSeconds'],
                   'templateBindings': source_details, 'accountCount': len(accounts), 'backup': str(backup)})
    persist()
    for account in accounts:
        entry = {'id': account['id'], 'name': account['name'], 'copied': False}
        report['accounts'].append(entry)
        persist()
        if bindings_of(account) != template:
            call('PUT', f"/accounts/{account['id']}/preset-bindings", {
                'expectedVersion': account['bindings']['bindingVersion'], 'bindings': template,
            })
        current_schedule = get(f"/accounts/{account['id']}/schedule")
        call('PUT', f"/accounts/{account['id']}/schedule", {
            'expectedVersion': current_schedule['version'],
            'minIntervalSeconds': schedule['minIntervalSeconds'],
            'maxIntervalSeconds': schedule['maxIntervalSeconds'], 'enabled': True,
        })
        entry['copied'] = True
        persist()
        print(json.dumps({'configuredAccount': account['name'], 'enabled': True}, ensure_ascii=False), flush=True)
    env_text = environment.read_text()
    matches = re.findall(r'^SQUARE_PUBLISH_ENABLED=.*$', env_text, flags=re.MULTILINE)
    assert len(matches) == 1, 'Expected exactly one publishing transport setting'
    updated_env = re.sub(r'^SQUARE_PUBLISH_ENABLED=.*$', 'SQUARE_PUBLISH_ENABLED=true', env_text, flags=re.MULTILINE)
    if updated_env != env_text:
        pending = environment.with_name('square.env.enable-next')
        pending.write_text(updated_env)
        pending.chmod(stat.S_IMODE(environment.stat().st_mode))
        os.chown(pending, environment.stat().st_uid, environment.stat().st_gid)
        pending.replace(environment)
        report['status'] = 'transport-restarting'
        persist()
        subprocess.run(['systemctl', 'restart', 'square-platform.service'], check=True)
        ready = False
        for attempt in range(20):
            try:
                health = get('/health')
                ready = health['publishTransportEnabled'] is True and health['worker']['state'] == 'running'
                if ready:
                    break
            except Exception:
                pass
            time.sleep(0.5)
        assert ready, 'Service not ready after transport was enabled; global pause retained'
    health = get('/health')
    assert health['publishTransportEnabled'] is True
    assert get('/runtime')['paused'] is True
    report['status'] = 'schedules-ready'
    persist()
    current_runtime = get('/runtime')
    resumed, _ = call('PATCH', '/runtime', {'expectedVersion': current_runtime['version'], 'paused': False})
    assert resumed['paused'] is False
    for entry in report['accounts']:
        current = get('/accounts/' + entry['id'])
        assert bindings_of(current) == template
        s = current['schedule']
        assert s['enabled'] is True
        assert s['minIntervalSeconds'] == schedule['minIntervalSeconds'] and s['maxIntervalSeconds'] == schedule['maxIntervalSeconds']
        assert s['minIntervalSeconds'] <= s['sampledDelaySeconds'] <= s['maxIntervalSeconds']
        assert datetime.datetime.fromisoformat(s['nextDueAt'].replace('Z', '+00:00')) > datetime.datetime.now(datetime.timezone.utc)
        entry.update({'status': current['status'], 'blockReason': current.get('blockReason'),
                      'presetCount': len(current['bindings']['bindings']), 'scheduleEnabled': True,
                      'anchorAt': s['anchorAt'], 'sampledDelaySeconds': s['sampledDelaySeconds'], 'nextDueAt': s['nextDueAt']})
    report.update({'status': 'enabled', 'enabledAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   'globallyPaused': get('/runtime')['paused'], 'publishTransportEnabled': get('/health')['publishTransportEnabled'],
                   'workerState': get('/health')['worker']['state'], 'manualPublicationsTriggered': 0})
    persist()
except Exception as error:
    report.update({'status': 'failed', 'error': str(error)})
    persist()
    raise
finally:
    if logged_in:
        call('POST', '/auth/logout', {})
print(json.dumps(report, ensure_ascii=False), flush=True)
PY
install -o ubuntu -g ubuntu -m 600 /opt/square-platform/deploy/auto-publishing-enabled.json /home/ubuntu/square-platform-upload/auto-publishing-enabled.json
