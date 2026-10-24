import {app} from 'electron'
import {createRequire} from 'node:module'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

// Exactly one desktop host owns Electron lifecycle and IPC in each process.
// Keep the established design interface available without importing its
// independent server and lifecycle into the restored workbench host.
const directory=dirname(fileURLToPath(import.meta.url))
const require=createRequire(import.meta.url)
if(app.isPackaged){
  process.env.ASTRIX_BUNDLE_ROOT=join(process.resourcesPath,'workbench')
  process.env.ASTRIX_RECOVERY_ROOT=join(process.resourcesPath,'recovered')
  process.env.ASTRIX_DESKTOP_USER_DATA=join(app.getPath('appData'),'Design Studio','workbench')
}
if(process.argv.includes('--legacy-ui')){
  void import(pathToFileURL(join(directory,'legacy-main.mjs')).href).catch(error=>{
    console.error('Astrix 设计界面未能启动',error)
    app.exit(1)
  })
}else{
  const root=process.env.ASTRIX_BUNDLE_ROOT||resolve(directory,'../..')
  // Synchronous loading is required: custom editor schemes must be registered
  // before Electron emits ready. The host starts its own local desktop server.
  require(join(root,'客户端','workbench','desktop','main.cjs'))
}
