/* HarmonyDrop 手机端 */
'use strict';

const $ = (s) => document.querySelector(s);

let token = null;
let currentPath = null;   // null = 根目录列表

// ---------- 工具 ----------

function toast(msg, ms = 1800) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, ms);
}

function fmtSize(n) {
  if (n >= 1 << 30) return (n / (1 << 30)).toFixed(1) + ' GB';
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

function fileIcon(name, isDir) {
  if (isDir) return '📁';
  const ext = name.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'heic', 'gif', 'webp'].includes(ext)) return '🖼️';
  if (['mp4', 'mov', 'mkv'].includes(ext)) return '🎬';
  if (['mp3', 'm4a', 'flac', 'wav', 'aac'].includes(ext)) return '🎵';
  if (['pdf'].includes(ext)) return '📕';
  if (['zip', 'rar', '7z'].includes(ext)) return '📦';
  if (['txt', 'md', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) return '📄';
  return '📄';
}

function isImage(name) {
  return ['jpg', 'jpeg', 'png', 'heic', 'gif', 'webp'].includes(name.split('.').pop().toLowerCase());
}
function isAudio(name) {
  return ['mp3', 'm4a', 'flac', 'wav', 'aac', 'ogg'].includes(name.split('.').pop().toLowerCase());
}

// ---------- 鉴权 ----------

function readTokenFromHash() {
  const m = location.hash.match(/token=([0-9a-f]+)/);
  if (m) { token = m[1]; localStorage.setItem('hd_token', token); }
}

async function api(path, opts = {}) {
  const url = new URL(path, location.origin,);
  if (opts.query) for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  url.searchParams.set('token', token);
  const init = { method: opts.method || 'GET', headers: { 'X-HarmonyDrop-Token': token } };
  if (opts.body !== undefined) init.body = opts.body;
  const resp = await fetch(url, init);
  if (resp.status === 401) { showPair('配对已失效，请重新输入配对码'); throw new Error('unauthorized'); }
  return resp;
}

async function tryAutoConnect() {
  readTokenFromHash();
  if (!token) token = localStorage.getItem('hd_token');
  if (!token) { showPair(); return; }
  try {
    const r = await api('/api/info');
    if (r.ok) { enterMain(); return; }
    showPair();
  } catch { showPair(); }
}

function showPair(errMsg) {
  $('#pairScreen').hidden = false;
  $('#main').hidden = true;
  if (errMsg) { $('#pairErr').textContent = errMsg; $('#pairErr').hidden = false; }
  $('#pairInput').focus();
}

async function enterMain() {
  $('#pairScreen').hidden = true;
  $('#main').hidden = false;
  const info = await (await api('/api/info')).json();
  $('#macName').textContent = info.name;
  loadBrowser(null);
  refreshClip();
}

// ---------- 标签切换 ----------

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    $('#tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'clipboard') refreshClip();
  });
});

// ---------- 上传 ----------

$('#dropZone').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', (e) => { uploadFiles([...e.target.files]); e.target.value = ''; });

function uploadFiles(files) {
  files.forEach(uploadOne);
}

function uploadOne(file) {
  const row = document.createElement('div');
  row.className = 'upload-item';
  row.innerHTML = `
    <div class="info">
      <div class="name">${escapeHtml(file.name)}</div>
      <div class="bar"><div></div></div>
      <div class="st">准备中…</div>
    </div>`;
  $('#uploadList').prepend(row);
  const bar = row.querySelector('.bar > div');
  const st = row.querySelector('.st');

  const xhr = new XMLHttpRequest();
  xhr.open('PUT', `/api/upload?name=${encodeURIComponent(file.name)}&token=${encodeURIComponent(token)}`);
  xhr.setRequestHeader('X-HarmonyDrop-Token', token);
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const pct = e.loaded / e.total;
      bar.style.width = (pct * 100).toFixed(1) + '%';
      st.textContent = `${fmtSize(e.loaded)} / ${fmtSize(e.total)}`;
    }
  };
  xhr.onload = () => {
    if (xhr.status === 200) {
      bar.style.width = '100%';
      st.textContent = '✓ 已发送到 Mac';
      st.classList.add('ok');
    } else {
      st.textContent = '✗ 失败：' + (JSON.parse(xhr.responseText || '{}').error || xhr.status);
      st.classList.add('err');
    }
  };
  xhr.onerror = () => { st.textContent = '✗ 网络错误'; st.classList.add('err'); };
  xhr.send(file);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------- 浏览 ----------

async function loadBrowser(path) {
  $('#browseLoading').hidden = false;
  try {
    const resp = await api('/api/tree', { query: path ? { path } : {} });
    const data = await resp.json();
    currentPath = path;
    renderCrumbs();
    renderEntries(data.entries || []);
  } catch (e) {
    if (e.message !== 'unauthorized') toast('加载失败');
  } finally {
    $('#browseLoading').hidden = true;
  }
}

function renderCrumbs() {
  const box = $('#crumbs');
  box.innerHTML = '';
  const mk = (label, target) => {
    const c = document.createElement('span');
    c.className = 'crumb' + (target === currentPath ? ' cur' : '');
    c.textContent = label;
    c.onclick = () => loadBrowser(target);
    box.appendChild(c);
  };
  mk('🏠 Mac', null);
  if (currentPath) {
    const parts = currentPath.split('/').filter(Boolean);
    let acc = '';
    parts.forEach((p, i) => {
      acc += (i === 0 ? '' : '/') + p;
      const target = i === parts.length - 1 ? currentPath : '/' + acc;
      mk(p, target);
    });
  }
}

function renderEntries(entries) {
  const box = $('#browser');
  box.innerHTML = '';
  // 同屏全图片 → 照片墙；否则列表
  const imageCount = entries.filter(e => !e.dir && isImage(e.name)).length;
  const files = entries.filter(e => !e.dir);
  const grid = files.length >= 6 && imageCount === files.length;
  box.classList.toggle('list-mode', !grid);

  for (const e of entries) {
    const el = document.createElement('div');
    el.className = 'entry';
    if (e.dir) {
      el.innerHTML = `<div class="icon">📁</div><div class="name">${escapeHtml(e.name)}</div>`;
      el.onclick = () => loadBrowser(e.path);
    } else if (grid) {
      el.innerHTML = `<img loading="lazy" src="/api/thumb?path=${encodeURIComponent(e.path)}&token=${encodeURIComponent(token)}">` +
        `<button class="dl" title="下载">⬇︎</button>`;
      el.querySelector('.dl').onclick = (ev) => { ev.stopPropagation(); download(e); };
      el.onclick = () => preview(e);
    } else {
      const icon = isAudio(e.name) ? '🎵' : fileIcon(e.name, false);
      el.innerHTML = `<div class="icon">${icon}</div>
        <div class="meta"><div class="name">${escapeHtml(e.name)}</div>
        <div class="sub">${fmtSize(e.size)}</div></div>
        <button class="dl" style="position:static;width:44px;height:36px;font-size:16px">⬇︎</button>`;
      el.querySelector('.dl').onclick = () => download(e);
      if (isAudio(e.name)) el.onclick = () => playAudio(e);
    }
    box.appendChild(el);
  }
  if (!entries.length) {
    box.innerHTML = '<div class="loading">空目录</div>';
  }
}

function download(e) {
  const a = document.createElement('a');
  a.href = `/api/file?path=${encodeURIComponent(e.path)}&token=${encodeURIComponent(token)}`;
  a.download = e.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('开始下载 ' + e.name);
}

function preview(e) {
  const url = `/api/file?path=${encodeURIComponent(e.path)}&token=${encodeURIComponent(token)}`;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:300;display:flex;align-items:center;justify-content:center';
  const img = document.createElement('img');
  img.src = url;
  img.style.cssText = 'max-width:100%;max-height:100%';
  ov.appendChild(img);
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
}

function playAudio(e) {
  document.querySelectorAll('audio').forEach(a => a.pause());
  const url = `/api/file?path=${encodeURIComponent(e.path)}&token=${encodeURIComponent(token)}`;
  let player = document.getElementById('hd-audio');
  if (!player) {
    player = document.createElement('audio');
    player.id = 'hd-audio';
    player.controls = true;
    player.style.cssText = 'position:fixed;left:12px;right:12px;bottom:16px;z-index:150';
    document.body.appendChild(player);
  }
  player.src = url;
  player.play();
}

// ---------- 剪贴板 ----------

async function refreshClip() {
  try {
    const r = await api('/api/clipboard');
    const data = await r.json();
    $('#clipMac').textContent = data.text || '（Mac 剪贴板无文本）';
  } catch { /* 静默 */ }
}

$('#clipRefresh').onclick = refreshClip;

$('#clipSendBtn').onclick = async () => {
  const text = $('#clipSend').value;
  if (!text.trim()) return toast('请输入内容');
  const r = await api('/api/clipboard', { method: 'POST', body: JSON.stringify({ text }) });
  if (r.ok) { toast('✓ 已写入 Mac 剪贴板'); $('#clipSend').value = ''; }
  else toast('发送失败');
};

$('#clipCopy').onclick = async () => {
  const text = $('#clipMac').textContent;
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制');
  }
};

// ---------- 配对 ----------

async function doPair() {
  const code = $('#pairInput').value.trim();
  if (code.length !== 6) { $('#pairErr').textContent = '请输入 6 位数字'; $('#pairErr').hidden = false; return; }
  const r = await fetch('/api/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
  if (r.ok) {
    const data = await r.json();
    token = data.token;
    localStorage.setItem('hd_token', token);
    enterMain();
  } else {
    const data = await r.json().catch(() => ({}));
    $('#pairErr').textContent = data.error || '配对失败';
    $('#pairErr').hidden = false;
  }
}
$('#pairBtn').onclick = doPair;
$('#pairInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doPair(); });

// ---------- 启动 ----------

(async () => {
  // 连接状态指示
  setInterval(async () => {
    try {
      await api('/api/ping');
      $('#connState').className = 'conn ok';
    } catch {
      $('#connState').className = 'conn bad';
      $('#connState').textContent = '连接中断';
    }
  }, 5000).unref?.();

  await tryAutoConnect();
})();
