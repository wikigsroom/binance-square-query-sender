set -eu
python3 -u - <<'PY'
import datetime, http.client, json, os, pwd, subprocess
from pathlib import Path
from zoneinfo import ZoneInfo

root=Path('/opt/square-platform')
query="""
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object(
 'job',(SELECT j.data || jsonb_build_object('id',j.id) FROM jobs j JOIN posts p ON j.id=p.data->>'jobId' WHERE p.data->>'text' LIKE '%一只戴工牌的河狸%' ORDER BY p.created_at DESC LIMIT 1),
 'exampleText',(SELECT data->>'text' FROM posts WHERE data->>'text' LIKE '%一只戴工牌的河狸%' ORDER BY created_at DESC LIMIT 1),
 'history',COALESCE((SELECT json_agg(t) FROM (SELECT data->>'text' text FROM posts ORDER BY created_at DESC LIMIT 40) t),'[]'::json),
 'presets',COALESCE((SELECT json_agg(json_build_object('id',p.id,'name',p.data->>'name','rules',v.data->'rules')) FROM presets p JOIN preset_versions v ON v.id=p.data->>'publishedVersionId' WHERE (p.data->>'enabled')::boolean),'[]'::json),
 'runtime',(SELECT json_build_object('paused',data->'paused','contentValidationMode',data->>'contentValidationMode') FROM runtime WHERE id='main'),
 'activeJobs',(SELECT count(*) FROM jobs WHERE data->>'state' IN ('preparing','generating_text','validating','preparing_media','ready','submitting')),
 'recentRuns',COALESCE((SELECT json_agg(t) FROM (SELECT id,created_at,data FROM generation_runs WHERE data->>'type'='text' ORDER BY created_at DESC LIMIT 30) t),'[]'::json),
 'recentPosts',COALESCE((SELECT json_agg(t) FROM (SELECT p.id,p.data AS post,r.data AS run FROM posts p JOIN content_versions c ON c.id=p.data->>'contentId' JOIN generation_runs r ON r.id=c.data->>'generationRunId' ORDER BY p.created_at DESC LIMIT 40) t),'[]'::json)
);
COMMIT;
"""
raw=subprocess.check_output(['runuser','-u','postgres','--','psql','-X','-qAt','-p','5433','-d','square_platform','-c',query],text=True)
data=json.loads(raw)
assert data['job'] and data['exampleText'], 'Original incident evidence unavailable'
code="""import fs from 'node:fs';
import { AI, PROMPT_VERSION } from './dist/src/ai.js';
import { hash, normalize } from './dist/src/core.js';
import { validate } from './dist/src/validation.js';
import { writingHistory } from './dist/src/writing-context.js';
import { ARTICLE_POLICY_VERSION, imageBriefInBody } from './dist/src/article-policy.js';
import { IMAGE_POLICY_VERSION } from './dist/src/image-policy.js';
const data=JSON.parse(fs.readFileSync(0,'utf8'));
if(PROMPT_VERSION!=='square-author/1.4.0'||ARTICLE_POLICY_VERSION!=='article-body-v1'||IMAGE_POLICY_VERSION!=='industry-meme-v1')throw Error('Wrong live versions');
const ai=new AI(null,null,null);
const input={tokens:data.job.tokens||[],facts:data.job.facts||[],snapshots:[],warnings:[]};
const results=[];
for(const preset of data.presets){
 const job={...data.job,rules:preset.rules,baseText:data.exampleText,revision:'按本次文字预设重新写成文章'};
 const repair={previousDraft:{text:data.exampleText,claims:[{quote:data.exampleText}]},errors:[{code:'IMAGE_BRIEF_IN_BODY',quote:data.exampleText}]};
 const payload=JSON.parse(ai.prompt(job,input,[...data.history,{text:data.exampleText}],repair)[1].content);
 if(payload.rules.image||payload.rules.modelId||JSON.stringify(payload).includes(data.exampleText))throw Error('Image script entered writing context');
 if(job.rules.image.prompt&&JSON.stringify(payload).includes(job.rules.image.prompt))throw Error('Image prompt entered writing context');
 if(payload.rules.direction!==job.rules.direction||payload.rules.maxChars!==job.rules.maxChars)throw Error('Text requirements changed');
 if(payload.task.baseText!==null||!payload.task.rewriteFromFacts||payload.repairErrors.previousDraft!==null||!payload.repairErrors.rewriteFromFacts)throw Error('Revision/repair isolation failed');
 if(payload.outputContract.contentType!=='article_body'||payload.outputContract.imageInstructionsAllowed!==false)throw Error('Wrong output contract');
 results.push({presetId:preset.id,name:preset.name,textDirectionPreserved:true,textLengthPreserved:true,imageConfigExcluded:true,revisionAndRepairIsolated:true,imageMode:job.rules.image.mode});
}
if(!results.length)throw Error('No published presets inspected');
const bad={text:data.exampleText,contentHash:hash(data.exampleText),tokens:[],claims:[],usedSourceIds:[],newsClaims:[]};
for(const mode of ['strict','publish_first']){
 const result=validate(bad,data.job.rules,input,[],[],mode);
 if(result.passed||!result.errors.some(issue=>issue.code==='IMAGE_BRIEF_IN_BODY'))throw Error('Original leaked script was accepted');
}
const inspectRun=(row)=>{
 const run=row.data;
 let text='';try{text=JSON.parse(run.output||'{}').text||'';}catch{}
 const payload=JSON.parse((run.messages||[]).find(message=>message.role==='user')?.content||'{}');
 return {id:row.id,jobId:run.jobId,state:run.state,promptVersion:run.promptVersion,requestedModel:run.requestedModel,createdAt:row.created_at,receivesImageRules:'image' in (payload.rules||{}),imageBriefDetected:!!imageBriefInBody(text),characterCount:Array.from(text).length};
};
const runs=data.recentRuns.map(inspectRun).filter(run=>run.promptVersion===PROMPT_VERSION);
if(runs.some(run=>run.receivesImageRules))throw Error('Actual new request received image rules');
const posts=data.recentPosts.filter(row=>row.run.promptVersion===PROMPT_VERSION).map(row=>{
 const text=row.post.text;
 const issue=imageBriefInBody(text);
 const matchesAi=normalize(JSON.parse(row.run.output).text)===text;
 if(issue||!matchesAi)throw Error('Published body violates the article boundary or AI provenance');
 return {id:row.id,jobId:row.post.jobId,publishedAt:row.post.publishedAt,url:row.post.url,verificationStatus:row.post.verificationStatus,model:row.run.requestedModel,characterCount:Array.from(text).length,matchesAi:true,imageBriefDetected:false,excerpt:Array.from(text).slice(0,160).join('')};
});
const previousReleasePosts=data.recentPosts.filter(row=>row.run.promptVersion==='square-author/1.3.0');
console.log(JSON.stringify({promptVersion:PROMPT_VERSION,articlePolicyVersion:ARTICLE_POLICY_VERSION,imagePolicyVersion:IMAGE_POLICY_VERSION,presetChecks:results,originalIncidentRejectedInBothModes:true,previousExamples:data.history.length,cleanExamples:writingHistory(data.history).length,observedNewAuthorRuns:runs,observedNewPublishedPosts:posts,previousReleasePublishedCount:previousReleasePosts.length,previousReleasePostsWithImageBrief:previousReleasePosts.filter(row=>imageBriefInBody(row.post.text)).length,modelRequests:0}));
"""
live=json.loads(subprocess.check_output(['runuser','-u','square-platform','--','/usr/local/bin/node','--input-type=module','-e',code],input=json.dumps(data),cwd=root/'current/service',text=True))
client=http.client.HTTPConnection('127.0.0.1',39410,timeout=10)
client.request('GET','/api/v1/auth/me');response=client.getresponse();response.read();client.close()
assert response.status==401, 'API readiness failed'
report={'checkedAt':datetime.datetime.now(ZoneInfo('Asia/Taipei')).isoformat(),'release':(root/'current').resolve().name,'service':subprocess.check_output(['systemctl','is-active','square-platform.service'],text=True).strip(),'apiReady':True,'runtime':data['runtime'],'activeJobs':data['activeJobs'],'checks':live,'verificationScope':'Read-only production requests, original incident, all published presets, model output and publication records; public verification status is recorded separately.'}
assert report['release']=='20261023-article-body-guard' and report['service']=='active'
destination=Path('/home/ubuntu/square-platform-upload/article-body-verification.json')
destination.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');destination.chmod(0o600)
owner=pwd.getpwnam('ubuntu');os.chown(destination,owner.pw_uid,owner.pw_gid)
print(json.dumps(report,ensure_ascii=False,indent=2))
PY
