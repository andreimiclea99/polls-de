import scrapeWahlrecht from "../polls.js";

const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK;

async function sendSlack(poll) {
  const partyEmojis = {
    "CDU/CSU": "🔵",
    "SPD": "🔴", 
    "GRÜNE": "🟢",
    "FDP": "🟡",
    "LINKE": "🟣",
    "AfD": "🔵",
    "BSW": "🟤",
    "Sonstige": "⚪"
  };

  // Build results text
  let resultsText = "";
  for (const [party, percentage] of Object.entries(poll.results)) {
    const emoji = partyEmojis[party] || "▪️";
    resultsText += `${emoji} ${party}: ${percentage}%\n`;
  }

  const msg = `🗳️ *New German Poll: ${poll.institute}*\n` +
    `📅 Published: ${poll.published}\n\n` +
    `*Results:*\n${resultsText}\n` +
    `<${poll.link}|View full poll details>`;

  await fetch(SLACK_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: msg })
  });
}

export default async function (context, myTimer) {
  try {
    context.log("🔍 Checking for new polls...");
    const newPolls = await scrapeWahlrecht();

    if (newPolls.length === 0) {
      context.log("✅ No new polls found");
      return;
    }

    context.log(`📢 Found ${newPolls.length} new poll(s)`);

    for (const poll of newPolls) {
      context.log(`📊 Sending to Slack: ${poll.institute} - ${poll.published}`);
      await sendSlack(poll);
    }

    context.log("✅ All notifications sent successfully");
  } catch (err) {
    context.log.error("❌ Error running function:", err.message);
    context.log.error(err.stack);
    throw err; // Re-throw to mark function execution as failed
  }
}