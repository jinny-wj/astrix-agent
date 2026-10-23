import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root=fileURLToPath(new URL('..',import.meta.url));
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'m0-canvas-check-'));
const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const origin='http://127.0.0.1:'+port;
const environment={...process.env,M0_LOCAL_PORT:String(port),M0_LOCAL_DATA_DIR:path.join(directory,'data'),M0_LOCAL_WORKSPACE:path.join(directory,'workspace'),M0_CANVAS_TEST_URL:origin};
delete environment.ELECTRON_RUN_AS_NODE;
const service=spawn(process.execPath,[path.join(root,'server/index.mjs')],{cwd:root,env:environment,stdio:['ignore','pipe','pipe']});
let serverOutput='';for(const stream of [service.stdout,service.stderr])stream.on('data',chunk=>{serverOutput=(serverOutput+chunk).slice(-5000);});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const electron=createRequire(import.meta.url)('electron');
const reports={'canvas/ui-check.cjs':'canvas-ui-verification.json','canvas/ui-enhanced-check.cjs':'canvas-v2-ui-verification.json','canvas/ui-vector-check.cjs':'canvas-vector-ui-verification.json','canvas/ui-collaboration-check.cjs':'canvas-collaboration-ui.json','tools/test-canvas-windows.cjs':'canvas-desktop-windows.json'};
const run=entry=>new Promise((resolve,reject)=>{
  const started=Date.now(),child=spawn(electron,[entry],{cwd:root,env:environment,stdio:'inherit'});let expired=false;
  const deadline=setTimeout(()=>{expired=true;child.kill('SIGTERM');},90000);
  child.once('error',error=>{clearTimeout(deadline);reject(error);});
  child.once('exit',async(code,signal)=>{clearTimeout(deadline);try{if(expired||code!==0)throw Error(`${entry} failed (${expired?'timeout':signal??code})`);const file=path.join(root,'diagnostics',reports[entry]),stat=await fs.stat(file),report=JSON.parse(await fs.readFile(file,'utf8'));if(stat.mtimeMs<started||report.success!==true)throw Error(`${entry} did not produce a fresh passing report`);resolve();}catch(error){reject(error);}});
});
try{
  let ready=false;
  for(let index=0;index<150;index++){
    if(service.exitCode!==null)throw Error('Canvas test server exited: '+serverOutput);
    try{if((await fetch(origin+'/__local/health',{signal:AbortSignal.timeout(500)})).ok){ready=true;break;}}catch{}
    await sleep(40);
  }
  if(!ready)throw Error('Canvas test server did not start: '+serverOutput);
  // GUI checks run sequentially so native focus cannot be stolen by another
  // test window. Both use only this disposable server, never the user's app.
  const entries=process.argv.includes('--collaboration')?['canvas/ui-collaboration-check.cjs','tools/test-canvas-windows.cjs']:['canvas/ui-check.cjs','canvas/ui-enhanced-check.cjs','canvas/ui-vector-check.cjs'];
  for(const entry of entries)await run(entry);
  console.log('PASS: '+entries.join(', '));
}catch(error){console.error(error.message);process.exitCode=1;}
finally{
  service.kill('SIGTERM');
  await Promise.race([new Promise(resolve=>service.once('exit',resolve)),sleep(3000)]);
  if(service.exitCode===null)service.kill('SIGTERM');
  await fs.rm(directory,{recursive:true,force:true});
}
