const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
test('every API is classified; retired handlers stop before any request or data dependency',async()=>{
 const {RETIRED_API_PATHS,CONTROL_API_PATHS}=await import('../config/http-boundary.mjs');
 const routes=files('app/api').filter(f=>f.endsWith('route.ts')).map(f=>path.dirname(path.relative('app/api',f)).replaceAll('\\','/'));
 assert.deepEqual([...routes].sort(),[...RETIRED_API_PATHS,...CONTROL_API_PATHS].sort(),'The route registry must be exact');
 for(const name of routes)assert.ok([...RETIRED_API_PATHS,...CONTROL_API_PATHS].includes(name),'Unclassified route '+name);
 for(const name of RETIRED_API_PATHS){const file=`app/api/${name}/route.ts`,source=fs.readFileSync(file,'utf8');assert.match(source,/from ["']@\/lib\/legacy-gate/);
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,ast=ts.createSourceFile(file,js,ts.ScriptTarget.Latest,true);
 const handlers=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(n.name?.text));assert.ok(handlers.length);
 for(const h of handlers){const body=h.body.getText(ast).slice(1,-1);assert.match(body,/^\s*if\s*\(!legacyBusinessEnabled\(\)\)\s*return retiredBusinessResponse\(\);/);
 const invoke=new (Object.getPrototypeOf(async()=>{}).constructor)('request','legacyBusinessEnabled','retiredBusinessResponse',body);
 const request=new Proxy({},{get(){throw Error('Retired route read request');}});const response=await invoke(request,()=>false,()=>new Response(null,{status:410}));assert.equal(response.status,410,name+' '+h.name.text);}}
});
test('reachable API import graphs contain no business-table writes',async()=>{
 const {CONTROL_API_PATHS,CONTROL_TABLES}=await import('../config/http-boundary.mjs');const writes=/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi;
 for(const route of CONTROL_API_PATHS){const start=`app/api/${route}/route.ts`;assert.ok(fs.existsSync(start),'Missing registered route '+route);const seen=new Set();
 function visit(file){if(seen.has(file))return;seen.add(file);const text=fs.readFileSync(file,'utf8');for(const m of text.matchAll(writes))assert.ok(CONTROL_TABLES.includes(m[1]),`${route} reaches a write to ${m[1]} in ${file}`);
 for(const m of text.matchAll(/from\s+["'](@\/[^"']+|\.[^"']+)["']/g)){const base=m[1].startsWith('@/')?m[1].slice(2):path.resolve(path.dirname(file),m[1]);for(const ext of ['.ts','.tsx','.mjs'])if(fs.existsSync(base+ext)){visit(base+ext);break;}}}
 visit(start);}
});
