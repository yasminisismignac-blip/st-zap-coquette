import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';

const NAME = 'morangozap';
const STEP = 650;
const ORDER = ['sent', 'delivered', 'read'];

const DEFAULTS = {
    enabled: true,
    theme: 'dark',
    ticks: true,
    typing: true,
    userTyping: true,
    clock: true,
    hour12: false,
    header: true,
    doodles: true,
    avatars: false,
    names: false,
    icons: true,
};

const OPTIONS = [
    ['enabled', 'Ativar MorangoZap'],
    ['ticks', 'Tracinhos de visualização (✓ → ✓✓ → azul)'],
    ['typing', 'Bolinhas de "digitando" da IA'],
    ['userTyping', 'Bolinhas de "digitando" minhas'],
    ['clock', 'Horário real nos balões'],
    ['hour12', 'Horário em formato 12h (AM/PM)'],
    ['header', 'Cabeçalho de contato'],
    ['doodles', 'Papel de parede rabiscado'],
    ['icons', 'Trocar ícones por versões fofas'],
    ['avatars', 'Mostrar avatares nos balões'],
    ['names', 'Mostrar nomes nos balões'],
];

const tk = new Map();
const st = {
    gen: false,
    type: '',
    charShow: false,
    tokenSeen: false,
    userTyping: false,
    since: 0,
    ut: null,
    raf: 0,
};

const cfg = () => extension_settings[NAME];
const q = (s, r = document) => r.querySelector(s);
const svgUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

const SVG_TICKS = '<svg viewBox="0 0 18 12" aria-hidden="true"><path class="t1" d="M1.5 6.8L4.7 10L11.2 2.2"/><path class="t2" d="M6.6 6.8L9.8 10L16.3 2.2"/></svg>';

function doodle(color, opacity) {
    const heart = '<path d="M0 7C-13-3-8-13 0-6C8-13 13-3 0 7Z"/>';
    const bow = '<path d="M0 0C-8-8-13-3-11 4C-8 8-3 4 0 0C3 4 8 8 11 4C13-3 8-8 0 0Z"/><path d="M0 0L-4 11M0 0L4 11"/>';
    const berry = '<path d="M0-8C8-9 12-1 7 8C4 12-4 12-7 8C-12-1-8-9 0-8Z"/><path d="M-4-9L0-5L4-9"/><path d="M-3 0h.1M2 2h.1M-1 5h.1M3-2h.1" stroke-width="2.2"/>';
    const spark = '<path d="M0-8L2-2L8 0L2 2L0 8L-2 2L-8 0L-2-2Z"/>';
    const cherry = '<circle cx="-4" cy="5" r="4"/><circle cx="6" cy="6" r="4"/><path d="M-4 1C-3-6 1-9 4-11M6 2C6-4 5-8 4-11"/>';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><g fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
<g transform="translate(34 38) rotate(-14)">${heart}</g>
<g transform="translate(122 30) rotate(10)">${bow}</g>
<g transform="translate(204 62) rotate(12)">${berry}</g>
<g transform="translate(76 112)">${spark}</g>
<g transform="translate(172 132) rotate(-10)">${heart}</g>
<g transform="translate(30 188) rotate(8)">${berry}</g>
<g transform="translate(116 182) rotate(-8)">${bow}</g>
<g transform="translate(206 208)">${spark}</g>
<g transform="translate(62 226) scale(.8)">${cherry}</g>
<g transform="translate(150 84)"><circle r="2.4"/></g>
<g transform="translate(16 112)"><circle r="2.4"/></g>
<g transform="translate(220 150)"><circle r="2.4"/></g>
</g></svg>`;
}

function installAssets() {
    const root = document.documentElement.style;
    root.setProperty('--mz-doodle-light', svgUrl(doodle('#d6457f', 0.16)));
    root.setProperty('--mz-doodle-dark', svgUrl(doodle('#ff9ec9', 0.11)));
    root.setProperty('--mz-ico-send', svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="black" d="M2.5 20.5L22 12 2.5 3.5v6.6l13 1.9-13 1.9z"/></svg>'));
    root.setProperty('--mz-ico-mic', svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="black" d="M12 15a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v5a4 4 0 0 0 4 4zm6-4a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.93V22h2v-3.07A8 8 0 0 0 20 11z"/></svg>'));
}

function parseDate(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return new Date(v);
    const d = new Date(v);
    if (!isNaN(d)) return d;
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})@(\d{1,2})h(\d{1,2})m(\d{1,2})s/.exec(String(v));
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    try {
        const mm = window.moment?.(v);
        if (mm?.isValid()) return mm.toDate();
    } catch (e) { /* noop */ }
    return null;
}

function fmt(d) {
    const h12 = !!cfg().hour12;
    return d.toLocaleTimeString(undefined, { hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', hour12: h12 });
}

function schedule() {
    if (st.raf) return;
    st.raf = requestAnimationFrame(decorateAll);
}

function decorateAll() {
    st.raf = 0;
    const chat = q('#chat');
    if (!chat) return;
    const list = getContext().chat || [];
    let prev = null;
    chat.querySelectorAll(':scope > .mes').forEach((mes) => {
        const user = mes.getAttribute('is_user') === 'true';
        const sys = mes.getAttribute('is_system') === 'true';
        const id = Number(mes.getAttribute('mesid'));
        let meta = mes.querySelector(':scope > .mz-meta');
        if (!meta) {
            meta = document.createElement('div');
            meta.className = 'mz-meta';
            meta.innerHTML = `<span class="mz-time"></span><span class="mz-ticks">${SVG_TICKS}</span>`;
            mes.appendChild(meta);
        }
        let d = parseDate(list[id]?.send_date);
        if (!d) {
            if (!mes.dataset.mzTs) mes.dataset.mzTs = String(Date.now());
            d = new Date(Number(mes.dataset.mzTs));
        }
        const label = fmt(d);
        const timeEl = meta.querySelector('.mz-time');
        if (timeEl.textContent !== label) timeEl.textContent = label;
        const status = user ? (tk.get(id)?.status || 'read') : '';
        if (meta.dataset.status !== status) meta.dataset.status = status;
        mes.classList.toggle('mz-first', !prev || prev.user !== user || prev.sys !== sys);
        prev = { user, sys };
    });
}

function paintTicks(id) {
    const mes = q(`#chat > .mes[mesid="${id}"]`);
    const meta = mes && mes.querySelector(':scope > .mz-meta');
    if (!meta) return;
    const status = tk.get(id)?.status || 'read';
    const was = meta.dataset.status;
    meta.dataset.status = status;
    if (status === 'read' && was !== 'read') {
        meta.classList.add('mz-flash');
        setTimeout(() => meta.classList.remove('mz-flash'), 700);
    }
}

function pump(id) {
    const e = tk.get(id);
    if (!e || e.timer) return;
    const cur = ORDER.indexOf(e.status);
    const target = ORDER.indexOf(e.want);
    if (cur >= target) return;
    e.timer = setTimeout(() => {
        e.timer = null;
        e.status = ORDER[ORDER.indexOf(e.status) + 1];
        e.at = Date.now();
        paintTicks(id);
        if (e.status === 'read') checkCharShow();
        pump(id);
    }, Math.max(0, e.at + STEP - Date.now()));
}

function want(id, target) {
    const e = tk.get(id);
    if (!e) return;
    if (ORDER.indexOf(target) > ORDER.indexOf(e.want)) e.want = target;
    pump(id);
}

function allRead() {
    tk.forEach((e, id) => want(id, 'read'));
}

function pending() {
    return [...tk.values()].some((e) => e.status !== 'read');
}

function checkCharShow() {
    if (st.gen && st.type !== 'impersonate' && !st.tokenSeen && !pending()) {
        st.charShow = true;
        refresh();
    }
}

function keepBottom() {
    const chat = q('#chat');
    if (!chat) return;
    const near = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 220;
    if (near) requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });
}

function refresh() {
    const c = cfg();
    const el = q('#mz-typing');
    if (!el) return;
    let side = '';
    if (c.enabled) {
        if (c.typing && st.gen && st.charShow) side = 'left';
        else if (c.userTyping && ((st.gen && st.type === 'impersonate') || st.userTyping)) side = 'right';
    }
    const was = el.dataset.side || '';
    el.dataset.side = side;
    document.body.classList.toggle('mz-typing-on', !!side);
    if (side && side !== was) keepBottom();
    const status = q('#mz-status');
    if (status) {
        const typing = !!(c.enabled && c.typing && st.gen && st.type !== 'impersonate');
        status.textContent = typing ? 'digitando...' : 'online';
        status.classList.toggle('typing', typing);
    }
}

function onSent(id) {
    if (!cfg().enabled) return;
    const n = Number(id);
    tk.set(n, { status: 'sent', want: 'sent', at: Date.now(), timer: null });
    st.userTyping = false;
    clearTimeout(st.ut);
    setTimeout(() => want(n, 'delivered'), 2600);
    schedule();
    refresh();
}

function onGenStart(type, opts, dry) {
    if (!cfg().enabled || dry === true || type === 'quiet') return;
    st.gen = true;
    st.type = type || 'normal';
    st.tokenSeen = false;
    st.since = Date.now();
    st.userTyping = false;
    clearTimeout(st.ut);
    const waiting = pending();
    st.charShow = st.type !== 'impersonate' && !waiting;
    allRead();
    refresh();
}

function onToken() {
    if (!st.gen) return;
    if (!st.tokenSeen) {
        st.tokenSeen = true;
        st.charShow = false;
        allRead();
        refresh();
    }
}

function onReceived() {
    if (!st.gen) return;
    st.tokenSeen = true;
    st.charShow = false;
    allRead();
    refresh();
    schedule();
}

function onGenEnd() {
    st.gen = false;
    st.charShow = false;
    st.tokenSeen = false;
    allRead();
    refresh();
    schedule();
}

function onChatChanged() {
    tk.forEach((e) => clearTimeout(e.timer));
    tk.clear();
    st.gen = false;
    st.charShow = false;
    st.userTyping = false;
    const ctx = getContext();
    document.body.classList.toggle('mz-group', !!ctx.groupId);
    updateHeader();
    refresh();
    schedule();
}

function onInput() {
    const ta = q('#send_textarea');
    if (!ta) return;
    const has = !!ta.value.trim();
    document.body.classList.toggle('mz-has-text', has);
    if (!cfg().enabled) return;
    clearTimeout(st.ut);
    if (has && !st.gen) {
        st.userTyping = true;
        st.ut = setTimeout(() => { st.userTyping = false; refresh(); }, 2200);
    } else {
        st.userTyping = false;
    }
    refresh();
}

function updateHeader() {
    const nameEl = q('#mz-name');
    const img = q('#mz-avatar');
    if (!nameEl || !img) return;
    const c = getContext();
    let name = c.name2 || 'MorangoZap';
    let src = '/img/ai4.png';
    if (c.groupId) {
        const g = (c.groups || []).find((x) => x.id == c.groupId);
        if (g?.name) name = g.name;
    } else if (c.characterId !== undefined && c.characters?.[c.characterId]) {
        const ch = c.characters[c.characterId];
        name = ch.name || name;
        if (ch.avatar && ch.avatar !== 'none') src = `/thumbnail?type=avatar&file=${encodeURIComponent(ch.avatar)}`;
    }
    nameEl.textContent = name;
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
}

function applyClasses() {
    const s = cfg();
    const b = document.body;
    b.classList.toggle('mz-on', !!s.enabled);
    b.dataset.mzTheme = s.theme === 'light' ? 'light' : 'dark';
    [
        ['mz-ticks-on', s.ticks],
        ['mz-clock', s.clock],
        ['mz-header', s.header],
        ['mz-doodles', s.doodles],
        ['mz-avatars', s.avatars],
        ['mz-names', s.names],
        ['mz-icons', s.icons],
    ].forEach(([c, v]) => b.classList.toggle(c, !!v));
    document.querySelectorAll('#mz-chatbar .mz-themes button').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.theme === b.dataset.mzTheme);
    });
    document.querySelectorAll('#mz_settings [data-mz]').forEach((inp) => {
        const k = inp.dataset.mz;
        if (inp.type === 'checkbox') inp.checked = !!s[k];
        else inp.value = s[k];
    });
}

function buildUI() {
    const sheld = q('#sheld') || document.body;
    const chat = q('#chat');
    if (!q('#mz-chatbar')) {
        const bar = document.createElement('div');
        bar.id = 'mz-chatbar';
        bar.innerHTML = `
<button type="button" id="mz-back" aria-label="Contatos"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
<span class="mz-av"><img id="mz-avatar" alt="" src="/img/ai4.png"></span>
<div class="mz-who"><div id="mz-name">MorangoZap</div><div id="mz-status">online</div></div>
<div class="mz-themes"><button type="button" data-theme="light" title="Claro">☀️</button><button type="button" data-theme="dark" title="Escuro">🌙</button></div>`;
        sheld.insertBefore(bar, sheld.firstChild);
    }
    if (!q('#mz-typing-wrap')) {
        const wrap = document.createElement('div');
        wrap.id = 'mz-typing-wrap';
        wrap.innerHTML = '<div id="mz-typing" data-side=""><i></i><i></i><i></i></div>';
        if (chat && chat.parentNode === sheld) chat.after(wrap);
        else sheld.appendChild(wrap);
    }
    q('#mz-avatar').addEventListener('error', (e) => {
        if (e.target.getAttribute('src') !== '/img/ai4.png') e.target.setAttribute('src', '/img/ai4.png');
    });
    q('#mz-back').addEventListener('click', () => q('#rightNavDrawerIcon')?.click());
    q('#mz-avatar').addEventListener('click', () => q('#rightNavDrawerIcon')?.click());
    q('#mz-name').addEventListener('click', () => q('#rightNavDrawerIcon')?.click());
    q('#mz-chatbar .mz-themes').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-theme]');
        if (!btn) return;
        cfg().theme = btn.dataset.theme;
        saveSettingsDebounced();
        applyClasses();
    });
}

function buildSettings() {
    if (q('#mz_settings')) return;
    const host = q('#extensions_settings2') || q('#extensions_settings');
    if (!host) return;
    const rows = OPTIONS.map(([k, label]) => `<label class="checkbox_label"><input type="checkbox" data-mz="${k}"><span>${label}</span></label>`).join('');
    host.insertAdjacentHTML('beforeend', `
<div id="mz_settings" class="inline-drawer">
  <div class="inline-drawer-toggle inline-drawer-header"><b>🍓 MorangoZap</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
  <div class="inline-drawer-content">
    <label for="mz_theme">Tema</label>
    <select id="mz_theme" class="text_pole" data-mz="theme"><option value="dark">🌙 Escuro</option><option value="light">☀️ Claro</option></select>
    ${rows}
  </div>
</div>`);
}

function bindEvents() {
    const on = (n, f) => {
        const t = event_types[n];
        if (t) eventSource.on(t, f);
    };
    on('MESSAGE_SENT', onSent);
    on('USER_MESSAGE_RENDERED', schedule);
    on('CHARACTER_MESSAGE_RENDERED', schedule);
    on('MESSAGE_RECEIVED', onReceived);
    on('GENERATION_STARTED', onGenStart);
    on('GENERATION_ENDED', onGenEnd);
    on('GENERATION_STOPPED', onGenEnd);
    on('STREAM_TOKEN_RECEIVED', onToken);
    on('CHAT_CHANGED', onChatChanged);
    on('MESSAGE_DELETED', () => { tk.clear(); schedule(); });
    on('MESSAGE_SWIPED', schedule);
    on('MESSAGE_UPDATED', schedule);
    on('MESSAGE_EDITED', schedule);
    on('CHARACTER_EDITED', updateHeader);
    on('GROUP_UPDATED', updateHeader);

    document.addEventListener('input', (e) => {
        if (e.target && e.target.id === 'send_textarea') onInput();
    }, true);

    document.addEventListener('change', (e) => {
        const t = e.target;
        if (!t.closest || !t.closest('#mz_settings')) return;
        const k = t.dataset.mz;
        if (!k) return;
        cfg()[k] = t.type === 'checkbox' ? t.checked : t.value;
        saveSettingsDebounced();
        applyClasses();
        updateHeader();
        decorateAll();
        refresh();
    });

    const chat = q('#chat');
    if (chat) {
        new MutationObserver(schedule).observe(chat, { childList: true });
        chat.addEventListener('click', (e) => {
            const mes = e.target.closest('.mes');
            if (!mes) return;
            if (e.target.closest('a,button,input,textarea,select,summary,.mes_buttons,.mes_edit_buttons,.swipe_left,.swipe_right,.swipeRightBlock,.mes_img,.mes_reasoning_header')) return;
            const was = mes.classList.contains('mz-actions');
            chat.querySelectorAll('.mes.mz-actions').forEach((m) => m.classList.remove('mz-actions'));
            if (!was) mes.classList.add('mz-actions');
        });
    }

    setInterval(() => {
        const ta = q('#send_textarea');
        if (ta) document.body.classList.toggle('mz-has-text', !!ta.value.trim());
        if (st.gen && Date.now() - st.since > 6000) {
            const stop = q('#mes_stop');
            if (!stop || getComputedStyle(stop).display === 'none') onGenEnd();
        }
        if (st.userTyping && ta && !ta.value.trim()) {
            st.userTyping = false;
            refresh();
        }
    }, 800);
}

jQuery(() => {
    extension_settings[NAME] = Object.assign({}, DEFAULTS, extension_settings[NAME]);
    installAssets();
    buildUI();
    buildSettings();
    applyClasses();
    bindEvents();
    document.body.classList.toggle('mz-group', !!getContext().groupId);
    updateHeader();
    onInput();
    refresh();
    decorateAll();
});
