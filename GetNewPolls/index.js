import scrapeWahlrecht from "../polls.js";
import axios from "axios";
import fs from "fs";

const STATE_FILE = "../state.json";
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function sendSlack(poll) {
  const msg = `🗳 *New ${poll.institute} poll*\n` +
    `📅 Published: ${poll.published}\n` +
    `CDU/CSU: ${poll.results.CDU ?? "-"}%\n` +
    `AfD: ${poll.results.AFD ?? "-"}%\n` +
    `SPD: ${poll.results.SPD ?? "-"}%\n` +
    `Greens: ${poll.results.GRU ?? "-"}%\n` +
    `Linke: ${poll.results.LIN ?? "-"}%\n` +
    `BSW: ${poll.results.BSW ?? "-"}%\n` +
    `FDP: ${poll.results.FDP ?? "-"}%\n` +
    `<${poll.sourceLink}|More details>`;
  await axios.post(SLACK_WEBHOOK, { text: msg });
}

export default async function (context) {
  context.log("🔍 Checking for new Wahlrecht polls…");

  const polls = await scrapeWahlrecht();
  const state = loadState();

  const newPolls = polls.filter(p => {
    const prev = state[p.institute];
    return !prev || p.published > prev;
  });

  if (newPolls.length === 0) {
    context.log("✅ No new polls today.");
    return;
  }

  for (const poll of newPolls) {
    context.log(`📌 New poll: ${poll.institute} — ${poll.published}`);
    await sendSlack(poll);
    state[p.institute] = poll.published;
  }

  saveState(state);
  context.log(`✅ ${newPolls.length} alert(s) sent to Slack.`);
}
