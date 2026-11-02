/* app.js — 界面与流程控制（分段写入，见文件末尾分段标记） */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt !== undefined) n.textContent = txt;
    return n;
  };
  const stage = $('#stage');
  const els = {
    project: $('#tbProject'), sub: $('#tbSub'), steps: $('#steps'),
    dockInfo: $('#dockInfo'), bGen: $('#btnGen'), bRegen: $('#btnRegen'),
    bApprove: $('#btnApprove'), bStop: $('#btnStop')
  };

  let cur = Store.current();
  var app = { streamEl: null };
  let busy = null;          // 当前生成状态 {ctrl, step, text}
  let view = 'home';        // project | home | settings
  let manualEdit = {};      // 人工手改缓存 {step: text}

  /* ---------- 工具 ---------- */
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._h);
    toast._h = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function lockScroll(on) {
    document.body.style.overflow = on ? 'hidden' : '';
  }
  function sheet(html, onMount) {
    const s = $('#sheet');
    $('#sheetBody').innerHTML = html;
    s.hidden = false;
    s.classList.remove('hide');
    lockScroll(true);
    const close = $('.close', $('#sheetBody'));
    if (close) close.onclick = () => closeSheet();
    s.onclick = (e) => { if (e.target === s) closeSheet(); };
    if (onMount) onMount($('#sheetBody'));
  }
  function closeSheet() { $('#sheet').hidden = true; $('#sheet').classList.add('hide'); lockScroll(false); }
  function fmtTime(ts) {
    const d = new Date(ts);
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
  }
  function persist() {
    if (!cur) return;
    if (!Store.save(cur)) toast('保存失败：存储空间可能已满，请先导出备份');
  }

  /* 保存当前屏幕上的手改内容 */
  function flushEdits() {
    if (!cur) return;
    const ta = $('textarea[data-manual]');
    const ed = $('#manualEdit');
    if (ed && ed.dataset.step === cur.step) {
      const s = cur.steps[ed.dataset.step];
      if (s.versions[s.sel]) s.versions[s.sel].text = ed.value;
      manualEdit[ed.dataset.step] = ed.value;
    }
    persist();
  }

  window.addEventListener('beforeunload', flushEdits);
  /* ===== 顶部与步骤条 ===== */
  function renderTop() {
    if (view === 'home') { els.project.textContent = '短篇工坊'; els.sub.textContent = '共 ' + Store.projects().length + ' 个项目'; return; }
    if (view === 'settings') { els.project.textContent = '设置'; els.sub.textContent = '接口与提示词'; return; }
    if (!cur) { els.project.textContent = '短篇工坊'; els.sub.textContent = '还没有项目'; return; }
    const t = Engine.tierInfo(cur);
    els.project.textContent = cur.title;
    els.sub.textContent = `${STEP_NAME[cur.step]} · 第${STEP_ORDER.indexOf(cur.step) + 1}/5 步 · ${t.name} 约${t.words}字`;
  }

  function stepState(p, k) {
    const s = p.steps[k];
    if (s.status === 'done') return 'ok';
    if (s.status === 'ready') return 'ok';
    return '';
  }

  function renderSteps() {
    els.steps.innerHTML = '';
    if (view !== 'project' || !cur) { els.steps.hidden = true; return; }
    els.steps.hidden = false;
    STEP_ORDER.forEach((k, i) => {
      const c = el('button', 'step-chip ' + (cur.step === k ? 'cur ' : '') + stepState(cur, k));
      c.appendChild(el('span', 'dot'));
      c.appendChild(el('span', '', (i + 1) + ' ' + STEP_NAME[k]));
      c.onclick = () => {
        if (busy) { toast('正在生成，先等一下'); return; }
        const target = STEP_ORDER.indexOf(k);
        const curIdx = STEP_ORDER.indexOf(cur.step);
        if (target > curIdx + 0 && cur.steps[cur.step].status !== 'done' && target !== curIdx) {
          // 允许回看已完成的，往前跳需要当前步通过
          if (target !== curIdx && !STEP_ORDER.slice(0, target).every(x => cur.steps[x].status === 'done')) {
            if (!confirm('前面的环节还没通过，仍然要跳到「' + STEP_NAME[k] + '」吗？')) return;
          }
        }
        flushEdits();
        cur.step = k;
        persist();
        render();
      };
      els.steps.appendChild(c);
    });
  }

  function render() {
    flushEdits();
    renderTop();
    renderSteps();
    $('#btnExport').hidden = !(view === 'project' && cur);
    $('#btnSet').hidden = view === 'settings';
    $('#dock').classList.toggle('empty', !(view === 'project' && cur));
    els.bStop.hidden = !busy;
    if (view === 'home') { renderHome(); return; }
    if (view === 'settings') { renderSettings(); return; }
    if (!cur) { renderEmpty(); return; }
    const k = cur.step;
    stage.innerHTML = '';
    const wrap = el('div');
    stage.appendChild(wrap);
    renderBrief(wrap);
    if (k === 'draft') renderDraft(wrap); else renderStepDoc(wrap, k);
    updateDock();
  }

  function updateDock() {
    const has = !!(cur && Engine.cur(cur, cur.step)) || !!(cur && cur.step === 'draft' && (cur.steps.draft.parts || []).length);
    const s = cur && cur.steps[cur.step];
    els.bGen.hidden = !!busy;
    if (cur) {
      const has = cur.steps[cur.step].status !== 'idle';
      els.bGen.textContent = cur.step === 'draft'
        ? ((cur.steps.draft.parts && cur.steps.draft.parts[cur.steps.draft.partIdx || 0]) ? '重写本节' : '写这一节')
        : (has ? '再生成一版' : '生成');
      els.bApprove.textContent = cur.step === 'polish' ? '定稿 · 完成'
        : cur.step === 'draft' ? '正文写完 · 进入润色'
        : '通过 · 进入下一环节';
    }
    els.bRegen.hidden = !!busy || (!has && cur.step !== 'draft');
    els.bApprove.hidden = !!busy || !s || !s.status || s.status === 'idle';
    els.bApprove.textContent = cur && cur.step === 'polish' ? '定稿 · 完成' : '通过 · 进入下一环节';
    if (busy) {
      const n = Engine.countWords(busy.text || '');
      els.dockInfo.textContent = busy.label + ' · 已生成 ' + n + ' 字';
    } else if (cur) {
      const total = Engine.countWords(Engine.cur(cur, cur.step));
      const t = Engine.tierInfo(cur);
      els.dockInfo.textContent = s && s.status !== 'idle'
        ? `目标 ${t.words} 字 · 当前 ${total} 字 · ${s.status === 'done' ? '已通过' : '待审核'}`
        : '填好左侧简报后点「生成」';
    }
  }
  /* ===== 简报 ===== */
  function renderBrief(root) {
    const c = el('div', 'card');
    const h = el('div', 'brief-head');
    const h3 = el('h3', '', '创作简报');
    const tw = el('input');
    tw.className = 'title-in';
    tw.placeholder = '标题';
    tw.value = cur.title;
    tw.oninput = () => { cur.title = tw.value || '未命名短篇'; persist(); renderTop(); };
    if (tw.value === '未命名短篇') tw.value = '';
    const hwrap = el('div', 'brief-title');
    hwrap.appendChild(h3); hwrap.appendChild(tw);
    h.appendChild(hwrap);
    tw.onblur = () => { if (!tw.value.trim()) tw.value = cur.title; };
    const btn = el('button', 'mini', '收起');
    h.appendChild(btn);
    c.appendChild(h);
    const body = el('div', 'brief-body');
    c.appendChild(body);
    btn.onclick = () => {
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      btn.textContent = open ? '展开' : '收起';
    };
    const b = cur.brief;
    const mk = (key, label, ph, area) => {
      const f = el('div', 'field');
      f.appendChild(el('label', '', label));
      const i = area ? el('textarea') : el('input');
      if (area) i.rows = 2; else i.type = 'text';
      i.placeholder = ph || '';
      i.value = b[key] || '';
      i.oninput = () => { b[key] = i.value; persist(); };
      f.appendChild(i);
      return f;
    };
    const g = el('div', 'grid3');
    g.appendChild(mk('genre', '题材', '悬疑 / 都市异闻 / 女频爽文…'));
    g.appendChild(mk('tags', '标签', '反转、追妻火葬场、动物异闻…'));
    const pf = el('div', 'field');
    pf.appendChild(el('label', '', '人称视角'));
    const ps = el('select');
    ['第三人称', '第一人称', '双视角交替'].forEach(v => {
      const o = el('option', '', v); o.value = v; if (v === b.pov) o.selected = true; ps.appendChild(o);
    });
    ps.onchange = () => { b.pov = ps.value; persist(); };
    pf.appendChild(ps);
    g.appendChild(pf);
    body.appendChild(g);
    body.appendChild(mk('idea', '我的想法（越具体越好）', '例：一只流浪猫能替人实现一个愿望，代价是……', true));
    const g2 = el('div', 'grid2');
    g2.appendChild(mk('style', '文风要求', '碎嘴流、冷幽默、对话多…', true));
    g2.appendChild(mk('avoid', '不要写的', '不要金手指、不要大团圆、不写血腥…', true));
    body.appendChild(g2);

    const tf = el('div', 'field');
    tf.appendChild(el('label', '', '篇幅档位'));
    const tg = el('div', 'tier-row');
    Object.keys(TIERS).forEach(k => {
      const t = TIERS[k];
      const bb = el('button', 'tier-btn' + (cur.tier === k ? ' on' : ''));
      bb.innerHTML = '';
      bb.appendChild(el('b', '', t.name));
      bb.appendChild(el('span', '', t.min + '-' + t.max + ' 字 · ' + t.parts + ' 节'));
      bb.onclick = () => { flushEdits(); cur.tier = k; persist(); render(); };
      tg.appendChild(bb);
    });
    tf.appendChild(tg);
    body.appendChild(tf);
    root.appendChild(c);
  }

  /* ===== 通用工序（选题/设定/大纲/润色） ===== */
  function renderStepDoc(root, k) {
    const s = cur.steps[k];
    const wrap = el('div', 'split');
    const left = el('div');
    const right = el('div');
    wrap.appendChild(left); wrap.appendChild(right);
    root.appendChild(wrap);

    const doc = el('div', 'card');
    const head = el('h3', '', STEP_NAME[k]);
    head.appendChild(el('span', 'tag', versionTag(s)));
    doc.appendChild(head);

    if (s.versions.length > 1 || (s.status !== 'idle' && s.versions.length)) {
      const vt = el('div', 'vers');
      s.versions.forEach((v, i) => {
        const t = el('button', 'ver-tab' + (i === s.sel ? ' on' : ''), '稿 ' + (i + 1));
        t.onclick = () => { flushEdits(); s.sel = i; persist(); render(); };
        vt.appendChild(t);
      });
      doc.appendChild(vt);
    }

    const box = el('div', 'card');
    box.id = 'docBox';
    const pre = el('div', 'doc');
    const text = Engine.cur(cur, k);
    pre.textContent = text || (busy ? '' : placeholderFor(k));
    if (busy && busy.step === k) pre.classList.add('streaming');
    if (!text && !busy) pre.style.color = '#b3aa9e';
    box.appendChild(pre);
    if (text && !(busy && busy.step === k)) {
      const ea = el('div', 'doc-ops');
      const b1 = el('button', 'mini', '手动编辑');
      b1.onclick = () => toggleManual(box, pre, k);
      const b2 = el('button', 'mini', '复制');
      b2.onclick = () => copy(text);
      ea.appendChild(b1); ea.appendChild(b2);
      box.appendChild(ea);
      box.appendChild(el('div', 'words', '共 ' + Engine.countWords(text) + ' 字'));
    }
    left.appendChild(box);

    right.appendChild(reviewCard(k));
    if (k === 'outline') right.appendChild(planCard());
    if (s.history && s.history.length) right.appendChild(historyCard(s));
    right.appendChild(el('div', 'pad'));

    // 流式输出目标
    app.streamEl = pre;
  }

  function versionTag(s) {
    if (busy && false) return '';
    if (s.status === 'done') return '已通过';
    if (s.status === 'ready') return '待审核 · 稿 ' + (s.sel + 1);
    return '未生成';
  }

  function placeholderFor(k) {
    return {
      topic: '点右下角「生成」，AI 会给出 3 个选题方案。也可以先在简报里写清你的想法，命中率更高。',
      setting: '基于已通过的选题，生成设定、人物、核心矛盾与情绪爆点。',
      outline: '生成分节大纲：每节都有目标、场景、beat、情绪走向和结尾钩子。',
      draft: '大纲通过后进入正文，可逐节写、也能一键全自动。',
      polish: '全文润色成可发布的定稿。'
    }[k] || '';
  }

  function toggleManual(box, pre, k) {
    let ed = $('#manualEdit');
    if (ed) { // 保存
      const s = cur.steps[k];
      s.versions[s.sel].text = ed.value;
      pre.textContent = ed.value || '（空）';
      persist();
      ed.remove();
      return;
    }
    ed = el('textarea');
    ed.id = 'manualEdit';
    ed.dataset.step = k;
    ed.value = Engine.cur(cur, k);
    ed.style.cssText = 'width:100%;min-height:420px;line-height:1.85;border:1px solid #f3c9bb;border-radius:12px;padding:10px;';
    pre.style.display = 'none';
    box.insertBefore(ed, pre);
    ed.focus();
    box.querySelector('.doc-ops .mini').textContent = '保存修改';
  }

  function copy(t) {
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast('已复制'), () => fallbackCopy(t));
    else fallbackCopy(t);
  }
  function fallbackCopy(t) {
    const ta = el('textarea'); ta.value = t; document.body.appendChild(ta);
    ta.select(); try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('复制失败，请手动选中'); }
    ta.remove();
  }

  /* ===== 审核意见卡 ===== */
  function reviewCard(k) {
    const c = el('div', 'card review');
    c.appendChild(el('h4', '', '✍︎ 人工审核意见'));
    const ta = el('textarea');
    ta.placeholder = '写下要改的地方，越具体越好。例：第2节节奏太慢，删掉回忆段；女主不要哭，要冷着脸走掉。';
    ta.value = cur.steps[k].feedback || '';
    ta.oninput = () => { cur.steps[k].feedback = ta.value; persist(); };
    c.appendChild(ta);
    const row = el('div', 'review-row');
    const quick = [
      ['节奏太慢', '节奏太慢，砍掉铺垫和回忆，冲突提前'],
      ['人物不像', '人物说话太像同一个人，对话要拉开区分度'],
      ['AI味重', 'AI味太重，去掉升华句和形容词，多用具体动作'],
      ['不够爽', '情绪不够到位，该爆的地方要写透，别一笔带过'],
      ['开头不抓人', '开头300字不够抓人，用冲突或悬念重写开头']
    ];
    quick.forEach(([t, full]) => {
      const b = el('button', 'mini', t);
      b.onclick = () => { ta.value = (ta.value ? ta.value + '\n' : '') + full; cur.steps[k].feedback = ta.value; persist(); };
      row.appendChild(b);
    });
    c.appendChild(row);
    c.appendChild(el('div', 'hint', '意见会带上现有稿件一起发给 AI，生成新一版。可以反复改。'));
    return c;
  }

  function planCard() {
    const c = el('div', 'card');
    c.appendChild(el('h3', '', '字数分配'));
    const plan = Engine.outlinePlan(Engine.cur(cur, 'outline'));
    const t = Engine.tierInfo(cur);
    if (!plan.length) { c.appendChild(el('div', 'hint', '还没有大纲')); return c; }
    const total = plan.reduce((a, b) => a + (b.words || 0), 0);
    plan.forEach((p, i) => {
      const r = el('div', 'plan-row');
      r.appendChild(el('span', 'pn', String(i + 1)));
      r.appendChild(el('span', 'ptt', p.title));
      r.appendChild(el('span', 'pw', (p.words || Math.round(t.words / plan.length)) + '字'));
      c.appendChild(r);
    });
    c.appendChild(el('div', 'hint', `合计约 ${total || t.words} 字 · 档位目标 ${t.min}-${t.max} 字`));
    return c;
  }

  function historyCard(s) {
    const c = el('div', 'card');
    c.appendChild(el('h3', '', '历史版本'));
    s.history.forEach((h, i) => {
      const r = el('div', 'hist-row');
      r.appendChild(el('span', '', fmtTime(h.at) + ' · ' + Engine.countWords(h.text) + '字'));
      const b = el('button', 'mini', '载入');
      b.onclick = () => {
        flushEdits();
        s.history.splice(i, 1);
        s.versions.push({ text: h.text, at: Date.now() });
        s.sel = s.versions.length - 1;
        s.status = 'ready';
        persist(); render();
      };
      r.appendChild(b);
      c.appendChild(r);
    });
    return c;
  }
  /* ===== 正文工序 ===== */
  function renderDraft(root) {
    const d = cur.steps.draft;
    d.parts = d.parts || [];
    const plan = Engine.outlinePlan(Engine.cur(cur, 'outline'));
    const total = plan.length || Engine.tierInfo(cur).parts;
    const wrap = el('div', 'split');
    const left = el('div'); const right = el('div');
    wrap.appendChild(left); wrap.appendChild(right);
    root.appendChild(wrap);

    // 左：当前节内容
    const card = el('div', 'card');
    const idx = Math.min(d.partIdx || 0, total - 1);
    const curPart = d.parts[idx];
    const head = el('h3', '', '正文 · 第' + (idx + 1) + ' / ' + total + ' 节');
    head.appendChild(el('span', 'tag', curPart ? Engine.countWords(curPart.body) + ' 字' : '未写'));
    card.appendChild(head);
    if (curPart) {
      const pre = el('div', 'doc');
      pre.textContent = curPart.body;
      if (busy && busy.step === 'draft' && busy.partIdx === idx) pre.classList.add('streaming');
      card.appendChild(pre);
    } else {
      const pre = el('div', 'doc');
      pre.textContent = busy && busy.step === 'draft' ? '' : '这一节还没写。点「生成」写这一节，或点「全自动」。';
      pre.style.color = '#b3aa9e';
      if (busy && busy.step === 'draft') pre.classList.add('streaming');
      card.appendChild(pre);
    }
    const ops = el('div', 'doc-ops');
    const rewrite = el('button', 'mini', '带意见重写本节');
    rewrite.onclick = () => doDraftPart(idx, true);
    const nextp = el('button', 'mini', '下一节');
    nextp.onclick = () => { if (idx < total - 1) { flushEdits(); d.partIdx = idx + 1; persist(); render(); } };
    const prevp = el('button', 'mini', '上一节');
    prevp.onclick = () => { if (idx > 0) { flushEdits(); d.partIdx = idx - 1; persist(); render(); } };
    ops.appendChild(prevp); ops.appendChild(nextp); ops.appendChild(rewrite);
    card.appendChild(ops);
    left.appendChild(card);
    app.streamEl = card.querySelector('.doc');

    // 右：节列表 + 总控 + 审核
    const listC = el('div', 'card');
    listC.appendChild(el('h3', '', '分节进度'));
    const pr = el('div', 'parts');
    for (let i = 0; i < total; i++) {
      const pt = d.parts[i];
      const row = el('div', 'part-row' + (i === idx ? ' on' : '') + (pt ? ' done' : ''));
      row.appendChild(el('span', 'pi', pt ? '✓' : String(i + 1)));
      const title = (plan[i] && plan[i].title) || (pt && pt.title) || '第' + (i + 1) + '节';
      row.appendChild(el('span', 'pt', title.replace(/\s*\d+节\s*\|?/, ' ').trim() || title));
      row.appendChild(el('span', 'pw', pt ? Engine.countWords(pt.body) + '字' : ((plan[i] && plan[i].words) ? plan[i].words + '字' : '')));
      row.onclick = () => { flushEdits(); d.partIdx = i; persist(); render(); };
      pr.appendChild(row);
    }
    listC.appendChild(pr);
    const totalWords = d.parts.reduce((a, p) => a + (p ? Engine.countWords(p.body) : 0), 0);
    const t = Engine.tierInfo(cur);
    listC.appendChild(el('div', 'words', `已写 ${d.parts.filter(Boolean).length}/${total} 节，合计 ${totalWords} 字（目标 ${t.words} 字）`));
    const auto = el('button', 'primary-btn wide', busy ? '生成中…' : (d.parts.filter(Boolean).length ? '全自动续写剩余节' : '全自动写完所有节'));
    auto.style.marginTop = '10px';
    auto.onclick = () => doAutoDraft();
    auto.disabled = !!busy;
    listC.appendChild(auto);
    right.appendChild(listC);
    right.appendChild(reviewCard('draft'));
  }

  /* ===== 生成动作 ===== */
  function setBusy(label, step) {
    busy = { ctrl: new AbortController(), label, step, text: '' };
    render();
  }
  function endBusy(err) {
    busy = null;
    if (err) { toast(err.message || String(err)); }
    persist();
    render();
  }

  async function doGen(k, extraFeedback) {
    if (busy) return;
    if (!Store.cfg().apiKey) { openSettings(); toast('先填 API Key'); return; }
    flushEdits();
    const s = cur.steps[k];
    const cards = Math.max(1, Math.min(4, Store.cfg().cards || 1));
    setBusy('正在生成' + STEP_NAME[k], k);
    const fbSave = s.feedback;
    if (extraFeedback) s.feedback = extraFeedback;
    try {
      for (let i = 0; i < cards; i++) {
        if (busy.ctrl.signal.aborted) throw new Error('已停止');
        busy.label = cards > 1 ? `正在生成${STEP_NAME[k]}（${i + 1}/${cards}）` : '正在生成' + STEP_NAME[k];
        busy.text = '';
        app.streamEl && app.streamEl.textContent === '' ;
        const out = await Engine.genStep(cur, k, (d, full) => {
          busy.text = full;
          if (app.streamEl) app.streamEl.textContent = full;
          updateDock();
        }, busy.ctrl.signal);
        s.versions.push({ text: out.trim(), at: Date.now() });
        s.sel = s.versions.length - 1;
        s.status = 'ready';
        s.feedback = '';
        persist();
      }
      s.history = s.history || [];
      s.feedback = '';
      endBusy();
    } catch (e) {
      s.feedback = fbSave;
      endBusy(e);
    }
  }

  async function doRegen() {
    if (!cur) return;
    flushEdits();
    const k = cur.step;
    if (k === 'draft') return doDraftPart(cur.steps.draft.partIdx || 0, true);
    const s = cur.steps[k];
    const old = Engine.cur(cur, k);
    const fb = (s.feedback || '').trim();
    if (old && !fb) {
      if (!confirm('这次没有写审核意见，AI 会重新独立生成一版。继续？')) return;
    }
    if (old) { s.history = s.history || []; s.history.unshift({ text: old, at: Date.now() }); if (s.history.length > 8) s.history.length = 8; }
    await doGen(k, fb ? undefined : '（请在上一版基础上写得更好，但不要重复上一版的表达）');
  }

  async function doDraftPart(idx, withFeedback) {
    if (busy) return;
    if (!Store.cfg().apiKey) { openSettings(); return; }
    flushEdits();
    const d = cur.steps.draft;
    d.feedback = withFeedback ? d.feedback : '';
    const old = d.parts[idx];
    if (old) {
      d.history = d.history || [];
      d.history = d.history || [];
      d.history.unshift({ text: old.title + '\n' + old.body, at: Date.now() });
      if (d.history.length > 12) d.history.length = 12;
    }
    setBusy('正在写第' + (idx + 1) + '节', 'draft');
    busy.partIdx = idx;
    try {
      const out = await Engine.genPart(cur, idx, (dd, full) => {
        busy.text = full;
        if (app.streamEl) app.streamEl.textContent = full;
        updateDock();
      }, busy.ctrl.signal);
      const plan = Engine.outlinePlan(Engine.cur(cur, 'outline'));
      d.parts[idx] = { title: (plan[idx] && plan[idx].title) || ('第' + (idx + 1) + '节'), body: out.trim() };
      d.partIdx = idx;
      d.status = 'ready';
      d.feedback = '';
      endBusy();
    } catch (e) { endBusy(e); }
  }

  async function doAutoDraft() {
    if (busy) return;
    if (!Store.cfg().apiKey) { openSettings(); return; }
    flushEdits();
    const d = cur.steps.draft;
    d.parts = d.parts || [];
    const plan = Engine.outlinePlan(Engine.cur(cur, 'outline'));
    const total = plan.length || Engine.tierInfo(cur).parts;
    let start = 0;
    while (start < total && d.parts[start]) start++;
    if (start >= total) start = 0;
    const meta = { label: '正在写第' + (start + 1) + '节', step: 'draft', text: '', ctrl: new AbortController(), partIdx: start };
    busy = meta;
    render();
    try {
      await Engine.autoDraft(cur, start, {
        cancelled: () => busy && busy.ctrl.signal.aborted,
        signal: meta.ctrl.signal,
        onDelta: (i, dd, full) => {
          busy.label = '正在写第' + (i + 1) + ' / ' + total + ' 节';
          busy.text = full;
          busy.partIdx = i;
          if (app.streamEl) app.streamEl.textContent = full;
          updateDock();
        },
        onPartDone: (i, p) => { busy.partIdx = i + 1; d.partIdx = Math.min(i + 1, total - 1); }
      });
      d.status = 'ready';
      endBusy();
    } catch (e) { endBusy(e); }
  }

  function doApprove() {
    if (busy || !cur) return;
    flushEdits();
    const k = cur.step;
    const s = cur.steps[k];
    if (!Engine.cur(cur, k) && !(k === 'draft' && (s.parts || []).length)) { toast('还没有内容'); return; }
    if (k === 'draft') {
      const plan = Engine.outlinePlan(Engine.cur(cur, 'outline'));
      const total = plan.length || Engine.tierInfo(cur).parts;
      if ((s.parts || []).length < total) { if (!confirm('还有节没写完，仍然通过？')) return; }
      s.versions = [{ text: Engine.joinDraft(cur), at: Date.now() }];
      s.sel = 0;
    }
    s.status = 'done';
    const i = STEP_ORDER.indexOf(k);
    if (i < STEP_ORDER.length - 1) cur.step = STEP_ORDER[i + 1];
    persist();
    toast('已通过，进入「' + STEP_NAME[cur.step] + '」');
    render();
  }
  /* ===== 空状态 ===== */
  function renderEmpty() {
    stage.innerHTML = '';
    const c = el('div', 'card empty-home');
    c.appendChild(el('h3', '', '还没有打开任何项目'));
    const b = el('button', 'primary-btn', '新建一个短篇');
    b.onclick = () => {
      const p = newProject();
      Store.save(p); Store.setCurrent(p.id); cur = p; view = 'project'; render();
    };
    c.appendChild(b);
    stage.appendChild(c);
  }

  /* ===== 事件绑定 ===== */
  $('#btnHome').onclick = () => {
    if (busy) { toast('正在生成，先停一下'); return; }
    if (view === 'home') { view = cur ? 'project' : 'home'; } else { flushEdits(); view = 'home'; }
    render();
  };
  $('#btnSet').onclick = openSettings;
  $('#btnExport').onclick = openExport;
  els.bGen.onclick = () => {
    if (!cur) return;
    if (cur.step === 'draft') doDraftPart(cur.steps.draft.partIdx || 0, false);
    else doGen(cur.step);
  };
  els.bRegen.onclick = doRegen;
  els.bApprove.onclick = doApprove;
  els.bStop.onclick = () => {
    if (busy) { busy.ctrl.abort(); toast('已停止'); }
  };

  // 暴露给 Engine.autoDraft 的界面句柄

  /* 启动：确保弹层/遮罩/提示都处于关闭状态 */
  $('#sheet').hidden = true;
  $('#sheet').classList.add('hide');
  $('#toast').hidden = true;
  lockScroll(false);

  /* 启动 */
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  /* ===== 项目首页 ===== */
  function renderHome() {
    stage.innerHTML = '';
    const top = el('div', 'home-top');
    const nb = el('button', 'primary-btn', '＋ 新建短篇');
    nb.onclick = () => {
      const p = newProject();
      Store.save(p); Store.setCurrent(p.id);
      cur = p; view = 'project'; render();
      setTimeout(() => { if (!Store.cfg().apiKey) openSettings(); }, 300);
    };
    top.appendChild(nb);
    const imp = el('button', 'ghost-btn', '导入备份');
    imp.onclick = importBackup;
    top.appendChild(imp);
    stage.appendChild(top);

    const list = Store.projects();
    if (!list.length) {
      const e = el('div', 'card empty-home');
      e.appendChild(el('h3', '', '还没有项目'));
      e.appendChild(el('div', 'hint', '点「新建短篇」开始。流程：选题 → 设定 → 大纲 → 正文 → 润色，每一步 AI 出稿、你审核、写意见、再改。'));
      stage.appendChild(e);
      return;
    }
    const w = el('div', 'plist');
    list.forEach(p => {
      const it = el('div', 'pitem');
      it.appendChild(el('div', 'pt', p.title));
      const m = el('div', 'pm');
      const t = Engine.tierInfo(p);
      m.appendChild(el('span', '', t.name + ' · 目标' + t.words + '字'));
      m.appendChild(el('span', '', '当前：' + STEP_NAME[p.step]));
      m.appendChild(el('span', '', '更新 ' + fmtTime(p.updatedAt || p.createdAt)));
      it.appendChild(m);
      const a = el('div', 'pa');
      const open = el('button', 'mini', '打开');
      open.onclick = () => { Store.setCurrent(p.id); cur = Store.get(p.id); view = 'project'; render(); };
      const ren = el('button', 'mini', '重命名');
      ren.onclick = () => {
        const n = prompt('项目名称', p.title);
        if (n && n.trim()) { const q = Store.get(p.id); q.title = n.trim(); Store.save(q); render(); }
      };
      const dup = el('button', 'mini', '复制');
      dup.onclick = () => {
        const q = JSON.parse(JSON.stringify(Store.get(p.id)));
        q.id = uid(); q.title = p.title + ' 副本'; q.createdAt = Date.now();
        Store.save(q); render();
      };
      const del = el('button', 'mini danger', '删除');
      del.onclick = () => {
        if (confirm('删除「' + p.title + '」？不可恢复。')) { Store.remove(p.id); if (cur && cur.id === p.id) cur = Store.current(); render(); }
      };
      a.appendChild(open); a.appendChild(ren); a.appendChild(dup); a.appendChild(del);
      it.appendChild(a);
      w.appendChild(it);
    });
    stage.appendChild(w);
    const bk = el('div', 'card');
    bk.appendChild(el('h3', '', '备份'));
    const b1 = el('button', 'mini', '导出全部数据(JSON)');
    b1.onclick = exportBackup;
    bk.appendChild(b1);
    bk.appendChild(el('div', 'hint', '数据只存在这台设备上。换设备或清缓存前记得导出。'));
    stage.appendChild(bk);
  }

  function exportBackup() {
    const data = { v: 1, at: Date.now(), projects: Store.projects() };
    download('短篇工坊备份-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data, null, 2), 'application/json');
  }
  function importBackup() {
    const inp = el('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const d = JSON.parse(r.result);
          const arr = d.projects || d;
          if (!Array.isArray(arr)) throw new Error('格式不对');
          const exist = new Set(Store.projects().map(x => x.id));
          let n = 0;
          arr.forEach(p => { if (!exist.has(p.id)) { Store.save(p); n++; } });
          toast('导入 ' + n + ' 个项目'); render();
        } catch (e) { toast('导入失败：' + e.message); }
      };
      r.readAsText(f);
    };
    inp.click();
  }

  function download(name, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* ===== 导出 ===== */
  function openExport() {
    if (!cur) return;
    flushEdits();
    const full = cur.steps.polish.status === 'done' || cur.steps.polish.status === 'ready'
      ? Engine.cur(cur, 'polish') : Engine.joinDraft(cur);
    const plain = full.replace(/^第[一二三四五六七八九十百零\d]+节.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    sheet(`
      <h2>导出 <button class="close">✕</button></h2>
      <div class="grid2">
        <div>
          <div class="field"><label>标题（可改）</label><input id="exTitle" value=""></div>
          <div class="field"><label>简介（可改，150字内更好过审）</label><textarea id="exIntro" rows="4"></textarea></div>
        </div>
        <div>
          <div class="field"><label>正文字数</label><input id="exWords" value="" readonly></div>
          <div class="hint">纯文本适合直接粘进番茄后台；Markdown 带节标题，适合留档。</div>
        </div>
      </div>
      <div class="sheet-acts">
        <button class="primary-btn" id="exCopyPlain">复制纯文本</button>
        <button class="ghost-btn" id="exCopyMd">复制 Markdown</button>
        <button class="ghost-btn" id="exTxt">下载 .txt</button>
        <button class="ghost-btn" id="exMd">下载 .md</button>
      </div>
    `, (body) => {
      const T = $('#exTitle', body), I = $('#exIntro', body);
      T.value = cur.title;
      I.value = cur.brief.idea || '';
      $('#exWords', body).value = Engine.countWords(full) + ' 字';
      const md = () => '# ' + (T.value || cur.title) + '\n\n' + (I.value ? '> ' + I.value.replace(/\n/g, '\n> ') + '\n\n' : '') + full;
      $('#exCopyPlain', body).onclick = () => { copy(plain); closeSheet(); };
      $('#exCopyMd', body).onclick = () => { copy(md()); closeSheet(); };
      $('#exTxt', body).onclick = () => { download((T.value || '短篇') + '.txt', plain); toast('已下载'); };
      $('#exMd', body).onclick = () => { download((T.value || '短篇') + '.md', md()); toast('已下载'); };
    });
  }

  /* ===== 设置 ===== */
  function openSettings() { flushEdits(); view = 'settings'; render(); }

  function renderSettings() {
    stage.innerHTML = '';
    const cfg = Store.cfg();
    const c = el('div', 'card');
    c.appendChild(el('h3', '', 'AI 接口（OpenAI 兼容）'));
    const mk = (key, label, ph, area, type) => {
      const f = el('div', 'field');
      f.appendChild(el('label', '', label));
      const i = area ? el('textarea') : el('input');
      if (area) i.rows = 2; else i.type = type || 'text';
      i.placeholder = ph; i.value = cfg[key] || '';
      i.oninput = () => { Store.setCfg({ [key]: i.value }); };
      f.appendChild(i); c.appendChild(f); return i;
    };
    mk('baseUrl', 'Base URL', 'https://api.deepseek.com/v1');
    mk('apiKey', 'API Key', 'sk-...', false, 'password');
    const g = el('div', 'grid3');
    c.append(g);
    const mkIn = (key, label, type, ph) => {
      const f = el('div', 'field');
      f.appendChild(el('label', '', label));
      const i = el('input'); i.type = type; i.placeholder = ph || ''; i.value = cfg[key] ?? '';
      i.oninput = () => { Store.setCfg({ [key]: type === 'number' ? Number(i.value) : i.value }); };
      f.appendChild(i); g.appendChild(f);
    };
    mkIn('model', '模型名', 'text', 'deepseek-chat');
    mkIn('temperature', '温度', 'number', '0.9');
    mkIn('cards', '每次生成张数(1-4)', 'number', '1');
    const sw = el('label', 'switch-row');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!cfg.stream;
    cb.onchange = () => Store.setCfg({ stream: cb.checked });
    sw.appendChild(cb); sw.appendChild(el('span', '', '流式输出（边写边显示）'));
    c.appendChild(sw);
    const row = el('div', 'sheet-acts');
    const test = el('button', 'ghost-btn', '测试连接');
    const out = el('div', 'err'); out.hidden = true;
    test.onclick = async () => {
      out.hidden = false; out.textContent = '正在测试…';
      try { const r = await API.testConn(); out.textContent = '✓ 连接正常：' + r.slice(0, 30); out.className = 'ok-box'; }
      catch (e) { out.textContent = '✕ ' + e.message; out.className = 'err'; }
    };
    row.appendChild(test);
    const back = el('button', 'primary-btn', '返回');
    back.onclick = () => { view = cur ? 'project' : 'home'; render(); };
    row.appendChild(back);
    c.appendChild(row);
    c.appendChild(out);
    stage.appendChild(c);

    // 提示词
    const pc = el('div', 'card');
    pc.appendChild(el('h3', '', '提示词'));
    pc.appendChild(el('div', 'hint', '每个工序的提示词都可以改。{{topic}} 这类占位符会被自动替换成上一步的成果。'));
    const P = PROMPTS.get();
    const keys = ['system', 'topic', 'setting', 'outline', 'draft', 'polish'];
    const names = { system: '系统提示（全局）', topic: '① 选题', setting: '② 设定人设', outline: '③ 分节大纲', draft: '④ 逐节正文', polish: '⑤ 润色成稿' };
    keys.forEach(k => {
      const acc = el('div', 'acc');
      const hd = el('button', 'acc-hd');
      hd.appendChild(el('span', '', names[k]));
      hd.appendChild(el('span', '', '▾'));
      const ta = el('textarea'); ta.rows = 12; ta.value = P[k];
      ta.style.display = 'none';
      hd.onclick = () => { const open = ta.style.display !== 'none'; ta.style.display = open ? 'none' : 'block'; };
      ta.oninput = () => {
        const pr = Store.cfg().prompts || {}; pr[k] = ta.value; Store.setCfg({ prompts: pr });
      };
      const rb = el('button', 'mini', '恢复默认');
      rb.onclick = () => {
        if (!confirm('恢复默认提示词？')) return;
        const pr = Store.cfg().prompts || {}; delete pr[k]; Store.setCfg({ prompts: pr });
        ta.value = PROMPTS.DEFAULTS[k]; toast('已恢复');
      };
      acc.appendChild(hd); acc.appendChild(ta); acc.appendChild(rb);
      pc.appendChild(acc);
    });
    stage.appendChild(pc);
    stage.appendChild(el('div', 'pad'));
  }
  /* ===== 顶部与步骤条 ===== */
  function renderTop() {
    if (view === 'home') { els.project.textContent = '短篇工坊'; els.sub.textContent = '共 ' + Store.projects().length + ' 个项目'; return; }
    if (view === 'settings') { els.project.textContent = '设置'; els.sub.textContent = '接口与提示词'; return; }
    if (!cur) { els.project.textContent = '短篇工坊'; els.sub.textContent = '还没有项目'; return; }
    const t = Engine.tierInfo(cur);
    els.project.textContent = cur.title;
    els.sub.textContent = `${STEP_NAME[cur.step]} · 第${STEP_ORDER.indexOf(cur.step) + 1}/5 步 · ${t.name} 约${t.words}字`;
  }

  function stepState(p, k) {
    const s = p.steps[k];
    if (s.status === 'done') return 'ok';
    if (s.status === 'ready') return 'ok';
    return '';
  }

  function renderSteps() {
    els.steps.innerHTML = '';
    if (view !== 'project' || !cur) { els.steps.hidden = true; return; }
    els.steps.hidden = false;
    STEP_ORDER.forEach((k, i) => {
      const c = el('button', 'step-chip ' + (cur.step === k ? 'cur ' : '') + stepState(cur, k));
      c.appendChild(el('span', 'dot'));
      c.appendChild(el('span', '', (i + 1) + ' ' + STEP_NAME[k]));
      c.onclick = () => {
        if (busy) { toast('正在生成，先等一下'); return; }
        const target = STEP_ORDER.indexOf(k);
        const curIdx = STEP_ORDER.indexOf(cur.step);
        if (target > curIdx + 0 && cur.steps[cur.step].status !== 'done' && target !== curIdx) {
          // 允许回看已完成的，往前跳需要当前步通过
          if (target !== curIdx && !STEP_ORDER.slice(0, target).every(x => cur.steps[x].status === 'done')) {
            if (!confirm('前面的环节还没通过，仍然要跳到「' + STEP_NAME[k] + '」吗？')) return;
          }
        }
        flushEdits();
        cur.step = k;
        persist();
        render();
      };
      els.steps.appendChild(c);
    });
  }

  function render() {
    flushEdits();
    renderTop();
    renderSteps();
    $('#btnExport').hidden = !(view === 'project' && cur);
    $('#btnSet').hidden = view === 'settings';
    els.bStop.hidden = !busy;
    if (view === 'home') { renderHome(); return; }
    if (view === 'settings') { renderSettings(); return; }
    if (!cur) { renderEmpty(); return; }
    const k = cur.step;
    stage.innerHTML = '';
    const wrap = el('div');
    stage.appendChild(wrap);
    renderBrief(wrap);
    if (k === 'draft') renderDraft(wrap); else renderStepDoc(wrap, k);
    updateDock();
  }

  /* ===== 空状态 ===== */
  function renderEmpty() {
    stage.innerHTML = '';
    const c = el('div', 'card empty-home');
    c.appendChild(el('h3', '', '还没有打开任何项目'));
    const b = el('button', 'primary-btn', '新建一个短篇');
    b.onclick = () => {
      const p = newProject();
      Store.save(p); Store.setCurrent(p.id); cur = p; view = 'project'; render();
    };
    c.appendChild(b);
    stage.appendChild(c);
  }

  /* ===== 事件绑定 ===== */
  $('#btnHome').onclick = () => {
    if (busy) { toast('正在生成，先停一下'); return; }
    if (view === 'home') { view = cur ? 'project' : 'home'; } else { flushEdits(); view = 'home'; }
    render();
  };
  $('#btnSet').onclick = openSettings;
  $('#btnExport').onclick = openExport;
  els.bGen.onclick = () => {
    if (!cur) return;
    if (cur.step === 'draft') doDraftPart(cur.steps.draft.partIdx || 0, false);
    else doGen(cur.step);
  };
  els.bRegen.onclick = doRegen;
  els.bApprove.onclick = doApprove;
  els.bStop.onclick = () => {
    if (busy) { busy.ctrl.abort(); toast('已停止'); }
  };

  // 暴露给 Engine.autoDraft 的界面句柄

  /* 启动 */
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  render();
})();