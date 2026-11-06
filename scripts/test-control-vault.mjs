// Local-only runner: disposable signing keys, real browser, synthetic lab identity.
// No synthetic Supabase configuration is supplied and no secrets are printed.
import { spawn } from 'node:child_process';
import { generateKeys } from './control-plane-keys.mjs';
// Match the bound IPv4 address. localhost may resolve to an older IPv6 listener.
const env={...process.env,...generateKeys(),VAULT_LAB_ENABLED:'true',VAULT_TEST_URL:'http://127.0.0.1:3100'};
async function run(args){const child=spawn(process.execPath,args,{env,stdio:'inherit'});await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(args.join(' ')+' exited '+code)));});}
await run(['scripts/build-spike.mjs']);
await run(['node_modules/next/dist/bin/next','build']);
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3100'],{env,stdio:'inherit'});
try{
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch(env.VAULT_TEST_URL+'/lab/vault')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}if(!ready)throw Error('Local lab server did not start.');
 for(const browser of (process.argv.find(v=>v.startsWith('--browser='))?[process.argv.find(v=>v.startsWith('--browser=')).split('=')[1]]:['chrome','msedge'])){if(!process.argv.includes('--relay-only'))await run(['scripts/test-vault-browser.mjs','--browser='+browser]);await run(['scripts/test-relay-browser.mjs','--browser='+browser]);}
}finally{server.kill();}
