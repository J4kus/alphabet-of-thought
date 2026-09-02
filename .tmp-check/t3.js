const table=require('../src/table');
const {lint}=require('../src/linter');
const {conceptRegistry}=require('../src/derive');
const reg=(t,n)=>{const{root,nodes}=lint(t,n);return table.mergeRegistries(conceptRegistry(root,nodes));};
const show=(t,n)=>{
  const lines=t.split('\n');
  const edits=table.align(t,reg(t,n),n);
  for(const e of edits){ if(e.to!==undefined){lines.splice(e.line-1,e.to-e.line+1,...e.text.split('\n'));} else lines[e.line-1]=e.text; }
  console.log(lines.map(l=>JSON.stringify(l)).join('\n'));
  console.log('errors after:',lint(lines.join('\n'),n).errors.length);
  console.log('---');
};
// a pre-1.12 bordered file, formatted once
show(['Otter','    |Otter |size|colour|','    |------+----+------|','    |Ollie |5   |brown |','    |    Pup|1   |      |'].join('\n'),'World');
show(['|default|left align|right align|','|-------|:---------|----------:|','|1|1|1|'].join('\n'),'World');
