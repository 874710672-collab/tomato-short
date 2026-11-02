/* trends.js — 番茄热门方向库（来源：作家课堂官方文章，可编辑可更新） */
(function () {
  // 内置方向卡：数据来自作家课堂原文的结构化摘要
  const SEED = [
    {
      id: 't31-1',
      src: '第31期 · 四大热门方向',
      srcId: '7670363158518693950',
      srcDate: '2025',
      name: '重生/弹幕预警 + 逆袭反转 + 亲情向',
      parts: ['重生', '弹幕预警', '逆袭反转', '萌娃/换子/婴语'],
      core: '提前知道结局的人，靠信息差翻盘；读者跟着一起“开天眼”',
      hook: '弹幕把后面的剧情提前泄露一句，读者立刻想知道怎么翻',
      emotion: '憋屈 → 炫耀式爽',
      best: 's,m',
      risk: '弹幕写太多会变成解说，人物变工具人；萌娃容易写成卖萌拖节奏',
      on: true
    },
    {
      id: 't31-2',
      src: '第31期 · 四大热门方向',
      srcId: '7670363158518693950',
      name: '现言 + 微创新切入点 + 追妻火葬场',
      parts: ['现言', '接地气切入点', '追妻火葬场'],
      core: '把老套的追妻火葬场，换一个没人写过的小切口身份或场景',
      hook: '一个具体的、日常的身份，让“离开”变得有分量',
      emotion: '先委屈 → 后痛快 → 略带唏嘘',
      best: 's,m',
      risk: '容易写成女主反复拉扯；男主悔悟太晚显得假',
      on: true
    },
    {
      id: 't31-3',
      src: '第31期 · 四大热门方向',
      srcId: '7670363158518693950',
      name: '世情 + 逆袭反转 + 重生复仇/延后复仇',
      parts: ['世情', '逆袭反转', '重生复仇', '延后复仇'],
      core: '不急着报复，把复仇延后，先活成对方够不着的样子',
      hook: '读者知道她要报复，但她一直不动手，张力全靠憋',
      emotion: '压抑 → 释放 → 从容',
      best: 'm,l',
      risk: '复仇拖太久会失去耐心；反派降智会显得廉价',
      on: true
    },
    {
      id: 't31-4',
      src: '第31期 · 四大热门方向',
      srcId: '7670363158518693950',
      name: '真假千金 + 反差人设',
      parts: ['真假千金', '反差人设'],
      core: '身份错位 + 人设与身份不匹配的反差',
      hook: '“真千金”比“假千金”更不像千金，反差就是钩子',
      emotion: '被轻视 → 打脸 → 认同',
      best: 's,m',
      risk: '同类太多，必须有一个人设反差是别人没写过的',
      on: true
    },
    {
      id: 't40-1',
      src: '第40期 · 三大热门方向',
      srcId: '7697081389316833342',
      srcDate: '2026-10-16',
      name: '追妻火葬场 + 弹幕/攻守互换 + 先虐后爽',
      parts: ['追妻火葬场', '弹幕', '攻守互换', '情绪流'],
      core: '把“离开”写成清醒而不是崩溃：取消婚礼、整理账单、拉黑亲属、接下搁置的工作，没有一句“我恨你”，句句是“我看清了”',
      hook: '克制本身就是爽点，用行动代替哭闹',
      emotion: '憋屈 → 心痛 → 利落爽',
      best: 's,m',
      risk: '落入激烈对峙、反复拉扯的套路；女主一哭就垮',
      on: true
    },
    {
      id: 't40-2',
      src: '第40期 · 三大热门方向',
      srcId: '7697081389316833342',
      srcDate: '2026-10-16',
      name: '夸张数字切入点 + 反转打脸 + 强内核主人公',
      parts: ['夸张数字', '反转打脸', '强内核'],
      core: '标题和开头用一个夸张的数字制造噱头，正文再用内核撑住',
      hook: '数字越离谱，读者越想点进来看你怎么圆',
      emotion: '被看轻 → 反杀',
      best: 's,m',
      risk: '只玩数字不写内核，开头三章就崩；打脸来得太顺则不痛',
      on: true
    },
    {
      id: 't40-3',
      src: '第40期 · 三大热门方向',
      srcId: '7697081389316833342',
      srcDate: '2026-10-16',
      name: '古风世情 + 清醒大女主 + 权谋宅斗 + 延时复仇',
      parts: ['古风世情', '清醒大女主', '权谋宅斗', '延时复仇'],
      core: '复仇后不彻底清算，让反派自食其果，收在格局和清醒上',
      hook: '身居高位却慢慢来，读者等着看她什么时候出手',
      emotion: '压抑 → 一步步翻盘 → 从容收场',
      best: 'm,l',
      risk: '宅斗写细就拖；结局清算过头会掉档次',
      on: true
    }
  ];

  function getCustom() {
    try { return JSON.parse(localStorage.getItem('ts_trends_v1') || '[]'); } catch (e) { return []; }
  }
  function setCustom(list) { localStorage.setItem('ts_trends_v1', JSON.stringify(list)); }

  /* 已删除的内置方向（用户删掉的不要每次又冒出来） */
  function getHidden() {
    try { return JSON.parse(localStorage.getItem('ts_trends_hidden') || '[]'); } catch (e) { return []; }
  }
  function hide(id) {
    const h = getHidden(); if (!h.includes(id)) { h.push(id); localStorage.setItem('ts_trends_hidden', JSON.stringify(h)); }
  }

  function all() {
    const hidden = getHidden();
    const seen = new Set();
    const out = [];
    getCustom().forEach(c => { out.push(c); seen.add(c.id); });
    SEED.forEach(s => {
      if (hidden.includes(s.id) || seen.has(s.id)) return;
      // 用户改过的内置方向优先
      const edited = getCustom().find(c => c.id === s.id);
      out.push(edited || Object.assign({}, s));
    });
    return out;
  }

  function upsert(card) {
    const list = getCustom();
    const i = list.findIndex(c => c.id === card.id);
    if (i >= 0) list[i] = card; else list.unshift(card);
    setCustom(list);
  }

  function remove(id) {
    const list = getCustom().filter(c => c.id !== id);
    setCustom(list);
    if (SEED.some(s => s.id === id)) hide(id);
  }

  function source(id) {
    return SEED.find(s => s.id === id) || null;
  }

  /* 供提示词用：把方向卡压成紧凑文本 */
  function brief(cards) {
    return cards.map((c, i) =>
      `${i + 1}. ${c.name}\n   组成：${(c.parts || []).join(' / ')}\n   内核：${c.core}\n   情绪：${c.emotion}\n   易崩：${c.risk}`
    ).join('\n');
  }


  /* ---------- 自动发现新课堂 ---------- */
  // 候选文章池：从官方页面/搜索里已知的文章 ID。App 打开时逐个探测标题。
  const KNOWN_IDS = (function () {
    try { return JSON.parse(localStorage.getItem('ts_known_ids') || 'null') || null; } catch (e) { return null; }
  })() || ['7670363158518693950', '7697081389316833342'];

  function articleUrl(id) { return 'https://fanqienovel.com/writer/zone/article/' + id; }

  /* 从抓到的 HTML 里抽出标题与正文纯文本 */
  function parseArticleHTML(t) {
    let title = '';
    const mt = t.match(/"title":"((?:[^"\\]|\\.){2,120})"/);
    if (mt) { try { title = JSON.parse('"' + mt[1] + '"'); } catch (e) { title = mt[1]; } }
    let s = '';
    const mc = t.match(/"content":"((?:[^"\\]|\\.)*)"/);
    if (mc) {
      try {
        s = mc[1].encode('utf-8').toString();
        s = JSON.parse('"' + mc[1] + '"');
      } catch (e) { s = mc[1]; }
      s = s.replace(/<[^>]+>/g, '\n');
      s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      s = s.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
    }
    return { title, text: s };
  }

  /* 探测一个 ID 是否存在、是不是课堂文章 */
  async function probe(id) {
    try {
      const r = await fetch(articleUrl(id), { mode: 'cors' });
      if (!r.ok) return null;
      const html = await r.text();
      if (html.length < 30000) return null;
      const m = html.match(/作家课堂[^"<\\]{0,20}/);
      return { id, isClass: !!m };
    } catch (e) { return { id, err: String(e) }; }
  }

  /* 记录已知 ID，供下次探测 */
  function rememberId(id) {
    const list = KNOWN_IDS.slice();
    if (!list.includes(id)) list.push(id);
    localStorage.setItem('ts_known_ids', JSON.stringify(list));
  }
  function knownIds() { return KNOWN_IDS; }

  window.TRENDS = { SEED, all, upsert, remove, source, brief, getCustom, getHidden, parseArticleHTML, probe, rememberId, knownIds, articleUrl };
})();
