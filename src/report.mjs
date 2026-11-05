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
 if(!Array.isArray(r.findings)||r.findings.length>100)e.push('Invalid findings');else for(const f of r.findings)if(!object(f)||Object.keys(f).some(k=>!['severity','title','location','url','change'].includes(k))||!text(f.severity,50)||!text(f.title,1000)||!text(f.location,2000)||(f.url!==undefined&&!safeUrl(f.url))||(f.change!==undefined&&!['new','fixed','still-open'].includes(f.change)))e.push('Invalid finding');
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
export {render} from './render.mjs';
