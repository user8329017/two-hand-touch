// Weekly power rankings: blend of all-play record, scoring, recent form, and rest-of-season outlook.
import { range } from './data.js';
import { gamesForWeek } from './sim.js';

export const POWER_WEIGHTS = { allPlay: 0.35, avgPts: 0.2, recent: 0.2, outlook: 0.25 };

export function powerRankings(m, scores, simResults, asOfWeek = m.lastScored) {
  const weeks = range(m.startWeek, asOfWeek).filter(w => scores[w]);
  if (!weeks.length) return [];
  const sim = Object.fromEntries(simResults.map(r => [r.rid, r]));

  const rows = m.teams.map(t => {
    const pts = weeks.map(w => scores[w][t.rid] ?? 0);
    let apW = 0, apG = 0;
    for (const w of weeks) {
      const mine = scores[w][t.rid] ?? 0;
      for (const o of m.teams) {
        if (o.rid === t.rid) continue;
        const theirs = scores[w][o.rid] ?? 0;
        apW += mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
        apG++;
      }
    }
    // Actual record through asOfWeek (recomputed so past-week rankings are honest).
    let w = 0, l = 0, streak = 0, streakType = null;
    for (const wk of weeks) {
      const g = gamesForWeek(m, wk).find(g => g.a.rid === t.rid || g.b.rid === t.rid);
      if (!g) continue;
      const [me, opp] = g.a.rid === t.rid ? [g.a, g.b] : [g.b, g.a];
      const won = me.pts > opp.pts;
      won ? w++ : l++;
      const type = won ? 'W' : 'L';
      streak = type === streakType ? streak + 1 : 1;
      streakType = type;
    }
    const last3 = pts.slice(-3);
    return {
      rid: t.rid,
      allPlay: apG ? apW / apG : 0,
      apW, apL: apG - apW,
      avgPts: avg(pts),
      recent: avg(last3),
      outlook: sim[t.rid]?.rosAvg ?? avg(pts),
      lastWeek: pts[pts.length - 1],
      high: Math.max(...pts),
      record: `${w}-${l}`,
      wins: w,
      expectedWins: (apG ? apW / apG : 0) * weeks.length,
      streak: streakType ? `${streakType}${streak}` : '',
    };
  });

  const z = {};
  for (const k of Object.keys(POWER_WEIGHTS)) z[k] = zscores(rows.map(r => r[k]));
  rows.forEach((r, i) => {
    r.score = Object.entries(POWER_WEIGHTS).reduce((s, [k, wt]) => s + wt * z[k][i], 0);
  });
  // Map to a friendly 0–100 scale.
  const lo = Math.min(...rows.map(r => r.score)), hi = Math.max(...rows.map(r => r.score));
  rows.forEach(r => { r.rating = hi > lo ? Math.round(40 + 60 * (r.score - lo) / (hi - lo)) : 70; });
  rows.sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

// Little auto-written blurbs so each team gets some trash talk.
export function blurb(m, r, rows) {
  const n = rows.length;
  const luck = r.wins - r.expectedWins;
  const bits = [];
  const byKey = (k) => [...rows].sort((a, b) => b[k] - a[k]).findIndex(x => x.rid === r.rid) + 1;
  const ptsRank = byKey('avgPts'), recentRank = byKey('recent'), outRank = byKey('outlook');

  if (r.rank === 1) bits.push(`The team to beat.`);
  if (r.rank === n) bits.push(`Rock bottom.`);
  if (r.streak.startsWith('W') && +r.streak.slice(1) >= 3) bits.push(`Riding a ${r.streak.slice(1)}-game win streak.`);
  if (r.streak.startsWith('L') && +r.streak.slice(1) >= 3) bits.push(`Has dropped ${r.streak.slice(1)} straight.`);
  if (luck >= 1.25) bits.push(`Living charmed: ${r.record} but plays like a ${fmtRec(r.expectedWins, r.wins + lossesOf(r))} team.`);
  if (luck <= -1.25) bits.push(`Snakebitten: ${r.record} despite an all-play record of ${Math.round(r.apW)}-${Math.round(r.apL)}.`);
  if (ptsRank === 1) bits.push(`League's top scoring offense.`);
  if (recentRank <= 2 && ptsRank > 4) bits.push(`Heating up lately (${r.recent.toFixed(1)} ppg over the last 3).`);
  if (recentRank >= n - 1 && ptsRank <= 4) bits.push(`Cooling off (${r.recent.toFixed(1)} ppg over the last 3).`);
  if (outRank <= 2) bits.push(`Projections love this roster the rest of the way.`);
  if (outRank >= n - 1) bits.push(`Rest-of-season projections are grim.`);
  if (!bits.length) bits.push(`Averaging ${r.avgPts.toFixed(1)} ppg; ranked #${outRank} in rest-of-season projections.`);
  return bits.slice(0, 3).join(' ');
}

const lossesOf = (r) => +r.record.split('-')[1];
const fmtRec = (ew, games) => `${Math.round(ew)}-${Math.round(games - ew)}`;
const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
function zscores(xs) {
  const mu = avg(xs);
  const sd = Math.sqrt(avg(xs.map(x => (x - mu) ** 2))) || 1;
  return xs.map(x => (x - mu) / sd);
}
