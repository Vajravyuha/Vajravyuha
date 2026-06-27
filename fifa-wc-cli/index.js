#!/usr/bin/env node
import 'dotenv/config'
import ora from 'ora'
import inquirer from 'inquirer'
import figlet from 'figlet'
import chalk from 'chalk'

const apiKey = process.env.API_KEY

const stripAnsi = str => str.replace(/\x1B\[[0-9;]*m/g, '');
const visibleLength = str => stripAnsi(str).length;

//drawBox
function drawBox(lines, width) {
  console.log("╔" + "═".repeat(width) + "╗")
  for (const line of lines) {
    const padding = Math.max(0, width - visibleLength(line) - 2);
    console.log("║ " + line + " ".repeat(padding) + " ║");
  }
  console.log("╚" + "═".repeat(width) + "╝")
  console.log()
}

//helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

//liveDashBoard
async function liveDashboard() {

  // Fix 1: guard against non-TTY environments
  if (!process.stdin.isTTY) {
    console.log(chalk.red("Live dashboard requires an interactive terminal."))
    return
  }

  let exitDashboard = false;

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  const keyHandler = (key) => {
    if (key.toLowerCase() === "q") {
      exitDashboard = true;
    }
    if (key === "\u0003") {
      process.exit();
    }
  };

  process.stdin.on("data", keyHandler);

  while (!exitDashboard) {
    console.clear();
    console.log(chalk.yellow.bold(banner));

    const matches = await getMatches();
    const liveMatches = matches.filter(match => match.status === "IN_PLAY");

    if (liveMatches.length === 0) {
      console.log(chalk.yellow("No live matches right now."));
    } else {
      showMatches(liveMatches);
      console.log(chalk.green.bold(`\n${liveMatches.length} live match(es)`));
    }

    for (let i = 60; i > 0 && !exitDashboard; i--) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(chalk.gray(`Refreshing in ${i}s | Press Q to return`));
      await sleep(1000);
    }

    console.log();
  }

  process.stdin.removeListener("data", keyHandler);
  process.stdin.setRawMode(false);
  process.stdin.pause();
}

//getMatches
async function getMatches() {
  const response = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
    headers: { "X-Auth-Token": apiKey }
  })
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Failed to fetch matches");
  }
  return data.matches;
}

//getStandings
async function getStandings() {
  const response = await fetch("https://api.football-data.org/v4/competitions/WC/standings", {
    headers: { "X-Auth-Token": apiKey }
  })
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Failed to fetch standings");
  }
  return data.standings;
}

//Upcoming matches
function showUpcoming(matches) {
  const upcoming = matches
    .filter(match => match.status === "TIMED")
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
    .slice(0, 8);

  for (const match of upcoming) {
    const kickoff = new Date(match.utcDate);
    const time = kickoff.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const lines = [
      chalk.yellow(time),
      `${chalk.cyan(match.homeTeam.name)} vs ${chalk.magenta(match.awayTeam.name)}`
    ];
    drawBox(lines, 60);
  }
}

//showMatches
function showMatches(matches) {
  for (const match of matches) {
    const home = chalk.cyan.bold(match.homeTeam?.name ?? "TBD");
    const away = chalk.magenta.bold(match.awayTeam?.name ?? "TBD");
    const score = chalk.black.bgWhite.bold(
      ` ${match.score.fullTime.home ?? "-"} - ${match.score.fullTime.away ?? "-"} `
    );
    const status = getStatus(match.status);
    const lines = [
      `${home}  vs  ${away}`,
      `${score}  |  ${status}`
    ]
    drawBox(lines, 50);
  }
}

//showStandings
function showStandings(standings) {
  for (const group of standings) {
    console.log(chalk.yellow.bold(group.group))
    console.log()
    console.log(chalk.dim("Pos Team                      P  W  D  L  GD  Pts"));
    for (const row of group.table) {
      const pos = String(row.position).padStart(2)
      let name = row.team.name.padEnd(25)
      const played = String(row.playedGames).padStart(2)
      const won = String(row.won).padStart(2)
      const draw = String(row.draw).padStart(2)
      const lost = String(row.lost).padStart(2)
      const gd = String(row.goalDifference).padStart(3)
      const pts = String(row.points).padStart(3)
      if (row.position == 1) {
        name = chalk.green(name)
      }
      console.log(`${pos} ${name} ${played} ${won} ${draw} ${lost} ${gd} ${chalk.white.bold(pts)}`)
    }
    console.log()
  }
}

//mainMenu
async function mainMenu() {
  const ans = await inquirer.prompt([{
    type: 'select',
    name: 'choice',
    message: chalk.magenta.bold('What do you want to do?'),
    choices: ['Live DashBoard', 'Upcoming Matches', 'All Matches', 'Standings', 'Refresh Data', 'Quit']
  }]);
  return ans.choice
}

//getStatus
function getStatus(status) {
  switch (status) {
    case "IN_PLAY":  return chalk.black.bgRed.bold(" LIVE ");
    case "PAUSED":   return chalk.black.bgYellow.bold(" PAUSED ");
    case "FINISHED": return chalk.black.bgGreen.bold(" FINISHED ");
    case "TIMED":    return chalk.black.bgBlue.bold(" SCHEDULED ");
    default:         return chalk.gray(status);
  }
}

// --- Startup ---
console.clear();
const banner = figlet.textSync("WC 2026", { font: "Big" });
console.log(chalk.yellow.bold(banner));

const spinner = ora("Loading World Cup data...").start();

// Fix 2 & 3: error handling on initial fetch, data declared outside try
let data = {}
try {
  data.matches = await getMatches()
  data.standings = await getStandings()
  spinner.succeed("World Cup data loaded!")
} catch (err) {
  spinner.fail("Failed to load data: " + err.message)
  process.exit(1)
}

// --- Main loop ---
while (true) {
  const choice = await mainMenu();

  if (choice === "Live DashBoard") {
    await liveDashboard();
  }
  else if (choice === "All Matches") {
    console.clear();
    console.log(chalk.yellow.bold(banner));
    showMatches(data.matches);
  }
  else if (choice === "Standings") {
    console.clear();
    console.log(chalk.yellow.bold(banner));
    showStandings(data.standings);
  }
  else if (choice === "Upcoming Matches") {
    console.clear();
    console.log(chalk.yellow.bold(banner));
    showUpcoming(data.matches);
  }
  else if (choice === "Refresh Data") {
    const spinner = ora("Refreshing World Cup data...").start();
    try {
      data.matches = await getMatches()
      data.standings = await getStandings()
      spinner.succeed("Data updated!")
    } catch (err) {
      spinner.fail("Failed to refresh: " + err.message)
    }
    await sleep(1000);
  }
  else {
    process.exit(0);
  }
}