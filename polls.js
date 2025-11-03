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

// ✅ Enhanced scraper that extracts poll percentages
export default async function scrapeWahlrecht() {
  const state = await loadState();
  const updated = [];

  const { data } = await axios.get("https://www.wahlrecht.de/umfragen/");
  const $ = cheerio.load(data);

  // Get party names from header row
  const parties = [];
  $("#partie th.part").each((i, el) => {
    const partyName = $(el).text().trim();
    if (partyName) parties.push(partyName);
  });

  // Process each poll column
  const dateRow = $("#datum td.di, #datum td.dir");
  dateRow.each((index, el) => {
    const instituteHeader = $("thead th.in").eq(index);
    const institute = instituteHeader.text().trim().replace(/\s+/g, "");
    const publishedText = $(el).text().trim();
    const published = new Date(publishedText).toISOString().slice(0, 10);
    const link = new URL(instituteHeader.find("a")?.attr("href") || "", "https://www.wahlrecht.de/umfragen/").href;

    // Extract poll results for each party
    const results = {};
    parties.forEach((party, partyIndex) => {
      const resultCell = $(`#partie tr`).eq(partyIndex + 1).find("td").eq(index);
      const percentage = resultCell.text().trim().replace(",", ".");
      if (percentage && !isNaN(parseFloat(percentage))) {
        results[party] = parseFloat(percentage);
      }
    });

    // Check if this is a new poll or updated poll
    const pollKey = `${institute}_${published}`;
    if (!state[pollKey] || JSON.stringify(state[pollKey].results) !== JSON.stringify(results)) {
      updated.push({ 
        institute, 
        published, 
        link,
        results 
      });
      state[pollKey] = { published, link, results };
    }
  });

  if (updated.length > 0) await saveState(state);

  return updated;
}