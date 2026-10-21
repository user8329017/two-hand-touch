// Hindsight trade grades: points each side actually got out of the deal (above replacement,
// only in weeks the player was started) + projected rest-of-season value above replacement.
import { range } from './data.js';
import { replacementByPos } from './projections.js';

const PICK_VALUE = [0, 45, 25, 12, 6, 3]; // rough points-above-replacement for a draft pick by round
const FAAB_VALUE = 0.2;                   // points per FAAB dollar

export function gradeTrades(m, projections) {
  const replFuture = Object.fromEntries(m.futureWeeks.map(w => [w, replacementByPos(m, projections, w)]));
  // Past weeks: use the average current replacement level per position.
  const replPast = {};
  for (const pos of m.positions) {
    const xs = m.futureWeeks.map(w => replFuture[w][pos]);
    replPast[pos] = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  }
  const onRoster = Object.fromEntries(m.teams.map(t => [t.rid, new Set(t.players)]));

  return m.trades.map(t => {
    const sides = t.roster_ids.map(rid => {
      const adds = Object.entries(t.adds || {});
      const assets = [];
      for (const [pid, to] of adds) {
        if (to !== rid) continue;
        const p = m.players[pid] || { name: `Player ${pid}`, pos: '?' };
        let realized = 0, starts = 0, rawPts = 0;
        for (const w of range(t.leg, m.lastScored)) {
          const row = (m.matchups[w] || []).find(r => r.roster_id === rid);
          if (row?.starters?.includes(pid)) {
            const pts = row.players_points?.[pid] ?? 0;
            rawPts += pts; starts++;
            realized += pts - (replPast[p.pos] ?? 0);
          }
        }
        const stillHere = onRoster[rid]?.has(pid);
        let future = 0;
        if (stillHere) {
          for (const w of m.futureWeeks) {
            future += Math.max(0, (m.proj[w]?.[pid] ?? 0) - (replFuture[w][p.pos] ?? 0));
          }
        }
        assets.push({ kind: 'player', pid, from: t.drops?.[pid], name: p.name, pos: p.pos, team: p.team, starts, rawPts, realized, future, stillHere, value: realized + future });
      }
      for (const pk of t.draft_picks || []) {
        if (pk.owner_id !== rid) continue;
        const orig = m.teamById[pk.roster_id];
        const v = PICK_VALUE[Math.min(pk.round, PICK_VALUE.length - 1)];
        assets.push({ kind: 'pick', from: pk.previous_owner_id, name: `${pk.season} Round ${pk.round}`, note: orig && pk.roster_id !== rid ? `via ${orig.name}` : '', value: v });
      }
      for (const fb of t.waiver_budget || []) {
        if (fb.receiver !== rid) continue;
        assets.push({ kind: 'faab', from: fb.sender, name: `$${fb.amount} FAAB`, value: fb.amount * FAAB_VALUE });
      }
      const received = assets.reduce((s, a) => s + Math.max(a.value, 0), 0);
      return { rid, assets, received };
    });

    // Judge each side on what it received vs. what it sent away (works for 3+ team trades too).
    const pad = 10; // keeps tiny trades from producing extreme grades
    for (const side of sides) {
      side.sent = sides.flatMap(o => o.assets.map(a => ({ ...a, to: o.rid })))
        .filter(a => a.from === side.rid);
      side.given = side.sent.reduce((s, a) => s + Math.max(a.value, 0), 0);
      side.pad = pad;
      side.share = (side.received + pad) / (side.received + side.given + 2 * pad);
      side.grade = letter(side.share);
      side.net = side.received - side.given;
    }
    const winner = [...sides].sort((a, b) => b.share - a.share)[0];
    const lopsided = winner.share >= 0.555; // B+ or better for the top side
    return { tx: t, week: t.leg, created: t.created, sides, winner: lopsided ? winner.rid : null, replPast };
  });
}

const SCALE = [[0.70, 'A+'], [0.64, 'A'], [0.59, 'A-'], [0.555, 'B+'], [0.52, 'B'], [0.49, 'B-'],
  [0.46, 'C+'], [0.43, 'C'], [0.40, 'C-'], [0.36, 'D+'], [0.32, 'D'], [0, 'F']];
const letter = (s) => SCALE.find(([cut]) => s >= cut)[1];
