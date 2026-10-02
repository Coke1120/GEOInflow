import fs from 'node:fs';
const input=process.argv[2];
if(!input) throw new Error('Pass pnpm licenses JSON output');
const data=JSON.parse(fs.readFileSync(input,'utf8'));
const packages=Object.values(data).flat().map(row=>({name:row.name,versions:row.versions,license:row.license,homepage:row.homepage||null})).sort((a,b)=>a.name.localeCompare(b.name));
fs.mkdirSync('public/liekan/licenses',{recursive:true});
fs.writeFileSync('public/liekan/licenses/dependencies.json',JSON.stringify({formatVersion:1,packages},null,2)+'\n');
console.log(`Recorded ${packages.length} installed dependency licenses without host paths.`);
