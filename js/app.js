import { loadLeague, range, SLOT_LABEL } from './data.js';
import { buildProjections } from './projections.js';
import { pastScores, weeklySD, simulate, gamesForWeek, winProb } from './sim.js';
import { powerRankings, blurb, POWER_WEIGHTS } from './power.js';
import { gradeTrades } from './trades.js';
import { weeklyAwards, awardTotals, awardOdds, TOP_JERRY_PRIZE } from './awards.js';

// This site is just for one league.
const LEAGUE_ID = '1392995163156004864'; // Sandusky's Two Hand Touch League

const $app = document.getElementById('app');
const $tabs = document.getElementById('tabs');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => x >= 0.995 ? '>99%' : x > 0 && x < 0.005 ? '<1%' : `${Math.round(x * 100)}%`;
const f1 = (x) => (x ?? 0).toFixed(1);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let M = null;     // league model
let ctx = null;   // computed analytics
let matchupWeek = null;

window.addEventListener('hashchange', render);
start(LEAGUE_ID);

// ---------- Load + compute ----------
async function start(leagueId) {
  $tabs.hidden = true;
  const progress = (msg) => { $app.innerHTML = `<div class="loading"><div class="spinner"></div>${esc(msg)}</div>`; };
  try {
    M = await loadLeague(leagueId, progress);
  } catch (err) {
    $app.innerHTML = `<div class="loading">
      <p class="error">Couldn't load the league from Sleeper: ${esc(err.message)}</p>
      <button class="primary" id="retry">Try again</button></div>`;
    document.getElementById('retry').onclick = () => start(leagueId);
    return;
  }
  progress('Simulating the rest of the season 10,000 times…');
  await new Promise(r => setTimeout(r, 30)); // let the message paint

  const projections = buildProjections(M);
  const scores = pastScores(M);
  const sd = weeklySD(M, scores);
  const sim = simulate(M, projections, sd);
  const power = powerRankings(M, scores, sim);
  const prevPower = M.lastScored - 1 >= M.startWeek ? powerRankings(M, scores, sim, M.lastScored - 1) : [];
  const trades = gradeTrades(M, projections);
  const awards = weeklyAwards(M, scores);
  const awardWeek = M.futureWeeks[0];
  ctx = { projections, scores, sd, sim, power, prevPower, trades, awards, awardWeek,
    awardTotals: awardTotals(M, awards),
    awardOdds: awardWeek ? awardOdds(M, projections, sd, awardWeek) : [] };
  matchupWeek = M.futureWeeks[0] ?? M.lastScored;

  document.getElementById('league-name').textContent = M.league.name;
  document.getElementById('league-sub').textContent =
    `${M.season} · ${M.teams.length} teams · ${M.futureWeeks.length ? `Week ${M.futureWeeks[0]}` : 'Regular season complete'}`;
  renderTopbar();
  $tabs.hidden = false;
  render();
}

function renderTopbar() {
  const mine = store.get(`myTeam:${M.leagueId}`) || '';
  document.getElementById('topbar-right').innerHTML = `
    <select id="my-team" title="Highlight your team">
      <option value="">Highlight my team…</option>
      ${M.teams.map(t => `<option value="${t.rid}" ${String(t.rid) === mine ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
    </select>`;
  document.getElementById('my-team').onchange = (e) => { store.set(`myTeam:${M.leagueId}`, e.target.value); render(); };
}

const myRid = () => +(store.get(`myTeam:${M.leagueId}`) || 0);

function render() {
  if (!M) return;
  const tab = (location.hash || '#standings').slice(1);
  $tabs.querySelectorAll('a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  const views = { standings: viewStandings, matchups: viewMatchups, power: viewPower, trades: viewTrades, awards: viewAwards };
  (views[tab] || viewStandings)();
}

function teamChip(rid, sub = true) {
  const t = M.teamById[rid];
  if (!t) return '';
  const av = t.avatar
    ? `<img class="avatar" src="${esc(t.avatar)}" alt="" loading="lazy">`
    : `<span class="avatar fallback">${esc(t.name.slice(0, 2).toUpperCase())}</span>`;
  return `<div class="team">${av}<div style="min-width:0"><div class="team-name">${esc(t.name)}</div>${sub ? `<div class="team-mgr">${esc(t.manager)}</div>` : ''}</div></div>`;
}

const heat = (p) => `background: color-mix(in srgb, var(--heat) ${Math.round(8 + p * 55)}%, transparent)`;

// ---------- Projected standings ----------
function viewStandings() {
  const P = M.playoffTeams;
  const rows = [...ctx.sim].sort((a, b) => a.avgSeed - b.avgSeed);
  const byes = rows.some(r => r.byePct > 0);
  const remaining = M.futureWeeks.length;
  const mine = myRid();
  $app.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Projected final standings</h2>
        <p>Every remaining regular-season week (${remaining ? `weeks ${M.futureWeeks[0]}–${M.regEnd}` : 'none left'}) simulated 10,000 times
        using each team's best projected lineup, accounting for byes and injuries, with waiver pickups filling any holes.
        ${P ? `Top ${P} make the playoffs.` : ''} ${M.medianGame ? 'Includes the weekly median game.' : ''}</p>
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Team</th><th>Record</th><th class="hide-sm">PF</th><th>Proj. record</th><th class="hide-sm">Proj. PF</th>
        <th>Playoffs</th>${byes ? '<th>Bye</th>' : ''}<th>#1 seed</th><th class="hide-sm">Last place</th><th>Avg seed</th>
        <th class="hide-sm">Seed odds</th>
      </tr></thead>
      <tbody>${rows.map((r, i) => {
        const t = M.teamById[r.rid];
        return `<tr class="${i === P && P ? 'cutline' : ''} ${r.rid === mine ? 'mine' : ''}">
          <td>${teamChip(r.rid)}</td>
          <td class="num">${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}</td>
          <td class="num hide-sm">${f1(t.pf)}</td>
          <td class="num"><b>${f1(r.projWins)}-${f1(r.projLosses)}</b></td>
          <td class="num hide-sm">${Math.round(r.projPF)}</td>
          <td class="num pct" style="${heat(r.playoffPct)}">${pct(r.playoffPct)}</td>
          ${byes ? `<td class="num" style="${heat(r.byePct)}">${pct(r.byePct)}</td>` : ''}
          <td class="num" style="${heat(r.topSeedPct)}">${pct(r.topSeedPct)}</td>
          <td class="num hide-sm">${pct(r.lastPct)}</td>
          <td class="num">${r.avgSeed.toFixed(1)}</td>
          <td class="hide-sm"><div class="seedbar" title="Chance of finishing 1st … last">
            ${r.seedDist.map((p, k) => `<span title="#${k + 1}: ${pct(p)}" style="opacity:${Math.max(0.06, Math.min(1, p * 2.5)).toFixed(2)}"></span>`).join('')}
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <p class="explain" style="margin-top:12px">Weekly score variability: ±${f1(ctx.sd)} pts (one standard deviation), estimated from this season's scores.
    Ties in the standings are broken by points for.${M.hasDivisions ? ' Division winners are seeded first.' : ''}</p>`;
}

// ---------- Matchups ----------
function viewMatchups() {
  const weeks = range(M.startWeek, M.regEnd);
  const w = matchupWeek;
  const isPast = w <= M.lastScored;
  const games = gamesForWeek(M, w);
  const mine = myRid();
  games.sort((g1, g2) => (g2.a.rid === mine || g2.b.rid === mine) - (g1.a.rid === mine || g1.b.rid === mine));

  $app.innerHTML = `
    <div class="section-head"><div>
      <h2>Week ${w} ${isPast ? 'results' : 'projections'}</h2>
      <p>${isPast ? 'Final scores.' : `Projected lineups use each team's best available starters. If a team has nobody to start at a spot (bye week, injury, no depth),
      we plug in the average of the top 3 free agents at that spot that week.`}</p>
    </div></div>
    <div class="week-picker">${weeks.map(x => `<button data-w="${x}" class="${x === w ? 'active' : ''} ${x <= M.lastScored ? 'past' : ''}">Wk ${x}</button>`).join('')}</div>
    <div class="grid">${games.map(g => isPast ? pastCard(g) : futureCard(g)).join('') || '<p class="muted">No matchups this week.</p>'}</div>`;
  $app.querySelectorAll('.week-picker button').forEach(b => b.onclick = () => { matchupWeek = +b.dataset.w; viewMatchups(); });
}

function pastCard(g) {
  const aw = g.a.pts > g.b.pts, bw = g.b.pts > g.a.pts;
  const lineup = (side) => {
    const row = side.row;
    return `<ol>${(row.starters || []).map((pid, i) => {
      const p = M.players[pid];
      return `<li><span class="slot">${esc(slotLabel(M.slots[i]))}</span><span class="nm">${esc(p?.name || pid)}</span><span class="num">${f1(row.starters_points?.[i])}</span></li>`;
    }).join('')}</ol>`;
  };
  return `<div class="card matchup ${g.a.rid === myRid() || g.b.rid === myRid() ? 'mine' : ''}">
    <div class="row ${aw ? 'winner' : ''}">${teamChip(g.a.rid)}<div class="score">${f1(g.a.pts)}</div></div>
    <div class="row ${bw ? 'winner' : ''}">${teamChip(g.b.rid)}<div class="score">${f1(g.b.pts)}</div></div>
    <details><summary>Box score</summary><div class="lineups">${lineup(g.a)}${lineup(g.b)}</div></details>
  </div>`;
}

function futureCard(g) {
  const w = matchupWeek;
  const la = ctx.projections.byWeek[w][g.a.rid], lb = ctx.projections.byWeek[w][g.b.rid];
  const p = winProb(la.total, lb.total, ctx.sd);
  const alerts = [g.a.rid, g.b.rid].flatMap((rid, k) => (k ? lb : la).lineup.filter(x => x.waiver).map(x =>
    `<div class="alert"><b>${esc(M.teamById[rid].name)}</b> has no one to start at ${esc(slotLabel(x.slot))} (${esc(x.reason)}).
     Projected with a waiver pickup: avg of ${x.pool.length ? esc(x.pool.join(', ')) : 'nobody available'} → <b>${f1(x.pts)}</b> pts.</div>`));
  const lineup = (l) => `<ol>${l.lineup.map(x => `<li class="${x.waiver ? 'waiver' : ''}">
      <span class="slot">${esc(slotLabel(x.slot))}</span>
      <span class="nm">${esc(x.name)}${x.team && !x.waiver ? `<span class="tag">${esc(x.pos)} ${esc(x.team)}</span>` : ''}</span>
      <span class="num">${f1(x.pts)}</span></li>`).join('')}
      <li class="bench-h" style="display:block;border:0">Bench</li>
      ${l.bench.filter(x => x.pts > 0 || x.bye).slice(0, 10).map(x => `<li><span class="slot">BN</span><span class="nm muted">${esc(x.name)}${x.bye ? '<span class="tag bye">BYE</span>' : ''}</span><span class="num muted">${f1(x.pts)}</span></li>`).join('')}
    </ol>`;
  return `<div class="card matchup ${g.a.rid === myRid() || g.b.rid === myRid() ? 'mine' : ''}">
    <div class="row side-a ${p >= 0.5 ? 'winner' : ''}">${teamChip(g.a.rid)}<div class="score">${f1(la.total)}</div></div>
    <div class="row side-b ${p < 0.5 ? 'winner' : ''}">${teamChip(g.b.rid)}<div class="score">${f1(lb.total)}</div></div>
    <div class="probbar"><div class="a" style="width:${p * 100}%"></div><div class="b" style="width:${(1 - p) * 100}%"></div></div>
    <div class="problabels"><span class="a">${pct(p)} win chance</span><span class="b">${pct(1 - p)}</span></div>
    ${alerts.join('')}
    <details><summary>Projected lineups</summary><div class="lineups">${lineup(la)}${lineup(lb)}</div></details>
  </div>`;
}

const slotLabel = (s) => SLOT_LABEL[s] || s;

// ---------- Power rankings ----------
function viewPower() {
  const prevRank = Object.fromEntries(ctx.prevPower.map(r => [r.rid, r.rank]));
  const mine = myRid();
  if (!ctx.power.length) {
    $app.innerHTML = '<p class="muted">Power rankings start after week 1 is scored.</p>';
    return;
  }
  const w = POWER_WEIGHTS;
  $app.innerHTML = `
    <div class="section-head"><div>
      <h2>Week ${M.lastScored} power rankings</h2>
      <p>Rating blends all-play record (${w.allPlay * 100}%: your record if you played everyone every week),
      season scoring (${w.avgPts * 100}%), last 3 weeks (${w.recent * 100}%), and rest-of-season projected lineup strength (${w.outlook * 100}%).</p>
    </div></div>
    <div class="power">${ctx.power.map(r => {
      const prev = prevRank[r.rid];
      const d = prev ? prev - r.rank : 0;
      const move = !prev ? '' : d > 0 ? `<div class="move up">▲ ${d}</div>` : d < 0 ? `<div class="move down">▼ ${-d}</div>` : '<div class="move same">–</div>';
      return `<div class="card power-row ${r.rid === mine ? 'mine' : ''}">
        <div><div class="rank-num">${r.rank}</div>${move}</div>
        <div style="min-width:0">
          ${teamChip(r.rid)}
          <p class="blurb">${esc(blurb(M, r, ctx.power))}</p>
          <div class="stats">
            <span>Record <b>${r.record}</b></span>
            <span>All-play <b>${Math.round(r.apW)}-${Math.round(r.apL)}</b></span>
            <span>Avg <b>${f1(r.avgPts)}</b></span>
            <span>Last 3 <b>${f1(r.recent)}</b></span>
            <span>ROS proj <b>${f1(r.outlook)}</b>/wk</span>
            ${r.streak ? `<span>Streak <b>${r.streak}</b></span>` : ''}
            ${awardBadges(r.rid)}
          </div>
        </div>
        <div class="rating">${r.rating}<small>rating</small></div>
      </div>`;
    }).join('')}</div>`;
}

// ---------- Trades ----------
function viewTrades() {
  const dynasty = M.league.settings.type === 2;
  const mine = myRid();
  $app.innerHTML = `
    <div class="section-head"><div>
      <h2>Trade grades</h2>
      <p>Hindsight grades: what each side has actually gotten (points above a waiver-level replacement, counted only in weeks the player
      was started) plus what they're projected to get the rest of the regular season if the player is still on the roster.
      ${dynasty ? '<b>Dynasty note:</b> this only grades value for this season, not long-term value.' : ''}</p>
    </div></div>
    <div class="power">${ctx.trades.length ? ctx.trades.map(tr => `
      <div class="card ${tr.sides.some(s => s.rid === mine) ? 'mine' : ''}">
        <div class="section-head" style="margin:0">
          <div class="muted">Week ${tr.week} · ${new Date(tr.created).toLocaleDateString()}</div>
          <div class="verdict">${tr.winner ? `Winner: ${esc(M.teamById[tr.winner]?.name)}` : 'Fair deal so far'}</div>
        </div>
        <div class="trade-sides">${tr.sides.map(s => `
          <div class="side">
            <div class="side-head">${teamChip(s.rid)}<div class="grade g-${s.grade[0]}">${s.grade}</div></div>
            <div class="muted" style="font-size:12px;margin-bottom:4px">Received ${f1(s.received)} · gave up ${f1(s.given)}</div>
            ${s.assets.map(a => `<div class="asset">
              <div class="nm">${esc(a.name)} ${a.pos ? `<span class="tag">${esc(a.pos)} ${esc(a.team || '')}</span>` : ''}</div>
              <div class="det">${a.kind === 'player'
                ? `${a.starts} start${a.starts === 1 ? '' : 's'}, ${f1(a.rawPts)} pts (${a.realized >= 0 ? '+' : ''}${f1(a.realized)} vs repl.) · ROS ${a.stillHere ? `+${f1(a.future)}` : 'n/a (no longer on roster)'}`
                : esc(a.note || 'Estimated value')}</div>
            </div>`).join('') || '<div class="asset muted">Nothing</div>'}
          </div>`).join('')}</div>
        ${tradeMath(tr)}
      </div>`).join('') : '<p class="muted">No trades yet this season. Somebody make a move!</p>'}</div>`;
}

const GRADE_SCALE = 'A+ ≥ .70 · A ≥ .64 · A- ≥ .59 · B+ ≥ .555 · B ≥ .52 · B- ≥ .49 · C+ ≥ .46 · C ≥ .43 · C- ≥ .40 · D+ ≥ .36 · D ≥ .32 · F below';

// Full value breakdown for one trade: every asset in and out, and the grade formula.
function tradeMath(tr) {
  const sign = (x) => `${x >= 0 ? '+' : ''}${f1(x)}`;
  const positions = [...new Set(tr.sides.flatMap(s => s.assets.filter(a => a.kind === 'player').map(a => a.pos)))];
  const replNote = positions.map(p => `${esc(p)} ${f1(tr.replPast[p])}`).join(', ');
  const valueCell = (a) => a.value < 0 ? `<span class="muted">${f1(a.value)} → 0</span>` : `<b>${f1(a.value)}</b>`;
  const assetRow = (a, extra = '') => a.kind === 'player'
    ? `<tr><td class="l">${esc(a.name)} <span class="tag">${esc(a.pos)}</span>${extra}</td>
        <td>${a.starts}</td><td>${f1(a.rawPts)}</td><td>−${f1(a.starts * (tr.replPast[a.pos] ?? 0))}</td>
        <td>${sign(a.realized)}</td><td>${a.stillHere ? sign(a.future) : '<span class="muted" title="No longer on this roster">gone</span>'}</td>
        <td>${valueCell(a)}</td></tr>`
    : `<tr><td class="l">${esc(a.name)}${extra}</td><td colspan="5" class="l muted">${a.kind === 'pick' ? 'Fixed value by round' : 'Fixed value per FAAB $'}</td><td>${valueCell(a)}</td></tr>`;
  const head = (label) => `<thead><tr><th class="l">${label}</th><th>Starts</th><th>Pts</th><th>Repl.</th><th>So far</th><th>ROS</th><th>Value</th></tr></thead>`;

  return `<details class="math"><summary>Show the math</summary>
    <p class="explain">For each player: <b>So far</b> = points scored in weeks his new team started him, minus what a waiver-level
    player would have scored in those starts (per start: ${replNote}). <b>ROS</b> = projected points above the top-3 free agents at his position
    for each remaining week (a week can't go below 0), counted only if he's still on the roster. Negative totals count as 0.
    Grade = (received + ${tr.sides[0].pad}) ÷ (received + gave up + ${2 * tr.sides[0].pad}).</p>
    ${tr.sides.map(s => `
      <div class="math-side">
        <div class="math-team">${esc(M.teamById[s.rid]?.name)} <span class="grade-sm g-${s.grade[0]}">${s.grade}</span></div>
        <div class="table-wrap"><table class="math-table">
          ${head('Received')}
          <tbody>${s.assets.map(a => assetRow(a)).join('') || '<tr><td class="l muted" colspan="7">Nothing</td></tr>'}
            <tr class="total"><td class="l" colspan="6">Total received</td><td><b>${f1(s.received)}</b></td></tr></tbody>
        </table></div>
        <div class="table-wrap"><table class="math-table">
          ${head('Gave up')}
          <tbody>${s.sent.map(a => assetRow(a, ` <span class="muted">→ ${esc(M.teamById[a.to]?.name)}</span>`)).join('') || '<tr><td class="l muted" colspan="7">Nothing</td></tr>'}
            <tr class="total"><td class="l" colspan="6">Total gave up</td><td><b>${f1(s.given)}</b></td></tr></tbody>
        </table></div>
        <p class="formula">(${f1(s.received)} + ${s.pad}) ÷ (${f1(s.received)} + ${f1(s.given)} + ${2 * s.pad}) = <b>${s.share.toFixed(3)}</b> → <b>${s.grade}</b></p>
      </div>`).join('')}
    <p class="explain">Grade scale: ${GRADE_SCALE}. The value of what a team gave up is measured by what its new team actually got from it.</p>
  </details>`;
}

// ---------- Top Jerry & Shower King ----------
function awardBadges(rid) {
  const t = ctx.awardTotals.find(x => x.rid === rid);
  if (!t) return '';
  return [
    t.jerry ? `<span title="Top Jerry weeks: ${t.jerryWeeks.join(', ')}">🧀 Top Jerry <b>×${t.jerry}</b></span>` : '',
    t.shower ? `<span title="Shower King weeks: ${t.showerWeeks.join(', ')}">🚿 Shower King <b>×${t.shower}</b></span>` : '',
  ].join('');
}

function viewAwards() {
  const names = (rids) => rids.map(r => esc(M.teamById[r]?.name)).join(' & ');
  const last = ctx.awards[ctx.awards.length - 1];
  const mine = myRid();
  const money = (x) => `$${Number.isInteger(x) ? x : x.toFixed(2)}`;
  const totals = [...ctx.awardTotals].sort((a, b) => (b.cash - a.cash) || (a.shower - b.shower));
  const odds = ctx.awardOdds;
  const oddsList = (key, label) => [...odds].sort((a, b) => b[key] - a[key]).slice(0, 5).map(o => `
    <li class="${o.rid === mine ? 'mine' : ''}">${teamChip(o.rid, false)}
      <span class="muted num">${f1(o.proj)} proj</span><b class="num">${pct(o[key])}</b></li>`).join('');

  $app.innerHTML = `
    <div class="section-head"><div>
      <h2>Top Jerry &amp; Shower King</h2>
      <p>Each week, the highest score is <b>Top Jerry</b> and wins $${TOP_JERRY_PRIZE}.
      The lowest score is the <b>Shower King</b>, who showers in the office bathroom.</p>
    </div></div>

    ${last ? `<div class="award-heroes">
      <div class="card award-hero jerry">
        <div class="award-emoji">🧀</div>
        <div class="award-label">Reigning Top Jerry · Week ${last.week}</div>
        <div class="award-name">${names(last.jerry)}</div>
        <div class="muted">${f1(last.hi)} pts · won by ${f1(last.jerryMargin)} · +${money(TOP_JERRY_PRIZE / last.jerry.length)}</div>
      </div>
      <div class="card award-hero shower">
        <div class="award-emoji">🚿</div>
        <div class="award-label">Reigning Shower King · Week ${last.week}</div>
        <div class="award-name">${names(last.shower)}</div>
        <div class="muted">${f1(last.lo)} pts · ${f1(last.showerMargin)} pts from safety · bring a towel</div>
      </div>
    </div>` : ''}

    ${odds.length ? `<h3 class="sub-h">Week ${ctx.awardWeek} odds</h3>
    <div class="award-heroes">
      <div class="card"><div class="award-label">🧀 Most likely Top Jerry</div><ol class="odds-list">${oddsList('jerryPct')}</ol></div>
      <div class="card"><div class="award-label">🚿 Most likely Shower King</div><ol class="odds-list">${oddsList('showerPct')}</ol></div>
    </div>
    <p class="explain">From 20,000 simulations of week ${ctx.awardWeek} using projected lineups (byes and waiver fill-ins included).</p>` : ''}

    <h3 class="sub-h">Season leaderboard</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Team</th><th>🧀 Top Jerry</th><th>Winnings</th><th>🚿 Shower King</th><th class="l hide-sm">Weeks</th></tr></thead>
      <tbody>${totals.map(t => `<tr class="${t.rid === mine ? 'mine' : ''}">
        <td>${teamChip(t.rid)}</td>
        <td class="num">${t.jerry || '<span class="muted">0</span>'}</td>
        <td class="num"><b>${t.cash ? money(t.cash) : '<span class="muted">$0</span>'}</b></td>
        <td class="num">${t.shower ? `${t.shower}` : '<span class="muted">0</span>'}</td>
        <td class="l hide-sm muted">${[...t.jerryWeeks.map(w => `🧀${w}`), ...t.showerWeeks.map(w => `🚿${w}`)].join(' ')}</td>
      </tr>`).join('')}</tbody>
    </table></div>

    <h3 class="sub-h">Week by week</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Week</th><th class="l">🧀 Top Jerry</th><th>Pts</th><th class="hide-sm">Margin</th><th class="l">🚿 Shower King</th><th>Pts</th><th class="hide-sm">Margin</th></tr></thead>
      <tbody>${[...ctx.awards].reverse().map(a => `<tr>
        <td>Wk ${a.week}</td>
        <td class="l">${names(a.jerry)}</td><td class="num">${f1(a.hi)}</td><td class="num hide-sm muted">+${f1(a.jerryMargin)}</td>
        <td class="l">${names(a.shower)}</td><td class="num">${f1(a.lo)}</td><td class="num hide-sm muted">−${f1(a.showerMargin)}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="l muted">No weeks scored yet.</td></tr>'}</tbody>
    </table></div>`;
}
