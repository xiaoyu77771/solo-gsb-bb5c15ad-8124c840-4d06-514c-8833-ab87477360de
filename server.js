'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { openDb } = require('./db');
const { checkPlay } = require('./check');
const { seedIfEmpty } = require('./seed');
const { buildTextReport } = require('./report');

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = openDb(DB_PATH);
seedIfEmpty(db);

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isRealId = (id) => Number.isInteger(id) && id > 0;

// ---------- 读取 ----------

function getFullPlay(playId) {
  const play = db.prepare('SELECT * FROM plays WHERE id = ?').get(playId);
  if (!play) return null;
  const areas = db.prepare('SELECT id, name, x, y FROM areas WHERE play_id = ? ORDER BY id').all(playId);
  const edges = db.prepare('SELECT id, a, b, seconds FROM edges WHERE play_id = ? ORDER BY id').all(playId);
  const scenes = db.prepare('SELECT id, seq, name FROM scenes WHERE play_id = ? ORDER BY seq').all(playId);
  const transitions = db.prepare('SELECT * FROM transitions WHERE play_id = ? ORDER BY from_seq').all(playId);
  const movesStmt = db.prepare('SELECT id, actor, from_area_id, to_area_id FROM actor_moves WHERE transition_id = ? ORDER BY id');
  return {
    id: play.id,
    name: play.name,
    createdAt: play.created_at,
    areas,
    edges,
    scenes,
    transitions: transitions.map((t) => ({
      id: t.id,
      fromSeq: t.from_seq,
      toSeq: t.to_seq,
      durationSeconds: t.duration_seconds,
      blockedAreaIds: JSON.parse(t.blocked_area_ids || '[]'),
      moves: movesStmt.all(t.id).map((m) => ({
        id: m.id,
        actor: m.actor,
        fromAreaId: m.from_area_id,
        toAreaId: m.to_area_id,
      })),
    })),
  };
}

function mustGetPlay(playId) {
  const doc = getFullPlay(playId);
  if (!doc) throw new HttpError(404, '剧目不存在');
  return doc;
}

// ---------- 路由 ----------

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/plays', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.created_at AS createdAt,
      (SELECT COUNT(*) FROM areas  a WHERE a.play_id = p.id) AS areaCount,
      (SELECT COUNT(*) FROM scenes s WHERE s.play_id = p.id) AS sceneCount
    FROM plays p ORDER BY p.id
  `).all();
  res.json(rows);
});

app.post('/api/plays', (req, res, next) => {
  try {
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) throw new HttpError(400, '剧目名称不能为空');
    const id = db.prepare('INSERT INTO plays (name) VALUES (?)').run(name).lastInsertRowid;
    res.status(201).json(getFullPlay(id));
  } catch (e) { next(e); }
});

app.get('/api/plays/:id', (req, res, next) => {
  try {
    res.json(mustGetPlay(Number(req.params.id)));
  } catch (e) { next(e); }
});

app.delete('/api/plays/:id', (req, res, next) => {
  try {
    const info = db.prepare('DELETE FROM plays WHERE id = ?').run(Number(req.params.id));
    if (!info.changes) throw new HttpError(404, '剧目不存在');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/**
 * 整剧保存：客户端提交完整文档（区域/邻接边/场次/换场/走位），
 * 服务端在事务内按 id 保留已有记录、插入新记录（临时 id 重映射）、删除缺失记录。
 */
app.put('/api/plays/:id', (req, res, next) => {
  try {
    const playId = Number(req.params.id);
    if (!db.prepare('SELECT id FROM plays WHERE id = ?').get(playId)) throw new HttpError(404, '剧目不存在');

    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) throw new HttpError(400, '剧目名称不能为空');
    const areas = Array.isArray(body.areas) ? body.areas : [];
    const edges = Array.isArray(body.edges) ? body.edges : [];
    const scenes = Array.isArray(body.scenes) ? body.scenes : [];
    const transitions = Array.isArray(body.transitions) ? body.transitions : [];

    for (const a of areas) {
      if (!String(a.name || '').trim()) throw new HttpError(400, '区域名称不能为空');
    }
    for (const e of edges) {
      if (!(Number(e.seconds) > 0)) throw new HttpError(400, '邻接边的通行秒数必须大于 0');
    }
    for (const s of scenes) {
      if (!String(s.name || '').trim()) throw new HttpError(400, '场次名称不能为空');
    }
    for (const t of transitions) {
      if (!(Number(t.durationSeconds) >= 0)) throw new HttpError(400, '换场时长必须是非负数字');
      for (const m of t.moves || []) {
        if (!String(m.actor || '').trim()) throw new HttpError(400, '演员姓名不能为空');
      }
    }

    const save = db.transaction(() => {
      db.prepare('UPDATE plays SET name = ? WHERE id = ?').run(name, playId);

      // --- 区域：保留/更新/新增，删除缺失；临时 id -> 真实 id 重映射 ---
      const existingAreaIds = db.prepare('SELECT id FROM areas WHERE play_id = ?').all(playId).map((r) => r.id);
      const existingAreaSet = new Set(existingAreaIds);
      const keepAreaIds = new Set(areas.filter((a) => isRealId(a.id)).map((a) => a.id));
      const delArea = db.prepare('DELETE FROM areas WHERE id = ? AND play_id = ?');
      for (const id of existingAreaIds) if (!keepAreaIds.has(id)) delArea.run(id, playId);

      const idMap = new Map(); // 客户端 id（真实或临时） -> 数据库 id
      const insArea = db.prepare('INSERT INTO areas (play_id, name, x, y) VALUES (?,?,?,?)');
      const updArea = db.prepare('UPDATE areas SET name = ?, x = ?, y = ? WHERE id = ? AND play_id = ?');
      areas.forEach((a, i) => {
        const key = a.id != null ? a.id : `idx-${i}`;
        const nm = String(a.name).trim();
        const x = Number(a.x) || 0;
        const y = Number(a.y) || 0;
        if (isRealId(a.id) && existingAreaSet.has(a.id)) {
          updArea.run(nm, x, y, a.id, playId);
          idMap.set(key, a.id);
        } else {
          idMap.set(key, insArea.run(playId, nm, x, y).lastInsertRowid);
        }
      });
      const mapAreaId = (id) => (idMap.has(id) ? idMap.get(id) : null);

      // --- 邻接边：整体重建（无外部引用） ---
      db.prepare('DELETE FROM edges WHERE play_id = ?').run(playId);
      const insEdge = db.prepare('INSERT INTO edges (play_id, a, b, seconds) VALUES (?,?,?,?)');
      const seenEdge = new Set();
      for (const e of edges) {
        const a = mapAreaId(e.a);
        const b = mapAreaId(e.b);
        if (a == null || b == null || a === b) continue;
        const k = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (seenEdge.has(k)) continue;
        seenEdge.add(k);
        insEdge.run(playId, a, b, Number(e.seconds));
      }

      // --- 场次：按 id 保留/更新/新增，删除缺失 ---
      const existingSceneIds = db.prepare('SELECT id FROM scenes WHERE play_id = ?').all(playId).map((r) => r.id);
      const keepSceneIds = new Set(scenes.filter((s) => isRealId(s.id)).map((s) => s.id));
      const delScene = db.prepare('DELETE FROM scenes WHERE id = ? AND play_id = ?');
      for (const id of existingSceneIds) if (!keepSceneIds.has(id)) delScene.run(id, playId);
      const insScene = db.prepare('INSERT INTO scenes (play_id, seq, name) VALUES (?,?,?)');
      const updScene = db.prepare('UPDATE scenes SET seq = ?, name = ? WHERE id = ? AND play_id = ?');
      scenes.forEach((s, i) => {
        const seq = i + 1;
        const nm = String(s.name).trim();
        if (isRealId(s.id) && keepSceneIds.has(s.id)) updScene.run(seq, nm, s.id, playId);
        else insScene.run(playId, seq, nm);
      });

      // --- 换场：按 id 保留/更新/新增；走位随换场整体重建 ---
      const existingTIds = db.prepare('SELECT id FROM transitions WHERE play_id = ?').all(playId).map((r) => r.id);
      const existingTSet = new Set(existingTIds);
      const keepTIds = new Set(transitions.filter((t) => isRealId(t.id)).map((t) => t.id));
      const delT = db.prepare('DELETE FROM transitions WHERE id = ? AND play_id = ?');
      for (const id of existingTIds) if (!keepTIds.has(id)) delT.run(id, playId);

      const insT = db.prepare('INSERT INTO transitions (play_id, from_seq, to_seq, duration_seconds, blocked_area_ids) VALUES (?,?,?,?,?)');
      const updT = db.prepare('UPDATE transitions SET from_seq = ?, to_seq = ?, duration_seconds = ?, blocked_area_ids = ? WHERE id = ? AND play_id = ?');
      const delMoves = db.prepare('DELETE FROM actor_moves WHERE transition_id = ?');
      const insMove = db.prepare('INSERT INTO actor_moves (transition_id, actor, from_area_id, to_area_id) VALUES (?,?,?,?)');

      transitions.forEach((t, i) => {
        const fromSeq = i + 1;
        const toSeq = i + 2;
        const dur = Number(t.durationSeconds);
        const blocked = JSON.stringify((t.blockedAreaIds || []).map(mapAreaId).filter((x) => x != null));
        let tid;
        if (isRealId(t.id) && existingTSet.has(t.id)) {
          updT.run(fromSeq, toSeq, dur, blocked, t.id, playId);
          tid = t.id;
          delMoves.run(tid);
        } else {
          tid = insT.run(playId, fromSeq, toSeq, dur, blocked).lastInsertRowid;
        }
        for (const m of t.moves || []) {
          insMove.run(tid, String(m.actor).trim(), mapAreaId(m.fromAreaId), mapAreaId(m.toAreaId));
        }
      });
    });
    save();

    res.json(getFullPlay(playId));
  } catch (e) { next(e); }
});

app.get('/api/plays/:id/check', (req, res, next) => {
  try {
    const doc = mustGetPlay(Number(req.params.id));
    res.json(checkPlay(doc));
  } catch (e) { next(e); }
});

app.get('/api/plays/:id/export', (req, res, next) => {
  try {
    const doc = mustGetPlay(Number(req.params.id));
    const result = checkPlay(doc);
    const safeName = doc.name.replace(/[\\/:*?"<>|]/g, '_');
    if (String(req.query.format) === 'txt') {
      const filename = encodeURIComponent(`${safeName}-检查报告.txt`);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="report-${doc.id}.txt"; filename*=UTF-8''${filename}`);
      res.send(buildTextReport(doc.name, result));
    } else {
      const filename = encodeURIComponent(`${safeName}-检查结果.json`);
      res.setHeader('Content-Disposition', `attachment; filename="check-${doc.id}.json"; filename*=UTF-8''${filename}`);
      res.json({ play: { id: doc.id, name: doc.name }, ...result });
    }
  } catch (e) { next(e); }
});

// ---------- 错误处理 ----------

app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`话剧走位连续性检查应用已启动: http://localhost:${PORT}`);
  console.log(`数据库文件: ${DB_PATH}`);
});
