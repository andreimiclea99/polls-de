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

export default async function (context, myTimer) {
    try {
      context.log("🔍 Checking for new polls...");
      const newPolls = await scrapeWahlrecht();
  
      if (newPolls.length === 0) {
        context.log("✅ No new polls");
        return;
      }
  
      context.log(`📢 Found ${newPolls.length} new poll(s)`);
  
      for (const poll of newPolls) {
        await fetch(process.env.SLACK_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `🗳 New poll: ${poll.institute} (${poll.published})\n${poll.sourceLink}`
          })
        });
      }
    } catch (err) {
      context.log.error("❌ Error running function:", err);
    }
  }
