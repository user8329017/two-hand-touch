// Draft grades. Every pick "costs" the value of its slot and "returns" the value of where the
// player should have gone:
//   Draft day: where the market valued him (consensus Sleeper ADP, ranked among the players drafted).
//   Hindsight: where he'd go in a re-draft today (points so far + rest-of-season projections, above replacement).
// Grade = total value returned ÷ total value spent. 1.00 means a team drafted exactly to slot.
import { api } from './api.js';
import { scoreStats } from './data.js';
import { replacementLevels } from './projections.js';

const DEF_IDS = /^[A-Z]{2,3}$/;

export async function loadDraft(m) {
  const drafts = await api.drafts(m.leagueId);
  const draft = drafts.find(d => d.season === m.season && d.status === 'complete') || drafts[0];
  if (!draft) return null;
  const [picks, stats, seasonProj] = await Promise.all([
    api.draftPicks(draft.draft_id),
    api.seasonStats(m.season, m.positions).catch(() => []),
    api.seasonProjections(m.season, m.positions).catch(() => []),
  ]);
  return { draft, picks, stats, seasonProj };
}

// Which ADP flavor matches this league's format.
function adpKey(m) {
  const qbSlots = m.slots.filter(s => s === 'QB').length;
  if (m.slots.includes('SUPER_FLEX') || qbSlots > 1) return 'adp_2qb';
  const rec = m.scoring.rec || 0;
  return rec >= 1 ? 'adp_ppr' : rec >= 0.5 ? 'adp_half_ppr' : 'adp_std';
}

export function gradeDraft(m, projections, raw) {
  const { draft, picks, stats, seasonProj } = raw;
  const N = picks.length;
  // Value of the nth pick: smooth decay so early picks matter most (pick 1 = 100, last pick ≈ 5).
  const slotValue = (n) => 100 * Math.exp(-3 * (n - 1) / Math.max(N - 1, 1));
  const { future: replFuture, past: replPast } = replacementLevels(m, projections);
  const weeksPlayed = Math.max(0, m.lastScored - m.startWeek + 1);
  const statsById = Object.fromEntries(stats.map(r => [r.player_id, r.stats || {}]));
  const key = adpKey(m);
  const adpById = Object.fromEntries(seasonProj.map(r => [r.player_id, r.stats?.[key]]));

  const rows = picks.map(pk => {
    const pid = pk.player_id;
    const md = pk.metadata || {};
    const pos = md.position || (DEF_IDS.test(pid) ? 'DEF' : '?');
    const name = pos === 'DEF' ? `${md.team || pid} D/ST` : `${md.first_name || ''} ${md.last_name || ''}`.trim() || m.players[pid]?.name || pid;
    const adp = adpById[pid] ?? 999;
    const pts = scoreStats(statsById[pid] || {}, m.scoring, pos);
    const soFar = pts - (replPast[pos] ?? 0) * weeksPlayed;
    let ros = 0;
    for (const w of m.futureWeeks) ros += Math.max(0, (m.proj[w]?.[pid] ?? 0) - (replFuture[w][pos] ?? 0));
    return {
      pickNo: pk.pick_no, round: pk.round, slot: pk.draft_slot, rid: pk.roster_id, keeper: !!pk.is_keeper,
      pid, name, pos, team: md.team || '', adp, pts, soFar, ros, nowValue: soFar + ros,
    };
  });

  // Rank every drafted player by ADP (draft day) and by current value (hindsight).
  [...rows].sort((a, b) => (a.adp - b.adp) || (a.pickNo - b.pickNo)).forEach((r, i) => { r.marketRank = i + 1; });
  [...rows].sort((a, b) => (b.nowValue - a.nowValue) || (a.pickNo - b.pickNo)).forEach((r, i) => { r.redraftRank = i + 1; });
  for (const r of rows) {
    r.cost = slotValue(r.pickNo);
    r.dayValue = slotValue(r.marketRank);
    r.nowSlotValue = slotValue(r.redraftRank);
    r.daySurplus = r.dayValue - r.cost;
    r.nowSurplus = r.nowSlotValue - r.cost;
  }

  const teams = m.teams.map(t => {
    const mine = rows.filter(r => r.rid === t.rid).sort((a, b) => a.pickNo - b.pickNo);
    const cost = sum(mine, 'cost'), day = sum(mine, 'dayValue'), now = sum(mine, 'nowSlotValue');
    const by = (k, dir) => [...mine].sort((a, b) => dir * (b[k] - a[k]))[0];
    return {
      rid: t.rid, picks: mine, cost, day, now,
      dayRatio: cost ? day / cost : 1, nowRatio: cost ? now / cost : 1,
      steal: by('daySurplus', 1), reach: by('daySurplus', -1),
      hit: by('nowSurplus', 1), bust: by('nowSurplus', -1),
    };
  });
  for (const t of teams) { t.dayGrade = letter(t.dayRatio); t.nowGrade = letter(t.nowRatio); }

  // Board columns: draft slot -> team that held it in round 1.
  const slotTeam = {};
  for (const r of rows) if (r.round === 1) slotTeam[r.slot] = r.rid;
  const rounds = Math.max(...rows.map(r => r.round));
  const slots = Object.keys(slotTeam).map(Number).sort((a, b) => a - b);

  return { draft, rows, teams, rounds, slots, slotTeam, weeksPlayed, replPast, adpKey: key };
}

const sum = (xs, k) => xs.reduce((s, x) => s + x[k], 0);

export const DRAFT_SCALE = [[1.15, 'A+'], [1.10, 'A'], [1.06, 'A-'], [1.03, 'B+'], [1.00, 'B'], [0.97, 'B-'],
  [0.94, 'C+'], [0.91, 'C'], [0.88, 'C-'], [0.84, 'D+'], [0.80, 'D'], [0, 'F']];
const letter = (x) => DRAFT_SCALE.find(([cut]) => x >= cut)[1];
