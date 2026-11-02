/* engine.js — 流程编排：拼上下文、生成、解析 */
(function () {
  function briefText(b) {
    const L = [];
    if (b.genre) L.push('题材：' + b.genre);
    if (b.tags) L.push('标签：' + b.tags);
    if (b.idea) L.push('我的想法：' + b.idea);
    if (b.pov) L.push('人称视角：' + b.pov);
    if (b.style) L.push('文风要求：' + b.style);
    if (b.avoid) L.push('不要写的：' + b.avoid);
    return L.join('\n');
  }

  function tierInfo(p) {
    const T = window.TIERS || {};
    const t = T[p.tier] || T.m;
    if (!t) return { name: '短篇·中', words: 10000, parts: 5, min: 8000, max: 12000 };
    return { name: t.name, words: Math.round((t.min + t.max) / 2), parts: t.parts, min: t.min, max: t.max };
  }

  function cur(p, step) {
    const s = p.steps[step];
    return s && s.versions[s.sel] ? s.versions[s.sel].text : '';
  }

  function fbText(s) {
    const f = (s.feedback || '').trim();
    return f ? '作者的意见（必须照改）：\n' + f : '';
  }

  /* 拆分正文为节：[{title, body}] */
  function splitParts(text) {
    if (!text) return [];
    const lines = text.split('\n');
    const parts = [];
    let c = null;
    const isHead = (ln) => {
      const s = ln.trim();
      if (!s || s.length > 30) return false;
      return /^(第[一二三四五六七八九十百零\d]+[节章回]|[\d]+[、.．]\s|[一二三四五六七八九十]+[、.]\s?)/.test(s) || /^[\d]+$/.test(s);
    };
    for (const ln of lines) {
      if (isHead(ln) && (c === null || c.body.trim())) {
        if (c) parts.push(c);
        c = { title: ln.trim(), body: '' };
      } else {
        if (!c) c = { title: '', body: '' };
        c.body += ln + '\n';
      }
    }
    if (c) parts.push(c);
    const out = parts.filter(x => x.body.trim() || x.title);
    return out.map((x, i) => ({ title: x.title || '第' + (i + 1) + '节', body: x.body.trim() }));
  }

  /* 从大纲里抓每节的预计字数 */
  function outlinePlan(outlineText) {
    const parts = splitParts(outlineText);
    return parts.map((p, i) => {
      const m = p.title.match(/(\d+)/) ? (p.body.match(/约\s*(\d+)\s*字/) || p.title.match(/(\d+)\s*字/)) : null;
      return { title: p.title, words: m ? +m[1] : 0 };
    });
  }

  function countWords(s) {
    if (!s) return 0;
    const cn = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
    const en = (s.match(/[A-Za-z0-9]+/g) || []).length;
    return cn + en;
  }

  /* 生成一个工序的一条候选 */
  async function genStep(p, step, onDelta, signal) {
    const P = PROMPTS.get();
    const t = tierInfo(p);
    const fb = fbText(p.steps[step]);
    const brief = briefText(p.brief);
    let user = '';
    if (step === 'topic') {
      user = PROMPTS.fill(P.topic, { brief, tier: t.name, words: t.words, parts: t.parts, feedback: fb });
    } else if (step === 'setting') {
      user = PROMPTS.fill(P.setting, { topic: window.pickedTopic ? window.pickedTopic() : cur(p, 'topic'), brief, tier: t.name, words: t.words, parts: t.parts, feedback: fb });
    } else if (step === 'outline') {
      user = PROMPTS.fill(P.outline, { topic: cur(p, 'topic'), setting: cur(p, 'setting'), brief, tier: t.name, words: t.words, parts: t.parts, feedback: fb });
    } else if (step === 'polish') {
      user = PROMPTS.fill(P.polish, { draft: cur(p, 'draft'), words: t.words, feedback: fb });
    }
    return API.chat({ messages: API.buildMessages(P.system, user), onDelta, signal });
  }

  /* 生成某一节正文 */
  async function genPart(p, idx, onDelta, signal) {
    const P = PROMPTS.get();
    const t = tierInfo(p);
    const plan = outlinePlan(cur(p, 'outline'));
    const draft = p.steps.draft;
    const parts = draft.parts || [];
    const partTitle = (plan[idx] && plan[idx].title) || ('第' + (idx + 1) + '节');
    const partWords = (plan[idx] && plan[idx].words) || Math.round(t.words / Math.max(t.parts, plan.length || t.parts));
    const prev = parts.slice(0, idx).map(x => x.title + '\n' + x.body).join('\n\n').slice(-2500);
    const fb = fbText(draft);
    const user = PROMPTS.fill(P.draft, {
      topic: cur(p, 'topic'),
      setting: cur(p, 'setting'),
      outline: cur(p, 'outline'),
      prev: prev,
      brief: briefText(p.brief),
      partTitle,
      partWords,
      feedback: fb
    });
    return API.chat({ messages: API.buildMessages(P.system, user), onDelta, signal });
  }

  /* 逐节自动写：从 startIdx 开始，回调进度 */
  async function autoDraft(p, startIdx, hooks) {
    const plan = outlinePlan(cur(p, 'outline'));
    const total = plan.length || tierInfo(p).parts;
    p.steps.draft.parts = p.steps.draft.parts || [];
    for (let i = startIdx; i < total; i++) {
      if (hooks.cancelled()) throw new Error('已停止');
      const r = await genPart(p, i, (d, full) => hooks.onDelta && hooks.onDelta(i, d, full), hooks.signal);
      p.steps.draft.parts[i] = { title: (plan[i] && plan[i].title) || ('第' + (i + 1) + '节'), body: r.trim() };
      p.steps.draft.partIdx = i;
      Store.save(p);
      hooks.onPartDone && hooks.onPartDone(i, p);
    }
    p.steps.draft.versions = [{ text: joinDraft(p), at: Date.now() }];
    p.steps.draft.sel = 0;
    p.steps.draft.status = 'ready';
    Store.save(p);
    return p;
  }

  function joinDraft(p) {
    return (p.steps.draft.parts || []).map(x => x.title + '\n' + x.body).join('\n\n').trim();
  }

  window.Engine = { briefText, tierInfo, cur, splitParts, outlinePlan, countWords, genStep, genPart, autoDraft, joinDraft };
})();
