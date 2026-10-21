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
    waiver[w] = {};
    const freeAgents = Object.keys(proj)
      .filter(id => !rostered.has(id) && proj[id] > 0)
      .map(id => ({ id, pts: proj[id], p: m.players[id] }))
      .sort((a, b) => b.pts - a.pts);

    for (const slot of new Set([...m.slots, ...m.positions])) {
      const elig = SLOT_ELIGIBILITY[slot];
      const top = freeAgents.filter(f => canPlay(f.p, elig)).slice(0, WAIVER_POOL_SIZE);
      waiver[w][slot] = {
        avg: top.length ? top.reduce((s, f) => s + f.pts, 0) / top.length : 0,
        names: top.map(f => `${f.p.name} (${f.pts.toFixed(1)})`),
      };
    }

    byWeek[w] = {};
    for (const t of m.teams) byWeek[w][t.rid] = bestLineup(m, t, w, waiver[w]);
  }
  return { byWeek, waiver };
}

function canPlay(p, elig) {
  return p && p.fantasyPositions.some(fp => elig.includes(fp));
}

// Greedy fill, most restrictive slots first (QB/K/DEF before FLEX before SUPER_FLEX).
export function bestLineup(m, team, week, waiverForWeek) {
  const proj = m.proj[week] || {};
  const pool = team.players
    .filter(id => !team.taxi.has(id))
    .map(id => ({ id, p: m.players[id], pts: proj[id] ?? 0 }))
    .filter(x => x.p)
    .sort((a, b) => b.pts - a.pts);

  const order = m.slots.map((slot, i) => ({ slot, i }))
    .sort((a, b) => SLOT_ELIGIBILITY[a.slot].length - SLOT_ELIGIBILITY[b.slot].length);
  const used = new Set();
  const lineup = new Array(m.slots.length);

  for (const { slot, i } of order) {
    const elig = SLOT_ELIGIBILITY[slot];
    const pick = pool.find(x => !used.has(x.id) && x.pts > 0 && canPlay(x.p, elig));
    if (pick) {
      used.add(pick.id);
      lineup[i] = { slot, id: pick.id, name: pick.p.name, pos: pick.p.pos, team: pick.p.team, pts: pick.pts };
    } else {
      // Nobody on the roster can play here this week (bye, injury, or no depth).
      // Explain why: is there an eligible player who's simply on bye?
      const benched = pool.filter(x => !used.has(x.id) && canPlay(x.p, elig));
      const reason = benched.length
        ? `${benched.map(x => x.p.name).join(', ')} ${isBye(m, benched[0].p, week) ? 'on bye' : 'out'}`
        : 'no eligible player';
      const wv = waiverForWeek[slot];
      lineup[i] = { slot, waiver: true, name: 'Waiver pickup', reason, pool: wv.names, pts: wv.avg };
    }
  }
  const total = lineup.reduce((s, x) => s + x.pts, 0);
  const bench = pool.filter(x => !used.has(x.id)).map(x => ({
    id: x.id, name: x.p.name, pos: x.p.pos, team: x.p.team, pts: x.pts, bye: isBye(m, x.p, week),
  }));
  return { lineup, bench, total };
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
