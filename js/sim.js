// Past results + Monte Carlo simulation of the rest of the regular season.
import { range } from './data.js';

// Pair up matchup rows by matchup_id: [{week, a:{rid,pts}, b:{rid,pts}}]
export function gamesForWeek(m, w) {
  const groups = {};
  for (const row of m.matchups[w] || []) {
    if (row.matchup_id == null) continue;
    (groups[row.matchup_id] ||= []).push({ rid: row.roster_id, pts: row.points || 0, row });
  }
  return Object.values(groups).filter(g => g.length === 2).map(([a, b]) => ({ week: w, a, b }));
}

// Weekly scores for completed weeks: week -> rid -> points
export function pastScores(m) {
  const out = {};
  for (const w of range(m.startWeek, m.lastScored)) {
    out[w] = {};
    for (const row of m.matchups[w] || []) out[w][row.roster_id] = row.points || 0;
  }
  return out;
}

// How much does a team's weekly score bounce around? Pooled within-team SD, shrunk toward ~22% of mean.
export function weeklySD(m, scores) {
  const weeks = Object.keys(scores);
  let ss = 0, n = 0, total = 0, cnt = 0;
  for (const t of m.teams) {
    const xs = weeks.map(w => scores[w][t.rid]).filter(x => x > 0);
    if (xs.length < 2) continue;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    xs.forEach(x => { ss += (x - mean) ** 2; total += x; cnt++; });
    n += xs.length - 1;
  }
  const prior = cnt ? 0.22 * (total / cnt) : 25;
  if (!n) return prior;
  const k = 20; // prior weight in "observations"
  return Math.sqrt((ss + k * prior * prior) / (n + k));
}

const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export const winProb = (meanA, meanB, sd) => normCdf((meanA - meanB) / (sd * Math.SQRT2));

function randn() {
  let u = 0; while (!u) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

export function simulate(m, projections, sd, N = 10000) {
  const T = m.teams.length;
  const idx = Object.fromEntries(m.teams.map((t, i) => [t.rid, i]));
  const weeks = m.futureWeeks.map(w => ({
    games: gamesForWeek(m, w).map(g => [idx[g.a.rid], idx[g.b.rid]]),
    means: m.teams.map(t => projections.byWeek[w]?.[t.rid]?.total ?? 0),
  }));
  const P = Math.min(m.playoffTeams || 0, T);
  const byes = P > 2 ? 2 ** Math.ceil(Math.log2(P)) - P : 0;

  const seedCounts = m.teams.map(() => new Array(T).fill(0));
  const winSum = new Array(T).fill(0);
  const pfSum = new Array(T).fill(0);
  const wins = new Float64Array(T), pf = new Float64Array(T), sc = new Float64Array(T);
  const order = [...Array(T).keys()];

  for (let s = 0; s < N; s++) {
    m.teams.forEach((t, i) => { wins[i] = t.wins + t.ties / 2; pf[i] = t.pf; });
    for (const wk of weeks) {
      for (let i = 0; i < T; i++) { sc[i] = Math.max(0, wk.means[i] + sd * randn()); pf[i] += sc[i]; }
      for (const [a, b] of wk.games) wins[sc[a] > sc[b] ? a : b] += 1;
      if (m.medianGame) {
        const sorted = Array.from(sc).sort((x, y) => y - x);
        const cut = sorted[Math.floor(T / 2) - 1];
        for (let i = 0; i < T; i++) if (sc[i] >= cut) wins[i] += 1;
      }
    }
    const seeds = seedOrder(m, order, wins, pf);
    seeds.forEach((ti, seed) => { seedCounts[ti][seed]++; });
    for (let i = 0; i < T; i++) { winSum[i] += wins[i]; pfSum[i] += pf[i]; }
  }

  const gamesLeft = weeks.length * (m.medianGame ? 2 : 1);
  return m.teams.map((t, i) => {
    const dist = seedCounts[i].map(c => c / N);
    const projWins = winSum[i] / N;
    const totalGames = t.wins + t.losses + t.ties + gamesLeft;
    return {
      rid: t.rid,
      projWins,
      projLosses: totalGames - projWins,
      projPF: pfSum[i] / N,
      seedDist: dist,
      avgSeed: dist.reduce((s, p, k) => s + p * (k + 1), 0),
      playoffPct: dist.slice(0, P).reduce((a, b) => a + b, 0),
      byePct: dist.slice(0, byes).reduce((a, b) => a + b, 0),
      topSeedPct: dist[0],
      lastPct: dist[T - 1],
      rosAvg: weeks.length ? weeks.reduce((s, wk) => s + wk.means[i], 0) / weeks.length : 0,
    };
  });
}

// Sleeper default seeding: record, then points for. Division winners seeded first if divisions exist.
function seedOrder(m, order, wins, pf) {
  const cmp = (a, b) => (wins[b] - wins[a]) || (pf[b] - pf[a]);
  const sorted = [...order].sort(cmp);
  if (!m.hasDivisions) return sorted;
  const seen = new Set(), leaders = [];
  for (const i of sorted) {
    const d = m.teams[i].division;
    if (!seen.has(d)) { seen.add(d); leaders.push(i); }
  }
  return [...leaders, ...sorted.filter(i => !leaders.includes(i))];
}
