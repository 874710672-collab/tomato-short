/* store.js — 数据层：本地存储、项目模型、配置 */
(function () {
  const K_CFG = 'ts_cfg_v1';
  const K_PROJ = 'ts_projects_v1';
  const K_CUR = 'ts_cur_v1';

  const DEFAULT_CFG = {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.9,
    cards: 1,          // 每次生成几条候选
    stream: true,
    maxTokens: 32000,
    noThinking: true
  };

  function loadJSON(k, d) {
    try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : d; } catch (e) { return d; }
  }
  function saveJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { console.error(e); return false; }
  }

  const Store = {
    cfg() { return Object.assign({}, DEFAULT_CFG, loadJSON(K_CFG, {})); },
    setCfg(patch) { const c = Object.assign(this.cfg(), patch); saveJSON(K_CFG, c); return c; },

    projects() { const l = loadJSON(K_PROJ, []); if (!Array.isArray(l)) return []; l.forEach(migrate); return l; },
    currentId() { return localStorage.getItem(K_CUR) || null; },
    setCurrent(id) { localStorage.setItem(K_CUR, id); },
    get(id) {
      const p = this.projects().find(x => x.id === id);
      return p ? migrate(p) : null;
    },
    current() { return this.get(this.currentId()); },
    save(p) {
      p.updatedAt = Date.now();
      // 直接改存储里的那条，不再整体覆盖（避免把别处刚改的字段冲掉）
      const list = this.projects();
      const i = list.findIndex(x => x.id === p.id);
      const prev = i >= 0 ? list[i] : {};
      // p 就是最新数据，直接用 p 写入，不做跨对象回写（回写会替换 steps 引用，
      // 导致正在执行的生成流程持有的 s 指向废弃对象，新版本写了却看不到）
      if (i >= 0) list[i] = p; else list.unshift(p);
      return saveJSON(K_PROJ, list);
    },
    remove(id) {
      const list = this.projects().filter(p => p.id !== id);
      saveJSON(K_PROJ, list);
      if (this.currentId() === id) {
        if (list[0]) this.setCurrent(list[0].id); else localStorage.removeItem(K_CUR);
      }
    }
  };

  /* ---------- 项目模型 ---------- */
  const STEPS = ['topic', 'setting', 'outline', 'draft', 'polish', 'manual'];
  const STEP_NAME = { topic: '选题立意', setting: '设定人设', outline: '分节大纲', draft: '分节正文', polish: '润色成稿', manual: '人工修改' };
  const TIERS = {
    s: { name: '短篇·小', min: 3000, max: 5000, parts: 3 },
    m: { name: '短篇·中', min: 8000, max: 12000, parts: 5 },
    l: { name: '短篇·大', min: 15000, max: 20000, parts: 7 }
  };

  /* 老版本数据补全缺失字段，避免升级后打不开 */
  function migrate(p) {
    if (!p || typeof p !== 'object') return p;
    // 关键：原地修改，不新建对象，避免外部持有的引用失效
    if (!p.brief || typeof p.brief !== 'object') p.brief = {};
    const bd = { genre: '', tags: '', idea: '', pov: '第三人称', style: '', avoid: '' };
    Object.keys(bd).forEach(key => { if (p.brief[key] === undefined) p.brief[key] = bd[key]; });
    if (!p.steps || typeof p.steps !== 'object') p.steps = {};
    const steps = p.steps;
    STEPS.forEach(k => {
      const d = { status: 'idle', versions: [], sel: 0, feedback: '' };
      if (k === 'draft') { d.parts = []; d.partIdx = 0; }
      if (k === 'manual') { d.editor = ''; d.lastSave = 0; d.base = ''; }
      // 原地补字段，保持对象引用不变
      const o = steps[k] || (steps[k] = {});
      Object.keys(d).forEach(key => { if (o[key] === undefined) o[key] = d[key]; });
      if (!Array.isArray(o.versions)) o.versions = [];
      if (o.sel == null) o.sel = 0;
      // sel 越界时校正到最后一版，避免改了却显示旧稿
      if (o.versions.length && (o.sel < 0 || o.sel >= o.versions.length)) o.sel = o.versions.length - 1;
      if (k === 'draft' && !Array.isArray(o.parts)) o.parts = [];
    });
    p.steps = steps;
    if (!p.trends) p.trends = [];
    if (p.useTrends === undefined) p.useTrends = true;
    if (typeof p.title !== 'string') p.title = '未命名短篇';
    return p;
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function newProject() {
    const p = {
      id: uid(),
      title: '未命名短篇',
      tier: 'm',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      brief: {           // 用户创作简报（全程可见）
        genre: '', tags: '', idea: '', pov: '第三人称', style: '', avoid: ''
      },
      step: 'topic',
      steps: {
        topic: { status: 'idle', versions: [], sel: 0, feedback: '' },
        setting: { status: 'idle', versions: [], sel: 0, feedback: '' },
        outline: { status: 'idle', versions: [], sel: 0, feedback: '' },
        draft: { status: 'idle', versions: [], sel: 0, feedback: '', partIdx: 0, parts: [] },
        polish: { status: 'idle', versions: [], sel: 0, feedback: '' },
        manual: { status: 'idle', versions: [], sel: 0, feedback: '', editor: '', lastSave: 0 }
      }
    };
    return p;
  }

  window.Store = Store;
  window.migrateProject = migrate;
  window.STEP_ORDER = STEPS;
  window.STEP_NAME = STEP_NAME;
  window.TIERS = TIERS;
  window.newProject = newProject;
  window.uid = uid;
})();
