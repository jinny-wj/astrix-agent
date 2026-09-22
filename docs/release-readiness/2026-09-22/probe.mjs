import { createRequire } from 'node:module'
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const { build } = createRequire(join(root, '客户端/package.json'))('esbuild')
const observations = []
for (const project of ['客户端', '网页端']) {
  const directory = join(root, project)
  const require = createRequire(join(directory, 'package.json'))
  const bundled = await build({
    stdin: { contents: "export {createAgentMiddleware} from './server/agentPlugin.ts'; export {createFigmaBridgeMiddleware} from './server/figmaBridgePlugin.ts'; export {sanitizeAttachment} from './server/agent/composer.ts';", resolveDir: directory, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{name:'external-sdk', setup(b) {b.onResolve({filter:/^(?:@anthropic-ai\/claude-agent-sdk|exceljs)$/}, args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}))}}],
  })
  const { createAgentMiddleware, createFigmaBridgeMiddleware, sanitizeAttachment } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))
  const cwd = mkdtempSync(join(tmpdir(), 'astrix-release-probe-'))
  const agent = createAgentMiddleware({backend:'shell',model:'auto',cwd})
  const bridge = createFigmaBridgeMiddleware()
  const server = createServer((req,res)=>agent(req,res,()=>bridge(req,res,()=>{res.statusCode=404;res.end()})))
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    const body = {files:[{name:'audit-fixture.txt',mime:'text/plain',contentBase64:Buffer.from('non-sensitive release audit fixture').toString('base64')}]}
    const upload = await fetch(origin+'/api/agent/attachments',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'text/plain'},body:JSON.stringify(body)})
    const result = await upload.json()
    const attachment = result.files?.[0]
    observations.push({project,check:'cross_origin_plaintext_upload_without_login',httpStatus:upload.status,fileWritten:Boolean(attachment?.path && existsSync(attachment.path)),passes:upload.status===403})
    observations.push({project,check:'attachment_ownership_validation',acceptsExistingPathWithoutUserIdentity:Boolean(attachment && sanitizeAttachment({...attachment,id:'different-request'},cwd)?.path),passes:false})
    const selection={sessionId:'isolated-audit',fileKey:'audit-file',documentName:'AUDIT FIXTURE',pageId:'0:1',pageName:'Audit',revision:1,updatedAt:Date.now(),nodes:[]}
    const publish=await fetch(origin+'/api/figma-bridge/selection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(selection)})
    const status=await fetch(origin+'/api/figma-bridge/status')
    const snapshot=await status.json()
    observations.push({project,check:'bridge_session_read_write_without_login',writeStatus:publish.status,readStatus:status.status,fixtureVisible:snapshot.selection?.documentName==='AUDIT FIXTURE',passes:publish.status===401||publish.status===403})
  } finally {
    await new Promise(resolve=>server.close(resolve))
    rmSync(cwd,{recursive:true,force:true})
  }
}
writeFileSync('/tmp/astrix-release-observations.json',JSON.stringify(observations,null,2))
console.log(JSON.stringify(observations,null,2))
