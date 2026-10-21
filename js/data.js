// Loads everything about a league and normalizes it into one model object.
import { api, avatarUrl } from './api.js';

// Which player positions can fill each Sleeper roster slot.
export const SLOT_ELIGIBILITY = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  DL: ['DL'], LB: ['LB'], DB: ['DB'],
  IDP_FLEX: ['DL', 'LB', 'DB'],
};
export const SLOT_LABEL = {
  FLEX: 'FLEX', WRRB_FLEX: 'W/R', REC_FLEX: 'W/T', SUPER_FLEX: 'SFLX', IDP_FLEX: 'IDP',
};

export async function loadLeague(leagueId, onProgress = () => {}) {
  onProgress('Fetching league…');
  const [state, league, users, rosters] = await Promise.all([
    api.state(), api.league(leagueId), api.users(leagueId), api.rosters(leagueId),
  ]);
  const season = league.season;
  const s = league.settings;
  const startWeek = s.start_week || 1;
  const regEnd = s.playoff_week_start ? s.playoff_week_start - 1 : 17;
  const inSeason = season === state.season;
  let lastScored = s.last_scored_leg ?? (inSeason ? state.week - 1 : regEnd);
  if (!inSeason && season < state.season) lastScored = regEnd;
  lastScored = Math.min(Math.max(lastScored, startWeek - 1), regEnd);

  const slots = league.roster_positions.filter(p => SLOT_ELIGIBILITY[p]);
  const positions = [...new Set(slots.flatMap(p => SLOT_ELIGIBILITY[p]))];

  const userById = Object.fromEntries(users.map(u => [u.user_id, u]));
  const teams = rosters.map(r => {
    const u = userById[r.owner_id] || {};
    return {
      rid: r.roster_id,
      ownerId: r.owner_id,
      name: u.metadata?.team_name || u.display_name || `Team ${r.roster_id}`,
      manager: u.display_name || 'Orphan',
      avatar: avatarUrl(u.metadata?.avatar || u.avatar),
      players: r.players || [],
      taxi: new Set(r.taxi || []),
      reserve: new Set(r.reserve || []),
      division: r.settings.division || 0,
      wins: r.settings.wins || 0,
      losses: r.settings.losses || 0,
      ties: r.settings.ties || 0,
      pf: (r.settings.fpts || 0) + (r.settings.fpts_decimal || 0) / 100,
      pa: (r.settings.fpts_against || 0) + (r.settings.fpts_against_decimal || 0) / 100,
    };
  });
  const teamById = Object.fromEntries(teams.map(t => [t.rid, t]));

  onProgress('Fetching matchups & transactions…');
  const weeks = range(startWeek, regEnd);
  const txWeeks = range(1, Math.max(lastScored + 1, 1));
  const [matchupsArr, txArr, schedule] = await Promise.all([
    Promise.all(weeks.map(w => api.matchups(leagueId, w).catch(() => []))),
    Promise.all(txWeeks.map(w => api.transactions(leagueId, w).catch(() => []))),
    api.schedule(season).catch(() => []),
  ]);
  const matchups = Object.fromEntries(weeks.map((w, i) => [w, matchupsArr[i] || []]));
  const trades = txArr.flat()
    .filter(t => t.type === 'trade' && t.status === 'complete')
    .sort((a, b) => b.created - a.created);

  // Teams playing each week; anyone missing is on bye.
  const teamsPlaying = {};
  for (const g of schedule) {
    (teamsPlaying[g.week] ||= new Set()).add(g.home).add(g.away);
  }

  const futureWeeks = range(lastScored + 1, regEnd);
  onProgress(`Fetching player projections for ${futureWeeks.length} upcoming weeks…`);
  const projPositions = positions.flatMap(p => p === 'DB' ? ['DB', 'CB', 'S'] : p === 'DL' ? ['DL', 'DE', 'DT'] : [p]);
  let done = 0;
  const projArr = await Promise.all(futureWeeks.map(w =>
    api.projections(season, w, projPositions).catch(() => []).then(d => {
      onProgress(`Fetching player projections… (${++done}/${futureWeeks.length})`);
      return d;
    })));

  const players = {}; // id -> {id, name, pos, team, injury}
  const proj = {};    // week -> { playerId -> fantasy points in THIS league's scoring }
  futureWeeks.forEach((w, i) => {
    const byPlayer = (proj[w] = {});
    const playing = teamsPlaying[w];
    for (const row of projArr[i]) {
      const p = row.player || {};
      const id = row.player_id;
      if (!players[id]) players[id] = toPlayer(id, p, row.team);
      const team = row.team || p.team;
      const onBye = playing && team && !playing.has(team);
      byPlayer[id] = onBye ? 0 : scoreStats(row.stats || {}, league.scoring_settings, players[id].pos);
    }
  });

  // Fill in names for anyone rostered/traded but missing from projections.
  const needed = new Set(teams.flatMap(t => t.players));
  for (const t of trades) Object.keys(t.adds || {}).forEach(id => needed.add(id));
  const missing = [...needed].filter(id => !players[id]);
  if (missing.length) {
    onProgress(`Looking up ${missing.length} more players…`);
    const found = await Promise.all(missing.map(id => api.player(id).catch(() => null)));
    missing.forEach((id, i) => { players[id] = toPlayer(id, found[i] || {}, found[i]?.team); });
  }

  return {
    leagueId, league, state, season, startWeek, regEnd, lastScored, futureWeeks,
    slots, positions, teams, teamById, matchups, trades, players, proj, teamsPlaying,
    scoring: league.scoring_settings,
    playoffTeams: s.playoff_teams || 0,
    medianGame: s.league_average_match === 1,
    hasDivisions: (s.divisions || 0) > 1,
  };
}

function toPlayer(id, p, team) {
  const isDef = p.position === 'DEF' || /^[A-Z]{2,3}$/.test(id);
  let pos = p.position || (isDef ? 'DEF' : '?');
  if (['DE', 'DT'].includes(pos)) pos = 'DL';
  if (['CB', 'S'].includes(pos)) pos = 'DB';
  const name = isDef
    ? `${team || id} D/ST`
    : [p.first_name, p.last_name].filter(Boolean).join(' ') || `Player ${id}`;
  return {
    id, name, pos, team: team || p.team || 'FA',
    fantasyPositions: (p.fantasy_positions || [pos]).map(x => ({ DE: 'DL', DT: 'DL', CB: 'DB', S: 'DB' }[x] || x)),
    injury: p.injury_status || null,
  };
}

// Apply the league's own scoring settings to a projected stat line.
export function scoreStats(stats, scoring, pos) {
  let pts = 0;
  for (const [k, v] of Object.entries(stats)) {
    const w = scoring[k];
    if (w && typeof v === 'number') pts += w * v;
  }
  // Positional reception bonuses aren't included in projection stat lines.
  const rec = stats.rec || 0;
  if (pos === 'TE' && scoring.bonus_rec_te && stats.bonus_rec_te == null) pts += rec * scoring.bonus_rec_te;
  if (pos === 'RB' && scoring.bonus_rec_rb && stats.bonus_rec_rb == null) pts += rec * scoring.bonus_rec_rb;
  if (pos === 'WR' && scoring.bonus_rec_wr && stats.bonus_rec_wr == null) pts += rec * scoring.bonus_rec_wr;
  return Math.round(pts * 100) / 100;
}

export function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}
