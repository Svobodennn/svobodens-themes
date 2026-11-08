// The playground itself: the three frames on one screen, the theme switch as the app makes it, and the panel's
// controls. Probes and links drive it the same way: PG.run(<action id>), or #theme=<id>&do=<id>,<id> in the address.
(() => {
  const PG = window.PG;
  const D = JSON.parse(document.getElementById('pg-data').textContent);
  const M = PG.mocks;
  const esc = M.esc;
  PG.data = D;
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const byId = new Map(D.themes.map((t) => [t.id, t]));
  const store = {
    get: (k, d) => {
      try {
        return JSON.parse(localStorage.getItem(`svb-playground.${k}`)) ?? d;
      } catch {
        return d;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(`svb-playground.${k}`, JSON.stringify(v));
      } catch {}
    },
  };

  // ---------- the log and the frames' errors ----------
  const errors = [];
  PG.errors = errors;
  PG.log = (msg, bad) => {
    const li = document.createElement('li');
    li.textContent = msg;
    if (bad) li.className = 'bad';
    const list = $('pg-log');
    list.prepend(li);
    while (list.children.length > 80) list.lastElementChild.remove();
  };
  PG.frameError = (frame, msg) => {
    errors.push(`${frame}: ${msg}`);
    $('pg-errors').textContent = `${errors.length} error${errors.length === 1 ? '' : 's'} in the frames`;
    $('pg-errors').classList.add('bad');
    PG.log(`${frame}: ${msg}`, true);
  };
  let sound = false;
  PG.sound = () => sound;
  PG.noticesReady = () => PG.log('notices ready');

  // ---------- the screen ----------
  const SIZES = ['1440x900', '1280x800', '1680x1050', '1920x1080', '1100x760', '900x700'];
  let size = SIZES.includes(store.get('size')) ? store.get('size') : SIZES[0];
  let scale = 1;
  PG.scale = () => scale;
  PG.screen = () => {
    const [w, h] = size.split('x').map(Number);
    return { w, h };
  };
  function fit() {
    const { w, h } = PG.screen();
    const stage = $('pg-stage');
    const s = Math.min((stage.clientWidth - 32) / w, (stage.clientHeight - 32) / h, 1);
    Object.assign($('pg-screen').style, { width: `${w}px`, height: `${h}px`, transform: `scale(${s})` });
    Object.assign($('pg-fit').style, { width: `${w * s}px`, height: `${h * s}px` });
    scale = s;
    $('pg-scale').textContent = `${size.replace('x', ' × ')} at ${Math.round(s * 100)}%`;
    PG.replaceNotices?.();
  }

  // ---------- the theme, as ThemeStore shows it ----------
  let kept = byId.has(store.get('theme')) ? store.get('theme') : D.themes[0].id;
  let current = kept;
  let uiFont = D.fonts.some((f) => f.id === store.get('font')) ? store.get('font') : 'mono';
  const cssFor = (id) => PG.assembleCss(byId.get(id).base, D.fonts.find((f) => f.id === uiFont).css, D.refresh.rule);
  // What the app runs on every page (ThemeStore.repaint): window.__theme(css, id); a checkout whose __theme doesn't
  // refresh the pseudo-elements gets the playground's own refresh after it.
  function paint(f) {
    if (!f.win || !f.win.__theme) return;
    f.win.__theme(cssFor(current), current);
    if (D.refresh.mode === 'playground') {
      const h = f.doc.documentElement;
      h.classList.add(D.refresh.cls);
      void h.offsetHeight;
      h.classList.remove(D.refresh.cls);
    }
  }
  const repaint = () => Object.values(frames).forEach(paint);
  // ThemeStore.show: nothing when it's the one showing.
  function show(id) {
    if (!byId.has(id) || id === current) return;
    current = id;
    repaint();
    soundRow();
    $('pg-theme').value = id;
    $('pg-current').textContent = byId.get(id).name + (id === kept ? '' : ' (pointed at)');
  }
  function choose(id) {
    if (!byId.has(id)) return;
    kept = id;
    store.set('theme', id);
    show(id);
    $('pg-current').textContent = byId.get(id).name;
  }
  PG.show = show;
  PG.choose = choose;
  PG.current = () => current;
  // The one-shot intros play when a theme comes on: away to another theme and back (each switch lays the page out, so
  // the theme's pseudo-elements go and come back new).
  async function replay() {
    const back = current;
    show(back === D.themes[0].id ? D.themes[1].id : D.themes[0].id);
    await wait(50);
    show(back);
  }

  // ---------- the frames ----------
  const frames = {};
  PG.frames = frames;
  const ready = {};
  function load(name, friend = null) {
    const el = $(`pg-${name}`);
    if (name === 'notices') {
      fired = false;
      try {
        localStorage.removeItem('fireDay');
      } catch {}
    }
    const f = (frames[name] = { name, el, win: null, doc: null });
    ready[name] = new Promise((resolve) => {
      el.onload = () => {
        f.win = el.contentWindow;
        f.doc = el.contentDocument;
        try {
          SETUP[name](f);
        } catch (e) {
          PG.frameError(name, `playground setup: ${e.message}`);
        }
        watch(f);
        resolve(f);
      };
    });
    el.srcdoc = D.frames[name]
      .replace(D.cssSlot, () => JSON.stringify(cssFor(current)).replace(/</g, '\\u003c'))
      .replace(D.friendSlot, () => JSON.stringify(friend).replace(/</g, '\\u003c'));
    return ready[name];
  }
  const loadAll = () => Promise.all(['dash', 'notices', 'overlay'].map(load));

  // The attributes the theme hooks put on each page's <html>, as they are now.
  function watch(f) {
    const out = () => {
      const h = f.doc.documentElement;
      const attrs = [...h.attributes].filter((a) => a.name.startsWith('data-')).map((a) => `${a.name}="${a.value}"`);
      const vars = [...h.style].filter((p) => p.startsWith('--')).map((p) => `${p}: ${h.style.getPropertyValue(p)}`);
      const cls = h.className ? [`class="${h.className}"`] : [];
      $(`pg-attrs-${f.name}`).textContent = [...attrs, ...vars, ...cls].join('\n') || '—';
    };
    new MutationObserver(out).observe(f.doc.documentElement, { attributes: true });
    out();
  }
  const hooks = (name) => frames[name] && frames[name].win && frames[name].win.Hooks;

  // ---------- the dashboard: sessions ----------
  const NAMES = ['night-city', 'afterlife', 'watson', 'pacifica', 'kabuki', 'japantown', 'heywood', 'arasaka', 'badlands', 'dogtown'];
  const TITLES = ['refactor the orbit renderer', 'migrate the user table', 'write the release notes', 'fix the flaky login test', 'port hooks.js to Windows', 'tune the matrix rain'];
  const WHY = ['approve: rm -rf build/', 'Bash: npm publish', 'allow WebFetch to github.com?', 'Edit app/Sources/Themes.swift'];
  let seq = 0;
  let sessions = [];
  function session(status) {
    const i = seq++;
    const now = Date.now();
    return {
      id: `s${i}`, hue: i, name: NAMES[i % NAMES.length], status, title: TITLES[i % TITLES.length], cwd: '~/development/atalay-terminal', branch: 'main',
      statusSince: now - (40 + i * 37) * 1000, lastTs: now - (i + 1) * 60_000, ctx: 40_000 + i * 31_000, ctxMax: 200_000, model: 'opus · high', tools: 12 + i * 7,
      web: i % 4, errors: status === 'waiting' ? 1 : 0, cost: 0.4 + i * 0.85, spark: [0, 1, 3, 2, 5, 4, 6, 3, 2, 1, 4, 5].map((v, k) => (v + i + k) % 7),
      agents: status === 'busy' && i % 2 ? 2 : 0, waitingFor: WHY[i % WHY.length], last: { n: 'Edit', l: 'orbit.js' }, turnMs: 82_000, clash: null,
    };
  }
  function renderSessions() {
    const d = frames.dash.doc;
    d.getElementById('sessions').innerHTML = sessions.length ? sessions.map(M.card).join('') : M.noSessions();
    const c = M.call(sessions);
    d.getElementById('p-call').classList.toggle('hot', c.hot);
    d.getElementById('m-call').textContent = c.meta;
    d.getElementById('call').innerHTML = c.body;
    d.getElementById('k-sessions').textContent = String(sessions.filter((s) => s.status !== 'ended').length);
    // app.js renderAll (theme hooks): how many need you, how many work.
    const H = hooks('dash');
    if (H) {
      H.set('waiting', sessions.filter((s) => s.status === 'waiting').length);
      H.set('working', sessions.filter((s) => s.status === 'busy').length);
    }
  }
  const add = (...statuses) => {
    sessions = [...statuses.map(session), ...sessions];
    renderSessions();
  };
  // app.js transitions(): a session that comes to need you flashes the edges; it and "your turn" are moments too.
  function change(s, status) {
    sessions = sessions.map((x) => (x === s ? { ...x, status, statusSince: Date.now(), errors: status === 'waiting' ? 1 : x.errors } : x));
    renderSessions();
    if (status === 'waiting') flash();
    if (status === 'waiting' || status === 'idle') hooks('dash')?.pulse('session-status', { value: status, sid: s.id });
  }
  function turn(status) {
    const s = sessions.find((x) => x.status === 'busy') || sessions.find((x) => x.status !== status);
    if (!s) return add('busy') || turn(status);
    change(s, status);
  }
  const CYCLE = { busy: 'waiting', waiting: 'idle', idle: 'ended', ended: 'busy' };
  // app.js flashEdge()
  function flash() {
    const f = frames.dash.doc.getElementById('flash');
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }
  // app.js toast()
  let toastTimer = 0;
  function toast(msg) {
    const t = frames.dash.doc.getElementById('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
  }
  // The launch: a fresh #boot as the page starts with, gone (app.js handleInit) once the window is up.
  let bootTimer = 0;
  function boot(hold) {
    const d = frames.dash.doc;
    const old = d.getElementById('boot');
    const fresh = old.cloneNode(true);
    fresh.classList.remove('gone');
    old.replaceWith(fresh);
    clearTimeout(bootTimer);
    if (!hold) bootTimer = setTimeout(() => fresh.classList.add('gone'), Number($('pg-boot-ms').value));
  }
  const unboot = () => frames.dash.doc.getElementById('boot').classList.add('gone');
  // cloud.js showView() + git.js mark(): a view of the activity bar where the dashboard's middle is.
  function view(v) {
    const d = frames.dash.doc;
    closeMenus();
    d.getElementById('app').classList.toggle('cloud-mode', v !== 'dash');
    for (const el of d.querySelectorAll('.cv')) el.classList.toggle('on', el.id === `${v}-view`);
    d.querySelectorAll('#activity .vs-ab').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    if (v === 'themes') {
      d.getElementById('themes-view').innerHTML = M.themesView(D.themes, kept);
      bindThemes(d);
    }
    if (v === 'notifications') d.getElementById('notifications-view').innerHTML = M.notesView(PG.mock.notes);
    if (v === 'friends') d.getElementById('friends-view').innerHTML = M.friendsView(PG.mock.friends, frames.dash.win.Xp, frames.dash.win.Social);
  }
  // cloud.js openThemes(): pointing at a card shows its theme, a click keeps it, leaving the cards goes back.
  function bindThemes(d) {
    const cards = [...d.querySelectorAll('.th-card')];
    let timer = 0;
    const point = (id) => {
      clearTimeout(timer);
      timer = setTimeout(() => show(id), 90);
    };
    cards.forEach((card) => {
      card.onmouseenter = () => {
        cards.forEach((c) => c.classList.toggle('hot', c === card));
        point(card.dataset.id);
      };
      card.onclick = () => {
        clearTimeout(timer);
        choose(card.dataset.id);
        themeKept(card.dataset.id);
        cards.forEach((c) => {
          c.classList.toggle('on', c === card);
          c.querySelector('.th-name em').textContent = c === card ? 'ACTIVE' : '';
        });
      };
    });
    d.querySelector('.th-grid').onmouseleave = () => {
      cards.forEach((c) => c.classList.remove('hot'));
      point(kept);
    };
  }
  function closeMenus() {
    for (const f of Object.values(frames)) f.doc?.querySelectorAll('.pn-ctx, .mn-ctx, .bdg-ctx, .pk-ctx, .sc-ctx').forEach((m) => m.remove());
  }
  function menu(cls, html, x, y, parent) {
    const d = frames.dash.doc;
    closeMenus();
    const m = d.createElement('div');
    m.className = cls;
    m.innerHTML = html;
    (parent || d.body).appendChild(m);
    Object.assign(m.style, { left: `${x}px`, top: `${y}px` }, cls.includes('bdg-ctx') ? { position: 'fixed' } : {});
    return m;
  }
  // app.js panelMenu(), at a panel's header
  function panelMenu(x, y) {
    const r = frames.dash.doc.querySelector('#p-files > header').getBoundingClientRect();
    const w = frames.dash.win.innerWidth;
    menu('pn-ctx', M.panelMenu, x ?? Math.min(r.left + 40, w - 200), y ?? r.top + 18);
  }
  // cloud.js friendMenu(), on the friends view's second row
  function friendMenu() {
    view('friends');
    const d = frames.dash.doc;
    const box = d.getElementById('friends-view').getBoundingClientRect();
    const row = d.querySelectorAll('.mn-friends .mn-row')[1].getBoundingClientRect();
    const m = menu('mn-ctx', M.friendMenu, Math.min(row.left + 120 - box.left, box.width - 190), Math.min(row.top + 14 - box.top, box.height - 150), d.getElementById('friends-view'));
    m.style.setProperty('--glow', 'var(--accent-rgb)');
  }
  // badges.js contextMenu(): fixed, by the pointer
  const badgeMenu = () => menu('mn-ctx bdg-ctx', M.badgeMenu, Math.min(420, frames.dash.win.innerWidth - 220), 120);

  const SETUP = {
    dash(f) {
      const d = f.doc;
      const app = d.getElementById('app');
      // cloud.js's views come before git.js's activity bar, as their scripts run.
      for (const v of ['friends', 'board', 'themes', 'notifications']) {
        const el = d.createElement('section');
        el.id = `${v}-view`;
        el.className = 'cv';
        app.appendChild(el);
      }
      const bar = d.createElement('nav');
      bar.id = 'activity';
      bar.innerHTML = M.activity(D.codicons);
      app.appendChild(bar);
      d.getElementById('boot').classList.add('gone');
      if (!sessions.length) add('busy', 'waiting', 'idle', 'ended');
      else renderSessions();
      if (updateOn) offerUpdate(true);
      bar.addEventListener('click', (e) => {
        const b = e.target.closest('[data-view]');
        if (b && ['dash', 'friends', 'themes', 'notifications'].includes(b.dataset.view)) view(b.dataset.view);
      });
      d.getElementById('sessions').addEventListener('click', (e) => {
        const card = e.target.closest('.card');
        const s = card && sessions.find((x) => x.id === card.dataset.key);
        if (s) change(s, CYCLE[s.status]);
      });
      d.addEventListener('contextmenu', (e) => {
        const panel = e.target.closest('section.panel[id^="p-"]');
        if (!panel) return;
        e.preventDefault();
        panelMenu(e.clientX, e.clientY);
      });
      d.addEventListener('mousedown', (e) => !e.target.closest('.pn-ctx, .mn-ctx') && closeMenus());
      f.win.addEventListener('keydown', (e) => e.key === 'Escape' && view('dash'));
      setWindow(windowState);
    },
    notices(f) {
      f.win.__messages.focus(front);
    },
    overlay() {},
    chat() {},
  };
  let windowState = 'front';
  // app.js setVisibility(): behind other windows the dashboard's decorations rest; hidden, they stop.
  function setWindow(state) {
    windowState = state;
    const h = frames.dash.doc.documentElement;
    h.classList.toggle('paused', state === 'hidden');
    h.classList.toggle('behind', state === 'behind');
  }
  let updateOn = false;
  function offerUpdate(on) {
    updateOn = on;
    const b = frames.dash.doc.getElementById('update');
    b.hidden = !on;
    b.innerHTML = M.updateButton;
    b.title = "Version 0.20.0 is out · it downloads by itself and installs when you step away · click to see what's new";
  }

  // ---------- the notices: messages.js's own code, through its __messages ----------
  const N = () => frames.notices.win.__messages;
  const Social = () => frames.notices.win.Social;
  let front = true;
  let fired = false;
  let level = 23;
  let n = 0;
  const at = () => new Date().toISOString();
  const friend = (i) => PG.mock.friends[i % PG.mock.friends.length];
  const stranger = () => ({ id: `u${++n}`, name: ['river', 'misty', 'kerry', 'rogue'][n % 4], tag: 400 + n, presence: 'online', xp: { level: 9 + n } });
  const BOUNDS = [5, 15, 25, 35, 45, 55];
  const NOTICES = {
    message: () => N().event({ type: 'message', with: friend(n).id, from: friend(n++), message: { id: Date.now(), body: 'meet me at the afterlife, the job is on. bring the shard.', at: at(), mine: false } }),
    request: () => N().event({ type: 'request', request: { id: `r${++n}`, from: stranger(), at: at() } }),
    friend: () => N().event({ type: 'friend', accepted: true, requestId: null, friend: stranger() }),
    // A friend offline long enough (messages.js counts only a return after ten minutes away).
    online: () => {
      const f = Social().state().friends.find((x) => x.presence !== 'online') || Social().state().friends[0];
      f.presence = 'offline';
      N().event({ type: 'presence', id: f.id, presence: 'online' });
    },
    update: () => N().update({ version: '0.20.0' }),
    updated: () => N().updated('0.19.0'),
    note: () => N().event({ type: 'notification', notification: { id: `n${Date.now()}`, title: 'Themes from the community', body: 'Three new themes came with this update: pick one in the themes view.', at: at() } }),
    xp: () => N().event({ type: 'xp', reason: 'daily', gained: 120, xp: { level } }),
    // Five hours today: once a day, the day kept by messages.js as it starts (its storage is this page's); a second time
    // needs the notices page started again.
    fire: async () => {
      if (fired) await load('notices');
      fired = true;
      N().event({ type: 'xp', xp: { level, today: 5 * 3600 + 60 } });
    },
    wait: () => N().wait({ sid: `w${++n}`, title: TITLES[n % TITLES.length], folder: 'atalay-terminal', what: WHY[n % WHY.length] }),
    'wait-over': () => {
      for (let i = 0; i <= n; i++) N().waitOver(`w${i}`);
    },
    clash: () => N().clash({ key: `/repo/app/orbit${++n}.js`, file: `orbit${n}.js`, path: `~/development/atalay-terminal/app/orbit${n}.js`, chats: ['night-city', 'afterlife'] }),
    'clash-over': () => {
      for (let i = 0; i <= n; i++) N().clashOver(`/repo/app/orbit${i}.js`);
    },
    danger: () => N().runaways([{ pid: 4242, started: 1_731_000_000, cpu: 99.4, name: 'node' }]),
    'danger-over': () => N().runaways([]),
    levelup: () => {
      N().focus(true);
      N().xp({ level });
      N().xp({ level: ++level });
    },
    rankup: () => {
      N().focus(true);
      const b = BOUNDS.find((x) => x > level) || BOUNDS[1];
      N().xp({ level: b - 1 });
      N().xp({ level: (level = b) });
    },
    badge: () => {
      N().focus(true);
      N().event({ type: 'badge', badges: [{ id: 'streak', tier: 3 }], quiet: false });
    },
    close: () => {
      N().skip();
      frames.notices.win.dispatchEvent(new (frames.notices.win.KeyboardEvent)('keydown', { key: 'Escape' }));
    },
  };

  // ---------- a friend's chat: messages.html as a chat panel, its own code (frameHTML, paint, paintList, send) ----------
  // Swift opens a friend's chat as a panel of its own (Messages.swift openChat: MessagePanel(.chat, friend:), then
  // __messages.open(id)); here each chat opened is that panel new, for that friend.
  const C = () => frames.chat && frames.chat.win && frames.chat.win.__messages;
  let chatWith = null;
  async function openChat(id) {
    chatWith = id;
    await load('chat', id);
    await C().open(id);
  }
  PG.openChat = (id) => openChat(id).catch((e) => PG.frameError('chat', e.message));
  // A live event goes to the notices and to every open chat (Swift: notices.push, pushToChats).
  function push(ev) {
    N().event(ev);
    C()?.event(ev);
  }
  // Typed into the chat's own box and sent with ↩, as you would.
  function type(text) {
    const w = frames.chat.win;
    const ta = frames.chat.doc.querySelector('.mb-input textarea');
    ta.value = text;
    ta.dispatchEvent(new w.Event('input', { bubbles: true }));
    ta.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }
  const openNow = () => (C() && frames.chat.doc.querySelector('#chatwin .mb.open') ? Promise.resolve() : openChat('f-vee'));
  const CHAT = {
    // vee: online, yesterday and today, earlier messages to load
    open: () => openChat('f-vee'),
    // jackie: no messages yet
    empty: () => openChat('f-jackie'),
    // panam: the chat open, then they remove you (the unfriended event)
    gone: async () => {
      await openChat('f-panam');
      push({ type: 'unfriended', id: 'f-panam' });
    },
    // two of yours: one the server hasn't answered yet, one that couldn't go (offline: click it to send again)
    pending: async () => {
      await openNow();
      PG.nextSends.push('hold', 'fail');
      type('pushing the fix now');
      await wait(60);
      type('sent you the table');
    },
    // theirs, arriving while it's open
    incoming: async () => {
      await openNow();
      const f = PG.mock.friends.find((x) => x.id === chatWith) || PG.mock.friends[0];
      push({ type: 'message', with: f.id, from: f, message: { id: Date.now(), body: 'one more thing: the legend keys too', at: new Date().toISOString(), mine: false } });
    },
    close: () => C()?.close(),
  };

  // ---------- the overlay: overlay.js, shortcuts.js and picker.js themselves ----------
  const O = () => frames.overlay.win;
  const showOverlay = (on) => $('pg-overlay').classList.toggle('off', !on);
  PG.overlayDone = () => showOverlay(false);
  const until = async (test, ms = 3000) => {
    for (let t = 0; t < ms; t += 50) {
      const v = test();
      if (v) return v;
      await wait(50);
    }
    return null;
  };
  const rightClick = (el) => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new (O().MouseEvent)('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  };
  const pie = () => {
    showOverlay(true);
    const { w, h } = PG.screen();
    O().Overlay.shortcuts(Math.round(w * 0.42), Math.round(h * 0.45));
  };
  const picker = () => {
    showOverlay(true);
    O().Overlay.newTerminal();
  };
  async function closeOverlay() {
    closeMenus();
    O().dispatchEvent(new (O().KeyboardEvent)('keydown', { key: 'Escape' }));
    await wait(500);
    showOverlay(false);
  }

  // ---------- the theme hooks: hooks.js's own Hooks in each page, called as the app calls them ----------
  let streak = 0;
  // app.js setStreak()
  function setStreak({ n: run, mark = 0, broke = 0 }) {
    const H = hooks('dash');
    streak = run;
    H.set('streak', run);
    if (mark) milestone(mark);
    if (broke) streakBreak(broke);
  }
  // app.js: each moment, and the theme's sound for it (Sfx.play: the theme-only names play only a theme's file).
  const dashSfx = (name) => frames.dash.win.Sfx?.play(name);
  function milestone(mark) {
    hooks('dash').pulse('streak-milestone', { value: mark }, { ms: 3000 });
    dashSfx('streak');
  }
  function streakBreak(run) {
    hooks('dash').pulse('streak-break', { value: run });
    dashSfx('streak-break');
  }
  function back(step) {
    hooks('dash').pulse('back', { value: step });
    dashSfx('back');
  }
  // cloud.js, a theme chosen on the theme screen or a friend's card.
  function themeKept(id) {
    hooks('dash').pulse('theme-kept', { value: id }, { ms: 1500 });
    dashSfx('theme-kept');
  }
  // app.js setIdle()
  let idleFor = '';
  function setIdle(seconds) {
    const H = hooks('dash');
    const { level: step, back: returned } = H.logic.idleStep(idleFor, seconds);
    idleFor = step;
    if (returned) back(returned);
    H.set('idle', step || null);
  }
  // app.js tellClashes() and messages.js addClash(): both pages
  const both = (f) => ['dash', 'notices'].forEach((p) => hooks(p) && f(hooks(p)));
  const HOOKS = {
    ...Object.fromEntries([0, 3, 5, 7, 25].map((v) => [`streak-${v}`, () => setStreak({ n: v })])),
    'result-ok': () => setStreak(hooks('dash').logic.streak(streak, true)),
    'result-fail': () => setStreak(hooks('dash').logic.streak(streak, false)),
    milestone: () => milestone(streak || 5),
    break: () => streakBreak(streak >= 3 ? streak : 7),
    ...Object.fromEntries([0, 1, 2].map((v) => [`same-file-${v}`, () => both((H) => H.set('sameFile', v))])),
    clash: () => both((H) => H.pulse('clash', { value: 'orbit.js', path: '~/development/atalay-terminal/app/orbit.js', chats: ['night-city', 'afterlife'] })),
    ...Object.fromEntries([['idle-1m', 60], ['idle-5m', 300], ['idle-10m', 600], ['idle-input', 0]].map(([k, s]) => [k, () => setIdle(s)])),
    ...Object.fromEntries(['1m', '5m', '10m'].map((v) => [`back-${v}`, () => back(v)])),
    'theme-kept': () => themeKept(current),
    'status-waiting': () => hooks('dash').pulse('session-status', { value: 'waiting', sid: sessions[0]?.id || 's0' }),
    'status-idle': () => hooks('dash').pulse('session-status', { value: 'idle', sid: sessions[0]?.id || 's0' }),
  };

  // ---------- the theme's sounds: each of its --sfx tokens, played from the page and the way the app plays it ----------
  const THEME_ONLY = ['streak', 'streak-break', 'back', 'theme-kept'];
  const soundsOf = (id) => Object.keys(byId.get(id).tokens).filter((k) => k.startsWith('--sfx-')).map((k) => k.slice('--sfx-'.length));
  function playSound(name) {
    // app.js ping(): straight through hooks.js; badges.js and the reveal: Sfx.sample; the rest: Sfx.play, the
    // dashboard's moments on the dashboard, everything else on the notices.
    if (name.startsWith('ping-')) return hooks('dash')?.sound(name);
    if (name.startsWith('badge-')) return (name === 'badge-equip' ? frames.dash : frames.notices).win.Sfx.sample(name);
    return (THEME_ONLY.includes(name) ? frames.dash : frames.notices).win.Sfx.play(name);
  }
  PG.sounds = () => soundsOf(current);
  PG.playSound = playSound;
  function soundRow() {
    const names = soundsOf(current);
    $('pg-sounds').innerHTML = names.map((n) => `<button type="button" data-sound="${esc(n)}">${esc(n)}</button>`).join('');
    $('pg-sounds-note').textContent = !names.length
      ? `${byId.get(current).name} has no sounds of its own: the app's play.`
      : sound
        ? 'Each plays as the app plays it: do not disturb still holds back what comes in.'
        : 'Muted: tick "sounds" under Screen to hear them.';
  }

  // ---------- the panel ----------
  const GROUPS = [
    ['Dashboard', [
      ['boot', 'launch: boot screen', () => boot(false)],
      ['boot-hold', 'boot screen, held', () => boot(true)],
      ['boot-gone', 'boot screen goes', unboot],
      ['card-busy', '+ working', () => add('busy')],
      ['card-idle', '+ your turn', () => add('idle')],
      ['card-waiting', '+ needs you', () => add('waiting')],
      ['card-ended', '+ ended', () => add('ended')],
      ['cards-waiting3', '+ 3 needs you', () => add('waiting', 'waiting', 'waiting')],
      ['to-waiting', 'a card → needs you', () => turn('waiting')],
      ['to-idle', 'a card → your turn', () => turn('idle')],
      ['card-clash', '⚠ same file on a card', () => ((sessions = sessions.map((s, i) => (i < 2 ? { ...s, clash: 'orbit.js (also afterlife)' } : s))), renderSessions())],
      ['cards-one-each', 'cards: one of each', () => ((sessions = []), add('busy', 'waiting', 'idle', 'ended'))],
      ['cards-none', 'no cards', () => ((sessions = []), renderSessions())],
      ['toast', 'toast', () => toast('Copied ~/development/atalay-terminal to the clipboard')],
      ['flash', 'edge flash', flash],
      ['update', 'update on offer', () => offerUpdate(!updateOn)],
    ]],
    ['Views', [
      ['view-dash', 'dashboard', () => view('dash')],
      ['view-themes', 'theme screen', () => view('themes')],
      ['view-notifications', "developer's notifications", () => view('notifications')],
      ['view-friends', 'friends', () => view('friends')],
    ]],
    ['Menus', [
      ['menu-panel', 'panel', () => panelMenu()],
      ['menu-friend', 'friend', friendMenu],
      ['menu-badge', 'badge', badgeMenu],
      ['menu-shortcut', 'shortcut slot', async () => {
        pie();
        const g = await until(() => O().document.querySelector('#shortcuts .slice:not(.empty)'));
        await wait(450);
        if (g) rightClick(g);
      }],
      ['menu-picker', 'picker tile', async () => {
        picker();
        const t = await until(() => O().document.querySelector('#picker .sc-tile:not(.empty)'));
        await wait(700);
        if (t) rightClick(t);
      }],
      ['menu-close', 'close menus', closeMenus],
    ]],
    ['Notices', [
      ['notice-message', 'message', NOTICES.message],
      ['notice-request', 'friend request', NOTICES.request],
      ['notice-friend', 'new friend', NOTICES.friend],
      ['notice-online', 'friend online', NOTICES.online],
      ['notice-update', 'update', NOTICES.update],
      ['notice-updated', 'updated', NOTICES.updated],
      ['notice-note', "developer's notice", NOTICES.note],
      ['notice-xp', 'daily bonus (xp)', NOTICES.xp],
      ['notice-fire', 'on fire', NOTICES.fire],
      ['notice-wait', 'needs you', NOTICES.wait],
      ['notice-wait-over', 'needs you: over', NOTICES['wait-over']],
      ['notice-clash', 'same file (clash)', NOTICES.clash],
      ['notice-clash-over', 'same file: over', NOTICES['clash-over']],
      ['notice-danger', 'danger: runaway', NOTICES.danger],
      ['notice-danger-over', 'danger: over', NOTICES['danger-over']],
      ['notice-levelup', 'level up', NOTICES.levelup],
      ['notice-rankup', 'rank up', NOTICES.rankup],
      ['notice-badge', 'badge reveal', NOTICES.badge],
      ['notice-close', 'close it', NOTICES.close],
    ]],
    ['Friend chat', [
      ['chat-open', 'open a chat', CHAT.open],
      ['chat-empty', 'an empty chat', CHAT.empty],
      ['chat-gone', 'not friends anymore', CHAT.gone],
      ['chat-pending', 'sending + failed', CHAT.pending],
      ['chat-incoming', 'a message comes in', CHAT.incoming],
      ['chat-close', 'close the chat', CHAT.close],
    ]],
    ['Overlay', [
      ['overlay-pie', 'shortcut pie', pie],
      ['overlay-picker', 'folder picker', picker],
      ['overlay-close', 'close', closeOverlay],
    ]],
    ['Theme hooks', [
      ['hook-streak-0', 'streak 0', HOOKS['streak-0']],
      ['hook-streak-3', 'streak 3', HOOKS['streak-3']],
      ['hook-streak-5', 'streak 5', HOOKS['streak-5']],
      ['hook-streak-7', 'streak 7', HOOKS['streak-7']],
      ['hook-streak-25', 'streak 25', HOOKS['streak-25']],
      ['hook-result-ok', 'a good result', HOOKS['result-ok']],
      ['hook-result-fail', 'a failed result', HOOKS['result-fail']],
      ['hook-milestone', 'streak-milestone', HOOKS.milestone],
      ['hook-break', 'streak-break', HOOKS.break],
      ['hook-same-file-0', 'same-file 0', HOOKS['same-file-0']],
      ['hook-same-file-1', 'same-file 1', HOOKS['same-file-1']],
      ['hook-same-file-2', 'same-file 2', HOOKS['same-file-2']],
      ['hook-clash', 'clash', HOOKS.clash],
      ['hook-idle-1m', 'idle 1m', HOOKS['idle-1m']],
      ['hook-idle-5m', 'idle 5m', HOOKS['idle-5m']],
      ['hook-idle-10m', 'idle 10m', HOOKS['idle-10m']],
      ['hook-idle-input', 'input again', HOOKS['idle-input']],
      ['hook-back-1m', 'back 1m', HOOKS['back-1m']],
      ['hook-back-5m', 'back 5m', HOOKS['back-5m']],
      ['hook-back-10m', 'back 10m', HOOKS['back-10m']],
      ['hook-theme-kept', 'theme-kept', HOOKS['theme-kept']],
      ['hook-status-waiting', 'session-status waiting', HOOKS['status-waiting']],
      ['hook-status-idle', 'session-status idle', HOOKS['status-idle']],
    ]],
  ];
  const ACTIONS = new Map(GROUPS.flatMap(([, items]) => items.map(([id, , run]) => [id, run])));
  PG.actions = [...ACTIONS.keys()];
  PG.run = async (id) => {
    const run = ACTIONS.get(id);
    if (!run) throw new Error(`no action ${id}`);
    await run();
  };

  function panel() {
    const sel = $('pg-theme');
    const group = (label, list) =>
      `<optgroup label="${esc(label)}">${list.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</optgroup>`;
    sel.innerHTML =
      group(D.pack.label, D.themes.filter((t) => D.pack.ids.includes(t.id))) + group("The app's", D.themes.filter((t) => !D.pack.ids.includes(t.id)));
    sel.value = kept;
    $('pg-current').textContent = byId.get(kept).name;
    sel.onchange = () => choose(sel.value);
    const step = (k) => {
      const ids = [...sel.options].map((o) => o.value);
      choose(ids[(ids.indexOf(current) + k + ids.length) % ids.length]);
    };
    $('pg-prev').onclick = () => step(-1);
    $('pg-next').onclick = () => step(1);
    $('pg-replay').onclick = replay;
    const font = $('pg-font');
    font.innerHTML = D.fonts.map((f) => `<option value="${f.id}">${f.id}</option>`).join('');
    font.value = uiFont;
    font.onchange = () => {
      uiFont = font.value;
      store.set('font', uiFont);
      repaint();
    };
    $('pg-refresh').textContent =
      D.refresh.mode === 'app'
        ? "On a switch the app's own __theme refreshes the pseudo-elements (Themes.swift, theme hooks)."
        : "This checkout's __theme doesn't refresh the pseudo-elements: the playground does it after each switch (pg-swap).";
    const sizes = $('pg-size');
    sizes.innerHTML = SIZES.map((s) => `<option value="${s}">${s.replace('x', ' × ')}</option>`).join('');
    sizes.value = size;
    sizes.onchange = () => {
      size = sizes.value;
      store.set('size', size);
      fit();
    };
    $('pg-window').onchange = (e) => setWindow(e.target.value);
    $('pg-sound').onchange = (e) => {
      sound = e.target.checked;
      soundRow();
    };
    $('pg-sounds').onclick = (e) => {
      const b = e.target.closest('[data-sound]');
      if (!b) return;
      try {
        playSound(b.dataset.sound);
      } catch (err) {
        PG.frameError('playground', `sound ${b.dataset.sound}: ${err.message}`);
      }
    };
    soundRow();
    $('pg-front').onchange = (e) => {
      front = e.target.checked;
      N().focus(front);
    };
    $('pg-reload').onclick = () => start();
    const rm = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => ($('pg-motion').textContent = rm.matches ? 'on: themes show their still picture' : 'off: intros and decorations move');
    rm.addEventListener('change', motion);
    motion();
    $('pg-groups').innerHTML = GROUPS.map(
      ([title, items]) =>
        `<details open><summary>${esc(title)}</summary><div class="pg-btns">` +
        items.map(([id, label]) => `<button type="button" data-act="${id}">${esc(label)}</button>`).join('') +
        '</div></details>',
    ).join('');
    $('pg-groups').onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      PG.run(b.dataset.act).catch((err) => PG.frameError('playground', `${b.dataset.act}: ${err.message}`));
    };
    if (!D.hooks) $('pg-groups').lastElementChild.querySelector('summary').textContent += " (this checkout has no hooks.js)";
    $('pg-where').textContent = `${D.checkout} · made ${new Date(D.generated).toLocaleString()}`;
  }

  // #theme=<id>&do=<action>,<action>&size=<w>x<h>&window=behind: a state to open in (a link, a probe, a screenshot).
  async function scenario() {
    const q = new URLSearchParams(location.hash.slice(1));
    if (q.get('size') && SIZES.includes(q.get('size'))) ((size = q.get('size')), fit());
    if (q.get('window')) setWindow(q.get('window'));
    if (q.get('theme')) choose(q.get('theme'));
    for (const id of (q.get('do') || '').split(',').filter(Boolean)) {
      await PG.run(id).catch((e) => PG.frameError('playground', `${id}: ${e.message}`));
      await wait(Number(q.get('gap') || 120));
    }
  }

  async function start() {
    errors.length = 0;
    $('pg-errors').textContent = 'no errors in the frames';
    $('pg-errors').classList.remove('bad');
    showOverlay(false);
    $('pg-notices').classList.add('off');
    // A chat open before goes with the reload, as its panel would with the app.
    delete frames.chat;
    $('pg-chat').classList.add('off');
    PG.chatFrost(false, 0);
    await loadAll();
    PG.log(`frames loaded in ${byId.get(current).name}`);
  }

  panel();
  fit();
  new ResizeObserver(fit).observe($('pg-stage'));
  PG.ready = start().then(scenario).then(() => {
    document.documentElement.dataset.ready = '1';
    return true;
  });
})();
