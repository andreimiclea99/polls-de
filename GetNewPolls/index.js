import scrapeGermany from "../polls.js";

const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK;

export default async function (context, myTimer) {
  context.log("🇩🇪 Checking Germany (latest only)...");
  const polls = await scrapeGermany();

  if (!polls.length) {
    context.log("✅ No new German polls");
    return;
  }

  for (const p of polls) {
    const lines = [];
    lines.push(`:ballot_box_with_ballot: *New German Poll: ${p.institute}*`);
    lines.push(`:date: Published: ${p.published}`);
    lines.push(`Results:`);

    // Order for output
    const order = ["CDU", "AFD", "SPD", "GRU", "LIN", "FDP", "FW", "BSW", "Others"];
    for (const k of order) {
      if (p.results[k] == null) continue;        // skip missing
      const val = p.results[k];
      const label = k === "Others" ? "Others" : k;
      lines.push(`${symbolFor(label)} ${label}: ${val}%`);
    }

    lines.push(`:link: ${p.link}`);

    const text = lines.join("\n");
    context.log(`📊 Sending to Slack: ${p.institute} - ${p.published}`);
    await fetch(SLACK_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  }

  context.log("✅ Germany poll notification complete");
}

function symbolFor(party) {
  // Keep your previous emoji mapping; quick neutral defaults below:
  const map = {
    CDU: ":black_small_square:",
    AFD: ":black_small_square:",
    SPD: ":red_circle:",
    GRU: ":black_small_square:",
    LIN: ":black_small_square:",
    FDP: ":large_yellow_circle:",
    FW:  "🟠",
    BSW: ":large_brown_circle:",
    Others: ":white_circle:",
  };
  return map[party] || ":black_small_square:";
}
