const table=require('../src/table');
const {lint}=require('../src/linter');
const {conceptRegistry}=require('../src/derive');
const reg=(t,n)=>{const{root,nodes}=lint(t,n);return table.mergeRegistries(conceptRegistry(root,nodes));};
const show=(t,n)=>{
  const lines=t.split('\n');
  const edits=table.align(t,reg(t,n||'World'),n||'World');
  for(const e of edits){ if(e.to!==undefined){lines.splice(e.line-1,e.to-e.line+1,...e.text.split('\n'));} else lines[e.line-1]=e.text; }
  console.log(lines.map(l=>JSON.stringify(l)).join('\n'));
  const {errors}=lint(lines.join('\n'),n||'World');
  console.log('errors:',errors.map(e=>e.line+': '+e.message.slice(0,90)));
  // idempotence
  const t2=lines.join('\n');
  const again=table.align(t2,reg(t2,n||'World'),n||'World');
  console.log('stable:',again.length===0);
  console.log('---');
};
// width cookie + continuation rows
show(['Note|description <12>','-+-','Acme|a long piece of text here'].join('\n'));
// empty row appended by Tab
show(['Otter|size','-+-','Ollie|5','|'].join('\n'));
// two tables needing a blank line
show(['A|b','-+-','x|1','','C|d','-+-','y|2'].join('\n'));
