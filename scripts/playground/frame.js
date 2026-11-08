// The first script in each of the playground's frames (index.html, messages.html, overlay.html as the playground loads
// them): what the app's native side gives a page before it loads, answered by the playground instead.
//  - errors and console.error go to the playground's panel, so a broken state is seen, not missed;
//  - window.webkit's message handlers (the app's bridge) reach the playground's mock answers (bridge.js);
//  - the notices panel's role, which Swift injects (__MESSAGES_ROLE__).
(() => {
  const FRAME = '__FRAME__';
  const ROLE = '__ROLE__';
  const FRIEND = /*PG:FRIEND*/null;
  const pg = () => window.parent && window.parent.PG;
  const report = (msg) => {
    try {
      pg().frameError(FRAME, String(msg));
    } catch {}
  };
  addEventListener('error', (e) => report(e.message || `failed to load ${(e.target && (e.target.src || e.target.href)) || 'a resource'}`), true);
  addEventListener('unhandledrejection', (e) => report(`unhandled rejection: ${(e.reason && e.reason.message) || e.reason}`));
  const error = console.error.bind(console);
  console.error = (...args) => {
    report(args.map((a) => (a && a.message) || a).join(' '));
    error(...args);
  };
  // Swift's first script in a message panel (Messages.swift): its role, and the one friend a chat panel is for.
  if (ROLE) {
    window.__MESSAGES_ROLE__ = ROLE;
    window.__MESSAGES_FRIEND__ = FRIEND;
  }
  // Answers come as copies made in this frame, as the app's would be: plain data of this page's own.
  const handler = (name) => ({
    postMessage: (msg) => {
      // An answer can take its time (a message still sending): a promise, settled as it comes.
      const r = pg().bridge(FRAME, name, JSON.parse(JSON.stringify(msg ?? null)));
      return Promise.resolve(r).then((v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v))));
    },
  });
  const handlers = {};
  window.webkit = { messageHandlers: new Proxy(handlers, { get: (t, name) => (typeof name === 'string' ? (t[name] ||= handler(name)) : undefined) }) };
})();
