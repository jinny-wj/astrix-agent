import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import layoutModule from '../layout.cjs';

// Only static REA inspection. This script does not start the original app,
// register MCP, install analysis engines or import recovered application code.
const {sharedRoot:root,recoveryRoot:recovered}=layoutModule.getLayout();
const targets={
  main:{root:path.join(recovered,'extracted/app'),sources:['out/main/index.js'],ceiling:12000},
  'figma-bridge':{root:path.join(recovered,'web-assets/additional-static'),sources:['p5-live.wskwai.com/kcdn/cdn-kcdn112803/app-figma-api/index.iife-76.js'],ceiling:8000},
  editor:{root:path.join(recovered,'extracted/resources/editor'),sources:['out/server-main.kscode.js','out/vs/code/browser/workbench/workbench.kscode.js'],ceiling:10000}
};
const name=process.argv[2];
if(!targets[name]){console.log('Usage: npm run analyze:rea -- main|figma-bridge|editor\nUses REA 6.7.0 with a bounded static source selection.');process.exit(name?1:0);}
const target=targets[name];
for(const source of target.sources)if(!fs.existsSync(path.join(target.root,source)))throw new Error('Recovered target is missing: '+source);
const output=path.join(root,'diagnostics/rea');fs.mkdirSync(output,{recursive:true,mode:0o700});
const resultFile=path.join(output,name+'-analysis.json');
const errorsFile=path.join(output,name+'-analysis.stderr');
const out=fs.openSync(resultFile,'w',0o600),err=fs.openSync(errorsFile,'w',0o600);
const child=spawn('npx',['-y','--cache',process.env.M0_REA_NPM_CACHE||path.join(os.tmpdir(),'m0-rea-npm-cache'),'rea-agents@6.7.0','analyze-javascript-application',target.root,...target.sources.flatMap(source=>['--source-path',source]),'--max-semantic-nodes',String(target.ceiling),'--json'],{stdio:['ignore',out,err]});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{fs.closeSync(out);fs.closeSync(err);console.log(`REA exit=${code}; evidence: ${resultFile}; progress/errors: ${errorsFile}`);if(code)console.log('On macOS, inspect the diagnostic file. The process-ownership helper may need compiler-cache and process-inspection permissions outside a restricted sandbox.');process.exitCode=code||0;});
