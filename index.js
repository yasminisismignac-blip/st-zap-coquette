(() => {
  const RANK = { sent: 1, delivered: 2, read: 3 };
  const CHECK =
    '<svg viewBox="0 0 18 12" width="17" height="12" aria-hidden="true">' +
    '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path class="zc-c1" d="M1.5 6.8L4.7 10L11.2 2.2"/>' +
    '<path class="zc-c2" d="M6.6 6.8L9.8 10L16.3 2.2"/>' +
    '</g></svg>';

  const pending = new Set();
  let generating = false;
  let idleTimer = null;
  let healTimer = null;

  const ctx = () => SillyTavern.getContext();
  const chatEl = () => document.getElementById('chat');
  const getMes = (id) => document.querySelector('#chat .mes[mesid="' + id + '"]');
  const isSys = (el) => el.getAttribute('is_system') === 'true';
  const isUserMes = (el) => el.getAttribute('is_user') === 'true';

  function formatTime(id) {
    try {
      const c = ctx();
      const m = c.chat[id];
      if (m && m.send_date) {
        if (typeof c.timestampToMoment === 'function') {
          const mo = c.timestampToMoment(m.send_date);
          if (mo && mo.isValid()) return mo.format('HH:mm');
        }
        const d = new Date(m.send_date);
        if (!isNaN(d.getTime())) {
          return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        }
      }
    } catch (e) {}
    return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function ensureFooter(el, id) {
    const block = el.querySelector('.mes_block');
    if (!block) return null;
    let f = block.querySelector(':scope > .zc-meta');
    if (!f) {
      f = document.createElement('div');
      f.className = 'zc-meta';
      f.innerHTML = '<span class="zc-time"></span><span class="zc-ticks" data-state="sent">' + CHECK + '</span>';
      const t = block.querySelector('.mes_text');
      if (t) t.after(f);
      else block.append(f);
    }
    f.querySelector('.zc-time').textContent = formatTime(id);
    return f;
  }

  function setState(el, state, force) {
    if (!el) return;
    const t = el.querySelector('.zc-ticks');
    if (!t) return;
    if (force || RANK[state] > RANK[t.dataset.state]) t.dataset.state = state;
  }

  function isSeen(el) {
    if (document.visibilityState !== 'visible') return false;
    const chat = chatEl();
    if (!chat || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const c = chat.getBoundingClientRect();
    if (r.height === 0) return false;
    return r.bottom > c.top + 20 && r.top < c.bottom - 20;
  }

  function checkPending() {
    pending.forEach((el) => {
      if (!el.isConnected) {
        pending.delete(el);
        return;
      }
      if (isSeen(el)) {
        pending.delete(el);
        setTimeout(() => {
          if (isSeen(el)) setState(el, 'read');
          else pending.add(el);
        }, 900);
      }
    });
  }

  function lastUserMes() {
    const list = document.querySelectorAll('#chat .mes[is_user="true"]');
    return list.length ? list[list.length - 1] : null;
  }

  function markAllUserRead() {
    document.querySelectorAll('#chat .mes[is_user="true"]').forEach((el) => setState(el, 'read'));
  }

  function startFresh(id) {
    const el = getMes(id);
    if (!el || isSys(el)) return;
    if (!ensureFooter(el, id)) return;
    setState(el, 'sent', true);
    if (isUserMes(el)) {
      setTimeout(() => setState(el, 'delivered'), 700);
    } else {
      markAllUserRead();
      setTimeout(() => setState(el, 'delivered'), 500);
      pending.add(el);
      checkPending();
    }
  }

  function typingEl(kind) {
    let e = document.getElementById('zc-typing-' + kind);
    if (!e) {
      e = document.createElement('div');
      e.id = 'zc-typing-' + kind;
      e.className = 'zc-typing zc-' + kind;
      e.innerHTML = '<span></span><span></span><span></span>';
    }
    return e;
  }

  function showTyping(kind) {
    const chat = chatEl();
    if (!chat) return;
    const near = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 150;
    const e = typingEl(kind);
    chat.append(e);
    if (near) chat.scrollTop = chat.scrollHeight;
  }

  function hideTyping(kind) {
    const e = document.getElementById('zc-typing-' + kind);
    if (e) e.remove();
  }

  function heal() {
    clearTimeout(healTimer);
    healTimer = setTimeout(() => {
      const lastId = String(ctx().chat.length - 1);
      document.querySelectorAll('#chat .mes').forEach((el) => {
        if (isSys(el)) return;
        if (el.querySelector('.zc-meta')) return;
        const id = el.getAttribute('mesid');
        if (generating && id === lastId) return;
        if (ensureFooter(el, id)) setState(el, 'read', true);
      });
    }, 300);
  }

  function bind() {
    const { eventSource, event_types: et } = ctx();
    const on = (name, fn) => {
      if (et[name]) eventSource.on(et[name], fn);
    };

    on('USER_MESSAGE_RENDERED', (id) => startFresh(id));
    on('CHARACTER_MESSAGE_RENDERED', (id) => {
      hideTyping('bot');
      startFresh(id);
    });

    on('GENERATION_STARTED', (type, params, dry) => {
      if (dry || type === 'quiet') return;
      if (type === 'impersonate') {
        showTyping('user');
        return;
      }
      generating = true;
      showTyping('bot');
      const u = lastUserMes();
      if (u) {
        setState(u, 'delivered');
        setTimeout(() => {
          if (generating) setState(u, 'read');
        }, 900);
      }
    });

    on('STREAM_TOKEN_RECEIVED', () => {
      hideTyping('bot');
      markAllUserRead();
    });
    on('MESSAGE_RECEIVED', () => hideTyping('bot'));
    on('GENERATION_STOPPED', () => {
      generating = false;
      hideTyping('bot');
      hideTyping('user');
    });
    on('GENERATION_ENDED', () => {
      generating = false;
      hideTyping('bot');
      hideTyping('user');
    });
    on('MESSAGE_SENT', () => hideTyping('user'));
    on('CHAT_CHANGED', () => {
      generating = false;
      pending.clear();
      hideTyping('bot');
      hideTyping('user');
      heal();
    });
  }

  function bindTextarea() {
    const ta = document.getElementById('send_textarea');
    if (!ta) return;
    ta.addEventListener('input', () => {
      const v = ta.value.trim();
      if (!v || v.startsWith('/')) {
        hideTyping('user');
        clearTimeout(idleTimer);
        return;
      }
      if (!document.getElementById('zc-typing-user')) showTyping('user');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => hideTyping('user'), 2500);
    });
  }

  jQuery(() => {
    bind();
    bindTextarea();
    const chat = chatEl();
    if (chat) new MutationObserver(heal).observe(chat, { childList: true });
    chat && chat.addEventListener('scroll', checkPending, { passive: true });
    document.addEventListener('visibilitychange', checkPending);
    window.addEventListener('focus', checkPending);
    setInterval(() => {
      if (pending.size) checkPending();
    }, 1000);
    heal();
  });
})();
