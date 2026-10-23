// League side games: Top Jerry (weekly high score, wins cash) and Shower King (weekly low score, showers at the office).
import { range } from './data.js';
import { teamSD } from './sim.js';

export const TOP_JERRY_PRIZE = 25;

// Past weeks: who won each award (ties share it, and split the prize).
export function weeklyAwards(m, scores) {
  return range(m.startWeek, m.lastScored).filter(w => scores[w]).map(w => {
    const entries = m.teams.map(t => ({ rid: t.rid, pts: scores[w][t.rid] ?? 0 }));
    const hi = Math.max(...entries.map(e => e.pts));
    const lo = Math.min(...entries.map(e => e.pts));
    const sorted = [...entries].sort((a, b) => b.pts - a.pts);
    return {
      week: w,
      jerry: entries.filter(e => e.pts === hi).map(e => e.rid),
      shower: entries.filter(e => e.pts === lo).map(e => e.rid),
      hi, lo,
      jerryMargin: sorted[0].pts - sorted[1].pts,
      showerMargin: sorted[sorted.length - 2].pts - sorted[sorted.length - 1].pts,
    };
  });
}

export function awardTotals(m, weeks) {
  const tot = Object.fromEntries(m.teams.map(t => [t.rid, { rid: t.rid, jerry: 0, cash: 0, shower: 0, jerryWeeks: [], showerWeeks: [] }]));
  for (const wk of weeks) {
    for (const rid of wk.jerry) {
      tot[rid].jerry++;
      tot[rid].cash += TOP_JERRY_PRIZE / wk.jerry.length;
      tot[rid].jerryWeeks.push(wk.week);
    }
    for (const rid of wk.shower) {
      tot[rid].shower++;
      tot[rid].showerWeeks.push(wk.week);
    }
  }
  return Object.values(tot);
}

function randn() {
  let u = 0; while (!u) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

// Odds of each team being Top Jerry / Shower King in an upcoming week.
export function awardOdds(m, projections, sd, week, N = 20000) {
  const lineups = projections.byWeek[week];
  if (!lineups) return [];
  const means = m.teams.map(t => lineups[t.rid]?.total ?? 0);
  const sds = m.teams.map(t => teamSD(projections, week, t.rid, sd));
  const top = new Array(means.length).fill(0), bot = new Array(means.length).fill(0);
  for (let s = 0; s < N; s++) {
    let hi = -Infinity, lo = Infinity, hiI = 0, loI = 0;
    for (let i = 0; i < means.length; i++) {
      const x = means[i] + sds[i] * randn();
      if (x > hi) { hi = x; hiI = i; }
      if (x < lo) { lo = x; loI = i; }
    }
    top[hiI]++; bot[loI]++;
  }
  return m.teams.map((t, i) => ({ rid: t.rid, proj: means[i], jerryPct: top[i] / N, showerPct: bot[i] / N }));
}
