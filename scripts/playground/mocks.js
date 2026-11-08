// The dashboard's markup as Atalay's Terminal 0.19.0 (with the theme hooks) writes it at run time, for the states the
// playground shows: each builder names the function it copies, its strings are that function's, its data made up. The
// dashboard frame runs none of app.js, cloud.js or git.js (they need the app's engine), so this is how its live parts
// get on screen. When the app's markup changes, change the builder named.
(() => {
  const M = (window.PG.mocks = {});
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  M.esc = esc;

  // ---------- app.js: STATUS, clock(), fmtTok(), fmtUsd(), fmtDur(), sparkBars(), ctxCss() ----------
  const STATUS = { busy: 'WORKING', waiting: 'NEEDS YOU', idle: 'YOUR TURN', ended: 'ENDED' };
  M.STATUS = STATUS;
  const clock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
  };
  const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));
  const fmtUsd = (n) => (n >= 100 ? '$' + n.toFixed(0) : n >= 0.01 ? '$' + n.toFixed(2) : n > 0 ? '$' + n.toFixed(3) : '$0');
  const fmtDur = (ms) => {
    const s = Math.round(ms / 1000);
    if (ms < 1000) return Math.round(ms) + 'ms';
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    return m < 60 ? m + 'm' + String(s % 60).padStart(2, '0') : Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0');
  };
  M.ago = (t) => fmtDur(Math.max(0, Date.now() - t));
  const ctxCss = (p) => (p < 0.5 ? 'var(--accent)' : p < 0.8 ? 'var(--amber)' : 'var(--red)');
  const sparkBars = (arr, col) => {
    const max = Math.max(1, ...arr);
    const w = 120 / arr.length;
    return arr
      .map((v, i) => {
        const h = v ? Math.max(1.5, (v / max) * 19) : 0.7;
        return `<rect x="${(i * w + 0.4).toFixed(1)}" y="${(20 - h).toFixed(1)}" width="${(w - 1.1).toFixed(1)}" height="${h.toFixed(1)}" style="fill:${v ? col : 'rgba(255,255,255,.09)'}"/>`;
      })
      .join('');
  };

  // ---------- app.js actionHTML(): what a card says it's doing ----------
  function actionHTML(s) {
    if (s.status === 'waiting') return `<span class="red">⚠ ${esc(s.waitingFor || 'waiting for you')}</span>`;
    if (s.status === 'busy') return `<span class="teal">◌ thinking…</span>${s.last ? ` <i class="dim">last ${esc(s.last.n)} ${esc(s.last.l)}</i>` : ''}`;
    if (s.status === 'idle') return `<span class="amber">◆ finished · your turn</span>${s.turnMs ? ` <i class="dim">last turn ${fmtDur(s.turnMs)}</i>` : ''}`;
    return `<span class="dim">ended ${M.ago(s.lastTs)} ago</span>`;
  }

  // ---------- app.js createCard() + updateCard(): a session card ----------
  M.card = (s) => {
    const col = `var(--hue${s.hue % 10})`;
    const pct = s.ctxMax ? Math.min(1, s.ctx / s.ctxMax) : 0;
    const clash = s.clash
      ? `<span class="flag clash" title="${esc(`Another chat is writing the same file: ${s.clash}`)}">⚠ same file</span>`
      : '';
    return (
      `<div class="card st-${s.status}" data-key="${esc(s.id)}">` +
      `<div class="ch"><span class="lights"><i class="l-close" title="${s.status === 'ended' ? 'Remove from the list' : 'End session'}"></i><i class="l-min" title="Collapse"></i></span>` +
      `<b class="nm">${esc(s.name)}</b><span class="kind">in app</span><span class="pill ${s.status}">${STATUS[s.status]} ${s.status === 'ended' ? '' : clock(Date.now() - s.statusSince)}</span></div>\n` +
      `<div class="title" title="${esc(s.title)}">${esc(s.title)}</div><div class="path">${esc(s.cwd)}  ⎇ ${esc(s.branch)}</div><div class="act">${actionHTML(s)}</div>\n` +
      `<div class="ctx"><span>ctx</span><div class="bar"><i style="width: ${(pct * 100).toFixed(1)}%; background: ${ctxCss(pct)};"></i></div><span class="cv">${fmtTok(s.ctx)} / ${fmtTok(s.ctxMax)}</span></div>\n` +
      `<div class="kv"><span class="md">${esc(s.model)}</span><span>tools <b class="tl">${s.tools}</b></span><span>web <b class="wb">${s.web}</b></span>` +
      `<span>err <b class="er${s.errors > 0 ? ' red' : ''}">${s.errors}</b></span><span class="cost">${fmtUsd(s.cost)}</span></div>\n` +
      `<svg class="spark" viewBox="0 0 120 20" preserveAspectRatio="none">${sparkBars(s.spark, col)}</svg><div class="ag">${s.agents ? `⤷ ${s.agents} running · ${s.agents} subagents (15 min)` : ''}</div>` +
      `<div class="flags">${clash}</div></div>`
    );
  };
  // ---------- app.js renderSessions() → placeholder(): no session ----------
  M.noSessions = () => '<div class="empty">no Claude Code session in the last 30 min</div>';

  // ---------- app.js renderCall(): your.call ----------
  M.call = (sessions) => {
    const need = sessions.filter((s) => s.status === 'waiting' || s.status === 'idle').sort((a, b) => (a.status === 'waiting' ? 0 : 1) - (b.status === 'waiting' ? 0 : 1) || a.statusSince - b.statusSince);
    const nW = need.filter((s) => s.status === 'waiting').length;
    const live = sessions.filter((s) => s.status !== 'ended').length;
    const meta = nW ? `${nW} blocked on you` : need.length ? `${need.length} waiting for your next prompt` : 'nothing needs you';
    const body = need.length
      ? need
          .map((s) =>
            `<div class="yc${s.status === 'waiting' ? ' waiting' : ' idle'}" data-key="${esc(s.id)}"><span class="b">${s.status === 'waiting' ? 'NEEDS YOU' : 'YOUR TURN'}</span>` +
            `<span class="nm">${esc(s.name)}</span><span class="tm">${clock(Date.now() - s.statusSince)}</span>` +
            `<span class="why">${esc(s.status === 'waiting' ? `${s.waitingFor || 'waiting'} · click to jump` : s.title)}</span></div>`)
          .join('')
      : `<div class="quiet">${live ? 'all quiet · every live session is working<small>you will hear a ping if sound is on</small>' : 'no live Claude Code session'}</div>`;
    return { hot: nW > 0, meta, body };
  };

  // ---------- git.js: the activity bar (the frame's first part) ----------
  M.activity = (cp) => {
    const ci = (n) => `<i class="vs-ci">${cp[n] ? String.fromCodePoint(cp[n]) : ''}</i>`;
    return (
      `<a class="vs-ab on" data-view="dash" title="Dashboard">${ci('files')}</a>` +
      `<a class="vs-ab" data-view="git" title="Source Control (⌃⇧G)">${ci('source-control')}<b class="vs-badge" hidden></b></a>` +
      `<a class="vs-ab" data-view="friends" title="Friends and messages">${ci('organization')}<b class="vs-badge" hidden></b></a>` +
      `<a class="vs-ab" data-view="board" title="Leaderboard">${ci('trophy')}</a>` +
      `<a class="vs-ab" data-view="themes" title="Themes">${ci('symbol-color')}</a>` +
      `<a class="vs-ab" data-view="notifications" title="Notifications">${ci('bell')}<b class="vs-badge" hidden></b></a>` +
      `<a class="vs-ab vs-ab-acct" data-view="account" title="Account">${ci('account')}<i class="acct-dot" hidden></i></a>` +
      `<a class="vs-ab vs-ab-foot" data-view="feedback" title="Send feedback to the developer">${ci('feedback')}</a>`
    );
  };

  // ---------- cloud.js renderUpdate(): the top bar's update button ----------
  M.updateButton =
    '<svg viewBox="0 0 16 16"><path class="ar" d="M8 2.5v7.5M4.6 6.8 8 10.2l3.4-3.4"/><path d="M3 13.5h10"/></svg><span>update</span>';

  // ---------- cloud.js themeCard() + openThemes(): the themes view ----------
  const themeCard = (t, kept) => {
    const k = t.tokens, a = (i) => k[`--a${i}`];
    const vars = {
      '--t-bg': k['--bg'], '--t-panel': `rgb(${k['--panel-rgb']})`, '--t-acc': k['--accent'], '--t-soft': k['--accent-soft'], '--t-txt': k['--txt'],
      '--t-dim': k['--dim'], '--t-cyan': k['--cyan'], '--t-warn': k['--warn'], '--t-code': k['--code-bg'], '--t-fg': k['--code-fg'], '--t-cur': k['--code-cursor'],
    };
    const style = Object.entries(vars).map(([n, v]) => `${n}:${v}`).join(';');
    return (
      `<button type="button" class="th-card${t.id === kept ? ' on' : ''}" data-id="${esc(t.id)}" style="${esc(style)}">` +
      '<span class="th-shot"><span class="th-top"><i></i><b>ATALAY\'S</b><em></em></span>' +
      '<span class="th-side"><i class="busy"></i><i class="idle"></i><i class="wait"></i></span>' +
      `<span class="th-term"><span><b style="color:${a(2)}">❯</b> git status</span><span style="color:${a(1)}">  modified: app.js</span>` +
      `<span style="color:${a(2)}">  new file: themes.json</span><span><b style="color:${a(4)}">~/repo</b> <b style="color:${a(5)}">main</b> <i class="cur"></i></span></span>` +
      `<span class="th-pal">${Array.from({ length: 16 }, (_, i) => `<i style="background:${a(i)}"></i>`).join('')}</span></span>` +
      `<span class="th-name">${esc(t.name)}<em>${t.id === kept ? 'ACTIVE' : ''}</em></span></button>`
    );
  };
  M.themesView = (themes, kept) =>
    `<section class="panel cv-themes"><header><span class="tag">themes</span><span class="meta">${themes.length} themes · point to try · click to keep · the orbit map keeps its colours</span></header>` +
    `<div class="body th-grid">${themes.map((t) => themeCard(t, kept)).join('')}</div></section>`;

  // ---------- cloud.js renderNotes(): the developer's notifications (richText is plain text for these) ----------
  M.notesView = (notes) =>
    `<section class="panel cv-notes"><header><span class="tag">notifications</span><span class="meta">${notes.length} from the developer</span></header><div class="body nt-list">` +
    notes
      .map((n) =>
        `<div class="nt-item${n.read ? '' : ' new'}"><div class="nt-head"><b>${esc(n.title)}</b>${n.read ? '' : '<em>NEW</em>'}` +
        `<span class="nt-time" title="${esc(new Date(n.at).toLocaleString())}">${M.ago(n.at)}</span></div>` +
        `${n.body ? `<div class="nt-body">${esc(n.body)}</div>` : ''}</div>`)
      .join('') +
    '</div></section>';

  // ---------- cloud.js views.friends + renderSocial()'s friendRow(): the friends view ----------
  const friendRow = (f, Xp, Social) => {
    const x = f.xp;
    const r = Xp.rank(x ? x.level : 1);
    const line = f.last ? `${f.last.mine ? 'you: ' : ''}${esc(f.last.body)}` : `${esc(Social.PRESENCE[f.presence].label)}${x ? ` · Lv ${x.level} · ${esc(r.name)}` : ''}`;
    const today = x && x.last24 ? `<span class="mn-today" title="Active in the last 24 hours"><b>${Xp.dur(x.last24)}</b><small>24h</small></span>` : '';
    const fire = (x && x.today) >= 5 * 3600;
    const tag = `#${String(f.tag).padStart(4, '0')}`;
    const name = f.nick ? `<b class="lb-name">${esc(f.nick)}</b><i class="lb-tag">${esc(f.name)}${tag}</i>` : `<b class="lb-name">${esc(f.name)}</b><i class="lb-tag">${tag}</i>`;
    const pic = `<b>${esc((f.nick || f.name || '?').trim().charAt(0).toUpperCase())}</b>`;
    const hover = f.nick ? `${f.name}${tag} · ` : '';
    return (
      `<div class="mn-row fr-row${fire ? ' fire' : ''}" data-id="${esc(f.id)}"${fire ? ' title="On fire: 5 hours of work today"' : ''}>` +
      `${fire ? '<canvas class="fire-card"></canvas>' : ''}<span class="fr-av" style="--rc:${r.color}">${pic}${Social.dot(f.presence)}</span>` +
      `<div class="mn-main" title="${esc(hover)}Click for their card · double-click to message"><span class="lb-l1">${name}</span><small${f.last && f.unread ? ' class="fr-new"' : ''}>${line}</small></div>` +
      `${today}${f.unread ? `<i class="cnt hot">${f.unread}</i>` : ''}<span class="fr-btns"><button class="mn-btn" type="button" data-act="profile" title="Profile: level and hours">◎</button>` +
      '<button class="mn-btn" type="button" data-act="chat" title="Message (right-click for more)">✉</button></span></div>'
    );
  };
  M.friendsView = (friends, Xp, Social) =>
    '<section class="panel cv-friends"><header><span class="tag">friends</span><span class="meta"></span></header><div class="body">' +
    '<div class="me-card-host"></div>' +
    '<label class="hk-field mn-add"><span class="hk-prompt">+</span><input class="mn-handle-in" maxlength="21" spellcheck="false" autocomplete="off" placeholder="add a friend · name#0427"><button class="mn-send" type="button" disabled>send request</button></label>' +
    `<p class="hk-status mn-add-status"></p><div class="mn-list mn-friends">${friends.map((f) => friendRow(f, Xp, Social)).join('')}</div></div></section>` +
    '<div class="cv-col"><section class="panel cv-friend"><header><span class="tag">friend</span><span class="meta">double-click a friend to message them</span></header><div class="body fr-host"></div></section>' +
    '<section class="panel cv-requests"><header><span class="tag">requests</span><span class="meta"></span></header><div class="body">' +
    '<div class="hk-h">INCOMING</div><div class="mn-list mn-in"></div><div class="hk-h">SENT</div><div class="mn-list mn-out"></div></div></section></div>' +
    '<section class="panel cv-me"><header><span class="tag">profile</span><span class="meta">your badges · hover one to see what it\'s for, right click to display it</span>' +
    '<button type="button" class="cv-hbtn" data-me="back" title="Back to your friends">← friends</button></header><div class="body me-host"></div></section>';

  // ---------- the context menus ----------
  // app.js panelMenu(): a dashboard panel's (one that was cleared before, so all three)
  M.panelMenu =
    '<button type="button" data-ctx="clear">⌫ clear this panel</button><button type="button" data-ctx="restore">↺ show what was cleared</button>' +
    '<hr><button type="button" data-ctx="hide">– hide this panel</button>';
  // cloud.js friendMenu(): a friend's, one with a nickname
  M.friendMenu =
    '<button type="button" data-ctx="chat">✉ message</button><button type="button" data-ctx="profile">◎ view profile</button>' +
    '<button type="button" data-ctx="nick">✎ change nickname</button><button type="button" data-ctx="unnick">⌫ remove nickname</button>' +
    '<button type="button" data-ctx="copy">⧉ copy name#tag</button><hr><button type="button" class="danger" data-ctx="remove">✕ remove friend</button>';
  // badges.js contextMenu(): one of your badges, not on display
  M.badgeMenu = '<button type="button" data-c="on">★ display beside my name</button>';
})();
