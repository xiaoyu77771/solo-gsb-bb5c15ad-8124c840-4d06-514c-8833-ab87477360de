'use strict';

/* ================= 全局状态 ================= */

let plays = [];          // 剧目列表
let state = null;        // 当前剧目完整文档
let checkResult = null;  // 最近一次检查结果
let dirty = false;       // 有未保存修改
let tmpSeq = 1;          // 客户端临时 id 计数器（保存时由服务端重映射）

const tmpId = () => 'tmp_' + (tmpSeq++);
const SVG_W = 800, SVG_H = 500;

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ================= API ================= */

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `请求失败（${res.status}）`);
  }
  return res.json();
}

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

function markDirty() {
  dirty = true;
  $('#dirtyMark').textContent = '● 有未保存的修改';
}
function clearDirty() {
  dirty = false;
  $('#dirtyMark').textContent = '';
}

/* ================= 初始化 ================= */

async function init() {
  bindEvents();
  await reloadPlays();
}

async function reloadPlays(selectId) {
  plays = await api('/api/plays');
  const sel = $('#playSelect');
  sel.innerHTML = plays.map((p) => `<option value="${p.id}">${esc(p.name)}（区域 ${p.areaCount} / 场次 ${p.sceneCount}）</option>`).join('');
  $('#emptyState').classList.toggle('hidden', plays.length > 0);
  if (plays.length === 0) {
    state = null;
    renderAll();
    return;
  }
  const id = selectId != null ? selectId : plays[0].id;
  sel.value = String(id);
  await loadPlay(Number(sel.value));
}

async function loadPlay(id) {
  state = await api(`/api/plays/${id}`);
  checkResult = null;
  clearDirty();
  renderAll();
}

/* ================= 渲染：总入口 ================= */

function renderAll() {
  const has = !!state;
  for (const id of ['tab-graph', 'tab-scenes', 'tab-results']) {
    document.getElementById(id).style.display = has ? '' : 'none';
  }
  $('#exportJson').href = has ? `/api/plays/${state.id}/export?format=json` : '#';
  $('#exportTxt').href = has ? `/api/plays/${state.id}/export?format=txt` : '#';
  if (!has) return;
  renderGraphTab();
  renderScenesTab();
  renderResultsTab();
}

/* ================= 舞台区域图 ================= */

const svgEl = () => $('#stageSvg');
let dragKey = null;

function areaById(id) {
  return state.areas.find((a) => String(a.id) === String(id));
}
function areaName(id) {
  const a = areaById(id);
  return a ? a.name : `#${id}`;
}

function renderGraphTab() {
  renderSvg();
  renderAreaList();
  renderEdgeList();
  renderEdgeSelects();
}

function renderSvg() {
  const svg = svgEl();
  let html = '';
  for (const e of state.edges) {
    const a = areaById(e.a), b = areaById(e.b);
    if (!a || !b) continue;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    html += `<line class="edge-line" data-edge="${e.id}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
    html += `<text class="edge-label" data-edge="${e.id}" x="${mx}" y="${my - 4}">${e.seconds}s</text>`;
  }
  for (const a of state.areas) {
    html += `<g class="node" data-node="${esc(a.id)}">
      <circle cx="${a.x}" cy="${a.y}" r="20"/>
      <text x="${a.x}" y="${a.y + 34}">${esc(a.name)}</text>
    </g>`;
  }
  svg.innerHTML = html;
}

function renderAreaList() {
  $('#areaList').innerHTML = state.areas.map((a) => `
    <li>
      <input type="text" value="${esc(a.name)}" onchange="onRenameArea('${esc(a.id)}', this.value)">
      <button class="btn small danger" onclick="onDeleteArea('${esc(a.id)}')">删除</button>
    </li>`).join('');
}

function renderEdgeList() {
  $('#edgeList').innerHTML = state.edges.map((e) => `
    <li>
      <span class="grow">${esc(areaName(e.a))} ↔ ${esc(areaName(e.b))}（${e.seconds}s）</span>
      <button class="btn small" onclick="onEditEdge('${esc(e.id)}')">改秒数</button>
      <button class="btn small danger" onclick="onDeleteEdge('${esc(e.id)}')">删除</button>
    </li>`).join('');
}

function renderEdgeSelects() {
  const opts = state.areas.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  $('#edgeFrom').innerHTML = opts;
  $('#edgeTo').innerHTML = opts;
}

function svgPoint(evt) {
  const r = svgEl().getBoundingClientRect();
  return {
    x: (evt.clientX - r.left) * SVG_W / r.width,
    y: (evt.clientY - r.top) * SVG_H / r.height,
  };
}

function onAddArea() {
  const input = $('#newAreaName');
  const name = input.value.trim();
  if (!name) return toast('请输入区域名称', true);
  if (state.areas.some((a) => a.name === name)) return toast('区域名称重复', true);
  const n = state.areas.length;
  const angle = n * 2.39996; // 黄金角散布
  const r = 60 + 18 * n;
  state.areas.push({
    id: tmpId(), name,
    x: Math.round(Math.min(770, Math.max(30, SVG_W / 2 + r * Math.cos(angle)))),
    y: Math.round(Math.min(470, Math.max(30, SVG_H / 2 + r * Math.sin(angle)))),
  });
  input.value = '';
  markDirty();
  renderGraphTab();
  renderScenesTab();
}

function onRenameArea(id, name) {
  const a = areaById(id);
  name = String(name).trim();
  if (!a || !name) return;
  a.name = name;
  markDirty();
  renderGraphTab();
  renderScenesTab();
}

function onDeleteArea(id) {
  const a = areaById(id);
  if (!a) return;
  if (!confirm(`删除区域「${a.name}」？相关邻接边、走位起终点与不可穿越设置将一并移除。`)) return;
  const key = String(id);
  state.areas = state.areas.filter((x) => String(x.id) !== key);
  state.edges = state.edges.filter((e) => String(e.a) !== key && String(e.b) !== key);
  for (const t of state.transitions) {
    t.blockedAreaIds = t.blockedAreaIds.filter((x) => String(x) !== key);
    for (const m of t.moves) {
      if (String(m.fromAreaId) === key) m.fromAreaId = null;
      if (String(m.toAreaId) === key) m.toAreaId = null;
    }
  }
  markDirty();
  renderGraphTab();
  renderScenesTab();
}

function onAddEdge() {
  const a = $('#edgeFrom').value, b = $('#edgeTo').value;
  const seconds = Number($('#edgeSeconds').value);
  if (!a || !b || a === b) return toast('请选择两个不同的区域', true);
  if (!(seconds > 0)) return toast('通行秒数必须大于 0', true);
  const dup = state.edges.find((e) =>
    (String(e.a) === a && String(e.b) === b) || (String(e.a) === b && String(e.b) === a));
  if (dup) return toast('这两个区域之间已有邻接边', true);
  state.edges.push({ id: tmpId(), a: isNaN(Number(a)) ? a : Number(a), b: isNaN(Number(b)) ? b : Number(b), seconds });
  markDirty();
  renderGraphTab();
}

function onEditEdge(id) {
  const e = state.edges.find((x) => String(x.id) === String(id));
  if (!e) return;
  const v = prompt(`修改「${areaName(e.a)} ↔ ${areaName(e.b)}」的通行秒数（输入 0 删除此边）`, e.seconds);
  if (v == null) return;
  const n = Number(v);
  if (n === 0) return onDeleteEdge(id);
  if (!(n > 0)) return toast('秒数必须大于 0', true);
  e.seconds = n;
  markDirty();
  renderGraphTab();
}

function onDeleteEdge(id) {
  state.edges = state.edges.filter((x) => String(x.id) !== String(id));
  markDirty();
  renderGraphTab();
}

/* ================= 场次与换场 ================= */

/** 按场次顺序重建换场槽位：相邻两场之间一个换场，按位置保留已有数据。 */
function syncTransitions() {
  state.scenes.forEach((s, i) => { s.seq = i + 1; });
  const next = [];
  for (let i = 0; i < state.scenes.length - 1; i++) {
    const t = state.transitions[i] || { id: tmpId(), durationSeconds: 30, blockedAreaIds: [], moves: [] };
    t.fromSeq = i + 1;
    t.toSeq = i + 2;
    next.push(t);
  }
  state.transitions = next;
}

function renderScenesTab() {
  syncTransitions();
  $('#sceneList').innerHTML = state.scenes.map((s, i) => `
    <li>
      <span>第${i + 1}场</span>
      <input type="text" class="grow" value="${esc(s.name)}" onchange="onRenameScene(${i}, this.value)">
      <button class="btn small" onclick="onMoveScene(${i}, -1)" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn small" onclick="onMoveScene(${i}, 1)" ${i === state.scenes.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn small danger" onclick="onDeleteScene(${i})">删</button>
    </li>`).join('');

  const wrap = $('#transitionList');
  if (state.transitions.length === 0) {
    wrap.innerHTML = '<p class="hint">至少需要两个场次才会出现换场设置。</p>';
    return;
  }
  wrap.innerHTML = state.transitions.map((t, i) => renderTransitionCard(t, i)).join('');
}

function renderTransitionCard(t, i) {
  const fromName = state.scenes[i] ? state.scenes[i].name : `第${t.fromSeq}场`;
  const toName = state.scenes[i + 1] ? state.scenes[i + 1].name : `第${t.toSeq}场`;
  const blockedBoxes = state.areas.map((a) => {
    const checked = t.blockedAreaIds.some((x) => String(x) === String(a.id)) ? 'checked' : '';
    return `<label><input type="checkbox" ${checked} onchange="onToggleBlocked(${i}, '${esc(a.id)}', this.checked)"> ${esc(a.name)}</label>`;
  }).join('') || '<span class="hint">（尚未定义区域）</span>';

  const areaOpts = (sel) => `<option value="">（选择区域）</option>` + state.areas.map((a) =>
    `<option value="${esc(a.id)}" ${String(sel) === String(a.id) ? 'selected' : ''}>${esc(a.name)}</option>`).join('');

  const moveRows = t.moves.map((m, j) => `
    <tr>
      <td><input type="text" value="${esc(m.actor)}" placeholder="演员名" onchange="onMoveField(${i}, ${j}, 'actor', this.value)"></td>
      <td><select onchange="onMoveField(${i}, ${j}, 'fromAreaId', this.value)">${areaOpts(m.fromAreaId)}</select></td>
      <td><select onchange="onMoveField(${i}, ${j}, 'toAreaId', this.value)">${areaOpts(m.toAreaId)}</select></td>
      <td><button class="btn small danger" onclick="onDeleteMove(${i}, ${j})">删</button></td>
    </tr>`).join('');

  return `
  <div class="transition-card">
    <h4>换场 ${i + 1}：${esc(fromName)} → ${esc(toName)}</h4>
    <div class="row">
      <label>换场时长（秒）</label>
      <input type="number" min="0" step="1" value="${t.durationSeconds}"
             onchange="onDurationChange(${i}, this.value)">
    </div>
    <div>
      <strong>不可穿越区域（本次换场期间）：</strong>
      <div class="blocked-box">${blockedBoxes}</div>
    </div>
    <table class="moves-table">
      <thead><tr><th>演员</th><th>起点（上一场结束位置）</th><th>终点（下一场开始位置）</th><th></th></tr></thead>
      <tbody>${moveRows || '<tr><td colspan="4" class="hint">暂无走位记录</td></tr>'}</tbody>
    </table>
    <div class="row"><button class="btn small" onclick="onAddMove(${i})">+ 添加演员走位</button></div>
  </div>`;
}

function onAddScene() {
  const input = $('#newSceneName');
  const name = input.value.trim() || `第${state.scenes.length + 1}场`;
  state.scenes.push({ id: tmpId(), seq: state.scenes.length + 1, name });
  input.value = '';
  markDirty();
  renderScenesTab();
}

function onRenameScene(i, name) {
  name = String(name).trim();
  if (!name) return;
  state.scenes[i].name = name;
  markDirty();
  renderScenesTab();
}

function onMoveScene(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= state.scenes.length) return;
  [state.scenes[i], state.scenes[j]] = [state.scenes[j], state.scenes[i]];
  markDirty();
  renderScenesTab();
}

function onDeleteScene(i) {
  const s = state.scenes[i];
  if (!confirm(`删除场次「${s.name}」？相邻换场设置将按新顺序重新配对。`)) return;
  state.scenes.splice(i, 1);
  markDirty();
  renderScenesTab();
}

function onDurationChange(i, v) {
  const n = Number(v);
  if (!(n >= 0)) return toast('换场时长必须是非负数字', true);
  state.transitions[i].durationSeconds = n;
  markDirty();
}

function onToggleBlocked(i, areaId, checked) {
  const t = state.transitions[i];
  const key = String(areaId);
  const has = t.blockedAreaIds.some((x) => String(x) === key);
  if (checked && !has) t.blockedAreaIds.push(isNaN(Number(areaId)) ? areaId : Number(areaId));
  if (!checked && has) t.blockedAreaIds = t.blockedAreaIds.filter((x) => String(x) !== key);
  markDirty();
}

function onAddMove(i) {
  state.transitions[i].moves.push({ actor: '', fromAreaId: null, toAreaId: null });
  markDirty();
  renderScenesTab();
}

function onDeleteMove(i, j) {
  state.transitions[i].moves.splice(j, 1);
  markDirty();
  renderScenesTab();
}

function onMoveField(i, j, field, value) {
  const m = state.transitions[i].moves[j];
  if (field === 'actor') m.actor = value.trim();
  else m[field] = value === '' ? null : (isNaN(Number(value)) ? value : Number(value));
  markDirty();
}

/* ================= 保存 / 检查 / 导出 ================= */

async function saveAll(silent = false) {
  if (!state) return;
  // 剔除完全空白的走位行（未填演员且未选起终点），避免误触「添加」后保存报错
  for (const t of state.transitions) {
    t.moves = t.moves.filter((m) => (m.actor && m.actor.trim()) || m.fromAreaId != null || m.toAreaId != null);
  }
  try {
    const saved = await api(`/api/plays/${state.id}`, { method: 'PUT', body: JSON.stringify(state) });
    state = saved;
    clearDirty();
    renderAll();
    if (!silent) toast('已保存');
  } catch (e) {
    toast('保存失败：' + e.message, true);
    throw e;
  }
}

async function runCheck() {
  if (!state) return;
  try {
    await saveAll(true);
    checkResult = await api(`/api/plays/${state.id}/check`);
    renderResultsTab();
    switchTab('results');
    if (checkResult.ok) toast('检查通过：全部转场可行');
    else toast('发现不可能转场', true);
  } catch (e) {
    toast('检查失败：' + e.message, true);
  }
}

function renderResultsTab() {
  const sumEl = $('#checkSummary');
  const detEl = $('#checkDetails');
  if (!checkResult) {
    sumEl.innerHTML = '<p class="hint">尚未运行检查。点击「运行检查」查看结果。</p>';
    detEl.innerHTML = '';
    return;
  }
  const r = checkResult;
  if (r.ok) {
    sumEl.innerHTML = `<div class="summary-banner ok">✔ 全部 ${r.transitions.length} 个转场均可行（检查时间：${esc(r.checkedAt)}）</div>`;
  } else {
    const f = r.firstFailure;
    sumEl.innerHTML = `<div class="summary-banner fail">
      ✘ 首个不可能转场：第${f.fromSeq}场「${esc(f.fromScene)}」 → 第${f.toSeq}场「${esc(f.toScene)}」（换场时长 ${f.durationSeconds}s）
    </div>`;
  }
  detEl.innerHTML = r.transitions.map((t) => {
    const blocked = t.blockedNames.length ? `｜不可穿越：${t.blockedNames.map(esc).join('、')}` : '';
    const rows = t.moves.map((m) => {
      const path = m.pathNames.length ? `<span class="path-str">${m.pathNames.map(esc).join(' → ')}</span>` : '—';
      const cost = m.cost == null ? '—' : `${m.cost}s`;
      return `<tr class="move-row">
        <td>${esc(m.actor)}</td>
        <td>${esc(m.fromName || '?')} → ${esc(m.toName || '?')}</td>
        <td>${cost}</td>
        <td>${path}</td>
        <td class="${m.ok ? 'ok' : 'fail'}">${m.ok ? '✔ ' : '✘ '}${esc(m.reason)}</td>
      </tr>`;
    }).join('');
    return `<div class="result-card ${t.ok ? 'ok' : 'fail'}">
      <h4>${t.ok ? '✔' : '✘'} 第${t.fromSeq}场「${esc(t.fromScene)}」 → 第${t.toSeq}场「${esc(t.toScene)}」</h4>
      <div class="meta">换场时长 ${t.durationSeconds}s ${blocked}${t.note ? '｜' + esc(t.note) : ''}</div>
      ${t.moves.length ? `<table class="moves-table">
        <thead><tr><th>演员</th><th>起 → 止</th><th>最短耗时</th><th>最短路径</th><th>结论 / 阻断原因</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : ''}
    </div>`;
  }).join('');
}

/* ================= 剧目管理 / 事件绑定 ================= */

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  for (const id of ['graph', 'scenes', 'results']) {
    document.getElementById('tab-' + id).classList.toggle('hidden', id !== name);
  }
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  $('#playSelect').addEventListener('change', async (e) => {
    if (dirty && !confirm('当前有未保存的修改，切换剧目将丢弃这些修改。继续？')) {
      e.target.value = String(state ? state.id : '');
      return;
    }
    await loadPlay(Number(e.target.value));
  });

  $('#newPlayBtn').addEventListener('click', async () => {
    const name = prompt('新剧目名称：');
    if (!name || !name.trim()) return;
    try {
      const doc = await api('/api/plays', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      await reloadPlays(doc.id);
      toast('已创建剧目');
    } catch (e) { toast(e.message, true); }
  });

  $('#renamePlayBtn').addEventListener('click', async () => {
    if (!state) return;
    const name = prompt('剧目名称：', state.name);
    if (!name || !name.trim()) return;
    state.name = name.trim();
    await saveAll();
    await reloadPlays(state.id);
  });

  $('#deletePlayBtn').addEventListener('click', async () => {
    if (!state) return;
    if (!confirm(`确定删除剧目「${state.name}」？该操作不可恢复。`)) return;
    try {
      await api(`/api/plays/${state.id}`, { method: 'DELETE' });
      state = null;
      await reloadPlays();
      toast('已删除');
    } catch (e) { toast(e.message, true); }
  });

  $('#saveBtn').addEventListener('click', () => saveAll());
  $('#checkBtn').addEventListener('click', runCheck);
  $('#runCheckBtn2').addEventListener('click', runCheck);

  $('#addAreaBtn').addEventListener('click', onAddArea);
  $('#newAreaName').addEventListener('keydown', (e) => { if (e.key === 'Enter') onAddArea(); });
  $('#addEdgeBtn').addEventListener('click', onAddEdge);
  $('#addSceneBtn').addEventListener('click', onAddScene);
  $('#newSceneName').addEventListener('keydown', (e) => { if (e.key === 'Enter') onAddScene(); });

  // SVG：节点拖拽 + 边点击改秒数
  const svg = svgEl();
  svg.addEventListener('mousedown', (e) => {
    const g = e.target.closest('[data-node]');
    if (!g) return;
    dragKey = g.dataset.node;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (dragKey == null || !state) return;
    const a = areaById(dragKey);
    if (!a) return;
    const p = svgPoint(e);
    a.x = Math.round(Math.min(770, Math.max(30, p.x)));
    a.y = Math.round(Math.min(470, Math.max(30, p.y)));
    markDirty();
    renderSvg();
  });
  window.addEventListener('mouseup', () => { dragKey = null; });
  svg.addEventListener('click', (e) => {
    const el = e.target.closest('[data-edge]');
    if (el) onEditEdge(el.dataset.edge);
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  init().catch((e) => toast('初始化失败：' + e.message, true));
});
