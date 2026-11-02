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
    stream: true
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

    projects() { return loadJSON(K_PROJ, []); },
    currentId() { return localStorage.getItem(K_CUR) || null; },
    setCurrent(id) { localStorage.setItem(K_CUR, id); },
    get(id) { return this.projects().find(p => p.id === id) || null; },
    current() { return this.get(this.currentId()); },
    save(p) {
      p.updatedAt = Date.now();
      // 直接改存储里的那条，不再整体覆盖（避免把别处刚改的字段冲掉）
      const list = this.projects();
      const i = list.findIndex(x => x.id === p.id);
      const prev = i >= 0 ? list[i] : {};
      const merged = Object.assign({}, prev, p);
      if (i >= 0) list[i] = merged; else list.unshift(merged);
      const ok = saveJSON(K_PROJ, list);
      if (ok) {
        // 用存好的那份回写内存对象，保持两边一致
        for (const key in merged) p[key] = merged[key];
      }
      return ok;
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
  const STEPS = ['topic', 'setting', 'outline', 'draft', 'polish'];
  const STEP_NAME = { topic: '选题立意', setting: '设定人设', outline: '分节大纲', draft: '分节正文', polish: '润色成稿' };
  const TIERS = {
    s: { name: '短篇·小', min: 3000, max: 5000, parts: 3 },
    m: { name: '短篇·中', min: 8000, max: 12000, parts: 5 },
    l: { name: '短篇·大', min: 15000, max: 20000, parts: 7 }
  };

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
        polish: { status: 'idle', versions: [], sel: 0, feedback: '' }
      }
    };
    return p;
  }

  window.Store = Store;
  window.STEP_ORDER = STEPS;
  window.STEP_NAME = STEP_NAME;
  window.TIERS = TIERS;
  window.newProject = newProject;
  window.uid = uid;
})();
