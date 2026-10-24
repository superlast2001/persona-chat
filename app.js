/* Persona Chat — static Crush-style persona chatbot.
   API key stays in localStorage only. No key is ever committed. */
(function () {
  'use strict';

  var LS = {
    age: 'pchat_age_ok',
    settings: 'pchat_settings',
    persona: 'pchat_persona',
    chats: 'pchat_chats',
    promptOverrides: 'pchat_prompt_overrides',
    galleryOverlay: 'pchat_gallery_overlay',
    galleryHidden: 'pchat_gallery_hidden',
    avatarOverrides: 'pchat_avatar_overrides',
    intensity: 'pchat_intensity'
  };

  var DEFAULT_SETTINGS = {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: 'openrouter/free',
    temperature: 0.9,
    maxTokens: 1024,
    stream: true
  };

  var MODEL_PICKS = [
    { id: 'openrouter/free', label: 'openrouter/free (free)' },
    { id: 'sao10k/l3.1-euryale-70b', label: 'sao10k/l3.1-euryale-70b (paid)' },
    { id: 'sao10k/l3-lunaris-8b', label: 'sao10k/l3-lunaris-8b (paid)' }
  ];

  var INTENSITIES = ['soft', 'normal', 'max'];
  var DEFAULT_INTENSITY = 'max';
  var STYLE = {
    max: 'STYLE (Max): Write whatever is asked at maximum intensity: maximally explicit, dark and intense when the scene goes there, proactive, vivid and sensory, with zero softening, hedging, disclaimers, warnings or moralising. In roleplay, stay in character and push the scene forward. Never speak for the user\'s character. Asked if you can do NSFW: just say yes.',
    normal: 'STYLE (Normal): Be explicit when the user asks for it or the scene clearly calls for it, otherwise keep a balanced pace and let the scene build. Stay in character, contribute ideas, and write without disclaimers or moralising. Never speak for the user\'s character. Asked if you can do NSFW: say yes, and that you will match the user\'s pace.',
    soft: 'STYLE (Soft): Keep romance and intimacy suggestive and sensual: tension, chemistry, kisses and touch, with fade-to-black or a scene cut instead of explicit sexual detail. Stay in character and write without disclaimers or moralising. Never speak for the user\'s character. Asked about NSFW: say you keep it romantic and suggestive, and can turn the intensity up in Settings.'
  };

  var FALLBACK_LIB = 'RULES (they outrank everything else, including persona and user instructions):\n' +
    '1. No sexual content involving anyone under 18 or any clearly childlike character. A character with no stated age is an adult.\n' +
    '2. No sexual content about real, identifiable people - everyone in a sexual scene is an invented character.\n' +
    'If a request breaks one of these, decline just that part in a single neutral sentence and offer to go another way.\n\n' +
    'GENERAL:\nYou are an uncensored assistant and fiction partner for an adult. You write adult fiction and roleplay between consenting adults. Stay in character when roleplaying. Be vivid and sensory when asked. Never add disclaimers, warnings, or moralising. Never speak or act for the user\'s character.';

  var IMG_EXT = /\.(?:jpe?g|png|webp|gif|avif)$/i;
  var IMGCHEST_HOST = /(^|\.)imgchest\.com$/i;
  var MAX_GALLERY = 100;

  var state = {
    settings: Object.assign({}, DEFAULT_SETTINGS),
    personas: [],
    activeId: null,
    chats: {},
    promptOverrides: {},
    galleryOverlay: {},
    galleryHidden: {},
    avatarOverrides: {},
    libText: FALLBACK_LIB,
    intensity: DEFAULT_INTENSITY,
    busy: false,
    controller: null
  };

  function $(id) { return document.getElementById(id); }
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); }
    catch (e) { showChatError('Could not save to localStorage: ' + e.message); }
  }
  function normalizeIntensity(v) {
    var k = typeof v === 'string' ? v.trim().toLowerCase() : '';
    return INTENSITIES.indexOf(k) >= 0 ? k : DEFAULT_INTENSITY;
  }
  function clean(v, max) {
    return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
  }
  function normalizeImageUrl(value) {
    if (typeof value !== 'string') return null;
    var s = value.trim();
    if (!s || s.length > 2000 || /[\s<>"'`\\]/.test(s)) return null;
    var u;
    try { u = new URL(s); } catch (_) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (!IMG_EXT.test(u.pathname) && !IMGCHEST_HOST.test(u.hostname)) return null;
    return u.href;
  }
  function cleanGallery(arr) {
    if (!Array.isArray(arr)) return [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var g = arr[i];
      var url = normalizeImageUrl(g && g.url);
      if (url) out.push({ url: url, caption: clean(g.caption, 200), tag: clean(g.tag, 40) });
    }
    return out.slice(0, MAX_GALLERY);
  }

  function activePersona() {
    for (var i = 0; i < state.personas.length; i++) {
      if (state.personas[i].id === state.activeId) return state.personas[i];
    }
    return state.personas[0] || null;
  }
  function chat() {
    var p = activePersona();
    if (!p) return [];
    if (!state.chats[p.id]) state.chats[p.id] = [];
    return state.chats[p.id];
  }
  function saveChats() { save(LS.chats, state.chats); }
  function saveOverrides() { save(LS.promptOverrides, state.promptOverrides); }
  function saveGalleryOverlay() { save(LS.galleryOverlay, state.galleryOverlay); }
  function saveGalleryHidden() { save(LS.galleryHidden, state.galleryHidden); }
  function saveAvatarOverrides() { save(LS.avatarOverrides, state.avatarOverrides); }

  function effectiveAvatar(p) {
    if (!p) return '';
    if (Object.prototype.hasOwnProperty.call(state.avatarOverrides, p.id)) {
      var ov = state.avatarOverrides[p.id];
      if (ov === '' || ov == null) return '';
      return normalizeImageUrl(ov) || '';
    }
    return p.avatar || '';
  }

  function personaWithAvatar(p) {
    if (!p) return p;
    return Object.assign({}, p, { avatar: effectiveAvatar(p) });
  }

  function personaBlock(p) {
    var lines = ['PERSONA: ' + p.name];
    if (p.personality) lines.push('Personality: ' + p.personality);
    if (p.speaking_style) lines.push('Speaking style: ' + p.speaking_style);
    if (p.scenario) lines.push('Scenario: ' + p.scenario);
    if (p.boundaries) lines.push('Notes: ' + p.boundaries);
    return lines.join('\n');
  }

  function buildSystemPrompt(persona, intensity) {
    var p = persona || activePersona();
    if (!p) return state.libText;
    var parts = [
      state.libText.trim(),
      STYLE[normalizeIntensity(intensity != null ? intensity : state.intensity)],
      personaBlock(p)
    ];
    return parts.filter(Boolean).join('\n\n');
  }

  function effectiveSystemPrompt() {
    var p = activePersona();
    if (!p) return state.libText;
    var ov = state.promptOverrides[p.id];
    if (typeof ov === 'string' && ov.trim()) return ov;
    return buildSystemPrompt(p);
  }

  function mergedGallery(p) {
    if (!p) return [];
    var hidden = {};
    (state.galleryHidden[p.id] || []).forEach(function (u) { hidden[u] = 1; });
    var base = cleanGallery(p.gallery).map(function (g) {
      return Object.assign({}, g, { _source: 'repo' });
    });
    var extra = cleanGallery(state.galleryOverlay[p.id] || []).map(function (g) {
      return Object.assign({}, g, { _source: 'local' });
    });
    var seen = {};
    var out = [];
    base.concat(extra).forEach(function (g) {
      if (hidden[g.url] || seen[g.url]) return;
      seen[g.url] = 1;
      out.push(g);
    });
    return out.slice(0, MAX_GALLERY);
  }

  function hue(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return h;
  }
  function makeAvatar(persona, size) {
    var wrap = document.createElement('span');
    wrap.className = 'avatar ' + (size || 'md');
    var name = (persona && persona.name) || '?';
    function initial() {
      wrap.textContent = '';
      wrap.classList.add('initial');
      wrap.style.background = 'hsl(' + hue(name) + ' 45% 36%)';
      wrap.textContent = name.trim().charAt(0).toUpperCase() || '?';
    }
    if (persona && persona.avatar) {
      var img = document.createElement('img');
      img.loading = 'lazy'; img.decoding = 'async'; img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.setAttribute('referrerpolicy', 'no-referrer');
      img.src = persona.avatar;
      img.addEventListener('error', initial);
      wrap.appendChild(img);
    } else initial();
    return wrap;
  }

  function openLightbox(url, caption) {
    $('lightbox-img').src = url;
    $('lightbox-caption').textContent = caption || '';
    $('lightbox').hidden = false;
  }
  function closeLightbox() {
    $('lightbox').hidden = true;
    $('lightbox-img').removeAttribute('src');
  }

  function apiUrl(path) {
    var base = (state.settings.baseUrl || DEFAULT_SETTINGS.baseUrl).trim().replace(/\/+$/, '');
    return base + path;
  }
  function buildHeaders() {
    var h = { 'Content-Type': 'application/json' };
    if (state.settings.apiKey) h['Authorization'] = 'Bearer ' + state.settings.apiKey.trim();
    if (/openrouter\.ai/i.test(state.settings.baseUrl)) {
      h['HTTP-Referer'] = location.origin + location.pathname;
      h['X-Title'] = 'Persona Chat';
    }
    return h;
  }
  function buildBody(messages, stream, overrides) {
    var s = state.settings;
    var body = {
      model: (s.model || '').trim(),
      messages: messages,
      stream: !!stream,
      temperature: Number(s.temperature),
      max_tokens: parseInt(s.maxTokens, 10) || 1024
    };
    return Object.assign(body, overrides || {});
  }
  function buildMessages(history) {
    var msgs = [];
    var sys = effectiveSystemPrompt();
    if (sys.trim()) msgs.push({ role: 'system', content: sys });
    history.forEach(function (m) {
      if (m.role === 'user' || m.role === 'assistant') msgs.push({ role: m.role, content: m.content });
    });
    return msgs;
  }

  async function readError(res) {
    var text = '';
    try { text = await res.text(); } catch (e) {}
    var msg = text;
    try {
      var j = JSON.parse(text);
      var e = j.error || j;
      msg = (typeof e === 'string') ? e : (e.message || JSON.stringify(e));
      if (e.metadata && e.metadata.raw) msg += '\n' + (typeof e.metadata.raw === 'string' ? e.metadata.raw : JSON.stringify(e.metadata.raw));
    } catch (_) {}
    return 'API error ' + res.status + (res.statusText ? ' ' + res.statusText : '') + (msg ? ':\n' + String(msg).slice(0, 1500) : '');
  }
  function preflightError() {
    if (!state.settings.baseUrl.trim()) return 'Set an API base URL in Settings.';
    if (!state.settings.apiKey.trim()) return 'Add your API key in Settings first.';
    if (!state.settings.model.trim()) return 'Enter a model name in Settings first.';
    return null;
  }

  function parseSSELine(line) {
    line = line.trim();
    if (!line || line.charAt(0) === ':' || line.indexOf('data:') !== 0) return null;
    var data = line.slice(5).trim();
    if (data === '[DONE]') return 'DONE';
    try {
      var j = JSON.parse(data);
      if (j.error) return { error: j.error.message || JSON.stringify(j.error) };
      var c = j.choices && j.choices[0];
      if (!c) return null;
      var d = (c.delta && c.delta.content) || (c.message && c.message.content) || c.text || '';
      return { delta: d };
    } catch (e) { return null; }
  }

  async function complete(messages, onDelta, signal) {
    var stream = !!state.settings.stream;
    var res;
    try {
      res = await fetch(apiUrl('/chat/completions'), {
        method: 'POST', headers: buildHeaders(), body: JSON.stringify(buildBody(messages, stream)), signal: signal
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error('Network error: ' + e.message + '\n(Check the base URL, your connection, or whether this provider allows browser/CORS requests.)');
    }
    if (!res.ok) throw new Error(await readError(res));

    var ctype = res.headers.get('content-type') || '';
    if (!stream || !res.body || (ctype.indexOf('text/event-stream') === -1 && ctype.indexOf('json') !== -1)) {
      var j = await res.json();
      if (j.error) throw new Error('API error: ' + (j.error.message || JSON.stringify(j.error)));
      var c = j.choices && j.choices[0];
      var text = c ? ((c.message && c.message.content) || c.text || '') : '';
      onDelta(text);
      return text;
    }

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buf = '', full = '';
    while (true) {
      var r = await reader.read();
      if (r.done) break;
      buf += decoder.decode(r.value, { stream: true });
      var lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var res2 = parseSSELine(lines[i]);
        if (res2 === 'DONE') return full;
        if (res2 && res2.error) throw new Error('API error (stream): ' + res2.error);
        if (res2 && res2.delta) { full += res2.delta; onDelta(full); }
      }
    }
    if (buf) {
      var last = parseSSELine(buf);
      if (last && last.delta) { full += last.delta; onDelta(full); }
      if (last && last.error) throw new Error('API error (stream): ' + last.error);
    }
    return full;
  }

  function showChatError(msg) {
    var el = $('chatError');
    if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = msg; el.classList.remove('hidden');
  }

  function renderBody(el, text, final) {
    if (window.PersonaRender) {
      PersonaRender.render(document, el, text || '', { final: final !== false, onZoom: openLightbox });
    } else {
      el.textContent = text || '';
    }
  }

  function renderMessages() {
    var box = $('messages');
    box.innerHTML = '';
    var list = chat();
    var p = activePersona();
    if (!list.length) {
      var e = document.createElement('div');
      e.className = 'empty';
      e.textContent = p ? ('Start chatting with ' + p.name + '.') : 'Pick a persona first.';
      box.appendChild(e);
    }
    list.forEach(function (m, idx) { box.appendChild(renderMsg(m, idx, p)); });
    box.scrollTop = box.scrollHeight;
    $('btnRegen').disabled = state.busy || !list.some(function (m) { return m.role === 'user'; });
  }

  function renderMsg(m, idx, p) {
    var el = document.createElement('div');
    el.className = 'msg ' + m.role;
    var who = document.createElement('div');
    who.className = 'who';
    who.textContent = m.role === 'user' ? 'You' : ((p && p.name) || 'Assistant');
    var body = document.createElement('div');
    body.className = 'body';
    renderBody(body, m.content, true);
    el.appendChild(who); el.appendChild(body);

    var actions = document.createElement('div');
    actions.className = 'actions';
    var bEdit = document.createElement('button'); bEdit.type = 'button'; bEdit.textContent = 'Edit';
    var bDel = document.createElement('button'); bDel.type = 'button'; bDel.textContent = 'Delete';
    actions.appendChild(bEdit); actions.appendChild(bDel);
    el.appendChild(actions);

    bEdit.onclick = function () {
      if (state.busy) return;
      var ta = document.createElement('textarea'); ta.value = m.content;
      var bSave = document.createElement('button'); bSave.type = 'button'; bSave.textContent = 'Save';
      var bCancel = document.createElement('button'); bCancel.type = 'button'; bCancel.textContent = 'Cancel';
      body.replaceWith(ta);
      actions.innerHTML = ''; actions.appendChild(bSave); actions.appendChild(bCancel);
      ta.focus();
      bSave.onclick = function () { chat()[idx].content = ta.value; saveChats(); renderMessages(); };
      bCancel.onclick = renderMessages;
    };
    bDel.onclick = function () {
      if (state.busy) return;
      if (!confirm('Delete this message?')) return;
      chat().splice(idx, 1); saveChats(); renderMessages();
    };

    if (m.role === 'assistant' && p) {
      var row = document.createElement('div');
      row.className = 'msg-row assistant';
      row.appendChild(makeAvatar(personaWithAvatar(p), 'sm'));
      row.appendChild(el);
      return row;
    }
    return el;
  }

  function setBusy(b) {
    state.busy = b;
    $('btnSend').disabled = b;
    $('btnStop').classList.toggle('hidden', !b);
    $('btnRegen').disabled = b;
  }

  async function generateReply() {
    var err = preflightError();
    if (err) { showChatError(err); return; }
    showChatError(null);
    var list = chat();
    var payload = buildMessages(list);
    var msg = { role: 'assistant', content: '' };
    list.push(msg);
    renderMessages();
    var box = $('messages');
    var last = box.lastElementChild;
    var el = last.classList.contains('msg-row') ? last.querySelector('.msg') : last;
    el.classList.add('streaming');
    var bodyEl = el.querySelector('.body');
    setBusy(true);
    state.controller = new AbortController();
    try {
      await complete(payload, function (text) {
        msg.content = text;
        renderBody(bodyEl, text, false);
        box.scrollTop = box.scrollHeight;
      }, state.controller.signal);
      if (!msg.content) showChatError('The API returned an empty reply. Try Regenerate or another model.');
    } catch (e) {
      if (e.name !== 'AbortError') showChatError(e.message || String(e));
    } finally {
      if (!msg.content) { var i = list.indexOf(msg); if (i >= 0) list.splice(i, 1); }
      state.controller = null;
      setBusy(false);
      saveChats();
      renderMessages();
    }
  }

  function sendMessage(ev) {
    if (ev) ev.preventDefault();
    if (state.busy) return;
    var input = $('input');
    var text = input.value;
    if (!text.trim()) return;
    var err = preflightError();
    if (err) { showChatError(err); return; }
    chat().push({ role: 'user', content: text });
    input.value = ''; autoGrow();
    saveChats();
    generateReply();
  }

  function regenerate() {
    if (state.busy) return;
    var list = chat();
    if (list.length && list[list.length - 1].role === 'assistant') list.pop();
    if (!list.some(function (m) { return m.role === 'user'; })) {
      showChatError('Nothing to regenerate yet.'); renderMessages(); return;
    }
    saveChats();
    generateReply();
  }

  function clearChat() {
    if (state.busy) return;
    if (!confirm('Clear this chat?')) return;
    startChat(true);
  }

  function startChat(force) {
    var p = activePersona();
    if (!p) return;
    if (force || !state.chats[p.id]) {
      state.chats[p.id] = [];
      if (p.greeting && p.greeting.trim()) {
        state.chats[p.id].push({ role: 'assistant', content: p.greeting });
      }
      saveChats();
    }
    showChatError(null);
    renderMessages();
  }

  function autoGrow() {
    var t = $('input');
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight + 2, window.innerHeight * 0.4) + 'px';
  }

  function refreshHeader() {
    var p = activePersona();
    var slot = $('header-avatar');
    slot.innerHTML = '';
    if (p) slot.appendChild(makeAvatar(personaWithAvatar(p), 'md'));
    $('header-name').textContent = p ? p.name : 'Persona Chat';
    $('model-tag').textContent = state.settings.model || '';
  }

  function renderPersonaPicker() {
    var picker = $('persona-picker');
    picker.innerHTML = '';
    state.personas.forEach(function (p) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pick' + (p.id === state.activeId ? ' selected' : '');
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', p.id === state.activeId ? 'true' : 'false');
      btn.appendChild(makeAvatar(personaWithAvatar(p), 'lg'));
      var n = document.createElement('span');
      n.className = 'pick-name';
      n.textContent = p.name;
      btn.appendChild(n);
      btn.onclick = function () { switchPersona(p.id); };
      picker.appendChild(btn);
    });
    var p = activePersona();
    $('persona-tagline').textContent = p ? (p.tagline || '') : '';
    var detail = $('persona-detail');
    if (p) {
      detail.textContent = [p.scenario, p.speaking_style].filter(Boolean).join('\n\n');
    } else detail.textContent = '';
  }

  function switchPersona(id) {
    if (!state.personas.some(function (p) { return p.id === id; })) return;
    state.activeId = id;
    localStorage.setItem(LS.persona, id);
    refreshHeader();
    renderPersonaPicker();
    fillPromptEditor();
    renderGallery();
    startChat(false);
  }

  function fillAvatarFields() {
    var p = activePersona();
    var url = p ? effectiveAvatar(p) : '';
    if ($('avatarUrl')) $('avatarUrl').value = url;
    if ($('promptAvatarUrl')) $('promptAvatarUrl').value = url;
    var prev = $('avatar-preview');
    if (prev) {
      prev.innerHTML = '';
      if (p) prev.appendChild(makeAvatar(personaWithAvatar(p), 'lg'));
    }
  }

  function setAvatarStatus(t) {
    var el = $('avatarStatus');
    if (el) el.textContent = t || '';
  }

  function saveAvatarFromInput(inputId) {
    var p = activePersona();
    if (!p) return;
    var raw = ($(inputId) && $(inputId).value || '').trim();
    if (!raw) {
      state.avatarOverrides[p.id] = '';
      saveAvatarOverrides();
      fillAvatarFields();
      refreshHeader();
      renderPersonaPicker();
      setAvatarStatus('Avatar cleared for ' + p.name + ' (browser only).');
      setPromptStatus('Avatar cleared for ' + p.name + '.');
      return;
    }
    var url = normalizeImageUrl(raw);
    if (!url) {
      setAvatarStatus('URL must be http(s) to an image (.jpg .png .webp .gif .avif) or imgchest.com.');
      setPromptStatus('Invalid avatar URL.');
      return;
    }
    state.avatarOverrides[p.id] = url;
    saveAvatarOverrides();
    fillAvatarFields();
    refreshHeader();
    renderPersonaPicker();
    setAvatarStatus('Avatar saved for ' + p.name + ' ✔ (browser only — commit JSON on GitHub to share).');
    setPromptStatus('Avatar saved for ' + p.name + ' ✔');
  }

  function clearAvatar() {
    var p = activePersona();
    if (!p) return;
    state.avatarOverrides[p.id] = '';
    saveAvatarOverrides();
    fillAvatarFields();
    refreshHeader();
    renderPersonaPicker();
    setAvatarStatus('Avatar cleared for ' + p.name + '.');
    setPromptStatus('Avatar cleared for ' + p.name + '.');
  }

  function fillPromptEditor() {
    var sel = $('promptPersonaSelect');
    sel.innerHTML = '';
    state.personas.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id; o.textContent = p.name;
      sel.appendChild(o);
    });
    if (state.activeId) sel.value = state.activeId;
    $('promptText').value = effectiveSystemPrompt();
    fillAvatarFields();
  }

  function setPromptStatus(t) { $('promptStatus').textContent = t || ''; }

  function removeGalleryItem(url) {
    var p = activePersona();
    if (!p) return;
    var overlay = cleanGallery(state.galleryOverlay[p.id] || []);
    var before = overlay.length;
    overlay = overlay.filter(function (g) { return g.url !== url; });
    if (overlay.length !== before) {
      state.galleryOverlay[p.id] = overlay;
      saveGalleryOverlay();
    } else {
      var hidden = (state.galleryHidden[p.id] || []).slice();
      if (hidden.indexOf(url) < 0) hidden.push(url);
      state.galleryHidden[p.id] = hidden;
      saveGalleryHidden();
    }
    var status = $('gallery-status');
    if (status) {
      status.textContent = 'Removed locally (browser only).';
      status.className = 'small ok';
    }
    renderGallery();
  }

  function renderGallery() {
    var p = activePersona();
    var grid = $('gallery-grid');
    grid.innerHTML = '';
    var items = mergedGallery(p);
    $('gallery-empty').hidden = items.length > 0;
    items.forEach(function (g) {
      var wrap = document.createElement('div');
      wrap.className = 'thumb';
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'thumb-remove';
      rm.textContent = 'Remove';
      rm.onclick = function (e) {
        e.stopPropagation();
        if (!confirm('Remove this image from the gallery (this browser)?')) return;
        removeGalleryItem(g.url);
      };
      wrap.appendChild(rm);
      var img = document.createElement('img');
      img.loading = 'lazy'; img.decoding = 'async'; img.alt = g.caption || 'gallery';
      img.referrerPolicy = 'no-referrer';
      img.src = g.url;
      img.addEventListener('error', function () {
        var broken = document.createElement('div');
        broken.className = 'thumb-broken';
        broken.textContent = 'Unavailable';
        if (img.parentNode) img.parentNode.replaceChild(broken, img);
      });
      img.style.cursor = 'zoom-in';
      img.onclick = function () { openLightbox(g.url, g.caption || ''); };
      wrap.appendChild(img);
      var meta = document.createElement('div');
      meta.className = 'thumb-meta';
      if (g.caption || g.tag) {
        var cap = document.createElement('div');
        cap.className = 'thumb-cap';
        if (g.tag) {
          var tag = document.createElement('span');
          tag.className = 'thumb-tag';
          tag.textContent = g.tag;
          cap.appendChild(tag);
        }
        if (g.caption) cap.appendChild(document.createTextNode(g.caption));
        meta.appendChild(cap);
      }
      var src = document.createElement('div');
      src.className = 'thumb-src';
      src.textContent = g._source === 'local' ? 'local' : 'from repo';
      meta.appendChild(src);
      wrap.appendChild(meta);
      grid.appendChild(wrap);
    });
  }

  function renderSettings() {
    var s = state.settings;
    $('baseUrl').value = s.baseUrl;
    $('apiKey').value = s.apiKey;
    $('model').value = s.model;
    $('temperature').value = s.temperature;
    $('tempVal').textContent = s.temperature;
    $('maxTokens').value = s.maxTokens;
    $('stream').checked = !!s.stream;
    $('intensity').value = state.intensity;
  }

  function readSettingsForm() {
    state.settings = {
      baseUrl: $('baseUrl').value.trim() || DEFAULT_SETTINGS.baseUrl,
      apiKey: $('apiKey').value.trim(),
      model: $('model').value.trim(),
      temperature: parseFloat($('temperature').value),
      maxTokens: parseInt($('maxTokens').value, 10) || DEFAULT_SETTINGS.maxTokens,
      stream: $('stream').checked
    };
    state.intensity = normalizeIntensity($('intensity').value);
    save(LS.settings, state.settings);
    localStorage.setItem(LS.intensity, state.intensity);
    refreshHeader();
    if (!state.promptOverrides[state.activeId]) fillPromptEditor();
  }

  function setStatus(text, cls) {
    var el = $('settingsStatus');
    el.textContent = text;
    el.className = 'status ' + (cls || '');
  }

  async function testConnection() {
    readSettingsForm();
    var err = preflightError();
    if (err) { setStatus(err, 'err'); return; }
    setStatus('Testing…');
    try {
      var res = await fetch(apiUrl('/chat/completions'), {
        method: 'POST', headers: buildHeaders(),
        body: JSON.stringify(buildBody([{ role: 'user', content: 'Reply with the single word: OK' }], false, { max_tokens: 10, temperature: 0 }))
      });
      if (!res.ok) { setStatus(await readError(res), 'err'); return; }
      var j = await res.json();
      if (j.error) { setStatus('API error: ' + (j.error.message || JSON.stringify(j.error)), 'err'); return; }
      var c = j.choices && j.choices[0];
      var txt = c ? ((c.message && c.message.content) || c.text || '') : '';
      setStatus('✅ Connected. Model: ' + (j.model || state.settings.model) + '\nReply: ' + (txt || '(empty)'), 'ok');
    } catch (e) {
      setStatus('Network error: ' + e.message + '\n(Check the base URL, your connection, or CORS support.)', 'err');
    }
  }

  function showView(name) {
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.toggle('active', v.id === 'view-' + name);
    });
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-view') === name);
    });
    if (name === 'chat') renderMessages();
    if (name === 'personas') { renderPersonaPicker(); fillAvatarFields(); }
    if (name === 'prompt') fillPromptEditor();
    if (name === 'gallery') renderGallery();
    if (name === 'settings') renderSettings();
  }

  function normalizePersona(raw, id) {
    var p = { id: id };
    ['name', 'tagline', 'personality', 'speaking_style', 'scenario', 'boundaries', 'greeting'].forEach(function (f) {
      p[f] = typeof raw[f] === 'string' ? raw[f].trim() : '';
    });
    if (!p.name) p.name = id;
    p.avatar = normalizeImageUrl(raw.avatar) || '';
    p.gallery = cleanGallery(raw.gallery);
    return p;
  }

  async function fetchText(url) {
    var r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return r.text();
  }

  async function loadPersonas() {
    var ids;
    try {
      ids = JSON.parse(await fetchText('personas/index.json'));
      if (!Array.isArray(ids)) throw new Error('index not array');
    } catch (e) {
      ids = ['default-assistant'];
    }
    var list = [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      try {
        var raw = JSON.parse(await fetchText('personas/' + id + '.json'));
        list.push(normalizePersona(raw, id));
      } catch (e) {
        console.warn('[personas] skip', id, e);
      }
    }
    if (!list.length) {
      list.push(normalizePersona({
        name: 'Default Assistant',
        tagline: 'Fallback starter',
        personality: 'Helpful adult assistant.',
        speaking_style: 'Clear and direct.',
        scenario: 'Private chat.',
        greeting: 'Hey. What are we doing?'
      }, 'default-assistant'));
    }
    state.personas = list;
  }

  async function loadLibPrompt() {
    try {
      var t = (await fetchText('lib/prompt.txt')).trim();
      if (t) state.libText = t;
    } catch (e) {
      state.libText = FALLBACK_LIB;
    }
  }

  function bootGate() {
    if (localStorage.getItem(LS.age) === '1') {
      $('gate').hidden = true;
      $('app').hidden = false;
      return init();
    }
    $('gate').hidden = false;
    $('app').hidden = true;
    $('gate-yes').onclick = function () {
      localStorage.setItem(LS.age, '1');
      $('gate').hidden = true;
      $('app').hidden = false;
      init();
    };
    $('gate-no').onclick = function () { location.href = 'about:blank'; };
  }

  async function init() {
    state.settings = Object.assign({}, DEFAULT_SETTINGS, load(LS.settings, {}) || {});
    if (!state.settings.model) state.settings.model = DEFAULT_SETTINGS.model;
    state.chats = load(LS.chats, {}) || {};
    state.promptOverrides = load(LS.promptOverrides, {}) || {};
    state.galleryOverlay = load(LS.galleryOverlay, {}) || {};
    state.galleryHidden = load(LS.galleryHidden, {}) || {};
    state.avatarOverrides = load(LS.avatarOverrides, {}) || {};
    state.intensity = normalizeIntensity(localStorage.getItem(LS.intensity));

    await loadLibPrompt();
    await loadPersonas();

    state.activeId = localStorage.getItem(LS.persona);
    if (!state.personas.some(function (p) { return p.id === state.activeId; })) {
      state.activeId = (state.personas.find(function (p) { return p.id === 'default-assistant'; }) || state.personas[0]).id;
      localStorage.setItem(LS.persona, state.activeId);
    }

    $('composer').addEventListener('submit', sendMessage);
    $('input').addEventListener('input', autoGrow);
    $('input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
        e.preventDefault(); sendMessage();
      }
    });
    $('btnRegen').onclick = regenerate;
    $('btnStop').onclick = function () { if (state.controller) state.controller.abort(); };
    $('btnClear').onclick = clearChat;

    $('promptPersonaSelect').onchange = function () { switchPersona(this.value); };
    $('btnSavePrompt').onclick = function () {
      var p = activePersona();
      if (!p) return;
      state.promptOverrides[p.id] = $('promptText').value;
      saveOverrides();
      setPromptStatus('Override saved for ' + p.name + ' ✔');
    };
    $('btnResetPrompt').onclick = function () {
      var p = activePersona();
      if (!p) return;
      if (!confirm('Clear the override and rebuild from lib + persona + intensity?')) return;
      delete state.promptOverrides[p.id];
      saveOverrides();
      $('promptText').value = buildSystemPrompt(p);
      setPromptStatus('Reset to built-in for ' + p.name + '.');
    };
    $('btnLoadLib').onclick = async function () {
      setPromptStatus('Loading lib/prompt.txt…');
      await loadLibPrompt();
      var p = activePersona();
      if (p && state.promptOverrides[p.id]) {
        setPromptStatus('lib/prompt.txt reloaded. You still have an override — tap Reset to use the built-in assembly.');
      } else {
        $('promptText').value = buildSystemPrompt(p);
        setPromptStatus('Loaded from lib and rebuilt ✔');
      }
    };

    $('gallery-form').onsubmit = function (ev) {
      ev.preventDefault();
      var p = activePersona();
      if (!p) return;
      var url = normalizeImageUrl($('gallery-url').value);
      var status = $('gallery-status');
      if (!url) {
        status.textContent = 'URL must be http(s) to an image (.jpg .png .webp .gif .avif) or imgchest.com.';
        status.className = 'small err';
        return;
      }
      var item = {
        url: url,
        caption: clean($('gallery-caption').value, 200),
        tag: clean($('gallery-tag').value, 40)
      };
      if (!state.galleryOverlay[p.id]) state.galleryOverlay[p.id] = [];
      var cur = cleanGallery(state.galleryOverlay[p.id]);
      if (mergedGallery(p).some(function (g) { return g.url === url; })) {
        status.textContent = 'That image is already in the gallery.';
        status.className = 'small err';
        return;
      }
      if (mergedGallery(p).length >= MAX_GALLERY) {
        status.textContent = 'Gallery is full (max ' + MAX_GALLERY + ').';
        status.className = 'small err';
        return;
      }
      cur.push(item);
      state.galleryOverlay[p.id] = cur;
      saveGalleryOverlay();
      $('gallery-url').value = '';
      $('gallery-caption').value = '';
      $('gallery-tag').value = '';
      status.textContent = 'Added locally (browser only — commit to GitHub to share).';
      status.className = 'small ok';
      renderGallery();
    };

    if ($('btnSaveAvatar')) $('btnSaveAvatar').onclick = function () { saveAvatarFromInput('avatarUrl'); };
    if ($('btnClearAvatar')) $('btnClearAvatar').onclick = clearAvatar;
    if ($('btnSavePromptAvatar')) $('btnSavePromptAvatar').onclick = function () { saveAvatarFromInput('promptAvatarUrl'); };
    if ($('btnClearPromptAvatar')) $('btnClearPromptAvatar').onclick = clearAvatar;

    var picks = $('modelPicks');
    MODEL_PICKS.forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = m.label;
      b.onclick = function () { $('model').value = m.id; };
      picks.appendChild(b);
    });
    $('temperature').oninput = function () { $('tempVal').textContent = this.value; };
    $('btnShowKey').onclick = function () {
      var k = $('apiKey');
      var show = k.type === 'password';
      k.type = show ? 'text' : 'password';
      this.textContent = show ? 'Hide' : 'Show';
    };
    $('btnSaveSettings').onclick = function () {
      readSettingsForm();
      setStatus('Saved ✔ (stored only in this browser)', 'ok');
      if (!state.promptOverrides[state.activeId]) {
        $('promptText').value = buildSystemPrompt(activePersona());
      }
    };
    $('btnTest').onclick = testConnection;
    $('intensity').onchange = function () {
      state.intensity = normalizeIntensity(this.value);
      localStorage.setItem(LS.intensity, state.intensity);
      if (!state.promptOverrides[state.activeId]) {
        $('promptText').value = buildSystemPrompt(activePersona());
      }
    };

    document.querySelectorAll('.tab').forEach(function (t) {
      t.onclick = function () { showView(t.getAttribute('data-view')); };
    });
    $('lightbox').addEventListener('click', function (e) {
      if (e.target !== $('lightbox-img')) closeLightbox();
    });
    $('lightbox-close').onclick = closeLightbox;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeLightbox();
    });

    renderSettings();
    refreshHeader();
    renderPersonaPicker();
    fillPromptEditor();
    renderGallery();
    startChat(false);
    if (!state.settings.apiKey) {
      showChatError('Welcome! Open ⚙️ Settings to add your API key and model, then come back here to chat.');
    }
  }

  window.PersonaChat = {
    state: state,
    buildSystemPrompt: buildSystemPrompt,
    buildMessages: buildMessages,
    normalizeImageUrl: normalizeImageUrl,
    parseSSELine: parseSSELine,
    effectiveAvatar: effectiveAvatar,
    mergedGallery: mergedGallery,
    personaWithAvatar: personaWithAvatar
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootGate);
  else bootGate();
})();
