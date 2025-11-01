import axios from "axios";
import * as cheerio from "cheerio";

const PAGE_URL = "https://www.wahlrecht.de/umfragen/";

function normalizeDate(str) {
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
}

function absoluteUrl(href) {
  if (!href) return null;
  if (href.startsWith("http")) return href;
  return new URL(href, PAGE_URL).href;
}

async function scrapeWahlrecht() {
    const { data: html } = await axios.get(PAGE_URL);
    const $ = cheerio.load(html);
  
    const table = $("table.wilko").first();
    if (!table.length) throw new Error("Polling table not found");
  
    const headerCells = table.find("thead tr th.in"); // only real institutes
  
    const institutes = headerCells.map((i, el) => {
      const rawText = $(el).text().replace(/\s+/g, " ").trim();
      const name = rawText || `Institute-${i + 1}`;
      const link = absoluteUrl($(el).find("a").attr("href"));
      return { index: i + 2, name, link };
    }).get();
  
    const publishedRow = table.find("#datum");
    const publishedCells = publishedRow.find("td, th");
  
    const partyIds = ["cdu", "afd", "spd", "gru", "lin", "bsw", "fdp", "son"];
  
    const polls = [];
  
    institutes.forEach(inst => {
      const dateText = publishedCells.eq(inst.index).text().trim();
  
      const published =
        normalizeDate(dateText) || // English style
        normalizeGermanDate(dateText); // German style
  
      if (!published) return; // skip columns with no poll yet
  
      const results = {};
  
      partyIds.forEach(id => {
        const row = table.find(`#${id}`);
        const cell = row.find("td, th").eq(inst.index);
        const txt = cell.text().replace("%", "").replace(",", ".").trim();
        const num = parseFloat(txt);
        results[id.toUpperCase()] = isNaN(num) ? null : num;
      });
  
      polls.push({
        institute: inst.name,
        published,
        results,
        sourceLink: inst.link,
        lastSeen: new Date().toISOString(),
      });
    });
  
    return polls;
  }
  
  function normalizeGermanDate(str) {
    const m = str.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!m) return null;
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`;
  }
  
  export default scrapeWahlrecht;
