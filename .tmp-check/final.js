const table=require('../src/table');
const {lint}=require('../src/linter');
const {conceptRegistry}=require('../src/derive');
const reg=(t,n)=>{const{root,nodes}=lint(t,n);return table.mergeRegistries(conceptRegistry(root,nodes));};
const show=(label,t,n)=>{
  const lines=t.split('\n');
  const edits=table.align(t,reg(t,n),n);
  for(let i=edits.length-1;i>=0;i--){const e=edits[i];
    if(e.to!==undefined)lines.splice(e.line-1,e.to-e.line+1,...e.text.split('\n'));else lines[e.line-1]=e.text;}
  console.log('--- '+label);
  console.log(lines.join('\n'));
  console.log('errors:',lint(lines.join('\n'),n).errors.length);
};
show('a pre-1.12 table, formatted once',
 ['Otter','    |Otter |size|colour|','    |------+----+------|','    |Ollie |5   |brown |','    |    Pup|1   |      |'].join('\n'),'World');
show('a new table, nested rows and a formula',
 ['Order|price|vat','Acme|100|20 =@price*0.2','    Sub|50|10 =@price*0.2'].join('\n'),'World');
