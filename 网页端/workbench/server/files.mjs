import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isUtf8} from 'node:buffer';

const failure=(message,status=400)=>Object.assign(new Error(message),{status});
const exists=async file=>{try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const MAX_FILE=2*1024*1024;
const MAX_PROJECT=4*1024*1024;

export function createFiles(workspaceRoot,{trashDir}={}) {
  const root = path.resolve(workspaceRoot);
  async function resolveFile(relative = '.', write = false) {
    if(typeof relative!=='string'||relative.includes('\0'))throw failure('文件路径无效');
    const candidate = path.resolve(root, relative);
    if (candidate !== root && !candidate.startsWith(root+path.sep)) throw new Error('路径超出本地工作区');
    let ancestor = candidate;
    while (true) {
      try {
        const actual = await fs.realpath(ancestor);
        const realRoot = await fs.realpath(root);
        if (actual !== realRoot && !actual.startsWith(realRoot+path.sep)) throw new Error('文件链接指向工作区外部');
        break;
      } catch (error) {
        if (error.code !== 'ENOENT' || !write || ancestor === root) throw error;
        ancestor = path.dirname(ancestor);
      }
    }
    return candidate;
  }
  async function writablePath(relative) {
    const full=await resolveFile(relative,true);
    if(full===root)throw failure('不能修改工作区根目录');
    return full;
  }
  async function vacant(full) {
    if(await exists(full))throw failure('目标路径已存在，请使用其他名称',409);
  }
  const api = {
    root,
    async list(relative='.') {
      const full = await resolveFile(relative);
      const result=[];
      for (const entry of await fs.readdir(full,{withFileTypes:true})) {
        if (entry.name.startsWith('.') || entry.name==='node_modules') continue;
        result.push({name:entry.name,path:path.relative(root,path.join(full,entry.name)),directory:entry.isDirectory(),symlink:entry.isSymbolicLink()});
      }
      return result.sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name));
    },
    async read(relative) {
      const full = await resolveFile(relative);
      const stat = await fs.stat(full);
      if (!stat.isFile() || stat.size>MAX_FILE) throw new Error('只支持读取 2 MB 以内的文本文件');
      const data=await fs.readFile(full);
      if (data.includes(0)||!isUtf8(data)) throw new Error('该文件不是 UTF-8 文本文件');
      return {path:path.relative(root,full),content:data.toString('utf8')};
    },
    async write(relative,content) {
      if (!relative || typeof content!=='string' || Buffer.byteLength(content)>MAX_FILE) throw new Error('文件内容或路径无效');
      const full = await writablePath(relative);
      await fs.mkdir(path.dirname(full),{recursive:true});
      // Recheck after directory creation so symlinked parents stay confined.
      await resolveFile(relative,true);
      await fs.writeFile(full,content,'utf8');
      return {success:true,path:path.relative(root,full)};
    },
    async mkdir(relative) {
      const full=await writablePath(relative);
      if(await exists(full)){
        if(!(await fs.stat(full)).isDirectory())throw failure('目标路径已经是文件',409);
        return {success:true,path:path.relative(root,full),alreadyExists:true};
      }
      await fs.mkdir(full,{recursive:true});
      await resolveFile(relative);
      return {success:true,path:path.relative(root,full)};
    },
    async rename(relative,newRelative) {
      const full=await resolveFile(relative),destination=await writablePath(newRelative);
      if(full===root)throw failure('不能重命名工作区根目录');
      if(full===destination)return {success:true,path:path.relative(root,full)};
      if(destination.startsWith(full+path.sep))throw failure('不能将目录移动到自身内部');
      await vacant(destination);
      await fs.mkdir(path.dirname(destination),{recursive:true});
      await resolveFile(newRelative,true);
      await fs.rename(full,destination);
      return {success:true,path:path.relative(root,destination),previousPath:path.relative(root,full)};
    },
    async remove(relative) {
      if(!trashDir)throw failure('尚未配置本地回收站');
      const full=await resolveFile(relative);
      if(full===root)throw failure('不能删除工作区根目录');
      const id=randomUUID(),directory=path.join(path.resolve(trashDir),id);
      await fs.mkdir(directory,{recursive:true,mode:0o700});
      const metadata={id,workspace:await fs.realpath(root),path:path.relative(root,full),deletedAt:new Date().toISOString()};
      await fs.writeFile(path.join(directory,'metadata.json'),JSON.stringify(metadata),{mode:0o600});
      try{await fs.rename(full,path.join(directory,'content'));}catch(error){await fs.rm(directory,{recursive:true,force:true});throw error;}
      return {success:true,path:metadata.path,trashId:id};
    },
    async restore(trashId) {
      if(!trashDir||typeof trashId!=='string'||!/^[-a-f0-9]{36}$/.test(trashId))throw failure('回收记录无效');
      const directory=path.join(path.resolve(trashDir),trashId);
      const metadata=JSON.parse(await fs.readFile(path.join(directory,'metadata.json'),'utf8'));
      if(metadata.workspace!==await fs.realpath(root))throw failure('该回收记录属于其他工作区',403);
      const destination=await writablePath(metadata.path);
      await vacant(destination);
      await fs.mkdir(path.dirname(destination),{recursive:true});
      await resolveFile(metadata.path,true);
      await fs.rename(path.join(directory,'content'),destination);
      await fs.rm(directory,{recursive:true,force:true});
      return {success:true,path:metadata.path};
    },
    async importProject(input,{allowBinary=false}={}) {
      if(!Array.isArray(input)||!input.length||input.length>500)throw failure('请选择 1 至 500 个文本文件');
      const prepared=[],seen=new Set();let total=0;
      for(const item of input){
        const binary=allowBinary&&Buffer.isBuffer(item?.content);
        if(!item||typeof item.path!=='string'||!item.path||(!binary&&(typeof item.content!=='string'||item.content.includes('\0')))||Buffer.byteLength(item.content)>MAX_FILE)throw failure('导入文件的路径或内容无效');
        total+=Buffer.byteLength(item.content);if(total>MAX_PROJECT)throw failure('导入正文总量不能超过 4 MB',413);
        const full=await writablePath(item.path);
        if(seen.has(full))throw failure('导入内容有重复路径',409);
        seen.add(full);await vacant(full);prepared.push({...item,full});
      }
      for(const item of prepared)for(const other of prepared)if(other!==item&&other.full.startsWith(item.full+path.sep))throw failure('文件路径与其子路径冲突',409);
      const created=[];
      try{
        for(const item of prepared){
          await fs.mkdir(path.dirname(item.full),{recursive:true});
          await resolveFile(item.path,true);
          await fs.writeFile(item.full,item.content,{encoding:'utf8',flag:'wx'});created.push(item.full);
        }
      }catch(error){for(const full of created)await fs.unlink(full).catch(()=>{});throw error;}
      return {success:true,workspace:root,files:created.map(full=>path.relative(root,full))};
    },
    async exportProject() {
      const files=[],skipped=[];let total=0,scanned=0;
      const visit=async(directory,depth=0)=>{
        if(depth>32){skipped.push({path:directory,reason:'目录深度超过导出上限'});return;}
        for(const entry of await api.list(directory)){
          scanned+=1;if(scanned>5000){skipped.push({path:directory,reason:'已扫描 5000 个文件或目录，剩余内容未导出'});return;}
          if(entry.symlink){skipped.push({path:entry.path,reason:'符号链接不包含在导出中'});continue;}
          if(entry.directory){await visit(entry.path,depth+1);continue;}
          try{
            const file=await api.read(entry.path),size=Buffer.byteLength(file.content);
            if(files.length>=500||total+size>MAX_PROJECT){skipped.push({path:entry.path,reason:'达到 500 文件或 4 MB 导出上限'});continue;}
            files.push(file);total+=size;
          }catch(error){skipped.push({path:entry.path,reason:error.message});}
        }
      };
      await visit('.');
      return {format:'m0-local-text-project-v1',workspace:root,files,skipped,complete:skipped.length===0,scope:'visible-utf8-text-files'};
    }
  };
  return api;
}
