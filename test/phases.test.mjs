import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
const runner=resolve('src/run.mjs');
test('two phase Action publishes top links only after upload output is available',()=>{
 const root=mkdtempSync(join(tmpdir(),'qe-phases-')),summary=join(root,'summary'),outputs=join(root,'outputs');writeFileSync(summary,'Prior summary\n');writeFileSync(outputs,'');
 writeFileSync(join(root,'qe-result-example.json'),JSON.stringify({schemaVersion:1,product:'Example',version:'1',verdict:'warn',headline:'Flaky test',metrics:[],findings:[],runUrl:'https://github.com/org/repo/actions/runs/1'}));
 const env={...process.env,QE_RESULTS:'qe-result*.json',QE_COMMENT:'false',QE_MODE:'enforce',QE_PHASE:'prepare',QE_OUTPUT_DIR:join(root,'report'),GITHUB_OUTPUT:outputs,GITHUB_STEP_SUMMARY:summary,QE_ARTIFACT_LINKS:JSON.stringify({'qe-result-example.json':'https://github.com/org/repo/actions/runs/1/artifacts/11'}),QE_REQUIRE_ARTIFACT_LINKS:'true'};
 let p=spawnSync(process.execPath,[runner],{cwd:root,env,encoding:'utf8'});assert.equal(p.status,0,p.stderr);assert.equal(readFileSync(summary,'utf8'),'Prior summary\n');
 p=spawnSync(process.execPath,[runner],{cwd:root,env:{...env,QE_PHASE:'publish',QE_BUNDLE_URL:'https://github.com/org/repo/actions/runs/1/artifacts/22',QE_HTML_URL:'https://org.github.io/repo/pr-1/report.html'},encoding:'utf8'});assert.equal(p.status,0,p.stderr);
 const md=readFileSync(summary,'utf8');assert.match(md,/Download full HTML report/);assert.match(md,/artifacts\/11/);assert.match(md,/artifacts\/22/);assert.match(md,/View HTML report/);assert.match(readFileSync(outputs,'utf8'),/exit-code=0/);
});
