/* check.js — 程序化一致性检查（不花 token） */
(function () {
  /* 从设定里抽出人物名与硬事实 */
  function parseSetting(text) {
    const people = [];
    const names = new Set();
    if (!text) return { people, names, facts: {} };

    // 主角块：支持「姓名/身份/年龄：林默/快递员/27」和「林默 27岁」两种
    const mb = text.match(/三、主角[^\n]*\n([\s\S]*?)(?=━━━|$)/);
    if (mb) {
      let line = (mb[1].match(/姓名[\s\S]{0,8}?[：:]\s*([^\n]+)/) || [])[1] || '';
      if (!line) line = (mb[1].match(/^\s*[-·]?\s*([\u4e00-\u9fa5]{2,4})/m) || [])[1] || '';
      const first = line.split(/[\/／、，,（(\s]/)[0].trim();
      if (first && first.length >= 2 && first.length <= 4) { people.push({ name: first, role: '主角' }); names.add(first); }
    }

    // 关键人物块
    const kb = text.match(/四、关键人物[^\n]*\n([\s\S]*?)(?=━━━|$)/);
    if (kb) {
      const re = /姓名[\/／]?身份[\/／]?年龄[：:]\s*([^\n]+)/g;
      let m;
      while ((m = re.exec(kb[1]))) {
        const first = m[1].split(/[\/／、，,（(]/)[0].trim();
        if (first && first.length <= 6 && !names.has(first)) { people.push({ name: first, role: '配角' }); names.add(first); }
      }
    }
    // 兜底：从"谁欠谁/谁骗谁"里捞名字
    const rel = text.match(/六、人物关系与张力[^\n]*\n([\s\S]*?)(?=━━━|$)/);
    if (rel && people.length < 2) {
      const cands = (rel[1].match(/[\u4e00-\u9fa5]{2,3}(?=[欠骗逼替])/g) || []);
      cands.forEach(c => { if (!names.has(c) && people.length < 5) { people.push({ name: c, role: '相关人物' }); names.add(c); } });
    }

    // 性别表
    const genders = {};
    const gb = text.match(/性别速查表[^\n]*\n([\s\S]*?)(?=━━━|$)/);
    if (gb) {
      gb[1].split('\n').forEach(line => {
        const m = line.match(/^\s*[-·]?\s*([\u4e00-\u9fa5]{2,4})\s*[｜|]\s*(男|女)/);
        if (m) genders[m[1]] = m[2];
      });
    }
    // 兜底：从人物条目里抓「姓名/男/...」
    if (!Object.keys(genders).length) {
      const re = /姓名\s*[\/／]\s*(男|女)\s*[\/／]?/g;
      let m;
      const lines = text.split('\n');
      lines.forEach(line => {
        const mm = line.match(/姓名[\/／、\s]*([\u4e00-\u9fa5]{2,4})[\/／](男|女)/);
        if (mm) genders[mm[1]] = mm[2];
      });
    }
    const facts = { genders };
    const nmAge = text.match(/主角姓名与年龄[：:]\s*([^\n]+)/);
    if (nmAge) {
      const n = nmAge[1].match(/(\d{1,2})\s*岁/);
      if (n) facts.age = +n[1];
      const nm = nmAge[1].match(/^([\u4e00-\u9fa5]{2,4})/);
      if (nm) facts.mainName = nm[1];
    }
    const tm = text.match(/故事时间[：:]\s*([^\n]+)/);
    if (tm) {
      const d = tm[1].match(/(\d+)\s*天/);
      if (d) facts.days = +d[1];
      facts.timeRaw = tm[1].trim();
    }
    return { people, names, genders, facts };
  }

  /* 检查一节正文：人名误写、年龄冲突、重复段落、AI 套话 */
  function checkText(settingInfo, text, opts) {
    opts = opts || {};
    const issues = [];
    if (!text) return issues;
    const names = settingInfo.names;

    // 1. 人名误写：设定里的人名，在正文里出现了「同姓+不同字」的近似写法
    if (names.size) {
      const known = [...names];
      const surnameMap = {};
      known.forEach(n => { if (n.length >= 2) (surnameMap[n[0]] = surnameMap[n[0]] || []).push(n); });
      const re = /[\u4e00-\u9fa5]{2,3}/g;
      const seenCand = new Set();
      let m;
      while ((m = re.exec(text))) {
        const cand = m[0];
        if (known.includes(cand) || seenCand.has(cand)) continue;
        const sibs = surnameMap[cand[0]];
        if (sibs && sibs.length && cand.length === sibs[0].length) {
          // 同姓、同长度、但不是设定里的人名——可能是写错，也可能是普通人名
          const cnt = (text.split(cand).length - 1);
          if (cnt >= 2) { seenCand.add(cand); issues.push({ level: 'warn', msg: '「' + cand + '」不在设定人物表里（设定里有 ' + sibs.join('、') + '），确认是不是写错' }); }
        }
      }
    }

    // 2. 年龄冲突
    if (settingInfo.facts.age) {
      const ages = [...text.matchAll(/(\d{1,2})\s*岁/g)].map(m => +m[1]);
      const bad = ages.filter(a => Math.abs(a - settingInfo.facts.age) > 3);
      if (bad.length) issues.push({ level: 'warn', msg: `文中出现年龄 ${[...new Set(bad)].join('、')} 岁，设定里主角是 ${settingInfo.facts.age} 岁` });
    }

    // 3. 重复段落（连续 20 字以上重复出现）
    const paras = text.split(/\n+/).map(x => x.trim()).filter(x => x.length > 15);
    const seen = new Map();
    paras.forEach(p => {
      const key = p.slice(0, 30);
      if (seen.has(key)) issues.push({ level: 'error', msg: '疑似重复段落：「' + p.slice(0, 20) + '…」' });
      else seen.set(key, 1);
    });
    // 句子级重复
    const sents = text.split(/[。！？\n]/).map(x => x.trim()).filter(x => x.length >= 14);
    const sc = new Map();
    sents.forEach(x => sc.set(x, (sc.get(x) || 0) + 1));
    sc.forEach((v, k) => { if (v >= 2) issues.push({ level: 'warn', msg: '同一句出现 ' + v + ' 次：「' + k.slice(0, 18) + '…」' }); });

    // 4. AI 套话
    const cliche = ['不禁', '不由得', '心中一颤', '宛如', '仿佛', '嘴角勾起', '与此同时', '心中暗想', '若有所思'];
    const found = cliche.filter(w => text.includes(w));
    if (found.length) issues.push({ level: 'warn', msg: 'AI 套话：' + found.join('、') });

    // 4.5 人称错误：名字后面第一句的人称是否符合性别
    if (settingInfo.genders && Object.keys(settingInfo.genders).length) {
      Object.keys(settingInfo.genders).forEach(name => {
        const g = settingInfo.genders[name];
        const wrong = g === '男' ? '她' : '他';
        const right = g === '男' ? '他' : '她';
        // 名字后面 25 字内的第一个第三人称
        const re = new RegExp(name + '([^。！？\n]{0,25}?)(' + wrong + ')', 'g');
        let m; let n = 0;
        while ((m = re.exec(text))) {
          // 跳过"她"后面紧跟的引号对白里的另一个角色
          n++;
          if (n >= 1) {
            issues.push({ level: 'error', msg: `人称可能写错：「${name}」设定为${g}性，但这里用了「${wrong}」—— …${m[0].slice(0, 24)}…` });
            break;
          }
        }
      });
    }

    // 5. 超长段
    paras.forEach(p => { if (p.length > 160) issues.push({ level: 'warn', msg: '超长段落（' + p.length + ' 字），建议拆开' }); });

    // 6. 设置里禁写的人物类型
    if (opts.banned && opts.banned.length) {
      opts.banned.forEach(b => { if (b && text.includes(b)) issues.push({ level: 'warn', msg: '出现禁写内容：「' + b + '」' }); });
    }

    return issues;
  }

  /* 从设定里抽禁写清单 */
  function parseBanned(settingText) {
    const m = settingText && settingText.match(/十、禁写清单[^\n]*\n([\s\S]*?)(?=━━━|$)/);
    if (!m) return [];
    return (m[1].match(/[：:]\s*([^\n，。]{2,10})/g) || []).map(x => x.replace(/[：:]\s*/, '').trim()).filter(Boolean);
  }

  window.CHECK = { parseSetting, checkText, parseBanned };
})();
