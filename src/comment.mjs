export async function upsert({api,repo,pr,body}){
 if(!/^[\w.-]+\/[\w.-]+$/.test(repo)||!/^\d+$/.test(String(pr)))throw Error('Invalid repository or PR');
 if(body.length>60000)throw Error('Comment exceeds bounded size; full report remains in artifact');
 let existing;
 for(let page=1;page<=10;page++){
  const batch=await api(`/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`,'GET');
  existing=batch.find(c=>c.user?.login==='github-actions[bot]'&&c.user?.type==='Bot'&&c.body?.startsWith('<!-- qe-atlas-report:v1 -->'));
  if(existing||batch.length<100)break;
  if(page===10)throw Error('Comment pagination bound exceeded; refusing duplicate');
 }
 return existing?api(`/repos/${repo}/issues/comments/${existing.id}`,'PATCH',{body}):api(`/repos/${repo}/issues/${pr}/comments`,'POST',{body});
}
