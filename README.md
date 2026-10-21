# League Lab

A static fantasy football site for a Sleeper league. No backend and no API key: the browser calls Sleeper's public API directly.

## Features
- **Projected standings**: simulates the rest of the regular season 10,000 times. Shows playoff, bye, #1 seed and last-place odds, plus each team's seed distribution.
- **Matchups**: projected scores and win chances for any future week, with full projected lineups. If a team has nobody to start at a slot (bye, injury, no depth), it uses the average of the top 3 free agents at that slot that week, and the card says so.
- **Power rankings**: all-play record 35%, season scoring 20%, last 3 weeks 20%, rest-of-season projections 25%. Shows week-over-week movement, auto-written blurbs, and Top Jerry / Shower King counts.
- **Trade grades**: each side is graded on value received vs. value given up. Value is points above replacement in weeks a player was started, plus projected rest-of-season value. Each card has a "Show the math" breakdown.
- **Top Jerry & Shower King**: weekly high score ($25) and low score, a season leaderboard, and odds for the upcoming week.
- **Looks**: Office Memo (default), Sports Page, Varsity, Arcade, Night Game. Visitors can switch with the menu in the header. The default is `DEFAULT_THEME` in `index.html`.

## Run locally
ES modules need a web server, so opening the file directly won't work. From this folder:

    python3 -m http.server 8766

Then open http://localhost:8766.

## Host it for the league
The site is static files only, with no server, database or API key. Every visit pulls fresh data from Sleeper,
so scores, standings and projections update on their own. You only need to re-upload after changing the code.
`DEFAULT_LEAGUE_ID` in `js/app.js` is already set to Sandusky's Two Hand Touch League.

### Option A: Netlify Drop (easiest, about 5 minutes, no git)
1. Make a free account at https://app.netlify.com/signup. Without an account, a dropped site expires after an hour.
2. Go to https://app.netlify.com/drop.
3. Drag this whole project folder onto the page. It uploads and gives you a random URL like `https://jolly-otter-123abc.netlify.app`.
4. Rename it: **Site configuration → Change site name**, e.g. `two-hand-touch` → `https://two-hand-touch.netlify.app`.
5. Share the link in the league chat.

To update later: open the site in Netlify → **Deploys** tab → drag the folder onto the "Drag and drop your project folder here" box.

### Option B: GitHub Pages (free, easy to keep updated)
1. Make a free account at https://github.com and click **New repository**. Name it e.g. `two-hand-touch` and make it **Public**. Pages is free for public repos.
2. On the new repo's page, click **uploading an existing file**. Drag in `index.html`, `README.md`, and the `css` and `js` folders, then **Commit changes**.
3. Go to **Settings → Pages**. Under "Build and deployment", set Source to **Deploy from a branch**, Branch to **main**, folder to **/ (root)**, then **Save**.
4. After about a minute the site is live at `https://YOUR-USERNAME.github.io/two-hand-touch/`.

To update later: upload the changed files to the repo again (or push with git). Pages redeploys automatically.

### Good to know
- Anyone with the link can see the site. It only shows what Sleeper already makes public about the league.
- It works on phones. The first load takes a few seconds while it downloads projections for the remaining weeks.
- A custom domain (e.g. `twohandtouch.com`, about $10–15 per year) can be connected in either host's domain settings.

## Tuning knobs
- `js/projections.js` → `WAIVER_POOL_SIZE` (top-N free agents averaged for fill-ins)
- `js/power.js` → `POWER_WEIGHTS`
- `js/trades.js` → `PICK_VALUE`, `FAAB_VALUE`, and the grade scale
