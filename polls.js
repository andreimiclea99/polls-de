import { BlobServiceClient } from "@azure/storage-blob";
import axios from "axios";
import * as cheerio from "cheerio";

const CONN_STRING = process.env.STORAGE_ACCOUNT_CONNECTION_STRING;
const CONTAINER = process.env.STATE_CONTAINER_NAME;
const BLOB_NAME = process.env.STATE_BLOB_NAME;

const blobService = BlobServiceClient.fromConnectionString(CONN_STRING);
const containerClient = blobService.getContainerClient(CONTAINER);
const blobClient = containerClient.getBlockBlobClient(BLOB_NAME);

// ---- Load state from blob ----
async function loadState() {
  try {
    const exists = await blobClient.exists();
    if (!exists) return {};
    const download = await blobClient.download();
    const text = await streamToString(download.readableStreamBody);
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// ---- Save state to blob ----
async function saveState(state) {
  await blobClient.upload(JSON.stringify(state, null, 2), Buffer.byteLength(JSON.stringify(state)));
}

// Helper for stream reading
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// ✅ Parse German date format (DD.MM.YYYY) to ISO (YYYY-MM-DD)
function parseGermanDate(dateStr) {
  const parts = dateStr.trim().match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!parts) return null;
  const [, day, month, year] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export default async function scrapeWahlrecht() {
  const state = await loadState();
  const updated = [];

  console.log("📡 Fetching wahlrecht.de...");
  const { data } = await axios.get("https://www.wahlrecht.de/umfragen/");
  const $ = cheerio.load(data);

  const table = $("table.wilko");

  // ✅ Skip first th (the "Institute" label), only get actual institute columns
  const institutes = table.find("thead tr th.in").slice(1).map((i, el) => ({
    name: $(el).text().split(/\s+/)[0].trim(),
    link: $(el).find("a").attr("href")
  })).get();

  console.log(`🏢 Found ${institutes.length} institutes:`, institutes.map(i => i.name));

  // ✅ Get dates (these don't have the extra column issue)
  const dates = table.find("tbody tr#datum td").map((i, el) => {
    const raw = $(el).text().trim();
    return {
      raw,
      parsed: parseGermanDate(raw),
    };
  }).get();

  console.log(`📅 Found ${dates.length} dates`);

  const partyRowMap = {
    "cdu": "CDU",
    "afd": "AFD",
    "spd": "SPD",
    "gru": "GRU",
    "lin": "LIN",
    "bsw": "BSW",
    "fdp": "FDP",
    "son": "Others",
  };

  for (const [rowId, party] of Object.entries(partyRowMap)) {
    const row = table.find(`tr#${rowId}`);
    
    row.find("td").each((colIndex, cell) => {
      // 👇 shift alignment: table data starts at index 1 in header
      const correctedIndex = colIndex - 1;
      if (correctedIndex < 0) return;
    
      let institute = institutes[correctedIndex];
      if (!institute) return;
    
      let instituteName = institute.name;
      let instituteLink = institute.link;
    
      const anchor = $(cell).find("a[href]").first();
      if (anchor.length) {
        const href = anchor.attr("href").toLowerCase();
        if (href.includes("insa")) instituteName = "INSA";
        else if (href.includes("yougov")) instituteName = "YouGov";
        else if (href.includes("forsa")) instituteName = "Forsa";
        else if (href.includes("kantar")) instituteName = "Kantar";
        else if (href.includes("allensbach")) instituteName = "Allensbach";
        else if (href.includes("dimap")) instituteName = "Infratest dimap";
        else if (href.includes("gms")) instituteName = "GMS";
        else if (href.includes("verian") || href.includes("emnid"))
          instituteName = "Verian (Emnid)";
        instituteLink = href;
      }
    
      const date = dates[correctedIndex];
      if (!date?.parsed) return;
    
      const valueText = $(cell).text().trim().replace(",", ".");
      const value = parseFloat(valueText);
      if (isNaN(value)) return;
    
      const pollKey = `${instituteName}_${date.parsed}`;
      if (!state[pollKey]) {
        state[pollKey] = {
          institute: instituteName,
          link: `https://www.wahlrecht.de/umfragen/${instituteLink}`,
          published: date.parsed,
          results: {},
        };
      }
    
      state[pollKey].results[party] = value;
    });
    
  }  

  // ✅ Detect new or updated polls correctly
  const prevState = await loadState();
  for (const [pollKey, pollData] of Object.entries(state)) {
    if (!prevState[pollKey] ||
        JSON.stringify(prevState[pollKey].results) !== JSON.stringify(pollData.results)) {
      updated.push(pollData);
      console.log(`✨ New/Updated: ${pollData.institute} - ${pollData.published}`);
    }
  }

  if (Object.keys(state).length > 0) {
    await saveState(state);
    console.log(`💾 Updated state with ${Object.keys(state).length} polls stored`);
  }

  return updated;
}