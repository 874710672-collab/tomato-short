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
    dockInfo: $('#dockInfo'), bGen: $('#btnGen'), bRegen: $('#btnRegen'), bRevise: $('#btnRevise'),
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
    if (view === 'trends') { els.project.textContent = '热门方向库'; els.sub.textContent = cur ? ('已选 ' + ((cur.trends || []).length) + ' 个方向') : '先打开一个短篇再勾选'; return; }
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
    $('#dock').classList.toggle('empty', view !== 'project' || !cur);
    $('#steps').hidden = !(view === 'project' && cur);
    els.bStop.hidden = !busy;
    if (view === 'home') { renderHome(); return; }
    if (view === 'settings') { renderSettings(); return; }
    if (view === 'trends') { renderTrends(); return; }
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
    if (!cur) { ['bRevise','bRegen','bGen','bApprove'].forEach(k => els[k].hidden = true); return; }
    const k = cur.step;
    const s = cur.steps[k];
    const has = k === 'draft'
      ? !!(s.parts && s.parts[s.partIdx || 0])
      : !!(s.status && s.status !== 'idle' && Engine.cur(cur, k));
    const fb = (s.feedback || '').trim();
    const busyNow = !!busy;

    els.bGen.hidden = busyNow || has;
    els.bRevise.hidden = busyNow || !has;
    els.bRegen.hidden = busyNow || !has;
    els.bApprove.hidden = busyNow || !has;

    els.bRevise.textContent = k === 'draft' ? '✎ 按意见改本节' : '✎ 按意见改';
    els.bRevise.disabled = false;
    els.bRevise.classList.toggle('need-fb', !fb);
    els.bRevise.title = fb ? '带上原稿 + 你的意见，只改意见提到的地方' : '先在右边写审核意见';
    els.bRegen.textContent = k === 'draft' ? '↻ 重写本节' : '↻ 重新生成';
    els.bGen.textContent = k === 'draft' ? '写这一节' : '生成';
    els.bApprove.textContent = k === 'polish' ? '定稿 · 完成'
      : k === 'draft' ? '正文写完 · 进入润色' : '通过 · 进入下一环节';

    if (busyNow) {
      const n = Engine.countWords(busy.text || '');
      els.dockInfo.textContent = busy.label + ' · 已生成 ' + n + ' 字';
    } else {
      const total = Engine.countWords(k === 'draft' ? Engine.joinDraft(cur) : Engine.cur(cur, k));
      const t = Engine.tierInfo(cur);
      els.dockInfo.textContent = has
        ? `目标 ${t.words} 字 · 当前 ${total} 字 · ${s.status === 'done' ? '已通过' : (fb ? '待按意见修改' : '待审核')}`
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

  /* ===== 选题：方案卡片（解析 AI 的三个方案，逐个选定） ===== */
  function parseOptions(text) {
    if (!text) return [];
    // 以【标题】作为方案分隔点
    const idx = [];
    let m;
    const re = /【标题】|标题[:：]\s*/g;
    while ((m = re.exec(text))) idx.push(m.index);
    if (idx.length < 1) return [];
    const out = [];
    idx.forEach((p, i) => {
      const seg = text.slice(p, i + 1 < idx.length ? idx[i + 1] : text.length).trim();
      out.push(seg);
    });
    return out.map(seg => {
      const title = (seg.match(/【标题】\s*(.+)/) || [])[1] || '';
      const tags = (seg.match(/【题材标签】\s*(.+)/) || [])[1] || '';
      const hook = (seg.match(/【一句话钩子】\s*(.+)/) || [])[1] || '';
      const setting = (seg.match(/【核心设定】\s*([\s\S]*?)(?=\n【|$)/) || [])[1] || '';
      return { text: seg, title: title.trim(), tags: tags.trim(), hook: hook.trim(), setting: setting.trim().replace(/\s+/g, ' ') };
    });
  }

  function renderTopicPicker(root, s, text) {
    const opts = parseOptions(text);
    const c = el('div', 'card');
    const h = el('h3', '', '选题方案');
    h.appendChild(el('span', 'tag', opts.length ? '共 ' + opts.length + ' 个 · 选一个再点「通过」' : ''));
    c.appendChild(h);
    if (!opts.length) {
      c.appendChild(el('div', 'hint', '这一版没有按【标题】分条，可直接在下面手动编辑，或用意见让 AI 重写。'));
      root.appendChild(c);
      return;
    }
    const curSel = s.picked;
    opts.forEach((o, i) => {
      const card = el('div', 'opt-card' + (curSel === i ? ' on' : ''));
      const top = el('div', 'opt-top');
      top.appendChild(el('span', 'opt-idx', String(i + 1)));
      top.appendChild(el('span', 'opt-title', o.title || '（无标题）'));
      const pick = el('button', 'mini opt-pick' + (curSel === i ? ' on' : ''), curSel === i ? '✓ 已选' : '选这个');
      pick.onclick = () => {
        flushEdits();
        s.picked = (s.picked === i ? null : i);
        // 选定方案即作为后续环节的选题
        s.versions[s.sel].picked = s.picked;
        persist(); render();
      };
      top.appendChild(pick);
      card.appendChild(top);
      if (o.tags) card.appendChild(el('div', 'opt-tags', o.tags));
      if (o.hook) card.appendChild(el('div', 'opt-hook', '钩子：' + o.hook));
      if (o.setting) card.appendChild(el('div', 'opt-set', o.setting.slice(0, 120)));
      const more = el('button', 'mini opt-more', '查看完整');
      more.onclick = () => sheet('<h2>方案 ' + (i + 1) + ' <button class="close">✕</button></h2><div class="doc">' + esc(o.text) + '</div>');
      card.appendChild(more);
      c.appendChild(card);
    });
    root.appendChild(c);
  }

  function esc(t) {
    return String(t).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  }

  /* 取当前选定的方案作为下一环节的输入；没选就返回整版 */
  function topicForNext() {
    const s = cur.steps.topic;
    const text = Engine.cur(cur, 'topic');
    if (s.picked === null || s.picked === undefined) return text;
    const opts = parseOptions(text);
    return (opts[s.picked] && opts[s.picked].text) || text;
  }

  /* ===== 通用工序（选题/设定/大纲/润色） ===== */
  function renderStepDoc(root, k) {
    const s = cur.steps[k];
    const wrap = el('div', 'split');
    const left = el('div');
    const right = el('div');
    right.id = 'rightCol';
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

    if (k === 'topic') {
      const bar = el('div', 'topic-bar');
      const n = (cur.trends || []).length;
      const tb = el('button', 'mini' + (n ? ' on' : ''), n ? ('已选 ' + n + ' 个热门方向') : '参考热门方向');
      tb.onclick = openTrends;
      const cb = el('button', 'mini', '组合创意');
      cb.onclick = doCombo;
      const db = el('button', 'mini', '方向诊断');
      db.onclick = () => doFit('topic');
      bar.appendChild(tb); bar.appendChild(cb); bar.appendChild(db);
      left.appendChild(bar);
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
      if (k !== 'topic') {
        const b3 = el('button', 'mini fit-btn', '✧ AI 诊断');
        b3.onclick = () => doFit(k);
        ea.appendChild(b3);
      }
      box.appendChild(ea);
      box.appendChild(el('div', 'words', '共 ' + Engine.countWords(text) + ' 字'));
    }
    left.appendChild(box);

    fillRight(right, k, text);

    // 流式输出目标
    app.streamEl = pre;
  }

  /* 右侧栏内容：方案卡 / 字数分配 / 审核意见 / 历史 */
  function fillRight(root, k, text) {
    const s = cur.steps[k];
    const fit = fitOf(k);
    if (fit) {
      const meta = FIT_MAP[k] || { label: '诊断', prefix: '按诊断结果修改' };
      const fc = el('div', 'card fit-card');
      const fh = el('h3', '', meta.label);
      fh.appendChild(el('span', 'tag', fmtTime(fit.at)));
      fc.appendChild(fh);
      const fb = el('div', 'fit-body');
      parseFit(fit.text).forEach(b => {
        const sec = el('div', 'fit-sec');
        sec.appendChild(el('div', 'fit-h', b.title));
        b.lines.forEach(l => sec.appendChild(el('div', 'fit-li', l)));
        fb.appendChild(sec);
      });
      fc.appendChild(fb);
      const ops = el('div', 'doc-ops');
      const o1 = el('button', 'mini', '展开');
      o1.onclick = () => openFitSheet(k);
      const o2 = el('button', 'mini', '写进审核意见');
      o2.onclick = () => {
        s.feedback = (s.feedback ? s.feedback + '\n' : '') + meta.prefix + '：\n' + fit.text;
        persist(); render(); toast('已写进审核意见');
      };
      const o3 = el('button', 'mini', '重新诊断');
      o3.onclick = () => doFit(k);
      const o4 = el('button', 'mini danger', '清除');
      o4.onclick = () => { delete cur.fits[k]; persist(); render(); };
      ops.appendChild(o1); ops.appendChild(o2); ops.appendChild(o3); ops.appendChild(o4);
      fc.appendChild(ops);
      root.appendChild(fc);
    }
    if (k === 'topic' && text && !(busy && busy.step === k)) renderTopicPicker(root, s, text);
    root.appendChild(reviewCard(k));
    if (k === 'outline') root.appendChild(planCard());
    if (s.history && s.history.length) root.appendChild(historyCard(s));
    root.appendChild(el('div', 'pad'));
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
    if (ed) { closeManual(ed, pre, k); return; }

    const s = cur.steps[k];
    ed = el('textarea');
    ed.id = 'manualEdit';
    ed.dataset.step = k;
    ed.className = 'manual-editor';
    ed.value = Engine.cur(cur, k);
    pre.style.display = 'none';
    box.insertBefore(ed, pre);
    ed.focus();

    const btn = box.querySelector('.doc-ops .mini');
    if (btn) btn.textContent = '完成编辑';

    // 实时写回 + 同步右侧
    let timer = null;
    ed.oninput = () => {
      const v = ed.value;
      const ver = s.versions[s.sel];
      if (ver) ver.text = v;
      clearTimeout(timer);
      timer = setTimeout(() => {
        Store.save(cur);
        syncRight(k, v, ed);
      }, 250);
    };
    ed.onblur = () => {
      clearTimeout(timer);
      Store.save(cur);
      syncRight(k, v => v, ed);
    };
  }

  function closeManual(ed, pre, k) {
    const s = cur.steps[k];
    if (s.versions[s.sel]) s.versions[s.sel].text = ed.value;
    pre.textContent = ed.value || '（空）';
    pre.style.display = '';
    persist();
    ed.remove();
    const box = pre.closest('.card');
    const btn = box && box.querySelector('.doc-ops .mini');
    if (btn) btn.textContent = '手动编辑';
    syncRight(k, ed.value, null);
  }

  /* 只刷新右侧那一栏，避免整页重绘打断输入 */
  function syncRight(k, textOrFn, ed) {
    const holder = document.getElementById('rightCol');
    if (!holder) return;
    const box = document.getElementById('rightScroll');
    const top = box ? box.scrollTop : 0;
    const v = typeof textOrFn === 'function' ? textOrFn(Engine.cur(cur, k)) : textOrFn;
    const frag = document.createElement('div');
    fillRight(frag, k, v);
    holder.innerHTML = '';
    while (frag.firstChild) holder.appendChild(frag.firstChild);
    if (box) box.scrollTop = top;
    if (ed) {
      const e2 = document.getElementById('manualEdit');
      if (e2 && e2.value !== ed.value) {
        const pos = e2.selectionStart;
        e2.value = ed.value;
        try { e2.setSelectionRange(pos, pos); } catch (x) {}
      }
    }
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
    c.appendChild(el('div', 'hint', '写完意见，点右下角「按意见改一版」——AI 会带着现有稿件和你的意见重写。不写意见直接点，就是换个角度再抽一版。'));
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
    if (curPart && curPart.issues && curPart.issues.length) {
      const box = el('div', 'issue-box');
      curPart.issues.forEach(it => {
        const line = el('div', 'issue-line ' + (it.level === 'error' ? 'err' : ''));
        line.textContent = (it.level === 'error' ? '● ' : '○ ') + it.msg;
        box.appendChild(line);
      });
      const recheck = el('button', 'mini', '重新检查');
      recheck.onclick = () => {
        const info = CHECK.parseSetting(Engine.cur(cur, 'setting'));
        curPart.issues = CHECK.checkText(info, curPart.body, { banned: CHECK.parseBanned(Engine.cur(cur, 'setting')) });
        persist(); render();
      };
      box.appendChild(recheck);
      card.appendChild(box);
    }
    const ops = el('div', 'doc-ops');
    const rewrite = el('button', 'mini', '按意见改本节');
    rewrite.onclick = () => doDraftPart(idx, { mode: 'revise' });
    const regenOne = el('button', 'mini', '重写本节');
    regenOne.onclick = () => doDraftPart(idx, { mode: 'fresh' });
    const nextp = el('button', 'mini', '下一节');
    nextp.onclick = () => { if (idx < total - 1) { flushEdits(); d.partIdx = idx + 1; persist(); render(); } };
    const prevp = el('button', 'mini', '上一节');
    prevp.onclick = () => { if (idx > 0) { flushEdits(); d.partIdx = idx - 1; persist(); render(); } };
    const diag = el('button', 'mini fit-btn', '✧ AI 诊断本节');
    diag.onclick = () => doFit('draft');
    ops.appendChild(prevp); ops.appendChild(nextp); ops.appendChild(rewrite); ops.appendChild(regenOne); ops.appendChild(diag);
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
      const iss = (pt && pt.issues) || [];
      if (iss.length) {
        const bad = iss.filter(x => x.level === 'error').length;
        row.appendChild(el('span', 'issue-badge' + (bad ? ' err' : ''), '⚠ ' + iss.length));
      }
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

  async function doGen(k, opts) {
    // opts.mode: 'fresh' 重新生成 | 'revise' 带原稿改

    if (busy) return;
    if (!Store.cfg().apiKey) { openSettings(); toast('先填 API Key'); return; }
    flushEdits();
    opts = opts || {};
    const s = cur.steps[k];
    const mode = (opts && opts.mode) || 'fresh';
    // 润色：走分段处理，避免一次输出被截断
    if (k === 'polish') return doPolishChunks(opts);
    const cards = mode === 'revise' ? 1 : Math.max(1, Math.min(4, Store.cfg().cards || 1));
    if (mode === 'revise' && !(s.feedback || '').trim()) { toast('先写审核意见'); return; }
    // 有旧稿就存进历史，方便退回
    const old = Engine.cur(cur, k);
    if (old && opts.keepHistory !== false) {
      s.history = s.history || [];
      s.history.unshift({ text: old, at: Date.now() });
      if (s.history.length > 8) s.history.length = 8;
    }
    setBusy('正在生成' + STEP_NAME[k], k);
    const fbSave = s.feedback;
    try {
      for (let i = 0; i < cards; i++) {
        if (busy.ctrl.signal.aborted) throw new Error('已停止');
        busy.label = mode === 'revise' ? '正在按意见修改' + STEP_NAME[k] : '正在重新生成' + STEP_NAME[k];
        busy.text = '';
        app.streamEl && app.streamEl.textContent === '' ;
        const runner = mode === 'revise' ? Engine.reviseStep : Engine.genStep;
        const out = await runner(cur, k, (d, full) => {
          busy.text = full;
          if (app.streamEl) app.streamEl.textContent = full;
          updateDock();
        }, busy.ctrl.signal);
        s.versions.push({ text: out.trim(), at: Date.now() });
        s.sel = s.versions.length - 1;
        if (k === 'topic') s.picked = null;
        s.status = 'ready';
        persist();
      }
      s.history = s.history || [];
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
    if (k === 'draft') return doDraftPart(cur.steps.draft.partIdx || 0, { mode: 'fresh' });
    const s = cur.steps[k];
    const fb = (s.feedback || '').trim();
    const msg = fb
      ? '重新生成会**不带上一版原稿**，让 AI 从头写一版（你的意见仍会作为要求带上）。\n\n要这样吗？\n确定 = 重新生成\n取消 = 用「✎ 按意见改」在上一版上改'
      : '没有写审核意见，会从头重新生成一版。继续？';
    if (!confirm(msg)) return;
    await doGen(k, { mode: 'fresh' });
  }

  async function doRevise() {
    if (!cur) return;
    if (busy) { toast('正在生成，稍等'); return; }
    flushEdits();
    const k = cur.step;
    const fb = (cur.steps[k].feedback || '').trim();
    if (!fb) {
      toast('先在右下角「人工审核意见」里写下要改什么');
      const ta = $('.review textarea');
      if (ta) { ta.focus(); ta.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      return;
    }
    if (k === 'draft') return doDraftPart(cur.steps.draft.partIdx || 0, { mode: 'revise' });
    await doGen(k, { mode: 'revise' });
  }



  async function doDraftPart(idx, opts) {
    if (busy) return;
    if (!Store.cfg().apiKey) { openSettings(); return; }
    flushEdits();
    const d = cur.steps.draft;
    const mode = (opts && opts.mode) || 'fresh';
    if (mode === 'revise' && !(d.feedback || '').trim()) { toast('先写审核意见'); return; }
    const old = d.parts[idx];
    if (mode === 'revise' && !old) { toast('这一节还没写，先用「重写本节」'); return; }
    if (old) {
      d.history = d.history || [];
      d.history.unshift({ text: old.title + '\n' + old.body, at: Date.now() });
      if (d.history.length > 12) d.history.length = 12;
    }
    setBusy('正在写第' + (idx + 1) + '节', 'draft');
    busy.partIdx = idx;
    try {
      let out;
      if (mode === 'revise') {
        const P = PROMPTS.get();
        const rule = PROMPTS.fill(Engine.REVISE_RULE, { prevText: old.title + '\n' + old.body, feedback: d.feedback });
        const ctx = Engine.buildContext(cur, 'draft', Engine.tierInfo(cur));
        out = await API.chat({
          messages: API.buildMessages(P.system + '\n\n' + rule, ctx),
          onDelta: (dd, full) => { busy.text = full; if (app.streamEl) app.streamEl.textContent = full; updateDock(); },
          signal: busy.ctrl.signal
        });
      }
      const out2 = mode === 'revise' ? out : await Engine.genPart(cur, idx, (dd, full) => {
        busy.text = full;
        if (app.streamEl) app.streamEl.textContent = full;
        updateDock();
      }, busy.ctrl.signal);
      const plan = Engine.outlinePlan(Engine.cur(cur, 'outline'));
      const bodyText = (mode === 'revise' ? out2 : out2).trim();
      d.parts[idx] = { title: (plan[idx] && plan[idx].title) || ('第' + (idx + 1) + '节'), body: bodyText };
      try {
        const info = CHECK.parseSetting(Engine.cur(cur, 'setting'));
        d.parts[idx].issues = CHECK.checkText(info, bodyText, { banned: CHECK.parseBanned(Engine.cur(cur, 'setting')) });
      } catch (e) { d.parts[idx].issues = []; }
      d.partIdx = idx;
      d.status = 'ready';
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

  /* 分段润色：长文一次输出会被 max_tokens 截断，改成分段处理再拼接 */
  async function doPolishChunks(opts) {
    if (busy) return;
    flushEdits();
    const s = cur.steps.polish;
    const mode = (opts && opts.mode) || 'fresh';
    const prev = Engine.cur(cur, 'polish');
    if (mode === 'revise' && !(s.feedback || '').trim()) { toast('先写审核意见'); return; }
    // 改写：以当前润色稿为源；重新生成：以草稿为源
    // 正文存的是分节数据，需要先拼成全文
    const draftText = Engine.joinDraft(cur) || Engine.cur(cur, 'draft');
    const source = mode === 'revise' && prev ? prev : draftText;
    if (!source) { toast('还没有正文，先去完成分节正文'); return; }
    if (prev) { s.history = s.history || []; s.history.unshift({ text: prev, at: Date.now() }); if (s.history.length > 8) s.history.length = 8; }

    window.__polishSource = () => source;
    setBusy('正在分段润色', 'polish');
    try {
      const out = await Engine.polishInChunks(cur, {
        cancelled: () => busy && busy.ctrl.signal.aborted,
        signal: busy.ctrl.signal,
        onProgress: (i, total, acc) => {
          busy.label = '正在润色第 ' + (i + 1) + ' / ' + total + ' 段';
          if (acc !== undefined) busy.text = acc;
          updateDock();
        }
      });
      s.versions.push({ text: out.trim(), at: Date.now() });
      s.sel = s.versions.length - 1;
      s.status = 'ready';
      window.__polishSource = null;
      endBusy();
      const n = Engine.countWords(out);
      toast('润色完成，共 ' + n + ' 字');
    } catch (e) { window.__polishSource = null; endBusy(e); }
  }

  /* 基于勾选的热门方向生成组合创意 */
  async function doCombo() {
    if (busy || !cur) return;
    if (!Store.cfg().apiKey) { openSettings(); toast('先填 API Key'); return; }
    const ids = cur.trends || [];
    if (!ids.length) { toast('先去「参考热门方向」勾几个方向'); openTrends(); return; }
    flushEdits();
    const cards = TRENDS.all().filter(c => ids.includes(c.id));
    const P = PROMPTS.get();
    const s = cur.steps.topic;
    setBusy('正在组合创意', 'topic');
    try {
      const out = await API.chat({
        messages: API.buildMessages(P.system, PROMPTS.fill(P.trendSuggest, {
          trends: TRENDS.brief(cards),
          brief: Engine.briefText(cur.brief) || '（未填，自由发挥，但要有番茄短篇的爽感）',
          feedback: (s.feedback || '').trim() ? '作者的意见：\n' + s.feedback : ''
        })),
        onDelta: (d, full) => {
          busy.text = full;
          if (app.streamEl) app.streamEl.textContent = full;
          updateDock();
        },
        signal: busy.ctrl.signal
      });
      s.versions.push({ text: out.trim(), at: Date.now() });
      s.sel = s.versions.length - 1;
      s.status = 'ready';
      s.picked = null;
      endBusy();
    } catch (e) { endBusy(e); }
  }

  /* 方向命中判断：评估现有想法 */
  /* 各环节的诊断提示词与上下文 */
  const FIT_MAP = {
    topic: { key: 'trendFit', label: '方向诊断', prefix: '按诊断结果调整方向' },
    setting: { key: 'fitSetting', label: '设定诊断', prefix: '按诊断结果修改设定' },
    outline: { key: 'fitOutline', label: '大纲诊断', prefix: '按诊断结果修改大纲' },
    draft: { key: 'fitDraft', label: '本节诊断', prefix: '按诊断结果修改本节' },
    polish: { key: 'fitPolish', label: '定稿体检', prefix: '按诊断结果修改定稿' }
  };

  function fitOf(k) { return (cur && cur.fits && cur.fits[k]) || null; }

  function buildFitVars(k) {
    const t = Engine.tierInfo(cur);
    const base = { brief: Engine.briefText(cur.brief) || '（简报为空）', tier: t.name, words: t.words, parts: t.parts, feedback: '' };
    if (k === 'topic') {
      const cards = TRENDS.all();
      const ids = cur.trends || [];
      const picked = ids.length ? cards.filter(c => ids.includes(c.id)) : cards;
      return Object.assign(base, {
        topic: Engine.cur(cur, 'topic').slice(0, 3000) || '（还没有选题稿）',
        trends: TRENDS.brief(picked),
        feedback: (cur.steps.topic.feedback || '').trim() ? '作者补充：' + cur.steps.topic.feedback : ''
      });
    }
    return Object.assign(base, {
      doc: Engine.cur(cur, k).slice(0, 8000),
      topic: window.pickedTopic ? window.pickedTopic() : Engine.cur(cur, 'topic'),
      setting: Engine.cur(cur, 'setting'),
      outline: Engine.cur(cur, 'outline'),
      feedback: (cur.steps[k].feedback || '').trim() ? '作者补充：' + cur.steps[k].feedback : ''
    });
  }

  async function doFit(stepKey) {
    if (busy || !cur) return;
    if (!Store.cfg().apiKey) { openSettings(); toast('先填 API Key'); return; }
    const k = stepKey || cur.step;
    const meta = FIT_MAP[k];
    if (!meta) return;
    flushEdits();
    if (k !== 'topic' && !Engine.cur(cur, k) && !(k === 'draft' && (cur.steps.draft.parts || []).length)) {
      toast('还没有稿子，先生成一版'); return;
    }
    const P = PROMPTS.get();
    // 正文按当前节诊断
    let vars = buildFitVars(k);
    if (k === 'draft') {
      const d = cur.steps.draft;
      const idx = d.partIdx || 0;
      const part = (d.parts || [])[idx];
      vars.doc = part ? (part.title + '\n' + part.body).slice(0, 8000) : '';
      meta.label = '第' + (idx + 1) + '节诊断';
    }
    setBusy('正在' + meta.label.replace('诊断', '诊断') + '…', k === 'draft' ? 'draft' : k);
    try {
      const out = await API.chat({
        messages: API.buildMessages(P.system, PROMPTS.fill(P[meta.key], vars)),
        onDelta: (d, full) => { busy.text = full; },
        signal: busy.ctrl.signal
      });
      cur.fits = cur.fits || {};
      cur.fits[k] = { text: out.trim(), at: Date.now() };
      endBusy();
      openFitSheet(k);
    } catch (e) { endBusy(e); }
  }



  function openFitSheet(stepKey) {
    const k = stepKey || cur.step;
    const fit = fitOf(k);
    if (!fit) { toast('还没有诊断结果'); return; }
    const meta = FIT_MAP[k] || { label: '诊断', prefix: '按诊断结果修改' };
    const blocks = parseFit(fit.text);
    let html = '<h2>' + meta.label + ' <button class="close">✕</button></h2>';
    html += '<div class="fit-body">';
    blocks.forEach(b => {
      html += '<div class="fit-sec"><div class="fit-h">' + esc(b.title) + '</div>';
      b.lines.forEach(l => { html += '<div class="fit-li">' + esc(l) + '</div>'; });
      html += '</div>';
    });
    html += '</div>';
    html += '<div class="sheet-acts">' +
      '<button class="ghost-btn" id="fitCopy">复制全文</button>' +
      '<button class="ghost-btn" id="fitToFb">写进审核意见</button>' +
      '<button class="primary-btn" id="fitAgain">重新诊断</button></div>';
    sheet(html, (body) => {
      $('#fitCopy', body).onclick = () => { copy(fit.text); toast('已复制'); };
      $('#fitToFb', body).onclick = () => {
        const s2 = cur.steps[k];
        s2.feedback = (s2.feedback ? s2.feedback + '\n' : '') + meta.prefix + '：\n' + fit.text;
        persist(); closeSheet(); render(); toast('已写进审核意见');
      };
      $('#fitAgain', body).onclick = () => { closeSheet(); doFit(k); };
    });
  }


  function parseFit(t) {
    const out = [];
    let curSec = null;
    String(t).split('\n').forEach(raw => {
      const line = raw.trim();
      if (!line) return;
      const m = line.match(/^【(.+?)】\s*(.*)$/);
      if (m) {
        curSec = { title: m[1], lines: [] };
        if (m[2]) curSec.lines.push(m[2]);
        out.push(curSec);
      } else if (curSec) {
        curSec.lines.push(line.replace(/^[-•·]\s*/, ''));
      }
    });
    if (!out.length) out.push({ title: '诊断', lines: String(t).split('\n').map(x => x.trim()).filter(Boolean) });
    return out;
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
    if (k === 'topic') {
      const opts = parseOptions(Engine.cur(cur, 'topic'));
      if (opts.length && (s.picked === null || s.picked === undefined)) {
        if (!confirm('还没选方案。直接通过的话，会把全部 ' + opts.length + ' 个方案一起交给下一步。\n\n要先去选一个吗？\n  确定 = 不选了，一起交给下一步\n  取消 = 回去选')) return;
      }
      if (opts.length && s.picked !== null && s.picked !== undefined && opts[s.picked] && opts[s.picked].title) {
        if (cur.title === '未命名短篇' || !cur.title.trim()) cur.title = opts[s.picked].title;
      }
    }
    const i = STEP_ORDER.indexOf(k);
    if (i < STEP_ORDER.length - 1) cur.step = STEP_ORDER[i + 1];
    persist();
    toast('已通过，进入「' + STEP_NAME[cur.step] + '」');
    render();
  }
  /* ===== 热门方向库 ===== */
  function openTrends() {
    flushEdits();
    view = 'trends';
    render();
  }
  function backFromTrends() { view = cur ? 'project' : 'home'; render(); }

  function renderTrends() {
    stage.innerHTML = '';
    const cards = TRENDS.all();
    const picked = (cur && cur.trends) || [];

    // 顶部操作
    const c = el('div', 'card');
    const h = el('h3', '', '热门方向库');
    h.appendChild(el('span', 'tag', cards.length + ' 个方向'));
    c.appendChild(h);
    c.appendChild(el('div', 'hint', '来源：番茄作家课堂官方文章。勾选后，在「选题立意」里可以基于这些方向生成组合创意。'));
    const acts = el('div', 'doc-ops');
    const b1 = el('button', 'mini', '＋ 粘贴新课堂文章');
    b1.onclick = openTrendImport;
    const b2 = el('button', 'mini', '检查更新');
    b2.onclick = checkTrendUpdates;
    acts.appendChild(b1); acts.appendChild(b2);
    c.appendChild(acts);
    stage.appendChild(c);

    if (!cards.length) {
      const e = el('div', 'card');
      e.appendChild(el('div', 'hint', '方向库是空的，点上面「粘贴新课堂文章」导入。'));
      stage.appendChild(e);
      return;
    }

    // 卡片列表
    cards.forEach(card => {
      const box = el('div', 'card trend-card' + (picked.includes(card.id) ? ' on' : ''));
      const top = el('div', 'trend-top');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = picked.includes(card.id);
      cb.onchange = () => {
        if (!cur) { toast('先打开或新建一个短篇'); cb.checked = false; return; }
        cur.trends = cur.trends || [];
        if (cb.checked) {
          if (cur.trends.length >= 3) { toast('最多选 3 个方向，组合才有聚焦'); cb.checked = false; return; }
          if (!cur.trends.includes(card.id)) cur.trends.push(card.id);
        }
        else cur.trends = cur.trends.filter(x => x !== card.id);
        persist(); render();
      };
      top.appendChild(cb);
      top.appendChild(el('div', 'trend-name', card.name));
      box.appendChild(top);

      const meta = el('div', 'trend-meta');
      (card.parts || []).forEach(p => meta.appendChild(el('span', 'chip', p)));
      box.appendChild(meta);

      const dl = el('dl', 'trend-dl');
      [['内核', card.core], ['钩子', card.hook], ['情绪', card.emotion], ['易崩', card.risk]].forEach(([k, v]) => {
        if (!v) return;
        dl.appendChild(el('dt', '', k));
        dl.appendChild(el('dd', '', v));
      });
      box.appendChild(dl);

      const foot = el('div', 'trend-foot');
      if (card.src) foot.appendChild(el('span', 'src', card.src + (card.srcDate ? ' · ' + card.srcDate : '')));
      const edit = el('button', 'mini', '编辑');
      edit.onclick = () => openTrendEdit(card);
      const del = el('button', 'mini danger', '删除');
      del.onclick = () => {
        if (!confirm('删除方向「' + card.name + '」？')) return;
        TRENDS.remove(card.id);
        render();
      };
      foot.appendChild(edit); foot.appendChild(del);
      box.appendChild(foot);
      stage.appendChild(box);
    });
    stage.appendChild(el('div', 'pad'));
  }

  function openTrendEdit(card) {
    const f = (label, key, rows) => `
      <div class="field"><label>${label}</label>${rows
        ? `<textarea id="tf_${key}" rows="${rows}">${esc(card[key] || '')}</textarea>`
        : `<input id="tf_${key}" value="${esc(card[key] || '')}">`}</div>`;
    sheet(`<h2>编辑方向 <button class="close">✕</button></h2>
      ${f('名称', 'name')}
      ${f('组成（用 / 分隔）', 'parts')}
      ${f('内核', 'core', 2)}
      ${f('钩子', 'hook', 2)}
      ${f('情绪走向', 'emotion')}
      ${f('篇幅（s/m/l）', 'best')}
      ${f('易写崩', 'risk', 2)}
      <div class="sheet-acts"><button class="primary-btn" id="tfSave">保存</button></div>
    `, (body) => {
      $('#tfSave', body).onclick = () => {
        const g = (k) => ($('#tf_' + k, body) || {}).value || '';
        const parts = g('parts').trim();
        const c2 = Object.assign({}, card, {
          name: g('name').trim(),
          parts: typeof parts === 'string' ? parts.split(/[\/、,，]/).map(x => x.trim()).filter(Boolean) : parts,
          core: g('core').trim(), hook: g('hook').trim(), emotion: g('emotion').trim(),
          best: g('best').trim(), risk: g('risk').trim()
        });
        if (!c2.name) { toast('名称不能为空'); return; }
        TRENDS.upsert(c2);
        closeSheet();
        render();
        toast('已保存');
      };
    });
  }

  /* 粘贴新课堂文章 -> AI 拆成方向卡 */
  function openTrendImport() {
    sheet(`<h2>导入作家课堂 <button class="close">✕</button></h2>
      <div class="field"><label>文章链接（可选，能填就自动抓正文）</label>
        <input id="tiUrl" placeholder="https://fanqienovel.com/writer/zone/article/…"></div>
      <div class="field"><label>或直接粘贴正文</label>
        <textarea id="tiText" rows="8" placeholder="把作家课堂那篇文章的正文整段粘进来…"></textarea></div>
      <div class="err" id="tiMsg" hidden></div>
      <div class="sheet-acts">
        <button class="ghost-btn" id="tiFetch">抓取链接</button>
        <button class="primary-btn" id="tiRun">拆成方向卡</button>
      </div>
    `, (body) => {
      const msg = $('#tiMsg', body);
      const say = (t, ok) => { msg.hidden = false; msg.textContent = t; msg.className = ok ? 'ok-box' : 'err'; };
      $('#tiFetch', body).onclick = async () => {
        const u = $('#tiUrl', body).value.trim();
        if (!u) { say('先填链接'); return; }
        say('正在抓取…', true);
        try {
          const r = await fetch(u, { mode: 'cors' });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const html = await r.text();
          const p = TRENDS.parseArticleHTML(html);
          if (!p.text) throw new Error('没解析出正文');
          $('#tiText', body).value = p.text;
          say('已抓取：' + p.title + '（' + p.text.length + ' 字）', true);
        } catch (e) {
          say('抓取失败：' + e.message + '\n\n浏览器跨域限制，请手动复制正文粘到下面。', false);
        }
      };
      $('#tiRun', body).onclick = async () => {
        let text = $('#tiText', body).value.trim();
        if (!text) { say('没有正文，先抓取或粘贴'); return; }
        if (!Store.cfg().apiKey) { say('先去设置里填 API Key'); return; }
        closeSheet();
        await extractTrends(text);
      };
    });
  }

  /* 调 AI 把文章拆成方向卡 */
  async function extractTrends(articleText) {
    const P = PROMPTS.get();
    const c = el('div', 'card');
    c.id = 'extractCard';
    c.appendChild(el('h3', '', '正在拆解方向…'));
    const pre = el('div', 'doc streaming');
    c.appendChild(pre);
    stage.innerHTML = '';
    stage.appendChild(c);
    $('#dock').classList.add('empty');
    try {
      const out = await API.chat({
        messages: API.buildMessages(P.system, PROMPTS.fill(P.trendExtract, { article: articleText.slice(0, 12000) })),
        onDelta: (d, full) => { pre.textContent = full; },
        temperature: 0.3
      });
      const cards = parseTrendCards(out);
      if (!cards.length) throw new Error('没有解析出方向卡，原文：' + out.slice(0, 200));
      cards.forEach(k => TRENDS.upsert(k));
      toast('已导入 ' + cards.length + ' 个方向');
      render();
    } catch (e) {
      stage.innerHTML = '';
      const c2 = el('div', 'card');
      c2.appendChild(el('h3', '', '拆解失败'));
      c2.appendChild(el('div', 'err', e.message));
      const back = el('button', 'primary-btn', '返回方向库');
      back.onclick = () => render();
      c2.appendChild(back);
      stage.appendChild(c2);
    }
  }

  function parseTrendCards(text) {
    const blocks = text.split(/===方向===/).slice(1);
    const out = [];
    blocks.forEach(b => {
      const body = b.split(/---方向结束---/)[0] || b;
      const g = (k) => {
        const m = body.match(new RegExp(k + '[:：]\\s*(.+)'));
        return m ? m[1].trim() : '';
      };
      const name = g('名称');
      if (!name) return;
      const parts = g('组成').split(/[\/、,，]/).map(x => x.trim()).filter(Boolean);
      out.push({
        id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        src: '作家课堂（导入）',
        srcDate: new Date().toISOString().slice(0, 10),
        name, parts,
        core: g('内核'), hook: g('钩子'), emotion: g('情绪'),
        best: g('篇幅') || 's,m', risk: g('易崩'),
        on: true
      });
    });
    return out;
  }

  /* 检查是否有新的课堂文章（跨域会被拦，给出降级提示） */
  async function checkTrendUpdates() {
    const ids = TRENDS.knownIds();
    toast('正在检查…');
    let ok = 0, blocked = 0;
    for (const id of ids.slice(-5)) {
      const r = await TRENDS.probe(id);
      if (r && r.ok) ok++; else blocked++;
    }
    if (!blocked) toast('检查完成，没有新的文章');
    else openTrendImport();
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

  window.pickedTopic = topicForNext;

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
    const tr = el('button', 'ghost-btn', '热门方向');
    tr.onclick = openTrends;
    top.appendChild(tr);
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
    // iOS 上必须把 input 挂进文档，否则 .click() 静默失效
    const inp = el('input');
    inp.type = 'file';
    inp.accept = '.json,application/json,.txt';
    inp.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
    document.body.appendChild(inp);
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) { inp.remove(); return; }
      const r = new FileReader();
      r.onload = () => {
        try { applyBackup(String(r.result)); }
        catch (e) { toast('导入失败：' + e.message); }
        inp.remove();
      };
      r.onerror = () => { toast('读取文件失败，换一个文件试试'); inp.remove(); };
      r.readAsText(f, 'utf-8');
    };
    inp.click();
    setTimeout(() => { if (inp.parentNode) inp.remove(); }, 120000);
  }

  /* 解析并合并备份：新增项目、跳过重名的、可选覆盖 */
  function applyBackup(text) {
    let d;
    try { d = JSON.parse(text); } catch (e) { throw new Error('不是有效的 JSON 文件'); }
    const arr = Array.isArray(d) ? d : (d.projects || []);
    if (!Array.isArray(arr) || !arr.length) throw new Error('文件里没有项目数据');
    const good = arr.filter(p => p && p.id && p.steps);
    if (!good.length) throw new Error('数据格式不认识（可能不是本 App 的备份）');
    const existing = Store.projects();
    const byId = new Map(existing.map(p => [p.id, p]));
    let added = 0, replaced = 0, dup = 0;
    good.forEach(p => {
      const e = byId.get(p.id);
      if (!e) { Store.save(p); added++; }
      else if ((p.updatedAt || 0) > (e.updatedAt || 0)) { Store.save(p); replaced++; }
      else dup++;
    });
    if (!added && !replaced) {
      toast('没有新内容：备份里的 ' + dup + ' 个项目本地都有，且不比本地新');
      return;
    }
    toast('导入完成：新增 ' + added + ' 个' + (replaced ? '，更新 ' + replaced + ' 个' : '') + (dup ? '，跳过 ' + dup + ' 个重复' : ''));
    render();
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
  let settingsBack = null;
  function openSettings() { flushEdits(); settingsBack = (view === 'trends') ? 'trends' : null; view = 'settings'; render(); }

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
    mkIn('maxTokens', '单次输出上限(max_tokens)', 'number', '32000');
    const sw = el('label', 'switch-row');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!cfg.stream;
    cb.onchange = () => Store.setCfg({ stream: cb.checked });
    sw.appendChild(cb); sw.appendChild(el('span', '', '流式输出（边写边显示）'));
    c.appendChild(sw);

    const sw2 = el('label', 'switch-row');
    const cb2 = el('input'); cb2.type = 'checkbox'; cb2.checked = cfg.noThinking !== false;
    cb2.onchange = () => Store.setCfg({ noThinking: cb2.checked });
    sw2.appendChild(cb2);
    sw2.appendChild(el('span', '', '关闭深度思考（豆包等模型必开，否则思考过程会混进正文）'));
    c.appendChild(sw2);
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
    back.onclick = () => { view = settingsBack || (cur ? 'project' : 'home'); settingsBack = null; render(); };
    row.appendChild(back);
    c.appendChild(row);
    c.appendChild(out);
    stage.appendChild(c);

    // 提示词
    const pc = el('div', 'card');
    pc.appendChild(el('h3', '', '提示词'));
    pc.appendChild(el('div', 'hint', '每个工序的提示词都可以改。{{topic}} 这类占位符会被自动替换成上一步的成果。'));
    const P = PROMPTS.get();
    const keys = ['system', 'topic', 'setting', 'outline', 'draft', 'polish', 'trendFit', 'fitSetting', 'fitOutline', 'fitDraft', 'fitPolish', 'polishChunk', 'trendExtract', 'trendSuggest'];
    const names = { system: '系统提示（全局）', topic: '① 选题', setting: '② 设定人设', outline: '③ 分节大纲', draft: '④ 逐节正文', polish: '⑤ 润色成稿',
      trendFit: '诊断 · 选题方向', fitSetting: '诊断 · 设定', fitOutline: '诊断 · 大纲', fitDraft: '诊断 · 正文', fitPolish: '诊断 · 定稿',
      polishChunk: '⑤ 润色 · 单段', trendExtract: '热门方向 · 拆解文章', trendSuggest: '热门方向 · 组合创意' };
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








  /* ===== 空状态 ===== */


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
  els.bRevise.onclick = doRevise;
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