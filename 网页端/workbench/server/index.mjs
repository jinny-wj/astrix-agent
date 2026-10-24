import http from 'node:http';
import {createWorkbenchApplication} from './application.mjs';
import layoutConfig from '../../../packages/astrix-workbench/layout.cjs';
export const root=layoutConfig.getLayout().webRoot;
const application=createWorkbenchApplication();
const app=http.createServer(application.handle);
app.on('upgrade',(req,socket)=>{if(!application.handleUpgrade(req,socket))socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');});
app.on('error',error=>{console.error(error.message);process.exitCode=1;void application.close();});
app.listen(application.port,'127.0.0.1',()=>console.log('Astrix: http://127.0.0.1:'+application.port+'/home'));
let stopping=false;
async function shutdown(){if(stopping)return;stopping=true;await application.close();app.close(()=>process.exit(0));app.closeAllConnections?.();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
const {api,model,chat}=application;
export {app,api,model,chat};
