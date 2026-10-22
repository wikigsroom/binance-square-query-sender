set -eu
python3 -u - <<'PY'
import http.client, json, subprocess
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
        return payload['data'], dict((k.lower(), v) for k, v in response.getheaders())
    finally:
        client.close()
login, response_headers = call('POST', '/auth/login', {'username': credentials['adminUsername'], 'password': credentials['adminPassword']})
headers.update({'Cookie': response_headers['set-cookie'].split(';', 1)[0], 'X-CSRF-Token': login['csrf']})
try:
    runtime, _ = call('GET', '/runtime')
    presets, _ = call('GET', '/presets?limit=1000')
    query = "SELECT json_build_object('publicationStates',(SELECT json_object_agg(state,n) FROM (SELECT data->>'state' state,count(*) n FROM jobs GROUP BY 1) s),'imageStates',(SELECT json_object_agg(state,n) FROM (SELECT data->>'state' state,count(*) n FROM image_jobs GROUP BY 1) s))"
    states = json.loads(subprocess.check_output(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-p', '5433', '-d', 'square_platform', '-tAc', query], text=True))
    print(json.dumps({'release': str(Path('/opt/square-platform/current').resolve()), 'runtime': {k:runtime.get(k) for k in ['paused','contentValidationMode','publishTransportEnabled']}, 'states':states, 'presets':[{'id':p['id'], 'name':p['name'], 'publishedVersionId':p.get('publishedVersionId'), 'draftStyle':(p.get('draftRules') or {}).get('image',{}).get('style'), 'memeOnly': '只允许生成各行各业的 meme 梗图' in (p.get('draftRules') or {}).get('image',{}).get('prompt','')} for p in presets]}, ensure_ascii=False, indent=2))
finally:
    call('POST', '/auth/logout', {})
PY
