'use strict';

/** 由检查结果生成可下载的纯文本报告。 */
function buildTextReport(playName, result) {
  const L = [];
  const line = (s = '') => L.push(s);

  const title = playName.includes('《') ? playName : `《${playName}》`;
  line(`话剧${title}走位连续性检查报告`);
  line(`生成时间：${result.checkedAt}`);
  line('='.repeat(48));
  line(`总体结果：${result.ok ? '全部转场可行' : '存在不可能转场'}`);
  if (result.firstFailure) {
    const f = result.firstFailure;
    line(`首个不可能转场：第${f.fromSeq}场「${f.fromScene}」 → 第${f.toSeq}场「${f.toScene}」（换场时长 ${f.durationSeconds}s）`);
  }
  line('');

  for (const t of result.transitions) {
    const blocked = t.blockedNames.length ? `，不可穿越：${t.blockedNames.join('、')}` : '';
    const mark = t.ok ? '[可行]' : '[不可行]';
    line(`${mark} 第${t.fromSeq}场「${t.fromScene}」 → 第${t.toSeq}场「${t.toScene}」（换场时长 ${t.durationSeconds}s${blocked}）`);
    if (t.note) line(`    ${t.note}`);
    for (const m of t.moves) {
      const flag = m.ok ? '  ✔' : '  ✘';
      const cost = m.cost == null ? '' : `｜最短耗时 ${m.cost}s`;
      const path = m.pathNames.length ? `｜路径：${m.pathNames.join(' → ')}` : '';
      line(`${flag} ${m.actor}：${m.fromName || '?'} → ${m.toName || '?'}${cost}${path}`);
      line(`      ${m.ok ? '结论' : '阻断原因'}：${m.reason}`);
    }
    line('');
  }

  return L.join('\n');
}

module.exports = { buildTextReport };
