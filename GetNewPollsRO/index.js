import scrapeRomania from "../polls-ro.js";

const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_RO;

export default async function (context, myTimer) {
  context.log("🇷🇴 Checking Romania polls...");
  const polls = await scrapeRomania();

  if (!polls.length) {
    context.log("✅ No new polls");
    return;
  }

  for (const p of polls) {
    const text = `🇷🇴 *New Romania Poll: ${p.institute}*\n📅 ${p.published}\n` +
      Object.entries(p.results)
        .filter(([, v]) => v !== null)
        .map(([party, v]) => `${party}: ${v}%`)
        .join("\n") +
      `\n🔗 ${p.link}`;

    await fetch(SLACK_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
  }

  context.log("✅ Romania poll notification complete");
}
