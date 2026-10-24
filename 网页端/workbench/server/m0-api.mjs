import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const now = () => Date.now();
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const safeKey = (key) => String(key || '').split('.').filter(Boolean).every((part) => !forbiddenKeys.has(part));
function getKey(object, key) {
  if (!key) return clone(object);
  if (!safeKey(key)) throw error('Invalid config key');
  return clone(String(key).split('.').reduce((value, part) => value?.[part], object));
}
function setKey(object, key, value) {
  if (!key || !safeKey(key)) throw error('Invalid config key');
  const parts = String(key).split('.');
  let cursor = object;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = clone(value);
}
function merge(target, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return target;
  for (const [key, value] of Object.entries(patch)) {
    if (forbiddenKeys.has(key)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) target[key] = merge(target[key] && typeof target[key] === 'object' ? target[key] : {}, value);
    else target[key] = clone(value);
  }
  return target;
}
function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value ?? null));
}

/** Local replacement for the remote project/session API and selected Electron RPCs.
 * This module never starts recovered binaries or calls the original company services.
 */
export function createM0Api({ dataDir, workspaceRoot, port = 4317, getModelConfig = () => ({}), chatHandler = null } = {}) {
  if (!dataDir || !workspaceRoot) throw new Error('dataDir and workspaceRoot are required');
  dataDir = path.resolve(dataDir);
  workspaceRoot = path.resolve(workspaceRoot);
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const stateFile = path.join(dataDir, 'state.json');
  let loaded;
  try { loaded = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (cause) { if (cause.code !== 'ENOENT') throw new Error(`Cannot read local state: ${cause.message}`); }
  const state = merge({ version: 1, nextProjectId: 1, projects: [], sessions: [], messages: {}, workspace: workspaceRoot, workspaceRevision: 0, activeProjectId: null, history: [workspaceRoot], config: { global: { appMode: 'code', currentOpencodeAgent: 'build', currentModelSelectionMode: 'auto' }, local: {} }, user: { userName: 'local-user', name: 'local-user', displayName: '本地用户', mail: '', avatar: '', token: '' } }, loaded || {});
  const localHome = path.join(dataDir, 'home');
  fs.mkdirSync(localHome, { recursive: true });
  const save = () => {
    const temporary = `${stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, stateFile);
  };
  const findProject = (id) => state.projects.find((item) => String(item.id) === String(id));
  const findSession = (id) => state.sessions.find((item) => item.id === String(id));
  const touchProject = (projectId, sessionId) => {
    const project = findProject(projectId);
    if (project) { project.updatedAt = project.latestUpdateAt = now(); if (sessionId) project.latestSessionId = sessionId; }
  };
  function prepareManagedProject(projectPath, projectName) {
    const managedRoot = path.join(localHome, '.m0', '.spark-project');
    if (path.dirname(projectPath) !== managedRoot || !/^\d+$/.test(path.basename(projectPath))) return false;
    const realHome = fs.realpathSync(localHome);
    let existing = projectPath;
    while (!fs.existsSync(existing)) existing = path.dirname(existing);
    const realExisting = fs.realpathSync(existing);
    if (realExisting !== realHome && !realExisting.startsWith(realHome + path.sep)) throw error('Managed project path is outside the local home', 403);
    fs.mkdirSync(projectPath, { recursive: true });
    const realProject = fs.realpathSync(projectPath);
    if (!realProject.startsWith(realHome + path.sep)) throw error('Managed project path is outside the local home', 403);
    const readme = path.join(projectPath, 'README.md');
    try {
      const title = String(projectName).replace(/[\r\n\x00-\x1f]/g, ' ').trim();
      fs.writeFileSync(readme, `# ${title || '本地项目'}\n\n这是 Astrix 创建的本地项目，文件仅保存在这台电脑上。\n\n可在中央文件编辑器中编辑文件，或在配置模型后通过聊天处理此工作区。\n`, { encoding: 'utf8', flag: 'wx' });
    } catch (cause) { if (cause.code !== 'EEXIST') throw cause; }
    return true;
  }
  function createProject(input = {}) {
    const mode = input.mode === 'code' ? 'code' : 'spark';
    const id = state.nextProjectId;
    const projectPath = input.projectPath ? path.resolve(input.projectPath) : path.join(localHome, '.m0', '.spark-project', String(id));
    const projectName = input.projectName || (mode === 'spark' ? '未命名项目' : path.basename(projectPath));
    prepareManagedProject(projectPath, projectName);
    if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) throw error('项目目录不存在，请选择已有的本地目录');
    const timestamp = now();
    const project = { id, userId: state.user.userName, type: input.type || 'cli', mode, projectName, projectPath, cover: '', figmaKey: '', createdAt: timestamp, updatedAt: timestamp, latestUpdateAt: timestamp, latestSessionId: null };
    state.nextProjectId += 1;
    state.projects.unshift(project);
    selectWorkspace(projectPath, {projectId:id});
    return clone(project);
  }
  function createSession(input = {}) {
    const id = String(input.sessionId || input.id || `ses_${randomUUID().replaceAll('-', '')}`);
    let session = findSession(id);
    const projectId = input.projectId || session?.projectId || state.projects[0]?.id || null;
    if (input.projectId && !findProject(projectId)) throw error('Project not found', 404);
    if (session) { if (projectId) session.projectId = Number(projectId); touchProject(projectId, id); save(); return clone(session); }
    const timestamp = now();
    session = { id, sessionId: id, projectId: projectId ? Number(projectId) : null, userId: state.user.userName, title: input.title || '', createdAt: timestamp, updatedAt: timestamp, latestUpdateAt: timestamp, parentID: input.parentID, directory: state.workspace, version: 'local-1', time: { created: timestamp, updated: timestamp } };
    state.sessions.unshift(session);
    state.messages[id] = [];
    touchProject(projectId, id);
    save();
    return clone(session);
  }
  function appendMessage(sessionId, input = {}) {
    const session = findSession(sessionId);
    if (!session) throw error('Session not found', 404);
    const message = { ...clone(input), id: input.id || `msg_${randomUUID().replaceAll('-', '')}`, sessionId, messageRole: input.messageRole || input.role || 'assistant', messageContent: input.messageContent ?? input.content ?? '', messageEvents: input.messageEvents || [], messageContext: input.messageContext || {}, createdAt: input.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    // The recovered renderer replays assistant messageEvents and does not read its messageContent.
    if (message.messageRole === 'assistant' && message.messageContent && !message.messageEvents.length) {
      const metadata = { messageId: message.id, chunkDetailId: `local_${message.id}`, chunkDetailSessionId: sessionId, chunkDetailMessageId: message.id };
      message.messageEvents = [
        { type: 'TEXT_MESSAGE_START', ...metadata, role: 'assistant', timestamp: now() },
        { type: 'TEXT_MESSAGE_CONTENT', ...metadata, delta: String(message.messageContent), timestamp: now() },
        { type: 'TEXT_MESSAGE_END', ...metadata, timestamp: now() },
        { type: 'RUN_FINISHED', threadId: sessionId, runId: message.id, timestamp: now() },
      ];
    }
    const list = state.messages[sessionId] ||= [];
    const previous = list.findIndex((item) => item.id === message.id);
    if (previous < 0) list.push(message); else list[previous] = { ...list[previous], ...message };
    if (!session.title && message.messageRole === 'user') session.title = String(message.messageContent).slice(0, 64);
    session.updatedAt = session.latestUpdateAt = session.time.updated = now();
    touchProject(session.projectId, sessionId);
    save();
    return clone(message);
  }
  function deleteSession(sessionId) {
    const session = findSession(sessionId);
    state.sessions = state.sessions.filter((item) => item.id !== sessionId);
    delete state.messages[sessionId];
    if (session) {
      const project = findProject(session.projectId);
      if (project?.latestSessionId === sessionId) project.latestSessionId = state.sessions.find((item) => item.projectId === session.projectId)?.id || null;
    }
    save();
    return true;
  }
  function selectWorkspace(directory, {projectId} = {}) {
    const resolved = path.resolve(directory || state.workspace || workspaceRoot);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return { success: false, path: resolved, error: '目录不存在或不是文件夹' };
    const currentProject = findProject(state.activeProjectId);
    const active = projectId === undefined ? (currentProject?.projectPath === resolved ? currentProject : state.projects.find(item => item.projectPath === resolved)) : findProject(projectId);
    const activeId = active?.id || null;
    if (state.workspace !== resolved || state.activeProjectId !== activeId) state.workspaceRevision = Number(state.workspaceRevision || 0) + 1;
    state.workspace = resolved;
    state.activeProjectId = activeId;
    state.history = [resolved, ...state.history.filter((item) => item !== resolved)].slice(0, 30);
    save();
    return { success: true, path: resolved, error: null };
  }
  function editorContext() {
    const project = findProject(state.activeProjectId);
    const entryFiles=[];
    try { for(const item of fs.readdirSync(state.workspace,{withFileTypes:true})) if(item.isFile() && !item.name.startsWith('.')) entryFiles.push(item.name); } catch { /* A removed workspace remains visible as unavailable. */ }
    entryFiles.sort((a,b)=>Number(/^readme\.md$/i.test(b))-Number(/^readme\.md$/i.test(a))||a.localeCompare(b));
    return {workspace:state.workspace,project:project ? {id:project.id,projectName:project.projectName,projectPath:project.projectPath,mode:project.mode} : null,revision:Number(state.workspaceRevision || 0),entryFiles:entryFiles.slice(0,20)};
  }
  function configResult(params = {}, group = 'config') {
    const scope = group === 'opencode' ? 'global' : params.scope === 'local' ? 'local' : 'global';
    const config = state.config[scope] ||= {};
    return { scope, path: stateFile, config: clone(config), ...(params.key ? { value: getKey(config, params.key) ?? null } : {}) };
  }
  function localDesignFiles() {
    const root = fs.realpathSync(state.workspace);
    const items = [];
    const inspect = (directory, name, value) => {
      try {
        const fileName = fs.readdirSync(directory).find((file) => /^design\.md$/i.test(file));
        if (!fileName) return;
        const file = fs.realpathSync(path.join(directory, fileName));
        if (!file.startsWith(root + path.sep) || fs.statSync(file).size > 1024 * 1024) return;
        items.push({ name, value, file, fileName, content: fs.readFileSync(file, 'utf8').trim() });
      } catch { /* Missing design files mean an empty local collection. */ }
    };
    inspect(root, '默认', 'local-default');
    const designs = path.join(root, '.m0', 'design');
    inspect(designs, 'm0默认', 'local-m0');
    try { for (const entry of fs.readdirSync(designs, { withFileTypes: true }).slice(0, 100)) if (entry.isDirectory()) inspect(path.join(designs, entry.name), entry.name, `local-${entry.name}`); } catch { /* Optional local designs directory. */ }
    return { items };
  }
  async function modelData() {
    const config = await getModelConfig() || {};
    const configured = Boolean(config.model && (config.baseUrl || config.baseURL) && config.mode !== 'demo');
    const modelId = config.model || 'local-demo';
    const label = configured ? modelId : '本地演示 · 无模型推理';
    const model = { id: modelId, name: label, status: 'active', family: configured ? 'custom' : 'demo', attachment: false, reasoning: false, toolcall: configured, limit: { context: 32000, output: 4096 }, cost: { input: 0, output: 0 }, modalities: { input: ['text'], output: ['text'] } };
    // The recovered selector filters these provider ids; this id is a compatibility namespace only.
    return { all: [{ id: 'wanqing', name: '本地配置的模型', source: 'local-reconstruction', models: { [modelId]: model } }], connected: ['wanqing'], default: { wanqing: modelId }, configured, modelId, label };
  }
  async function publicConfig() {
    const models = await modelData();
    return { models: [{ model_id: `wanqing/${models.modelId}`, name: models.label, display_name: models.label, enable: true, multimodal: false }], localAdapter: true };
  }
  async function executionStatus() {
    const original=(await getModelConfig())?.engine==='original-opencode';
    return {originalEngine:original,adapter:original?'original-opencode':'local-reconstruction',executionMode:original?'per-run-cli':'local-adapter'};
  }
  async function opencodeClientCall(method, params = {}) {
    const id = params?.path?.id || params?.path?.sessionID || params?.path?.sessionId || params?.sessionID || params?.sessionId;
    const input = params?.body || params || {};
    let result;
    switch (method) {
      case 'global.health': {const selected=await executionStatus();result = { healthy: true, version: 'local-adapter-1', engine:selected.adapter,...selected }; break;}
      case 'provider.list': result = await modelData(); break;
      case 'config.get': result = { ...clone(state.config.global), model: `wanqing/${(await modelData()).modelId}`, provider: {} }; break;
      case 'config.providers': result = await modelData(); break;
      case 'config.update': merge(state.config.global, input); save(); result = clone(state.config.global); break;
      case 'app.agents': { const selected=await executionStatus(); result = selected.originalEngine ? [{name:'build',description:'恢复的原版 OpenCode，按轮运行代码与文件任务',mode:'primary',native:true,hidden:false}] : [{ name: 'build', description: '本地文件助手', mode: 'primary', native: false, hidden: false }, { name: 'plan', description: '本地规划聊天', mode: 'primary', native: false, hidden: false }]; break; }
      case 'command.list': case 'skill.list': case 'tool.list': case 'tool.ids': result = []; break;
      case 'mcp.status': result = {}; break;
      case 'session.list': result = clone(state.sessions); break;
      case 'session.status': result = {}; break;
      case 'session.create': result = createSession(input); break;
      case 'session.get': result = clone(findSession(id)); if (!result) throw error('Session not found', 404); break;
      case 'session.children': result = clone(state.sessions.filter((item) => item.parentID === id)); break;
      case 'session.messages': result = clone((state.messages[id] || []).map((message) => ({ info: { id: message.id, sessionID: id, role: message.messageRole, time: { created: message.createdAt, completed: message.createdAt }, ...(message.messageRole === 'assistant' ? { parentID: message.parentId, modelID: (message.modelID || 'local-demo'), providerID: 'wanqing', mode: 'build', agent: 'build', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } } : {}) }, parts: [{ id: `prt_${message.id}`, sessionID: id, messageID: message.id, type: 'text', text: message.messageContent || '' }] }))); break;
      case 'session.update': { const session = findSession(id); if (!session) throw error('Session not found', 404); if (typeof input.title === 'string') session.title = input.title; save(); result = clone(session); break; }
      case 'session.delete': result = deleteSession(id); break;
      case 'session.abort': result = false; break;
      case 'session.todo': case 'session.diff': case 'question.list': case 'permission.list': result = []; break;
      case 'path.get': result = { home: localHome, state: dataDir, config: dataDir, worktree: state.workspace, directory: state.workspace }; break;
      case 'project.current': result = { id: 'local', worktree: state.workspace, vcs: null, time: { created: now() } }; break;
      default: throw error(`本地适配器未实现 OpenCode 方法 ${method}`, 501);
    }
    return { data: result };
  }
  async function rpc(namespace, method, args = []) {
    if ((!namespace || typeof namespace !== 'string') && typeof method === 'string' && method.includes('.')) [namespace, method] = method.split('.', 2);
    namespace = String(namespace).replace(/API$/, '');
    if (!Array.isArray(args)) args = [args];
    const [first, second] = args;
    switch (`${namespace}.${method}`) {
      case 'workspace.getCurrentPath': case 'cli.getCwd': return state.workspace;
      case 'workspace.getHistory': return clone(state.history);
      case 'workspace.selectPath': case 'cli.switchCwd': return selectWorkspace(first);
      case 'workspace.updateAndRestart': { const result = selectWorkspace(first); if (!result.success) throw error(result.error); return true; }
      case 'cli.getVersion': return '3.9.5-local';
      case 'cli.getPorts': return { nestjs: port, websocket: port, opencode: port, proxy: port };
      case 'app.getInfo': return { name: 'Astrix', version: '3.9.5-local', isPackaged: false, platform: process.platform, arch: process.arch, runtime: { node: process.versions.node, electron: '', chrome: '', v8: process.versions.v8 } };
      case 'app.getHomedir': return localHome;
      case 'app.getMainWindowBounds': return null;
      case 'app.getPreloadPath': return '';
      case 'app.getKscodeFramePath': return '/__local/editor';
      case 'devUser.get': return clone(state.user);
      case 'devUser.set': { for (const key of ['userName', 'displayName', 'mail', 'avatar']) if (typeof first?.[key] === 'string') state.user[key] = first[key]; state.user.name = state.user.userName; state.user.token = ''; save(); return true; }
      case 'devUser.clear': return false;
      case 'config.get': return configResult(first);
      case 'config.set': { const config = state.config[first?.scope === 'local' ? 'local' : 'global']; setKey(config, first?.key, first?.value); save(); return configResult(first); }
      case 'config.merge': { merge(state.config[first?.scope === 'local' ? 'local' : 'global'], first?.value); save(); return configResult(first); }
      case 'config.getDesignSystem': return null;
      case 'config.getLocalDesignMd': return localDesignFiles();
      case 'config.saveLocalDesignMd': {
        const root = fs.realpathSync(state.workspace);
        const file = path.resolve(root, String(first || ''));
        if (!file.startsWith(root + path.sep) || !/^design\.md$/i.test(path.basename(file)) || typeof second !== 'string' || second.length > 1024 * 1024) throw error('Only workspace DESIGN.md files can be saved');
        const parent = fs.realpathSync(path.dirname(file));
        if (parent !== root && !parent.startsWith(root + path.sep)) throw error('Design file is outside the workspace', 403);
        if (fs.existsSync(file) && !fs.realpathSync(file).startsWith(root + path.sep)) throw error('Design file is outside the workspace', 403);
        fs.writeFileSync(file, second, 'utf8'); return true;
      }
      case 'opencode.getStatus': return { connected: true, baseUrl: `http://127.0.0.1:${port}/__local/opencode`, managedServer: false, ...await executionStatus() };
      case 'opencode.clientCall': return opencodeClientCall(first, second);
      case 'opencode.get': return configResult(first, 'opencode');
      case 'opencode.set': setKey(state.config.global, first?.key, first?.value); save(); return configResult(first, 'opencode');
      case 'opencode.listSkills': return [];
      case 'opencode.getSkillRegistry': return { version: 1, skills: {}, systemSkillPaths: [] };
      case 'opencode.syncSkillsByScope': return { scope: String(first || ''), sourcePath: '', targetPath: '', copiedCount: 0 };
      case 'kscode.switchProject': { const project = findProject(first); if (!project) throw error('Project not found',404); const selected=selectWorkspace(project.projectPath,{projectId:project.id}); if(!selected.success) throw error(selected.error); return { success: true, projectId: first, adapter: 'local-workspace' }; }
      case 'm0Executor.getStatus': return { connected: false, socketPath: null };
      case 'deeplink.getSession': return null;
      case 'deeplink.rendererReady': case 'deeplink.setActiveFigma': case 'deeplink.emitEvent': case 'deeplink.attachSession': case 'deeplink.sendReady': return true;
      case 'figma.isLoggedIn': return false;
      case 'figma.getProxyStatus': return { running: false, port: 0 };
      case 'log.openLogDirectory': return dataDir;
      default: throw error(`本地版本暂不支持 ${namespace}.${method}`, 501);
    }
  }

  const api = { state, save, createProject, createSession, appendMessage, deleteSession, findProject, findSession, selectWorkspace, editorContext, rpc, publicConfig, opencodeClientCall, dataDir, workspaceRoot };
  async function handle(req, res, parsedUrl, body = {}) {
    const url = parsedUrl instanceof URL ? parsedUrl : new URL(req.url, `http://127.0.0.1:${port}`);
    const originalPath = url.pathname;
    const route = originalPath.replace(/^\/(?:devops-api|api\/proxy|proxy|api)(?=\/)/, '');
    const query = Object.fromEntries(url.searchParams);
    const input = { ...query, ...body };
    const send = (value, status) => { json(res, value, status); return true; };
    const mutations={'/project/v2/create':'POST','/project/create':'POST','/project/v2/update':'POST','/project/v2/delete':'DELETE','/session/v2/create':'POST','/session/v2/delete':'DELETE','/session/update':'POST','/session/v2/update':'POST','/message/create':'POST','/message/update':'POST'};
    if(mutations[route]&&req.method!==mutations[route])return send({error:'Method not allowed'},405);
    if (originalPath === '/__local/rpc' && req.method === 'POST') return send(await rpc(body.namespace, body.method, body.args));
    if (originalPath === '/__local/models') return send(await publicConfig());
    if (originalPath === '/__local/editor-context') return req.method === 'GET' ? send(editorContext()) : send({error:'Method not allowed'},405);
    if (route === '/portal/user/profile/' || route === '/portal/user/profile') return send({ username: state.user.userName, name: state.user.displayName, avatar: state.user.avatar, local: true });
    if (route === '/halo/v1/user/users') return send({ data: [{ username: state.user.userName, name: state.user.displayName, avatar: state.user.avatar, dept_path: '', newChannel: '', newFamily: '', employeeTypeName: '', status: { code: 'local', name: '本地用户' }, local: true }] });
    if (originalPath === '/rest/users/getUserInfo') return send({ data: { ...clone(state.user), token: undefined }, local: true });
    if (originalPath === '/rest/ai-code/agent/list') return send({ success: true, data: [], local: true });
    if (originalPath === '/rest/plugin/reco') return send({ data: [], local: true });
    if (originalPath === '/rest/users/getUserFigmaToken') return send({ data: { accessToken: null }, local: true, unavailable: 'Figma account is not connected' });
    if (originalPath === '/rest/figma/openApi') return send({ status: 'unavailable', local: true });
    if (originalPath === '/__local/workspace') {
      if (req.method === 'POST') return send(selectWorkspace(body.path));
      return send({ path: state.workspace, history: state.history });
    }
    if (route === '/info' || route === '/info/version') return send({ version: '3.9.5-local', name: 'Astrix', adapter: 'local-reconstruction' });
    if (route === '/project/container_available') return send({ status: 200, ...await executionStatus() });
    if (route === '/prompt/preset') return send([]);
    if (route === '/coolux/business-space/list') return send({ list: [{ id: 'local', name: '本地空间', description: '仅保存在本机；尚未连接 Figma 或企业资产', local: true }], total: 1, page: 1, pageSize: 20 });
    if (/^\/coolux\/(?:business-category|project|figma-file|figma-asset|category|image-asset|doc-asset|psd-asset|link-asset|component-library-asset|document-asset|design-spec|component-library|tag)\/list$/.test(route) || route === '/design-spec/list' || route === '/tool-center/list') return send({ list: [], total: 0, page: Number(query.page || 1), pageSize: Number(query.pageSize || 50), local: true });
    if (req.method === 'GET' && ['/skill-management', '/skill-management/market', '/skill-management/reviews/pending', '/skill-management/admin/skills'].includes(route)) return send({ list: [], total: 0, page: Number(query.page || 1), pageSize: Number(query.pageSize || 20), local: true });
    if (req.method === 'GET' && ['/skill-management/tags', '/skill-management/admin/tags', '/skill-management/admin/business-spaces'].includes(route)) return send([]);
    if (req.method === 'GET' && route === '/skill-management/admin/access') return send({ isAdmin: false, local: true });
    if (req.method === 'POST' && route === '/skill-management/resolve') return send([]);
    if (route === '/project/v2/list' || route === '/project/list') return send(clone(state.projects));
    if (route === '/project/v2/create' || route === '/project/create') return send(createProject(input));
    if (route === '/project/v2/info' || route === '/project/get') {
      const project = findProject(query.projectId || findSession(query.sessionId)?.projectId) || state.projects.find((item) => item.projectPath === query.projectPath);
      if (project?.projectPath) selectWorkspace(project.projectPath,{projectId:project.id});
      return send(clone(project) || null, project ? 200 : 404);
    }
    if (route === '/project/v2/update') {
      const project = findProject(input.projectId || input.id);
      if (!project) throw error('Project not found', 404);
      if (body.projectName !== undefined && (typeof body.projectName !== 'string' || !body.projectName.trim() || body.projectName.trim().length > 128)) throw error('项目名称需要 1 至 128 个字符');
      if(body.projectPath!==undefined){if(typeof body.projectPath!=='string'||!body.projectPath)throw error('项目目录无效');const resolved=path.resolve(body.projectPath);if(!fs.existsSync(resolved)||!fs.statSync(resolved).isDirectory())throw error('项目目录不存在');body={...body,projectPath:resolved};}
      for (const key of ['projectName', 'projectPath', 'cover', 'figmaKey', 'mode']) if (typeof body[key] === 'string') project[key] = key === 'projectName' ? body[key].trim() : body[key];
      if(state.activeProjectId===project.id && typeof body.projectPath==='string') selectWorkspace(body.projectPath,{projectId:project.id});
      touchProject(project.id); save(); return send(clone(project));
    }
    if (route === '/project/v2/delete') {
      const id = input.projectId;
      if(!findProject(id))throw error('Project not found',404);
      const wasActive=String(state.activeProjectId)===String(id);
      for (const session of [...state.sessions]) if (String(session.projectId) === String(id)) deleteSession(session.id);
      state.projects = state.projects.filter((item) => String(item.id) !== String(id));
      if(wasActive){const next=state.projects.find(item=>fs.existsSync(item.projectPath)&&fs.statSync(item.projectPath).isDirectory());selectWorkspace(next?.projectPath||workspaceRoot,{projectId:next?.id||null});}
      save(); return send(true);
    }
    if (route === '/session/list') return send(clone(state.sessions.filter((item) => !query.projectId || String(item.projectId) === String(query.projectId))));
    if (route === '/session/create' || route === '/session/v2/create') return send({ sessionId: createSession(input).id });
    if (route === '/session/exist') return send(Boolean(findSession(query.sessionId)));
    if (route === '/session/history_message') return send(clone(state.messages[query.sessionId] || []).map((message) => ({ ...message, messageContext: message.messageContext || {} })));
    if (route === '/session/v2/delete') return send(deleteSession(input.sessionId));
    if (route === '/session/update' || route === '/session/v2/update') { const session = findSession(input.sessionId || input.id); if (!session) throw error('Session not found', 404); if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length>256) throw error('会话名称需要 1 至 256 个字符'); session.title = body.title.trim(); session.updatedAt=session.latestUpdateAt=session.time.updated=now(); touchProject(session.projectId); save(); return send(clone(session)); }
    if (route === '/message/create' || route === '/message/update') return send(appendMessage(body.sessionId, body));
    if (route === '/agent/chat' || route === '/agent/stop') {
      const context = { api, state, session: findSession(body.sessionId || query.sessionId), createSession, appendMessage, save };
      if (chatHandler) { await chatHandler(req, res, url, body, context); return true; }
      return false;
    }
    if (route === '/model/icon') return send({ icon: null });
    if (route === '/tools/execute') return send({ success: false, error: '原客户端的本机工具执行器尚未恢复；本地版本未执行工具' }, 501);
    if (/^\/rest\/(?:wd\/common\/log|kd\/log)|^\/rest\/n\/log/.test(originalPath)) return send({ result: 1, local: true });
    return false;
  }
  api.handle = handle;
  save();
  return api;
}
