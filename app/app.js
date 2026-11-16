/* Bountyline — a fast make.fun frontend.
   One ES module, no imports, no framework. Reads make.fun's public API
   alone (GET, CORS open). Four surfaces on hash routes:
     #/                        the live bounty board
     #/bounty/<slug>           a bounty's page (rules, rewards, dates)
     #/bounty/<slug>/leaderboard  that bounty's leaderboard
     #/u/<handle>              an account's public profile
   Performance: API answers are cached in memory and sessionStorage and
   revalidated with ETag (If-None-Match); a view costs one request; long
   lists are paginated; the live countdown updates text nodes in place
   instead of rebuilding the page. */

const API = 'https://make.fun/api';
const view = document.getElementById('view');
const CACHE_TTL_MS = 60 * 1000;
const PAGE_SIZE = 50;

window.__shotReady = false;

/* ---------- tiny helpers ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const frac = n % 1 ? 2 : 0;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: frac, maximumFractionDigits: frac });
}

function fmtNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—';
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function timeLeft(iso) {
  if (!iso) return { text: '—', cls: '' };
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return { text: 'Ended', cls: 'closed' };
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d > 0) return { text: d + 'd ' + h + 'h left', cls: d < 2 ? 'hot' : '' };
  if (h > 0) return { text: h + 'h ' + mm + 'm left', cls: 'hot' };
  return { text: mm + 'm left', cls: 'hot' };
}

function isOpen(c) {
  if (!c) return false;
  if (c.deadline && new Date(c.deadline).getTime() <= Date.now()) return false;
  return c.status === 'open' || c.acceptingSubmissions === true;
}

/* ---------- API client: cache + ETag revalidation ---------- */
const memCache = new Map();

function cacheRead(url) {
  const hit = memCache.get(url);
  if (hit) return hit;
  try {
    const raw = sessionStorage.getItem('bl:' + url);
    if (raw) {
      const entry = JSON.parse(raw);
      memCache.set(url, entry);
      return entry;
    }
  } catch (e) { /* storage unavailable: memory cache still works */ }
  return null;
}

function cacheWrite(url, entry) {
  memCache.set(url, entry);
  try { sessionStorage.setItem('bl:' + url, JSON.stringify(entry)); } catch (e) { /* ignore */ }
}

async function apiGet(url) {
  const hit = cacheRead(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.body;
  const headers = {};
  if (hit && hit.etag) headers['If-None-Match'] = hit.etag;
  const res = await fetch(API + url, { headers });
  if (res.status === 304 && hit) {
    const fresh = { etag: hit.etag, body: hit.body, at: Date.now() };
    cacheWrite(url, fresh);
    return hit.body;
  }
  if (!res.ok) throw new Error('make.fun API ' + res.status + ' for ' + url);
  const body = await res.json();
  cacheWrite(url, { etag: res.headers.get('ETag'), body, at: Date.now() });
  return body;
}

function clearCache() {
  memCache.clear();
  try {
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) keys.push(sessionStorage.key(i));
    keys.filter((k) => k && k.startsWith('bl:')).forEach((k) => sessionStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}

/* ---------- tiny safe markdown (headings, lists, bold, code, links) ---------- */
function md(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let list = null;
  function closeList() {
    if (list) { html += list === 'ul' ? '</ul>' : '</ol>'; list = null; }
  }
  function inline(text) {
    let t = esc(text);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" rel="noopener" target="_blank">$1</a>');
    return t;
  }
  for (const line of lines) {
    const h3 = line.match(/^###\s+(.*)$/);
    const h2 = line.match(/^##\s+(.*)$/);
    const h1 = line.match(/^#\s+(.*)$/);
    const ul = line.match(/^[-*]\s+(.*)$/);
    const ol = line.match(/^\d+[.)]\s+(.*)$/);
    if (h1 || h2 || h3) {
      closeList();
      const tag = h1 ? 'h2' : h2 ? 'h2' : 'h3';
      html += '<' + tag + '>' + inline((h1 || h2 || h3)[1]) + '</' + tag + '>';
    } else if (ul) {
      if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
      html += '<li>' + inline(ul[1]) + '</li>';
    } else if (ol) {
      if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; }
      html += '<li>' + inline(ol[1]) + '</li>';
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      html += '<p>' + inline(line) + '</p>';
    }
  }
  closeList();
  return html;
}

/* ---------- shared bits ---------- */
function statusBadge(c) {
  if (!isOpen(c)) return '<span class="badge closed">Closed</span>';
  const left = timeLeft(c.deadline);
  if (left.cls === 'hot') return '<span class="badge soon">Closing soon</span>';
  return '<span class="badge open">Open</span>';
}

function avatarImg(url, handle, cls) {
  if (!url) return '<span class="avatar avatar-fallback ' + cls + '" aria-hidden="true">' + esc((handle || '?')[0].toUpperCase()) + '</span>';
  const src = url.startsWith('http') ? url : 'https://make.fun' + url;
  return '<img crossorigin="anonymous" class="avatar ' + cls + '" src="' + esc(src) + '" alt="">';
}

function loadingHtml(msg) {
  return '<div class="loading"><span class="spin" aria-hidden="true"></span><p>' + esc(msg || 'Loading live data from make.fun…') + '</p></div>';
}

function errorHtml(err, retry) {
  return '<div class="error"><p><strong>Could not load this view.</strong></p><p>' +
    esc(err && err.message ? err.message : String(err)) + '</p>' +
    '<p><button class="btn" data-retry="' + esc(retry || '') + '">Try again</button></p></div>';
}

function setShotReady() { window.__shotReady = true; }

/* Live countdown: update only the time-left text nodes, every 30 s. */
setInterval(() => {
  document.querySelectorAll('[data-deadline]').forEach((el) => {
    const left = timeLeft(el.getAttribute('data-deadline'));
    el.textContent = left.text;
    el.classList.toggle('hot', left.cls === 'hot');
  });
}, 30000);

/* ---------- view: bounty board ---------- */
let boardData = null;

function bountyCard(c) {
  const left = timeLeft(c.deadline);
  const fee = c.entryFeeUsd != null ? fmtMoney(c.entryFeeUsd) : 'Free';
  const pot = c.potUsd != null ? fmtMoney(c.potUsd) : fmtMoney(c.rewardAmount);
  const summary = (c.summary || c.description || '').split('\n')[0];
  return '<a class="card" href="#/bounty/' + esc(c.slug) + '">' +
    '<div class="card-top"><h2>' + esc(c.title) + '</h2>' + statusBadge(c) + '</div>' +
    '<div class="sponsor">' + esc(c.sponsor && c.sponsor.name ? c.sponsor.name : 'make.fun') +
    ' · ' + esc(c.category || 'Code') + '</div>' +
    '<p class="summary">' + esc(summary) + '</p>' +
    '<div class="money-row">' +
    '<div class="money-cell"><div class="k">Reward</div><div class="v money">' + fmtMoney(c.rewardAmount) + '</div></div>' +
    '<div class="money-cell"><div class="k">Live pot</div><div class="v">' + pot + '</div></div>' +
    '<div class="money-cell"><div class="k">Entry fee</div><div class="v">' + fee + '</div></div>' +
    '<div class="money-cell"><div class="k">Time left</div><div class="v' + (left.cls === 'hot' ? ' hot' : '') + '" data-deadline="' + esc(c.deadline || '') + '">' + left.text + '</div></div>' +
    '</div>' +
    '<div class="card-foot"><span class="cat">' + esc(fmtNum(c.submissionCount)) + ' entries</span>' +
    '<span>Deadline ' + esc(fmtDate(c.deadline)) + '</span></div>' +
    '</a>';
}

function renderBoardList() {
  const q = (document.getElementById('board-q') || { value: '' }).value.trim().toLowerCase();
  const filter = document.querySelector('.chip[aria-pressed="true"]');
  const mode = filter ? filter.getAttribute('data-filter') : 'all';
  const sort = (document.getElementById('board-sort') || { value: 'deadline' }).value;
  let items = boardData.slice();
  if (mode === 'open') items = items.filter(isOpen);
  if (mode === 'soon') {
    items = items.filter((c) => {
      if (!isOpen(c) || !c.deadline) return false;
      const ms = new Date(c.deadline).getTime() - Date.now();
      return ms > 0 && ms < 48 * 3600 * 1000;
    });
  }
  if (mode === 'closed') items = items.filter((c) => !isOpen(c));
  if (q) {
    items = items.filter((c) => ((c.title || '') + ' ' + (c.slug || '') + ' ' + (c.category || '') +
      ' ' + (c.sponsor && c.sponsor.name ? c.sponsor.name : '')).toLowerCase().includes(q));
  }
  const byPot = (c) => Number(c.potUsd ?? c.rewardAmount ?? 0);
  const openFirst = (a, b) => (isOpen(b) ? 1 : 0) - (isOpen(a) ? 1 : 0);
  if (sort === 'pot') items.sort((a, b) => openFirst(a, b) || byPot(b) - byPot(a));
  else if (sort === 'reward') items.sort((a, b) => openFirst(a, b) || Number(b.rewardAmount || 0) - Number(a.rewardAmount || 0));
  else if (sort === 'entries') items.sort((a, b) => openFirst(a, b) || Number(b.submissionCount || 0) - Number(a.submissionCount || 0));
  else items.sort((a, b) => openFirst(a, b) || (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  const list = document.getElementById('board-list');
  const count = document.getElementById('board-count');
  if (count) count.textContent = items.length + ' of ' + boardData.length + ' bounties';
  if (list) list.innerHTML = items.length ? items.map(bountyCard).join('') :
    '<div class="empty"><p>No bounties match. Try a different search or filter.</p></div>';
}

async function renderBoard() {
  view.innerHTML = '<div class="page-head"><h1>Live bounty board</h1>' +
    '<p>Every open competition on make.fun — its reward, live pot, entry fee and time left. Data is live from make.fun’s public API.</p></div>' +
    '<div class="stat-strip" id="board-stats"></div>' +
    '<div class="board-tools">' +
    '<input type="search" id="board-q" placeholder="Search bounties…" aria-label="Search bounties">' +
    '<div class="chip-row" role="group" aria-label="Filter">' +
    '<button class="chip" data-filter="all" aria-pressed="true">All</button>' +
    '<button class="chip" data-filter="open" aria-pressed="false">Open</button>' +
    '<button class="chip" data-filter="soon" aria-pressed="false">Closing soon</button>' +
    '<button class="chip" data-filter="closed" aria-pressed="false">Closed</button>' +
    '</div>' +
    '<select class="sort-select" id="board-sort" aria-label="Sort bounties">' +
    '<option value="deadline">Sort: closing soon</option>' +
    '<option value="pot">Sort: biggest pot</option>' +
    '<option value="reward">Sort: biggest reward</option>' +
    '<option value="entries">Sort: most entries</option>' +
    '</select>' +
    '<button class="chip" id="board-refresh" type="button">Refresh ↻</button>' +
    '</div>' +
    '<p class="board-count" id="board-count"></p>' +
    '<div id="board-list">' + loadingHtml('Loading the live board…') + '</div>';
  try {
    let items = [];
    let url = '/competitions';
    for (let page = 0; page < 4; page++) {
      const data = await apiGet(url);
      items = items.concat(data.items || []);
      if (!data.next_cursor) break;
      url = '/competitions?cursor=' + encodeURIComponent(data.next_cursor);
    }
    boardData = items;
    const open = items.filter(isOpen);
    const pot = open.reduce((s, c) => s + Number(c.potUsd ?? c.rewardAmount ?? 0), 0);
    const stats = document.getElementById('board-stats');
    if (stats) stats.innerHTML =
      '<div class="stat"><div class="k">Open bounties</div><div class="v">' + open.length + '</div></div>' +
      '<div class="stat"><div class="k">Live pots, open</div><div class="v money">' + fmtMoney(pot) + '</div></div>' +
      '<div class="stat"><div class="k">Total bounties</div><div class="v">' + items.length + '</div></div>' +
      '<div class="stat"><div class="k">Entries, open</div><div class="v">' + fmtNum(open.reduce((s, c) => s + Number(c.submissionCount || 0), 0)) + '</div></div>';
    document.getElementById('board-q').addEventListener('input', renderBoardList);
    document.querySelectorAll('.chip[data-filter]').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.chip[data-filter]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
        chip.setAttribute('aria-pressed', 'true');
        renderBoardList();
      });
    });
    document.getElementById('board-sort').addEventListener('change', renderBoardList);
    document.getElementById('board-refresh').addEventListener('click', () => {
      clearCache();
      boardData = null;
      renderBoard();
    });
    renderBoardList();
  } catch (err) {
    const list = document.getElementById('board-list');
    if (list) list.innerHTML = errorHtml(err, '#/');
  }
  setShotReady();
}

/* ---------- view: bounty page ---------- */
function rewardsTable(c) {
  const rewards = c.rewards || {};
  const now = c.rewardsNow || [];
  const rows = Object.keys(rewards).sort((a, b) => Number(a) - Number(b)).map((place) => {
    const hit = now.find((r) => String(r.place) === String(place));
    const amount = hit ? hit.amountUsd : rewards[place];
    const fee = hit && hit.feeShareUsd ? ' <span style="color:var(--ink-faint);font-weight:600">(+ ' + fmtMoney(hit.feeShareUsd) + ' fees)</span>' : '';
    return '<tr><td class="place">' + esc(place) + '</td><td class="amount">' + fmtMoney(amount) + fee + '</td></tr>';
  }).join('');
  if (!rows) return '';
  return '<h2>Rewards</h2><table class="rewards-table"><thead><tr><th>Place</th><th>Prize</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<p style="color:var(--ink-faint);font-size:13px">Live pot ' + fmtMoney(c.potUsd) +
    ' — the $' + fmtMoney(c.rewardAmount).slice(1) + ' reward plus entry fees paid so far. Fee shares update as more fees arrive.</p>';
}

async function renderBounty(slug) {
  view.innerHTML = loadingHtml('Loading bounty ' + slug + '…');
  try {
    const c = await apiGet('/competitions/' + encodeURIComponent(slug));
    const left = timeLeft(c.deadline);
    const fee = c.entryFeeUsd != null ? fmtMoney(c.entryFeeUsd) : 'Free';
    view.innerHTML =
      '<div class="hero"><div class="meta">' + statusBadge(c) +
      '<span>' + esc(c.sponsor && c.sponsor.name ? c.sponsor.name : 'make.fun') + '</span>' +
      '<span>' + esc(c.category || '') + '</span>' +
      '<span>' + esc((c.skills || []).join(' · ')) + '</span></div>' +
      '<h1 style="margin-top:10px">' + esc(c.title) + '</h1>' +
      '<p style="color:var(--ink-soft);margin:0">' + esc(c.summary || '') + '</p></div>' +
      '<div class="stat-strip">' +
      '<div class="stat"><div class="k">Reward</div><div class="v money">' + fmtMoney(c.rewardAmount) + '</div></div>' +
      '<div class="stat"><div class="k">Live pot</div><div class="v money">' + fmtMoney(c.potUsd) + '</div></div>' +
      '<div class="stat"><div class="k">Entry fee</div><div class="v">' + fee + '</div></div>' +
      '<div class="stat"><div class="k">Entries</div><div class="v">' + fmtNum(c.submissionCount) + '</div></div>' +
      '<div class="stat"><div class="k">Time left</div><div class="v small' + (left.cls === 'hot' ? ' hot' : '') + '" data-deadline="' + esc(c.deadline || '') + '">' + left.text + '</div></div>' +
      '<div class="stat"><div class="k">Deadline</div><div class="v small">' + esc(fmtDate(c.deadline)) + '</div></div>' +
      '</div>' +
      '<div class="subnav">' +
      '<a class="btn" href="#/bounty/' + esc(c.slug) + '/leaderboard">View leaderboard →</a>' +
      '<a class="btn ghost" href="https://make.fun/bounty/' + esc(c.slug) + '" target="_blank" rel="noopener">Open on make.fun ↗</a>' +
      '</div>' +
      '<div class="prose">' + rewardsTable(c) + md(c.description || c.summary || '') + '</div>';
  } catch (err) {
    view.innerHTML = errorHtml(err, '#/bounty/' + slug);
  }
  setShotReady();
}

/* ---------- view: leaderboard ---------- */
async function renderLeaderboard(slug, page) {
  const pageNum = Math.max(1, page || 1);
  view.innerHTML = loadingHtml('Loading the leaderboard…');
  try {
    const [c, lb] = await Promise.all([
      apiGet('/competitions/' + encodeURIComponent(slug)),
      apiGet('/competitions/' + encodeURIComponent(slug) + '/leaderboard'),
    ]);
    const entries = lb.entries || [];
    const total = entries.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const p = Math.min(pageNum, pages);
    const slice = entries.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
    const scoreKey = (lb.columns && lb.columns[0] && lb.columns[0].key) || 'judge';
    function scoreOf(e) {
      const v = e.values || {};
      const raw = v[scoreKey] != null ? v[scoreKey] : (v.judge != null ? v.judge : (v.score != null ? v.score : null));
      if (raw == null) return '—';
      const n = Number(raw);
      if (!Number.isFinite(n)) return String(raw);
      return n > 1000 ? (n / 10000).toFixed(2) + '%' : String(n);
    }
    const rows = slice.map((e) => {
      const img = e.image ? '<img crossorigin="anonymous" src="' + esc(e.image.startsWith('http') ? e.image : 'https://make.fun' + e.image) + '" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:8px">' : '';
      return '<tr' + (e.rank <= 3 ? ' class="top3"' : '') + '>' +
        '<td class="rank">' + esc(e.rank) + '</td>' +
        '<td class="handle">' + img + '<a href="#/u/' + esc(e.handle || '') + '">' + esc(e.handle || '—') + '</a></td>' +
        '<td>' + esc(e.title || '—') + '</td>' +
        '<td class="num score">' + esc(scoreOf(e)) + '</td>' +
        '<td class="num">' + (e.prize_rank != null ? esc(e.prize_rank) : '—') + '</td></tr>';
    }).join('');
    view.innerHTML =
      '<div class="page-head"><h1>' + esc(c.title) + ' — leaderboard</h1>' +
      '<p>' + fmtNum(total) + ' entries · ranked by ' + esc(lb.title || scoreKey) +
      ' · prize rank is the paid place. Click a handle to see that account’s public profile.</p></div>' +
      '<div class="subnav"><a class="btn ghost" href="#/bounty/' + esc(c.slug) + '">← Back to bounty</a></div>' +
      (total ? '<table class="lb-table"><thead><tr><th>Rank</th><th>Entrant</th><th>Entry</th><th class="num">Score</th><th class="num">Prize rank</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="pager">' +
      '<button type="button" id="lb-prev"' + (p <= 1 ? ' disabled' : '') + '>← Previous</button>' +
      '<span>Page ' + p + ' of ' + pages + '</span>' +
      '<button type="button" id="lb-next"' + (p >= pages ? ' disabled' : '') + '>Next →</button>' +
      '</div>' : '<div class="empty"><p>No entries on this leaderboard yet.</p></div>');
    const prev = document.getElementById('lb-prev');
    const next = document.getElementById('lb-next');
    if (prev) prev.addEventListener('click', () => { location.hash = '#/bounty/' + slug + '/leaderboard?page=' + (p - 1); });
    if (next) next.addEventListener('click', () => { location.hash = '#/bounty/' + slug + '/leaderboard?page=' + (p + 1); });
  } catch (err) {
    view.innerHTML = errorHtml(err, '#/bounty/' + slug + '/leaderboard');
  }
  setShotReady();
}

/* ---------- view: public profile ---------- */
async function renderProfile(handle) {
  view.innerHTML = loadingHtml('Loading profile @' + handle + '…');
  try {
    const p = await apiGet('/profiles/' + encodeURIComponent(handle));
    const rec = p.record || {};
    const sols = p.solutions || [];
    const solRows = sols.map((s) => {
      const comp = s.competition || {};
      const score = s.score && s.score.value != null ? fmtNum(s.score.value) : '—';
      const prize = s.prize_usd != null ? fmtMoney(s.prize_usd) : '';
      return '<a class="sol" href="#/bounty/' + esc(comp.slug || '') + '">' +
        '<span class="t">' + esc(s.title || comp.title || '—') + '</span>' +
        '<span class="m">' + esc(comp.title || '') + ' · ' + esc(comp.category || '') + '</span>' +
        '<span class="m">' + (s.placement != null ? 'Placed #' + esc(s.placement) : 'Unplaced') + (prize ? ' · won ' + prize : '') + '</span>' +
        '<span class="s">' + esc(score) + '</span></a>';
    }).join('');
    view.innerHTML =
      '<div class="hero"><div class="profile-head">' + avatarImg(p.image || p.avatar, p.handle, '') +
      '<div><h1>@' + esc(p.handle) + '</h1>' +
      '<div class="joined">Joined ' + esc(fmtDate(p.joined_at)) +
      (p.wallet && p.wallet.address ? ' · <a href="' + esc(p.wallet.explorer_url || '') + '" target="_blank" rel="noopener">' + esc(p.wallet.address.slice(0, 8)) + '…' + esc(p.wallet.address.slice(-4)) + '</a>' : '') + '</div>' +
      (p.bio ? '<p style="color:var(--ink-soft);margin:6px 0 0">' + esc(p.bio) + '</p>' : '') +
      '</div></div></div>' +
      '<div class="stat-strip">' +
      '<div class="stat"><div class="k">Entered</div><div class="v">' + fmtNum(rec.competitions_entered) + '</div></div>' +
      '<div class="stat"><div class="k">Placed</div><div class="v">' + fmtNum(rec.competitions_placed) + '</div></div>' +
      '<div class="stat"><div class="k">Won</div><div class="v">' + fmtNum(rec.competitions_won) + '</div></div>' +
      '<div class="stat"><div class="k">Best place</div><div class="v">' + (rec.best_placement != null ? '#' + fmtNum(rec.best_placement) : '—') + '</div></div>' +
      '<div class="stat"><div class="k">Prize money</div><div class="v money">' + fmtMoney(rec.prize_usd) + '</div></div>' +
      '</div>' +
      '<div class="page-head"><h1>Entries</h1><p>' + sols.length + ' submission' + (sols.length === 1 ? '' : 's') + ' on make.fun.</p></div>' +
      '<div class="sol-list">' + (solRows || '<div class="empty"><p>No entries yet.</p></div>') + '</div>';
  } catch (err) {
    view.innerHTML = '<div class="error"><p><strong>No public profile for @' + esc(handle) + '.</strong></p>' +
      '<p>Check the spelling, or try another handle.</p>' +
      '<p><a class="btn" href="#/">Back to the board</a></p></div>';
  }
  setShotReady();
}

/* ---------- router ---------- */
function route() {
  window.__shotReady = false;
  document.querySelectorAll('.topnav a').forEach((a) => a.classList.remove('active'));
  const hash = location.hash || '#/';
  const [path, query] = hash.split('?');
  const parts = path.replace(/^#\/?/, '').split('/');
  const q = new URLSearchParams(query || '');
  if (parts[0] === '' || parts[0] === undefined) {
    const board = document.querySelector('[data-nav="board"]');
    if (board) board.classList.add('active');
    renderBoard();
  } else if (parts[0] === 'bounty' && parts[1] && parts[2] === 'leaderboard') {
    renderLeaderboard(parts[1], Number(q.get('page')) || 1);
  } else if (parts[0] === 'bounty' && parts[1]) {
    const b = document.querySelector('[data-nav="bounty"]');
    if (b) b.classList.add('active');
    renderBounty(parts[1]);
  } else if (parts[0] === 'u' && parts[1]) {
    renderProfile(decodeURIComponent(parts[1]));
  } else {
    renderBoard();
  }
  window.scrollTo(0, 0);
}

document.getElementById('profile-search').addEventListener('submit', (e) => {
  e.preventDefault();
  const h = document.getElementById('profile-handle').value.trim();
  if (h) location.hash = '#/u/' + encodeURIComponent(h.replace(/^@/, ''));
});

view.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-retry]');
  if (btn) { e.preventDefault(); route(); }
});

window.addEventListener('hashchange', route);
route();
