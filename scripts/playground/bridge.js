// The app's native side, as far as the playground's frames ask for it: the bridge's answers (window.webkit's message
// handlers, see frame.js), made-up friends and folders, and where Swift puts the notices panel (Messages.swift
// placeNotice) and its frosted glass (frost).
(() => {
  const PG = window.PG;
  const now = Date.now();
  const min = 60_000;
  const me = { id: 'me', name: 'svoboden', tag: 7, status: 'online' };
  const friends = [
    { id: 'f-vee', name: 'vee', tag: 42, presence: 'online', xp: { level: 27, today: 7200, last24: 9000 }, unread: 0, last: null },
    { id: 'f-jackie', name: 'jackie', tag: 1977, nick: 'jackie welles', presence: 'offline', xp: { level: 12, last24: 3600 }, unread: 0, last: null },
    { id: 'f-judy', name: 'judy', tag: 2077, presence: 'idle', xp: { level: 41, today: 19_800, last24: 21_000 }, unread: 2, last: { body: 'the braindance is ready', at: now - 4 * min, mine: false } },
    { id: 'f-panam', name: 'panam', tag: 88, presence: 'offline', xp: { level: 56 }, unread: 0, last: { body: 'see you in the badlands', at: now - 90 * min, mine: true } },
  ];
  const notes = [
    { id: 'n3', title: 'Themes from the community', body: 'Three new themes came with this update: pick one in the themes view.', at: now - 25 * min, read: false },
    { id: 'n2', title: 'Scheduled maintenance tonight', body: 'Friends and the leaderboard pause for ten minutes at 02:00 UTC.', at: now - 26 * 3600_000, read: false },
    { id: 'n1', title: 'Welcome to 0.19', body: 'Accounts, badges and the Roadmap are here.', at: now - 5 * 86_400_000, read: true },
  ];
  PG.mock = { me, friends, notes };

  // ---------- the cloud handler: the API through Swift (social.js) ----------
  function social(method, path, body) {
    if (method === 'GET' && path === 'v1/social') return { me, friends, incoming: [], outgoing: [] };
    if (method === 'GET' && path === 'v1/notifications') return { notifications: notes, unread: notes.filter((n) => !n.read).length };
    const accept = path.match(/^v1\/friends\/requests\/([^/]+)\/accept$/);
    if (accept) return { friend: { id: `f-${accept[1]}`, name: 'river', tag: 451, presence: 'online', xp: { level: 9 } } };
    const history = path.match(/^v1\/messages\/([^/?]+)(?:\?before=(\d+))?$/);
    if (method === 'GET' && history) return conversation(history[1], history[2]);
    if (method === 'POST' && path === 'v1/messages') return sent(body);
    return {};
  }

  // ---------- conversations (GET v1/messages/<friend>): yesterday and today with vee, older ones on "earlier" ----------
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const at = (t) => new Date(t).toISOString();
  // Today's lines a few minutes apart, never before midnight.
  const today = (ago) => at(Math.max(dayStart + 60_000, now - ago * min));
  const yesterday = (h, m) => at(dayStart - 86_400_000 + (h * 60 + m) * min);
  const line = (id, mine, body, t) => ({ id, body, at: t, mine });
  const CHATS = {
    'f-vee': [
      line(11, false, 'build is green on my side, can you pull?', yesterday(23, 41)),
      line(12, true, 'pulling now', yesterday(23, 43)),
      line(13, false, 'and the orbit map looks wild in your theme', yesterday(23, 50)),
      line(14, false, 'what did you change?', today(52)),
      line(15, true, 'a colour grade on the canvas\nthe status colours kept apart', today(49)),
      line(16, false, 'needs-you still reads red?', today(47)),
      line(17, true, 'yes, checked every hex', today(46)),
      line(18, false, 'ship it', today(9)),
    ],
    'f-panam': [line(31, false, 'see you in the badlands', today(95)), line(32, true, 'wait', today(94))],
  };
  const EARLIER = { 'f-vee': [line(1, false, 'job is on tonight. you in?', at(dayStart - 3 * 86_400_000 + 21 * 60 * min)), line(2, true, 'always.', at(dayStart - 3 * 86_400_000 + 21 * 60 * min + 2 * min))] };
  function conversation(id, before) {
    if (before) return { messages: EARLIER[id] || [], more: false };
    return { messages: CHATS[id] || [], more: !!EARLIER[id] };
  }
  // POST v1/messages: delivered at once, unless the playground asked for the next one to hang (still sending) or fail.
  PG.nextSends = [];
  function sent(body) {
    const how = PG.nextSends.shift();
    const message = { id: Date.now(), body: body && body.body, at: new Date().toISOString(), mine: true };
    if (how === 'fail') return { error: 'offline' };
    if (how === 'hold') return new Promise((resolve) => setTimeout(() => resolve({ message }), 45_000));
    return { message };
  }

  // ---------- the overlay handler: shortcuts and the folder picker (api.js) ----------
  const home = '/Users/svoboden';
  const slot = (name, dir) => ({ name, dir: `${home}/${dir}`, display: `~/${dir}` });
  const pie = [slot('atalay-terminal', 'development/atalay-terminal'), null, slot('svobodens-themes', 'development/svobodens-themes'), slot('dotfiles', 'dotfiles'), null];
  const around = Array.from({ length: 14 }, (_, i) => [pie[0], pie[2], slot('night-city', 'development/night-city'), null, pie[3]][i] || null);
  const entries = (dir) =>
    ['atalay-terminal', 'svobodens-themes', 'night-city', 'afterlife', 'notes', '.config'].map((name, i) => ({
      name,
      path: `${dir}/${name}`,
      hidden: name.startsWith('.'),
      git: i < 4,
      claude: i < 2,
      modified: now - (i + 1) * 47 * min,
    }));
  function overlay(m) {
    switch (m.type) {
      case 'getSlots':
        return { slots: m.set === 'picker' ? around : pie };
      case 'saveSlots':
        return { slots: m.slots };
      case 'places':
        return {
          home,
          favorites: [{ name: 'Home', path: home, icon: 'home' }, { name: 'Desktop', path: `${home}/Desktop`, icon: 'desktop' }, { name: 'development', path: `${home}/development`, icon: 'code' }],
          recents: [{ name: 'atalay-terminal', path: `${home}/development/atalay-terminal`, t: now - 12 * min }, { name: 'svobodens-themes', path: `${home}/development/svobodens-themes`, t: now - 3 * 3600_000 }],
        };
      case 'listDir': {
        const path = String(m.path || '~').replace(/^~/, home);
        return { path, parent: path === '/' ? null : path.replace(/\/[^/]+$/, '') || '/', entries: entries(path) };
      }
      case 'done':
        return void PG.overlayDone();
      default:
        PG.log(`overlay → ${m.type}${m.dir ? ` ${m.dir}` : ''}`);
        return undefined;
    }
  }

  // ---------- the messages handler: the notices panel (messages.js post) ----------
  function messages(m) {
    if (m.type === 'layout') return void place(m);
    if (m.type === 'leaving') return void frost(false, 0.18);
    if (m.type === 'ready') return void PG.noticesReady();
    if (m.type !== 'lock') PG.log(`notices → ${m.type}${m.sid ? ` ${m.sid}` : ''}${m.msg ? `: ${m.msg}` : ''}`);
    return undefined;
  }

  // ---------- the messages handler of a friend's chat panel (Messages.swift: layout, drag, showing, openChat) ----------
  function chat(m) {
    if (m.type === 'layout') return void PG.placeChat(m);
    if (m.type === 'leaving') return void PG.chatFrost(false, 0.18);
    if (m.type === 'drag') return void PG.dragChat(m.dx, m.dy);
    // The friends whose chat is open get no pop-ups (Swift tells the notices: tellShowing).
    if (m.type === 'showing') return void PG.frames.notices?.win?.__messages?.showing(m.id ? [m.id] : []);
    if (m.type === 'openChat') return void PG.openChat(m.id);
    if (m.type !== 'ready' && m.type !== 'dragEnd') PG.log(`chat → ${m.type}${m.msg ? `: ${m.msg}` : ''}`);
    return undefined;
  }

  PG.bridge = (frame, name, m) => {
    if (!m || typeof m !== 'object') return undefined;
    if (name === 'cloud' && m.type === 'social') return social(m.method, m.path, m.body);
    if (name === 'messages' && frame === 'chat') return chat(m);
    if (name === 'messages') return messages(m);
    if (name === 'overlay') return overlay(m);
    PG.log(`${frame} → ${name}.${m.type}`);
    return name === 'cloud' ? {} : undefined;
  };

  // ---------- where the notices panel goes (Messages.swift placeNotice) ----------
  // The screen here is the playground's: its visible frame the whole of it. Corner: 12 pt in from the bottom right;
  // center: the danger alarm; screen: the takeover; fire: the flames, every click passing through.
  const el = () => document.getElementById('pg-notices');
  let rect = { x: 0, y: 0, w: 420, h: 300 };
  let last = null;
  function place({ w, h, place: where }) {
    last = { w, h, place: where };
    const f = el();
    const S = PG.screen();
    if (!(w >= 1 && h >= 1)) {
      frost(false, 0);
      f.classList.add('off');
      return;
    }
    const wide = where === 'screen' || where === 'fire';
    if (wide) rect = { x: 0, y: 0, w: S.w, h: S.h };
    else if (where === 'center') rect = { x: Math.round((S.w - w) / 2), y: Math.round((S.h - h) / 2), w, h };
    else rect = { x: S.w - w - 12, y: S.h - h - 12, w, h };
    Object.assign(f.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
    f.classList.remove('off');
    f.classList.toggle('through', where === 'fire');
    frost(!wide, wide ? 0 : 0.3);
  }
  PG.placeNotices = place;
  // The screen changed size: the panel where Swift would put it on that screen.
  PG.replaceNotices = () => last && place(last);
  PG.noticesRect = () => rect;

  // The frosted glass Swift puts behind a notice (an NSVisualEffectView, .hudWindow, 8 pt in from the panel's edges,
  // corners of 10): a CSS backdrop blur standing in for it.
  function frost(on, seconds) {
    const g = document.getElementById('pg-frost');
    Object.assign(g.style, { left: `${rect.x + 8}px`, top: `${rect.y + 8}px`, width: `${Math.max(0, rect.w - 16)}px`, height: `${Math.max(0, rect.h - 16)}px`, transitionDuration: `${seconds}s` });
    g.classList.toggle('on', on);
  }
  PG.frost = frost;
})();

// ---------- where a friend's chat goes (Messages.swift placeChat + whole) ----------
// The first time, the middle of the screen; while it's up, its top-left corner stays put as it resizes; always wholly
// on the screen. The same frosted glass behind its box.
(() => {
  const PG = window.PG;
  const el = () => document.getElementById('pg-chat');
  let rect = null;
  function whole(r) {
    const S = PG.screen();
    const w = Math.min(r.w, S.w), h = Math.min(r.h, S.h);
    return { x: Math.min(Math.max(r.x, 0), S.w - w), y: Math.min(Math.max(r.y, 0), S.h - h), w, h };
  }
  function put(r) {
    rect = whole(r);
    Object.assign(el().style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
  }
  function placeChat({ w, h }) {
    const f = el();
    if (!(w >= 1 && h >= 1)) {
      chatFrost(false, 0);
      f.classList.add('off');
      rect = null;
      return;
    }
    const S = PG.screen();
    put(rect && !f.classList.contains('off') ? { x: rect.x, y: rect.y, w, h } : { x: Math.round(S.w / 2 - w / 2), y: Math.round(S.h / 2 - h / 2), w, h });
    f.classList.remove('off');
    chatFrost(true, 0.3);
  }
  // A drag on its header moves the panel by the pointer's travel on the real screen (the playground's is scaled).
  function dragChat(dx, dy) {
    if (!rect) return;
    const s = PG.scale();
    put({ ...rect, x: rect.x + dx / s, y: rect.y + dy / s });
    chatFrost(true, 0);
  }
  function chatFrost(on, seconds) {
    const g = document.getElementById('pg-chat-frost');
    if (rect) Object.assign(g.style, { left: `${rect.x + 8}px`, top: `${rect.y + 8}px`, width: `${Math.max(0, rect.w - 16)}px`, height: `${Math.max(0, rect.h - 16)}px` });
    g.style.transitionDuration = `${seconds}s`;
    g.classList.toggle('on', on);
  }
  PG.chatRect = () => rect;
  Object.assign(PG, { placeChat, dragChat, chatFrost });
})();
