'use strict';

/**
 * 走位连续性核心算法：
 *  - 舞台区域为节点，邻接边带通行秒数（无向）。
 *  - 每次换场可设置若干「不可穿越区域」，计算时从图中剔除。
 *  - 对每位演员的起止位置求最短耗时路径（Dijkstra），
 *    与换场时长比较，定位首个不可能转场并给出路径或阻断原因。
 */

/** 构建邻接表：areaId -> [{to, seconds}]，剔除不可穿越区域及其关联边 */
function buildAdjacency(areas, edges, blocked) {
  const adj = new Map();
  for (const a of areas) {
    if (!blocked.has(a.id)) adj.set(a.id, []);
  }
  for (const e of edges) {
    if (blocked.has(e.a) || blocked.has(e.b)) continue;
    if (!adj.has(e.a) || !adj.has(e.b)) continue;
    adj.get(e.a).push({ to: e.b, seconds: e.seconds });
    adj.get(e.b).push({ to: e.a, seconds: e.seconds });
  }
  return adj;
}

/** Dijkstra 最短路径。返回 { cost, path }；不可达返回 null。 */
function shortestPath(adj, start, goal) {
  if (start === goal) return { cost: 0, path: [start] };
  const dist = new Map([[start, 0]]);
  const prev = new Map();
  const done = new Set();
  const queue = [{ id: start, d: 0 }];
  while (queue.length) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].d < queue[bi].d) bi = i;
    const { id, d } = queue.splice(bi, 1)[0];
    if (done.has(id)) continue;
    done.add(id);
    if (id === goal) break;
    for (const { to, seconds } of adj.get(id) || []) {
      const nd = d + seconds;
      if (nd < (dist.has(to) ? dist.get(to) : Infinity)) {
        dist.set(to, nd);
        prev.set(to, id);
        queue.push({ id: to, d: nd });
      }
    }
  }
  if (!dist.has(goal)) return null;
  const path = [];
  for (let cur = goal; cur !== undefined; cur = prev.get(cur)) path.unshift(cur);
  return { cost: dist.get(goal), path };
}

/**
 * 检查整部作品。
 * @param doc { areas, edges, scenes, transitions }
 *   transitions[i] = { id, fromSeq, toSeq, durationSeconds, blockedAreaIds, moves:[{actor, fromAreaId, toAreaId}] }
 * @returns { ok, firstFailure, transitions, checkedAt }
 */
function checkPlay(doc) {
  const areas = doc.areas || [];
  const edges = doc.edges || [];
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const sceneName = new Map((doc.scenes || []).map((s) => [s.seq, s.name]));
  const transitions = [...(doc.transitions || [])].sort((x, y) => x.fromSeq - y.fromSeq);

  const results = [];
  let firstFailure = null;

  for (const t of transitions) {
    const blocked = new Set(t.blockedAreaIds || []);
    const adj = buildAdjacency(areas, edges, blocked);
    const tRes = {
      transitionId: t.id,
      fromSeq: t.fromSeq,
      toSeq: t.toSeq,
      fromScene: sceneName.get(t.fromSeq) || `第${t.fromSeq}场`,
      toScene: sceneName.get(t.toSeq) || `第${t.toSeq}场`,
      durationSeconds: t.durationSeconds,
      blockedAreaIds: [...blocked],
      blockedNames: [...blocked].map((id) => areaName.get(id) || `#${id}`),
      ok: true,
      moves: [],
    };

    for (const m of t.moves || []) {
      const rec = {
        actor: m.actor,
        fromAreaId: m.fromAreaId,
        toAreaId: m.toAreaId,
        fromName: areaName.get(m.fromAreaId) || null,
        toName: areaName.get(m.toAreaId) || null,
        ok: false,
        cost: null,
        path: [],
        pathNames: [],
        reason: '',
      };

      if (m.fromAreaId == null || m.toAreaId == null || !areaName.has(m.fromAreaId) || !areaName.has(m.toAreaId)) {
        rec.reason = '缺少有效的起点或终点区域';
      } else if (m.fromAreaId === m.toAreaId) {
        rec.ok = true;
        rec.cost = 0;
        rec.path = [m.fromAreaId];
        rec.pathNames = [rec.fromName];
        rec.reason = '原地不动，无需走位';
      } else if (blocked.has(m.fromAreaId)) {
        rec.reason = `起点「${rec.fromName}」在本次换场期间不可穿越`;
      } else if (blocked.has(m.toAreaId)) {
        rec.reason = `终点「${rec.toName}」在本次换场期间不可穿越`;
      } else {
        const r = shortestPath(adj, m.fromAreaId, m.toAreaId);
        if (!r) {
          rec.reason = '区域不连通：起点到终点无可行路径（可能被不可穿越区域隔断）';
        } else {
          rec.cost = r.cost;
          rec.path = r.path;
          rec.pathNames = r.path.map((id) => areaName.get(id));
          if (r.cost <= t.durationSeconds) {
            rec.ok = true;
            rec.reason = '可在换场时长内到达';
          } else {
            rec.reason = `最短耗时 ${r.cost}s 超过换场时长 ${t.durationSeconds}s`;
          }
        }
      }

      if (!rec.ok) tRes.ok = false;
      tRes.moves.push(rec);
    }

    if ((t.moves || []).length === 0) tRes.note = '本次换场无演员走位记录';
    results.push(tRes);
    if (!tRes.ok && !firstFailure) firstFailure = tRes;
  }

  return {
    ok: !firstFailure,
    firstFailure,
    transitions: results,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = { checkPlay, shortestPath, buildAdjacency };
