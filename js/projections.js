// Weekly lineup projections: best legal lineup from each roster, with waiver-wire fill-ins
// when a team has nobody healthy/non-bye to start at a slot.
import { SLOT_ELIGIBILITY } from './data.js';

const WAIVER_POOL_SIZE = 3; // average the top N free agents for a fill-in

export function buildProjections(m) {
  const rostered = new Set(m.teams.flatMap(t => t.players));
  const byWeek = {}; // week -> rid -> lineup
  const waiver = {}; // week -> slot -> { avg, names }

  for (const w of m.futureWeeks) {
    const proj = m.proj[w] || {};
    const live = w === m.liveWeek;
    const freeAgents = Object.keys(proj)
      .filter(id => !rostered.has(id) && proj[id] > 0)
      .map(id => ({ id, pts: proj[id], p: m.players[id] }))
      .sort((a, b) => b.pts - a.pts);
    waiver[w] = waiverPool(m, freeAgents);
    // Once a free agent's game has started he can't be picked up for this week.
    const fillIns = live ? waiverPool(m, freeAgents.filter(f => !gameOf(m, f.p).started)) : waiver[w];

    byWeek[w] = {};
    for (const t of m.teams) {
      const row = live ? (m.matchups[w] || []).find(r => r.roster_id === t.rid) : null;
      byWeek[w][t.rid] = bestLineup(m, t, w, fillIns, row);
    }
  }
  return { byWeek, waiver };
}

function waiverPool(m, freeAgents) {
  const out = {};
  for (const slot of new Set([...m.slots, ...m.positions])) {
    const elig = SLOT_ELIGIBILITY[slot];
    const top = freeAgents.filter(f => canPlay(f.p, elig)).slice(0, WAIVER_POOL_SIZE);
    out[slot] = {
      avg: top.length ? top.reduce((s, f) => s + f.pts, 0) / top.length : 0,
      names: top.map(f => `${f.p.name} (${f.pts.toFixed(1)})`),
    };
  }
  return out;
}

function canPlay(p, elig) {
  return p && p.fantasyPositions.some(fp => elig.includes(fp));
}

// This week's NFL game for a player: has it started, and how much is left?
function gameOf(m, p) {
  const g = p && m.gameStatus[p.team];
  if (!g) return { started: false, state: 'pre', remaining: 1, label: '' };
  return { ...g, started: g.state !== 'pre' };
}

// Greedy fill, most restrictive slots first (QB/K/DEF before FLEX before SUPER_FLEX).
// During a live week (row = this team's Sleeper matchup), starters whose game has started are locked in
// with their actual points; locked bench players can't move in; open slots are still filled optimally.
export function bestLineup(m, team, week, waiverForWeek, row = null) {
  const proj = m.proj[week] || {};
  const actual = row?.players_points || {};
  const lineup = new Array(m.slots.length);
  const used = new Set();

  if (row) {
    (row.starters || []).forEach((id, i) => {
      const p = m.players[id];
      const g = gameOf(m, p);
      if (!p || !g.started || i >= m.slots.length) return;
      const projected = proj[id] ?? 0;
      const scored = actual[id] ?? 0;
      used.add(id);
      lineup[i] = {
        slot: m.slots[i], id, name: p.name, pos: p.pos, team: p.team,
        locked: true, status: g.state === 'post' ? 'final' : 'live', gameLabel: g.label,
        scored, projected,
        // Live: points so far plus the share of his projection still to play.
        pts: g.state === 'post' ? scored : scored + projected * g.remaining,
        toPlay: g.state === 'post' ? 0 : projected * g.remaining,
      };
    });
  }

  const pool = team.players
    .filter(id => !team.taxi.has(id) && !used.has(id))
    .map(id => ({ id, p: m.players[id], pts: proj[id] ?? 0 }))
    .filter(x => x.p)
    .map(x => ({ ...x, locked: !!row && gameOf(m, x.p).started }))
    .sort((a, b) => b.pts - a.pts);

  const order = m.slots.map((slot, i) => ({ slot, i }))
    .filter(({ i }) => !lineup[i])
    .sort((a, b) => SLOT_ELIGIBILITY[a.slot].length - SLOT_ELIGIBILITY[b.slot].length);

  for (const { slot, i } of order) {
    const elig = SLOT_ELIGIBILITY[slot];
    const pick = pool.find(x => !used.has(x.id) && !x.locked && x.pts > 0 && canPlay(x.p, elig));
    if (pick) {
      used.add(pick.id);
      lineup[i] = { slot, id: pick.id, name: pick.p.name, pos: pick.p.pos, team: pick.p.team, pts: pick.pts, toPlay: pick.pts,
        gameLabel: row ? gameOf(m, pick.p).label : '' };
    } else {
      // Nobody on the roster can play here this week (bye, injury, no depth, or their game already started).
      // Explain why: is there an eligible player who's simply on bye?
      const benched = pool.filter(x => !used.has(x.id) && canPlay(x.p, elig));
      const reason = benched.length
        ? `${benched.map(x => x.p.name).join(', ')} ${isBye(m, benched[0].p, week) ? 'on bye' : benched[0].locked ? 'already played on the bench' : 'out'}`
        : 'no eligible player';
      const wv = waiverForWeek[slot];
      lineup[i] = { slot, waiver: true, name: 'Waiver pickup', reason, pool: wv.names, pts: wv.avg, toPlay: wv.avg };
    }
  }
  const total = lineup.reduce((s, x) => s + x.pts, 0);
  const scored = lineup.reduce((s, x) => s + (x.scored ?? 0), 0);
  const toPlay = lineup.reduce((s, x) => s + x.toPlay, 0);
  const fullProj = lineup.reduce((s, x) => s + (x.locked ? x.projected : x.pts), 0);
  const bench = pool.filter(x => !used.has(x.id)).map(x => ({
    id: x.id, name: x.p.name, pos: x.p.pos, team: x.p.team, pts: x.locked ? (actual[x.id] ?? 0) : x.pts,
    bye: isBye(m, x.p, week), locked: x.locked,
  }));
  // How much of the week's uncertainty is left (1 = nothing played yet, 0 = all final).
  const uncertainty = row ? Math.min(1, fullProj > 0 ? toPlay / fullProj : 0) : 1;
  return { lineup, bench, total, scored, live: !!row, uncertainty };
}

function isBye(m, p, week) {
  const playing = m.teamsPlaying[week];
  return !!(playing && p.team && p.team !== 'FA' && !playing.has(p.team));
}

// Replacement level by position for a week (top-N free agents), used for trade value.
export function replacementByPos(m, projections, week) {
  const wv = projections.waiver[week] || {};
  const out = {};
  for (const pos of m.positions) out[pos] = wv[pos]?.avg ?? 0;
  return out;
}

// Replacement levels for every upcoming week, plus their average per position (used for past weeks).
export function replacementLevels(m, projections) {
  const future = Object.fromEntries(m.futureWeeks.map(w => [w, replacementByPos(m, projections, w)]));
  const past = {};
  for (const pos of m.positions) {
    const xs = m.futureWeeks.map(w => future[w][pos]);
    past[pos] = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  }
  return { future, past };
}
