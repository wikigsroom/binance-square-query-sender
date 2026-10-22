set -eu
python3 -u - <<'PY'
import datetime, json, os, pwd, subprocess
from pathlib import Path
from zoneinfo import ZoneInfo

root=Path('/opt/square-platform')
query="""
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object(
 'job',(SELECT data || jsonb_build_object('id',id) FROM jobs WHERE id=(SELECT data->>'jobId' FROM posts WHERE data->>'text' LIKE '%一只戴工牌的河狸%' ORDER BY created_at DESC LIMIT 1)),
 'history',COALESCE((SELECT json_agg(t) FROM (SELECT data->>'text' text FROM posts ORDER BY created_at DESC LIMIT 40) t),'[]'::json),
 'runtime',(SELECT json_build_object('paused',data->'paused','contentValidationMode',data->>'contentValidationMode') FROM runtime WHERE id='main'),
 'recentAuthorRuns',COALESCE((SELECT json_agg(t) FROM (SELECT id,created_at,data->>'jobId' job_id,data->>'state' state,data->>'promptVersion' prompt_version,data->>'output' output,data->'messages' messages FROM generation_runs WHERE data->>'type'='text' ORDER BY created_at DESC LIMIT 15) t),'[]'::json)
);
COMMIT;
"""
raw=subprocess.check_output(['runuser','-u','postgres','--','psql','-X','-qAt','-p','5433','-d','square_platform','-c',query],text=True)
data=json.loads(raw)
assert data['job'], 'Could not locate the original problem post'
code="""import fs from 'node:fs';
import { AI, PROMPT_VERSION } from './dist/src/ai.js';
import { writingHistory } from './dist/src/writing-context.js';
import { IMAGE_POLICY_VERSION } from './dist/src/image-policy.js';
const data=JSON.parse(fs.readFileSync(0,'utf8'));
const input={tokens:data.job.tokens||[],facts:data.job.facts||[],snapshots:[],warnings:[]};
const messages=new AI(null,null,null).prompt(data.job,input,data.history,null);
const payload=JSON.parse(messages[1].content);
if(payload.rules.image||payload.rules.modelId||payload.rules.futureImagePolicy)throw Error('Image configuration reached author');
if(JSON.stringify(payload).includes(data.job.rules.image.prompt))throw Error('Image prompt reached author');
if(payload.rules.direction!==data.job.rules.direction||payload.rules.maxChars!==data.job.rules.maxChars)throw Error('Text requirements were changed');
if(!messages[0].content.includes('不要写配图说明'))throw Error('Missing body-only instruction');
if(PROMPT_VERSION!=='square-author/1.3.0'||IMAGE_POLICY_VERSION!=='industry-meme-v1')throw Error('Wrong live versions');
console.log(JSON.stringify({promptVersion:PROMPT_VERSION,imagePolicyVersion:IMAGE_POLICY_VERSION,authorReceivesImageRules:false,textDirectionPreserved:true,textLengthPreserved:true,previousExamples:data.history.length,cleanExamples:writingHistory(data.history).length,originalImageMode:data.job.rules.image.mode,originalImageModelId:data.job.rules.image.modelId,modelRequests:0}));
"""
live=json.loads(subprocess.check_output(['runuser','-u','square-platform','--','/usr/local/bin/node','--input-type=module','-e',code],input=json.dumps({'job':data['job'],'history':data['history']}),cwd=root/'current/service',text=True))
runs=[]
for run in data['recentAuthorRuns']:
    if run['prompt_version']!='square-author/1.3.0':continue
    user=next((m['content'] for m in run.get('messages') or [] if m.get('role')=='user'),'{}')
    payload=json.loads(user)
    try: text=json.loads(run.get('output') or '{}').get('text','')
    except (ValueError,TypeError):text=''
    runs.append({'id':run['id'],'jobId':run['job_id'],'createdAt':run['created_at'],'state':run['state'],'authorReceivesImageRules':'image' in payload.get('rules',{}),'containsExplicitImageBrief':any(marker in text for marker in ['行业梗图：','梗图：','配图：','梗图可以画']),'characterCount':len(text)})
report={'checkedAt':datetime.datetime.now(ZoneInfo('Asia/Taipei')).isoformat(),'release':(root/'current').resolve().name,'service':subprocess.check_output(['systemctl','is-active','square-platform.service'],text=True).strip(),'runtime':data['runtime'],'livePromptChecks':live,'observedNewAuthorRuns':runs,'validation':{'backendTestsPassed':66,'backendTypeCheck':'passed','backendBuild':'passed','extraPaidModelRequests':0},'historicalInspection':{'checkedAt':'2026-10-23T05:14:23+08:00','recentPostsChecked':100,'postsWithImageBriefMarkers':66,'exactExamplePublishedAt':'2026-10-23T05:09:19+08:00','exampleMatchesParsedModelText':True,'exampleModel':'gpt-6-luna','contaminatedExamplesInItsHistory':33,'historyWindow':40}}
assert report['release']=='20261023-text-image-isolation' and report['service']=='active'
assert all(not r['authorReceivesImageRules'] for r in runs)
destination=Path('/home/ubuntu/square-platform-upload/writing-image-isolation-verification.json')
destination.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');destination.chmod(0o600)
owner=pwd.getpwnam('ubuntu');os.chown(destination,owner.pw_uid,owner.pw_gid)
print(json.dumps(report,ensure_ascii=False,indent=2))
PY
