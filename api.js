/* api.js — OpenAI 兼容接口调用，支持流式 */
(function () {
  function buildMessages(system, user) {
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
  }

  async function chat({ messages, temperature, onDelta, signal, jsonMode }) {
    const cfg = Store.cfg();
    if (!cfg.apiKey) throw new Error('还没填 API Key，请去「设置」页填写');
    if (!cfg.baseUrl) throw new Error('还没填 Base URL，请去「设置」页填写');

    let base = cfg.baseUrl.trim().replace(/\/+$/, '');
    if (!/\/v\d+$/.test(base) && !/\/chat\/completions$/.test(base)) base += '/v1';
    const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';

    const body = {
      model: cfg.model,
      messages,
      temperature: typeof temperature === 'number' ? temperature : cfg.temperature,
      stream: !!cfg.stream
    };
    if (jsonMode) body.response_format = { type: 'json_object' };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify(body),
      signal
    });

    if (!res.ok) {
      let t = '';
      try { t = await res.text(); } catch (e) {}
      let msg = t;
      try { const j = JSON.parse(t); msg = j.error?.message || j.message || t; } catch (e) {}
      throw new Error('接口错误 ' + res.status + '：' + (msg || '').slice(0, 300));
    }

    if (!body.stream || !res.body) {
      const j = await res.json();
      return j.choices?.[0]?.message?.content || '';
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '';
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const data = s.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const d = j.choices?.[0]?.delta?.content || '';
          if (d) { full += d; onDelta && onDelta(d, full); }
        } catch (e) { /* 分片不完整，忽略 */ }
      }
    }
    return full;
  }

  function testConn() {
    return chat({
      messages: [{ role: 'user', content: '回复两个字：可用' }],
      temperature: 0
    });
  }

  window.API = { chat, buildMessages, testConn };
})();
