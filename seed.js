'use strict';

/** 首次启动时写入一个示例剧目，便于直接体验检查功能。 */
function seedIfEmpty(db) {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM plays').get();
  if (c > 0) return;

  const seed = db.transaction(() => {
    const playId = db.prepare('INSERT INTO plays (name) VALUES (?)').run('示例剧目《茶馆》').lastInsertRowid;

    const insArea = db.prepare('INSERT INTO areas (play_id, name, x, y) VALUES (?,?,?,?)');
    const areaIds = {};
    const areaDefs = [
      ['上场口', 80, 120], ['舞台左', 220, 130], ['舞台中', 400, 120], ['舞台右', 580, 130], ['下场口', 720, 120],
      ['侧台左', 220, 300], ['侧台右', 580, 300], ['后台走廊', 400, 390], ['化妆间', 130, 400],
    ];
    for (const [name, x, y] of areaDefs) areaIds[name] = insArea.run(playId, name, x, y).lastInsertRowid;

    const insEdge = db.prepare('INSERT INTO edges (play_id, a, b, seconds) VALUES (?,?,?,?)');
    const edgeDefs = [
      ['上场口', '舞台左', 3], ['舞台左', '舞台中', 4], ['舞台中', '舞台右', 4], ['舞台右', '下场口', 3],
      ['舞台左', '侧台左', 2], ['舞台右', '侧台右', 2],
      ['侧台左', '后台走廊', 5], ['侧台右', '后台走廊', 5], ['后台走廊', '化妆间', 6],
    ];
    for (const [a, b, s] of edgeDefs) insEdge.run(playId, areaIds[a], areaIds[b], s);

    const insScene = db.prepare('INSERT INTO scenes (play_id, seq, name) VALUES (?,?,?)');
    ['第一幕', '第二幕', '第三幕'].forEach((n, i) => insScene.run(playId, i + 1, n));

    const insT = db.prepare('INSERT INTO transitions (play_id, from_seq, to_seq, duration_seconds, blocked_area_ids) VALUES (?,?,?,?,?)');
    const insM = db.prepare('INSERT INTO actor_moves (transition_id, actor, from_area_id, to_area_id) VALUES (?,?,?,?)');

    // 换场 1：第一幕 → 第二幕，30 秒，中央布景更换（舞台中不可穿越）
    const t1 = insT.run(playId, 1, 2, 30, JSON.stringify([areaIds['舞台中']])).lastInsertRowid;
    insM.run(t1, '王利发', areaIds['舞台左'], areaIds['侧台左']);   // 2s 直达
    insM.run(t1, '常四爷', areaIds['舞台右'], areaIds['化妆间']);   // 绕行 13s
    insM.run(t1, '秦仲义', areaIds['上场口'], areaIds['下场口']);   // 中路被堵，绕行 20s

    // 换场 2：第二幕 → 第三幕，10 秒，整场换景（舞台左/中/右均不可穿越）
    const t2 = insT.run(playId, 2, 3, 10, JSON.stringify([areaIds['舞台左'], areaIds['舞台中'], areaIds['舞台右']])).lastInsertRowid;
    insM.run(t2, '王利发', areaIds['侧台左'], areaIds['侧台右']);   // 恰好 10s，可行
    insM.run(t2, '常四爷', areaIds['侧台右'], areaIds['化妆间']);   // 最短 11s，超时
    insM.run(t2, '秦仲义', areaIds['化妆间'], areaIds['上场口']);   // 通道被隔断，不可达
    insM.run(t2, '庞太监', areaIds['舞台右'], areaIds['下场口']);   // 起点在不可穿越区域
  });

  seed();
  console.log('[seed] 已创建示例剧目《茶馆》');
}

module.exports = { seedIfEmpty };
