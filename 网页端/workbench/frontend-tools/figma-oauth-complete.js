const connected=new URLSearchParams(location.search).get('figma_auth')==='connected';
document.getElementById('title').textContent=connected?'Figma 账号已连接':'Figma 授权尚未完成';
document.getElementById('message').textContent=connected?'可以返回 Astrix，工作区会自动更新连接状态。':'请返回 Astrix 再次点击“连接 Figma 账号”。';
document.getElementById('close').onclick=()=>window.close();
if(connected)setTimeout(()=>window.close(),1200);
