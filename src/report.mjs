import {readdirSync,lstatSync,readFileSync,openSync,fstatSync,closeSync,constants} from 'node:fs';
import {resolve,relative,sep,join} from 'node:path';
const keys=['schemaVersion','product','version','verdict','headline','metrics','findings','detailsMarkdown','artifacts','runUrl'];
const text=(v,n=500)=>typeof v==='string'&&v.trim().length>0&&v.length<=n&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
export const safeUrl=v=>{try{const u=new URL(v);return typeof v==='string'&&v.length<=2048&&['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&!/[\s<>"'`]/.test(v);}catch{return false;}};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function validate(r){
 const e=[];if(!object(r))return ['Expected object'];
 if(Object.keys(r).some(k=>!keys.includes(k)))e.push('Unknown property');
 if(r.schemaVersion!==1)e.push('schemaVersion must equal 1');
 for(const k of ['product','version','headline'])if(!text(r[k],k==='version'?100:500)||/[\r\n]/.test(r[k]))e.push(`Invalid ${k}`);
 if(!['pass','fail','warn','error'].includes(r.verdict))e.push('Invalid verdict');
 if(!safeUrl(r.runUrl))e.push('Invalid runUrl');
 if(!Array.isArray(r.metrics)||r.metrics.length>30)e.push('Invalid metrics');else for(const m of r.metrics)if(!object(m)||Object.keys(m).some(k=>!['label','value'].includes(k))||!text(m.label,100)||!((typeof m.value==='number'&&Number.isFinite(m.value))||(typeof m.value==='string'&&m.value.length<=500)))e.push('Invalid metric');
 if(!Array.isArray(r.findings)||r.findings.length>100)e.push('Invalid findings');else for(const f of r.findings)if(!object(f)||Object.keys(f).some(k=>!['severity','title','location','url'].includes(k))||!text(f.severity,50)||!text(f.title,1000)||!text(f.location,2000)||(f.url!==undefined&&!safeUrl(f.url)))e.push('Invalid finding');
 if(r.detailsMarkdown!==undefined&&(typeof r.detailsMarkdown!=='string'||r.detailsMarkdown.length>100000))e.push('Invalid detailsMarkdown');
 if(r.artifacts!==undefined){if(!Array.isArray(r.artifacts)||r.artifacts.length>30)e.push('Invalid artifacts');else for(const a of r.artifacts)if(!object(a)||Object.keys(a).some(k=>!['label','url'].includes(k))||!text(a.label,100)||!safeUrl(a.url))e.push('Invalid artifact');}
 return [...new Set(e)];
}
export const overall=rs=>rs.some(r=>r.verdict==='fail')?'fail':rs.some(r=>r.verdict==='error')?'error':rs.some(r=>r.verdict==='warn')?'warn':'pass';
const lines=s=>String(s||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
function glob(pattern){if(pattern.startsWith('/')||pattern.split('/').includes('..')||pattern.includes('\\')||pattern.length>500)throw Error('Glob must be workspace-relative without parent traversal');let s='';for(let i=0;i<pattern.length;i++){if(pattern[i]==='*'){if(pattern[i+1]==='*'){i++;if(pattern[i+1]==='/'){i++;s+='(?:.*/)?';}else s+='.*';}else s+='[^/]*';}else if(pattern[i]==='?')s+='[^/]';else s+=pattern[i].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}return new RegExp('^'+s+'$');}
function errorResult(file,message,runUrl){return {schemaVersion:1,product:`Result error: ${file}`,version:'unknown',verdict:'error',headline:message,metrics:[],findings:[{severity:'error',title:message,location:file}],runUrl};}
export function collect({root=process.cwd(),patterns='**/qe-result*.json',expected='',runUrl='https://github.com/DaveEliranAssistant/qe-atlas-report'}={}){
 root=resolve(root);const results=[],files=[],errs=[];let visited=0,total=0;
 const matchers=lines(patterns).map(glob);const expectedPatterns=lines(expected).map(p=>({p,re:glob(p)}));
 function walk(dir,depth=0){if(depth>20)throw Error('Discovery depth limit exceeded');for(const ent of readdirSync(dir,{withFileTypes:true})){if(++visited>20000)throw Error('Discovery entry limit exceeded');if(['.git','node_modules'].includes(ent.name))continue;const full=join(dir,ent.name),rel=relative(root,full).split(sep).join('/');if(ent.isDirectory())walk(full,depth+1);else if(matchers.some(re=>re.test(rel))||expectedPatterns.some(x=>x.re.test(rel)))files.push(rel);}}
 try{walk(root);}catch{errs.push(errorResult('discovery','Discovery failed or bounded limit exceeded',runUrl));}
 for(const x of expectedPatterns)if(!files.some(f=>x.re.test(f)))errs.push(errorResult(x.p,'Expected product result is missing',runUrl));
 if(files.length===0&&errs.length===0)errs.push(errorResult('discovery','No product result files found',runUrl));
 if(files.length>100){errs.push(errorResult('discovery','More than 100 result files; report incomplete',runUrl));files.length=100;}
 for(const file of [...new Set(files)].sort()){
  let fd;try{const full=join(root,file);if(!lstatSync(full).isFile())throw Error('Not regular');fd=openSync(full,constants.O_RDONLY|constants.O_NOFOLLOW);const st=fstatSync(fd);if(!st.isFile()||st.size>262144)throw Error('Too large');total+=st.size;if(total>4194304)throw Error('Total too large');const r=JSON.parse(readFileSync(fd,'utf8'));const errors=validate(r);if(errors.length)errs.push(errorResult(file,errors.join('; ').slice(0,500),runUrl));else results.push({...r,sourceFile:file});}catch{errs.push(errorResult(file,'Malformed, unsafe, unreadable or oversized result file',runUrl));}finally{if(fd!==undefined)closeSync(fd);}
 }
 const all=[...results,...errs];return {schemaVersion:1,verdict:overall(all),hasErrors:errs.length>0,results:all};
}
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const md=s=>esc(s).replace(/([\\`*_{}\[\]()#+.!|~])/g,'\\$1').replace(/\r?\n/g,' ');
const url=s=>s.replace(/\(/g,'%28').replace(/\)/g,'%29');
export function render(report){
 const rs=report.results,rows=[],sections=[],mr=[],ms=[];
 for(let i=0;i<rs.length;i++){
  const r=rs[i],id=`product-${i+1}`,metrics=r.metrics.map(m=>`${m.label}: ${m.value}`).join('; '),title=`${r.product} — ${r.verdict.toUpperCase()}`;
  rows.push(`<tr><th scope="row">${esc(r.product)}</th><td>${esc(r.verdict.toUpperCase())}</td><td>${esc(r.headline)}</td><td>${esc(metrics)}</td><td><a href="#${id}">Details for ${esc(r.product)}</a></td></tr>`);
  sections.push(`<details id="${id}" open><summary>${esc(title)}</summary><p>${esc(r.headline)}</p><p>Version: ${esc(r.version)} · <a href="${esc(r.runUrl)}">Source CI run</a></p><ul>${r.metrics.map(m=>`<li>${esc(m.label)}: ${esc(m.value)}</li>`).join('')}</ul><h3>Findings (${r.findings.length} shown)</h3>${r.findings.length?'<ul>'+r.findings.map(f=>`<li><strong>${esc(f.severity)}</strong>: ${esc(f.title)} — <code>${esc(f.location)}</code>${f.url?` · <a href="${esc(f.url)}">Reference</a>`:''}</li>`).join('')+'</ul>':'<p>No listed findings. Check the product scope below.</p>'}${r.detailsMarkdown?`<h3>Native product details</h3><pre>${esc(r.detailsMarkdown)}</pre>`:''}${r.artifacts?.length?'<h3>Artifacts</h3><ul>'+r.artifacts.map(a=>`<li><a href="${esc(a.url)}">${esc(a.label)}</a></li>`).join('')+'</ul>':''}</details>`);
  mr.push(`| ${md(r.product)} | **${r.verdict.toUpperCase()}** | ${md(r.headline)} | ${md(metrics)} | [Details](${url(r.runUrl)}) |`);
  ms.push(`<details>\n<summary>${md(title)}</summary>\n\n${md(r.headline)}\n\nVersion: ${md(r.version)} · [Source CI run](${url(r.runUrl)})\n\n${r.findings.map(f=>`- **${md(f.severity)}**: ${md(f.title)} — ${md(f.location)}${f.url?` · [Reference](${url(f.url)})`:''}`).join('\n')||'No listed findings.'}\n\n${r.detailsMarkdown?'Native report (literal, not executed):\n\n<pre>'+esc(r.detailsMarkdown)+'</pre>':''}\n\n</details>`);
 }
 const heading=`QE Atlas Report — ${report.verdict.toUpperCase()}`;
 const note='Product verdicts are preserved. PASS is scoped to each product’s checks, not certification or full compatibility. Findings are capped at 100 per product; full counts remain in metrics and native artifacts.';
 const markdown=`<!-- qe-atlas-report:v1 -->\n# ${heading}\n\n${report.hasErrors?'**Operational errors are present; evidence is incomplete.**\n\n':''}| Product | Verdict | Headline | Key metrics | Details |\n| --- | --- | --- | --- | --- |\n${mr.join('\n')}\n\n${note}\n\n${ms.join('\n\n')}\n`;
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${heading}</title><style>body{font:16px/1.55 system-ui,sans-serif;color:#182433;background:#f4f6fa;margin:0}main{max-width:1200px;margin:auto;padding:32px}h1{font-size:2rem}table{width:100%;border-collapse:collapse;background:white}caption{text-align:left;font-weight:600;padding:12px 0}th,td{text-align:left;border:1px solid #a6b0be;padding:12px;vertical-align:top}a{color:#174ea6}details{background:white;border:1px solid #a6b0be;border-radius:8px;padding:18px;margin:20px 0}summary{font-size:1.2rem;font-weight:700;cursor:pointer}pre,code{white-space:pre-wrap;overflow-wrap:anywhere}pre{background:#edf1f7;padding:14px;font-size:.85rem}td,th{overflow-wrap:anywhere}.table-scroll{overflow-x:auto}:focus-visible{outline:3px solid #174ea6;outline-offset:3px}</style></head><body><main><h1>${heading}</h1>${report.hasErrors?'<p><strong>Operational errors are present; evidence is incomplete.</strong></p>':''}<p>${note}</p><div class="table-scroll" role="region" aria-label="Product results" tabindex="0"><table><caption>All discovered product checks</caption><thead><tr><th scope="col">Product</th><th scope="col">Verdict</th><th scope="col">Headline</th><th scope="col">Key metrics</th><th scope="col">Details</th></tr></thead><tbody>${rows.join('')}</tbody></table></div><h2>Product details</h2>${sections.join('')}</main></body></html>`;
 return {html,markdown};
}
