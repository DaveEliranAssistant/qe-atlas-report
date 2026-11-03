import {mkdirSync,writeFileSync,readFileSync,existsSync,appendFileSync} from 'node:fs';import {resolve,join} from 'node:path';import {collect,render} from './report.mjs';import {upsert} from './comment.mjs';
const env=process.env,out=resolve(env.QE_OUTPUT_DIR||'qe-atlas-report');
const runUrl=`${env.GITHUB_SERVER_URL||'https://github.com'}/${env.GITHUB_REPOSITORY||'DaveEliranAssistant/qe-atlas-report'}/actions/runs/${env.GITHUB_RUN_ID||'0'}`;
let report;try{report=collect({patterns:env.QE_RESULTS||'**/qe-result*.json',expected:env.QE_EXPECTED||'',runUrl});}catch{report={schemaVersion:1,verdict:'error',hasErrors:true,results:[{schemaVersion:1,product:'Report discovery',version:'1',verdict:'error',headline:'Invalid discovery configuration',metrics:[],findings:[],runUrl}]};}
mkdirSync(out,{recursive:true});let {html,markdown}=render(report);
writeFileSync(join(out,'report.html'),html);writeFileSync(join(out,'report.md'),markdown);writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
let infrastructureError=false;
try{
 if(env.QE_COMMENT==='true'){
  if(!env.QE_PR_NUMBER)console.log('Comment skipped: event has no PR number.');else{
   if(!env.QE_TOKEN)throw Error('Missing job token');
   const api=async(path,method='GET',body)=>{const res=await fetch(`https://api.github.com${path}`,{method,headers:{Authorization:`Bearer ${env.QE_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:body?JSON.stringify(body):undefined});if(!res.ok)throw Error(`GitHub report comment request failed (${res.status})`);return res.json();};
   const comment=await upsert({api,repo:env.GITHUB_REPOSITORY,pr:env.QE_PR_NUMBER,body:markdown});
   const readback=await api(`/repos/${env.GITHUB_REPOSITORY}/issues/comments/${comment.id}`);if(readback.body!==markdown)throw Error('Comment readback mismatch');
   if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,`comment-url=${readback.html_url}\n`);
  }
 }
}catch(error){infrastructureError=true;console.error(error.message);markdown+='\n**Report delivery error:** '+error.message+'\n';}
if(env.GITHUB_STEP_SUMMARY){const prior=existsSync(env.GITHUB_STEP_SUMMARY)?readFileSync(env.GITHUB_STEP_SUMMARY,'utf8'):'';writeFileSync(env.GITHUB_STEP_SUMMARY,markdown+'\n'+prior);}
const mode=env.QE_MODE||'report-only';if(!['report-only','enforce'].includes(mode))infrastructureError=true;
const exitCode=infrastructureError?2:mode==='enforce'?(report.hasErrors?2:report.verdict==='fail'?1:0):0;
if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,`verdict=${report.verdict}\nexit-code=${exitCode}\noutput-dir=${out}\n`);
console.log(`QE Atlas Report: ${report.verdict.toUpperCase()}, ${report.results.length} results, hasErrors=${report.hasErrors}`);
// Composite uploads artifacts before applying the recorded exit code.
