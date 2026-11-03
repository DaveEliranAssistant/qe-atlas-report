import {mkdir,writeFile,readFile,mkdtemp,rm} from 'node:fs/promises';import {spawnSync} from 'node:child_process';import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {render,validate,overall} from './report.mjs';
export async function writePreview({report,directory,number}){
 if(!Number.isSafeInteger(number)||number<1)throw Error('Invalid PR number');
 if(!report||!Array.isArray(report.results)||!report.results.length||report.results.length>100)throw Error('Invalid preview report');
 for(const r of report.results){const {sourceFile,...result}=r;if(validate(result).length)throw Error('Invalid preview product result');}
 if(report.verdict!==overall(report.results))throw Error('Preview verdict mismatch');
 const label=report.targetLabel||'';if(typeof label!=='string'||label.length>120||/[\r\n\x00-\x1f]/.test(label))throw Error('Invalid preview target label');
 const target=path.join(directory,`pr-${number}`);await mkdir(target,{recursive:true});
 await writeFile(path.join(target,'report.html'),render(report,{targetLabel:label}).html);
 await writeFile(path.join(target,'report.json'),JSON.stringify(report));return target;
}
export async function buildSite({repository,token,directory,api='https://api.github.com'}){
 if(!/^[\w.-]+\/[\w.-]+$/.test(repository)||!token)throw Error('Repository and read-only Actions token required');
 const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
 const get=async(route,binary=false)=>{const response=await fetch(`${api}${route}`,{headers});if(!response.ok)throw Error(`Preview API ${response.status}`);let size=0,chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>5*1024*1024)throw Error('Preview response exceeds size limit');chunks.push(chunk);}const buffer=Buffer.concat(chunks);return binary?buffer:JSON.parse(buffer.toString());};
 const prs=await get(`/repos/${repository}/pulls?state=open&per_page=100`);if(prs.length===100)throw Error('Open PR discovery bound exceeded');
 await mkdir(directory,{recursive:true});const published=[];
 for(const pr of prs.filter(pr=>pr.head.repo?.full_name===repository)){
  const runs=await get(`/repos/${repository}/actions/workflows/qe.yml/runs?event=pull_request&branch=${encodeURIComponent(pr.head.ref)}&per_page=20`);
  let artifact,source;
  for(const run of runs.workflow_runs){const list=await get(`/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`);artifact=list.artifacts.filter(a=>a.name==='qe-atlas-report'&&!a.expired).sort((a,b)=>b.id-a.id)[0];if(artifact){source=run;break;}}
  if(!artifact)continue;
  const buffer=await get(`/repos/${repository}/actions/artifacts/${artifact.id}/zip`,true),temp=await mkdtemp(path.join(tmpdir(),'qe-preview-'));
  let report;
  try{const zip=path.join(temp,'report.zip');await writeFile(zip,buffer);const result=spawnSync('unzip',['-p',zip,'report.json'],{encoding:'utf8',maxBuffer:5*1024*1024});if(result.status!==0)throw Error('Preview artifact has no readable report.json');report=JSON.parse(result.stdout);}finally{await rm(temp,{recursive:true,force:true});}
  await writePreview({report,directory,number:pr.number});published.push({number:pr.number,verdict:report.verdict,sourceRun:source.html_url,headSha:source.head_sha,artifactId:artifact.id});
 }
 if(!published.length)throw Error('No report artifacts available for preview');
 await writeFile(path.join(directory,'.nojekyll'),'');await writeFile(path.join(directory,'index.json'),JSON.stringify(published,null,2)+'\n');
 await writeFile(path.join(directory,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QE Atlas report previews</title><main><h1>QE Atlas report previews</h1><p>Latest available reports for open same-repository pull requests. Native artifact downloads require GitHub sign-in and expire with artifact retention.</p><ul>${published.map(p=>`<li><a href="pr-${p.number}/report.html">PR #${p.number} — ${p.verdict.toUpperCase()}</a></li>`).join('')}</ul></main></html>`);
 return published;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{const published=await buildSite({repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN,directory:process.env.QE_PREVIEW_DIRECTORY||'qe-preview-site'});console.log(JSON.stringify(published));}catch(error){console.error(error.message);process.exitCode=1;}}
