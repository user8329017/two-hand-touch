// Thin wrapper around Sleeper's public, read-only API (no key needed, CORS open).
const V1 = 'https://api.sleeper.app/v1';
const ROOT = 'https://api.sleeper.app';

const memo = new Map();

async function get(url) {
  if (memo.has(url)) return memo.get(url);
  const p = fetch(url).then(r => {
    if (!r.ok) throw new Error(`Sleeper API ${r.status} for ${url}`);
    return r.json();
  });
  memo.set(url, p);
  p.catch(() => memo.delete(url));
  return p;
}

export const api = {
  state: () => get(`${V1}/state/nfl`),
  league: (id) => get(`${V1}/league/${id}`),
  users: (id) => get(`${V1}/league/${id}/users`),
  rosters: (id) => get(`${V1}/league/${id}/rosters`),
  matchups: (id, week) => get(`${V1}/league/${id}/matchups/${week}`),
  transactions: (id, week) => get(`${V1}/league/${id}/transactions/${week}`),
  // Undocumented but public endpoints used by the Sleeper app itself.
  schedule: (season) => get(`${ROOT}/schedule/nfl/regular/${season}`),
  projections: (season, week, positions) => {
    const pos = positions.map(p => `position[]=${p}`).join('&');
    return get(`${ROOT}/projections/nfl/${season}/${week}?season_type=regular&${pos}`);
  },
  player: (id) => get(`https://api.sleeper.com/players/nfl/${id}`),
};

export const avatarUrl = (avatar) =>
  avatar ? (avatar.startsWith('http') ? avatar : `https://sleepercdn.com/avatars/thumbs/${avatar}`) : null;
