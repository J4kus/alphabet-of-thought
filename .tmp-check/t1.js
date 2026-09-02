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
  console.log('---');
};
show(['Otter','    Otter|size|colour','    ---+-+-','    Ollie|5|brown','    Pebble|3|'].join('\n'));
show(['Order|country|basket size','-+-+-','Acme March Order|France|$1,200','Bolt|Germany|$3,100'].join('\n'));
show(['Otter|size','-+-','Ollie|5','    Pup|1','Nibs|2'].join('\n'));
show(['Order|price|vat','-+-+-','Acme|100|20 =@price*0.2'].join('\n'));
