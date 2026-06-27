# ⚽ WC 2026 CLI

A FIFA World Cup 2026 terminal dashboard built with Node.js. Live scores, group standings, upcoming fixtures — all from your terminal.

```
npx wc26
```

> You'll need a free API key from [football-data.org](https://www.football-data.org/) to run it.

---

## Features

- **Live Dashboard** — auto-refreshes every 60 seconds, press `Q` to exit
- **All Matches** — every WC 2026 fixture with scores and status badges
- **Upcoming Matches** — next 8 fixtures with kickoff times in IST
- **Group Standings** — all 12 groups with points table
- **Refresh Data** — manually pull latest data without restarting

---

## Demo

```
 __        ______   ____   ___ ____   __
 \ \      / / ___| |___ \ / _ \___ \ / /_
  \ \ /\ / / |       __) | | | |__) | '_ \
   \ V  V /| |___   / __/| |_| / __/| (_) |
    \_/\_/  \____| |_____|\___/_____|\___/

✔ World Cup data loaded!

? What do you want to do? ›
  ❯ Live DashBoard
    Upcoming Matches
    All Matches
    Standings
    Refresh Data
    Quit

╔══════════════════════════════════════════════════╗
║ Brazil  vs  Argentina                            ║
║  2 - 1   |  LIVE                                 ║
╚══════════════════════════════════════════════════╝
```

---

## Setup

**1. Get a free API key**

Sign up at [football-data.org](https://www.football-data.org/) and copy your token from the dashboard.

**2. Run with npx**

```bash
API_KEY=your_token_here npx wc26
```

**Or clone and run locally:**

```bash
git clone https://github.com/KAMMAR-SHASHANK/fifa-wc-cli.git
cd fifa-wc-cli
npm install
```

Create a `.env` file:

```
API_KEY=your_token_here
```

Then run:

```bash
node index.js
```

---

## Tech Stack

- **Node.js** v25+ with ES Modules
- **chalk** — terminal colors
- **inquirer** — interactive menu
- **ora** — loading spinners
- **figlet** — ASCII banner
- **football-data.org API** — live match data

---

## License

ISC
