import {mkdir,writeFile,readFile,appendFile} from 'node:fs/promises';
import path from 'node:path';import {collect,render,overall,safeUrl} from './report.mjs';import {upsert} from './comment.mjs';
const out=process.env.QE_OUTPUT_DIR||'qe-atlas-report',phase=process.env.QE_PHASE||'single';
const expected=process.env.QE_EXPECTED||'';
let report,deliveryError=false;
const operational=message=>({schemaVersion:1,product:'Report delivery',version:'1',verdict:'error',headline:message,metrics:[],findings:[],runUrl:`https://github.com/${process.env.GITHUB_REPOSITORY||'DaveEliranAssistant/qe-atlas-report'}/actions/runs/${process.env.GITHUB_RUN_ID||'0'}`});
try{
 if(!['prepare','publish','single'].includes(phase))throw Error('Invalid phase');
 if(phase==='publish')report=JSON.parse(await readFile(path.join(out,'report.json'),'utf8'));
 else {
  report=await collect({patterns:process.env.QE_RESULTS||'**/qe-result*.json',expected});
  try{
   const links=JSON.parse(process.env.QE_ARTIFACT_LINKS||'{}');if(!links||typeof links!=='object'||Array.isArray(links))throw Error('Invalid artifact-links map');
   for(const r of report.results){const url=links[r.sourceFile];if(url){if(!safeUrl(url))throw Error('Unsafe native artifact URL');r.artifacts=[{label:'Native report',url},...(r.artifacts||[]).filter(a=>a.url!==url)];}else if(process.env.QE_REQUIRE_ARTIFACT_LINKS==='true'&&r.sourceFile)report.results.push(operational(`Missing native artifact link for ${r.product}`));}
  }catch{report.results.push(operational('Invalid native artifact link configuration'));}
  report.verdict=overall(report.results);report.hasErrors=report.results.some(r=>r.verdict==='error');
 }
 report.targetLabel=process.env.QE_TARGET_LABEL||report.targetLabel||'';
 if(report.targetLabel.length>120||/[\r\n\x00-\x1f]/.test(report.targetLabel))throw Error('Invalid target label');
 const downloadUrl=process.env.QE_BUNDLE_URL||'',htmlUrl=process.env.QE_HTML_URL||'';
 if(phase==='publish'&&!safeUrl(downloadUrl))throw Error('Missing uploaded HTML artifact URL');
 const {html,markdown}=render(report,{downloadUrl,htmlUrl,targetLabel:report.targetLabel});
 await mkdir(out,{recursive:true});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(path.join(out,'report.html'),html);await writeFile(path.join(out,'report.md'),markdown);
 if(phase!=='prepare'){
  if(process.env.GITHUB_STEP_SUMMARY){let previous='';try{previous=await readFile(process.env.GITHUB_STEP_SUMMARY,'utf8');}catch{}await writeFile(process.env.GITHUB_STEP_SUMMARY,markdown+'\n'+previous);}
  const comment=process.env.QE_COMMENT==='true';
  if(comment){
   let number=Number(process.env.QE_PR_NUMBER||0);if(!number&&process.env.GITHUB_EVENT_PATH){const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));number=event.pull_request?.number||0;}
   if(!number||!process.env.GITHUB_TOKEN||!process.env.GITHUB_REPOSITORY)throw Error('Comment requested without PR number, repository or token');
   const request=async(method,route,body)=>{const response=await fetch(`https://api.github.com${route}`,{method,headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{})});if(!response.ok)throw Error(`GitHub API ${response.status}`);return response.json();};
   const result=await upsert({api:(route,method,body)=>request(method,route,body),repo:process.env.GITHUB_REPOSITORY,pr:number,body:markdown});if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`comment-url=${result.html_url}\n`);
  }
 }
}catch(error){console.error(`QE Atlas report infrastructure error: ${error.message}`);deliveryError=true;}
const mode=process.env.QE_MODE||'report-only';
if(!['report-only','enforce'].includes(mode)){console.error('Invalid mode');deliveryError=true;}
const exitCode=deliveryError?2:mode==='enforce'?(report?.hasErrors?2:report?.verdict==='fail'||report?.verdict==='warn'&&process.env.QE_FAIL_ON_WARN==='true'?1:0):0;
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`verdict=${report?.verdict||'error'}\nexit-code=${exitCode}\n`);
console.log(`QE Atlas Report: ${report?.verdict?.toUpperCase()||'ERROR'}, ${report?.results?.length||0} results, hasErrors=${report?.hasErrors||deliveryError}`);
