import * as vscode from 'vscode';
import { RemoteServer } from './server';

export class RemoteChatPanel {
    private static currentPanel: RemoteChatPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly server: RemoteServer;
    private disposables: vscode.Disposable[] = [];

    static show(context: vscode.ExtensionContext, server: RemoteServer): void {
        const column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;
        if (RemoteChatPanel.currentPanel) {
            RemoteChatPanel.currentPanel.panel.reveal(column);
            return;
        }
        RemoteChatPanel.currentPanel = new RemoteChatPanel(context, server, column);
    }

    private constructor(context: vscode.ExtensionContext, server: RemoteServer, column: vscode.ViewColumn) {
        this.server = server;
        this.panel = vscode.window.createWebviewPanel(
            'remoteCodeChat',
            'Remote Code Chat',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );
        this.panel.webview.html = this.getHtml(this.panel.webview);

        this.panel.webview.onDidReceiveMessage(async (message) => {
            if (message?.type === 'pickAttachments') {
                const files = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: true,
                    title: 'Attach files to Remote Code'
                });
                if (!files?.length) return;
                const attachments = [];
                for (const uri of files.slice(0, 6)) {
                    const data = await vscode.workspace.fs.readFile(uri);
                    if (data.byteLength > 12 * 1024 * 1024) {
                        vscode.window.showWarningMessage(`Skipped large file: ${uri.fsPath}`);
                        continue;
                    }
                    attachments.push({
                        name: uri.path.split(/[\\/]/).pop() || 'attachment',
                        mimeType: 'application/octet-stream',
                        size: data.byteLength,
                        base64: Buffer.from(data).toString('base64')
                    });
                }
                this.panel.webview.postMessage({ type: 'attachmentsPicked', attachments });
            }
        }, null, this.disposables);

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    private dispose(): void {
        RemoteChatPanel.currentPanel = undefined;
        while (this.disposables.length) {
            this.disposables.pop()?.dispose();
        }
    }

    private getHtml(webview: vscode.Webview): string {
        const nonce = String(Date.now()) + Math.random().toString(36).slice(2);
        const port = this.server.port;
        const auth = this.server.authToken;
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src http://127.0.0.1:${port} ws://127.0.0.1:${port};">
<title>Remote Code Chat</title>
<style>
:root { color-scheme: dark; }
body { margin:0; background:#1e1e1e; color:#ddd; font:13px var(--vscode-font-family); height:100vh; overflow:hidden; }
.app { height:100vh; display:flex; flex-direction:column; }
.top { display:flex; gap:8px; align-items:center; padding:8px 10px; border-bottom:1px solid #333; background:#252526; }
.brand { font-weight:700; color:#fff; margin-right:auto; }
button, select { background:#2d2d30; color:#ddd; border:1px solid #454545; border-radius:4px; padding:6px 9px; }
button:hover { background:#3a3d41; }
button.primary { background:#0e639c; border-color:#0e639c; color:white; }
button.danger { color:#f48771; }
.tabs button.active { background:#094771; color:white; }
.status { color:#9cdcfe; font-size:12px; white-space:nowrap; }
.messages { flex:1; overflow:auto; padding:12px; display:flex; flex-direction:column; gap:10px; }
.msg { max-width:88%; padding:10px 12px; border-radius:8px; line-height:1.45; white-space:pre-wrap; word-break:break-word; }
.user { align-self:flex-end; background:#073b4c; color:#dff6ff; }
.assistant { align-self:flex-start; background:#2d2d30; }
.meta { font-size:11px; color:#8a8a8a; margin-bottom:5px; }
.composer { border-top:1px solid #333; padding:8px; background:#252526; display:flex; flex-direction:column; gap:6px; }
.row { display:flex; gap:8px; align-items:flex-end; }
textarea { flex:1; min-height:42px; max-height:150px; resize:vertical; background:#1e1e1e; color:#ddd; border:1px solid #454545; border-radius:6px; padding:8px; font:13px var(--vscode-font-family); }
.attachments { display:flex; gap:6px; flex-wrap:wrap; }
.chip { background:#333; border:1px solid #555; padding:4px 7px; border-radius:12px; font-size:12px; }
.empty { color:#888; text-align:center; margin:auto; }
</style>
</head>
<body>
<div class="app">
  <div class="top">
    <div class="brand">Remote Code</div>
    <div class="tabs">
      <button id="tabCodex" class="active">Codex</button>
      <button id="tabVS">VS Code</button>
    </div>
    <select id="model"></select>
    <select id="agent" style="display:none"></select>
    <button id="refresh">Refresh</button>
    <span id="status" class="status">Connecting...</span>
  </div>
  <div id="messages" class="messages"><div class="empty">Loading...</div></div>
  <div class="composer">
    <div id="attachments" class="attachments"></div>
    <div class="row">
      <button id="attach">Attach</button>
      <textarea id="input" placeholder="Request in VS Code..."></textarea>
      <button id="send" class="primary">Send</button>
    </div>
  </div>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const base = 'http://127.0.0.1:${port}';
const wsUrl = 'ws://127.0.0.1:${port}';
const authToken = ${JSON.stringify(auth)};
const headers = {'Content-Type':'application/json'};
if (authToken) headers.Authorization = 'Bearer ' + authToken;
let mode = 'codex';
let messages = [];
let attachments = [];
let selectedModel = '';
let selectedAgent = 'auto';
const el = id => document.getElementById(id);
function setStatus(text){ el('status').textContent = text; }
async function api(path, opts={}){
  const res = await fetch(base + path, {...opts, headers:{...headers, ...(opts.headers||{})}});
  if(!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}
function render(){
  const root = el('messages');
  root.innerHTML = '';
  if(!messages.length){ root.innerHTML = '<div class="empty">No messages yet</div>'; return; }
  for(const m of messages){
    const div = document.createElement('div');
    div.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant');
    div.innerHTML = '<div class="meta">' + (m.role === 'user' ? 'You' : (mode === 'codex' ? 'Codex' : 'VS Code')) + (m.isStreaming ? ' writing...' : '') + '</div>' + escapeHtml(m.content || '...');
    root.appendChild(div);
  }
  root.scrollTop = root.scrollHeight;
}
function renderAttachments(){
  const root = el('attachments');
  root.innerHTML = '';
  attachments.forEach((a,i)=>{
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = a.name + ' x';
    chip.onclick = () => { attachments.splice(i,1); renderAttachments(); };
    root.appendChild(chip);
  });
}
function escapeHtml(s){ return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
async function loadModels(){
  const data = await api('/api/codex/models');
  const model = el('model');
  model.innerHTML = '';
  (data.models || []).forEach(m => {
    const o = document.createElement('option'); o.value = m.id; o.textContent = m.name || m.id; model.appendChild(o);
  });
  selectedModel = data.selected || model.value || '';
  model.value = selectedModel;
}
async function loadAgents(){
  const data = await api('/api/chat/agents');
  const agent = el('agent');
  agent.innerHTML = '';
  (data.agents || []).forEach(a => {
    const o = document.createElement('option'); o.value = a.name; o.textContent = a.displayName || a.name; agent.appendChild(o);
  });
  selectedAgent = data.selected || agent.value || 'auto';
  agent.value = selectedAgent;
}
async function loadHistory(){
  if(mode === 'codex'){
    const data = await api('/api/codex/history');
    messages = data.messages || [];
  } else {
    const conv = await api('/api/chat/conversations');
    const chatId = conv.currentChatId || (conv.conversations && conv.conversations[0] && conv.conversations[0].id) || 'default';
    const data = await api('/api/chat/history?chatId=' + encodeURIComponent(chatId));
    messages = data.messages || [];
  }
  render();
}
async function refresh(){
  try {
    setStatus('Refreshing...');
    el('model').style.display = mode === 'codex' ? '' : 'none';
    el('agent').style.display = mode === 'codex' ? 'none' : '';
    if(mode === 'codex') await loadModels(); else await loadAgents();
    await loadHistory();
    setStatus('Ready');
  } catch(e) { setStatus(e.message); }
}
async function send(){
  const text = el('input').value.trim();
  if(!text && !attachments.length) return;
  el('input').value = '';
  const localAttachments = attachments;
  attachments = [];
  renderAttachments();
  try {
    if(mode === 'codex'){
      await api('/api/codex/send', { method:'POST', body: JSON.stringify({ message: text || 'Look at the attachment.', model: selectedModel, attachments: localAttachments }) });
    } else {
      await api('/api/chat/send', { method:'POST', body: JSON.stringify({ message: text, agentName: selectedAgent }) });
    }
    await loadHistory();
  } catch(e) { setStatus(e.message); }
}
function connectWs(){
  const ws = new WebSocket(authToken ? wsUrl + '?token=' + encodeURIComponent(authToken) : wsUrl);
  ws.onopen = () => setStatus('Live');
  ws.onclose = () => { setStatus('Disconnected'); setTimeout(connectWs, 2000); };
  ws.onmessage = ev => {
    const data = JSON.parse(ev.data);
    if(mode === 'codex'){
      if(['codex:message','codex:thinking','codex:response'].includes(data.type) && data.message){ upsert(data.message); }
      if(data.type === 'codex:chunk'){ upsert({ id:data.messageId, role:'assistant', content:data.content, timestamp:data.timestamp, isStreaming:true }); }
    } else if(data.type === 'chat:response' && data.message) {
      upsert(data.message);
    }
  };
}
function upsert(m){
  const i = messages.findIndex(x => x.id === m.id);
  if(i >= 0) messages[i] = {...messages[i], ...m}; else messages.push(m);
  messages.sort((a,b)=>(a.timestamp||0)-(b.timestamp||0));
  render();
}
el('tabCodex').onclick = () => { mode='codex'; el('tabCodex').classList.add('active'); el('tabVS').classList.remove('active'); refresh(); };
el('tabVS').onclick = () => { mode='vscode'; el('tabVS').classList.add('active'); el('tabCodex').classList.remove('active'); refresh(); };
el('model').onchange = async e => { selectedModel = e.target.value; await api('/api/codex/models', {method:'POST', body:JSON.stringify({modelId:selectedModel})}); };
el('agent').onchange = async e => { selectedAgent = e.target.value; await api('/api/chat/select-agent', {method:'POST', body:JSON.stringify({agentName:selectedAgent})}); };
el('refresh').onclick = refresh;
el('send').onclick = send;
el('input').addEventListener('keydown', e => { if(e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); send(); } });
el('attach').onclick = () => vscode.postMessage({type:'pickAttachments'});
window.addEventListener('message', ev => {
  if(ev.data?.type === 'attachmentsPicked'){ attachments = attachments.concat(ev.data.attachments || []).slice(-6); renderAttachments(); }
});
refresh();
connectWs();
</script>
</body>
</html>`;
    }
}
