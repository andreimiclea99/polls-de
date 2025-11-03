import { BlobServiceClient } from "@azure/storage-blob";
import axios from "axios";
import * as cheerio from "cheerio";

const CONN_STRING = process.env.STORAGE_ACCOUNT_CONNECTION_STRING;
const CONTAINER = process.env.STATE_CONTAINER_NAME;
const BLOB_NAME = process.env.STATE_BLOB_RO || "state-ro.json";

const blobService = BlobServiceClient.fromConnectionString(CONN_STRING);
const containerClient = blobService.getContainerClient(CONTAINER);
const blobClient = containerClient.getBlockBlobClient(BLOB_NAME);

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function loadState() {
  try {
    if (!(await blobClient.exists())) return {};
    const download = await blobClient.download();
    const text = await streamToString(download.readableStreamBody);
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function saveState(state) {
  await blobClient.upload(
    JSON.stringify(state, null, 2),
    Buffer.byteLength(JSON.stringify(state))
  );
}

function normalizeNumber(num) {
  if (!num) return null;
  return parseFloat(num.replace(",", ".").replace("%", ""));
}

export default async function scrapeRomania() {
  const prevState = await loadState();
  const state = { ...prevState };
  const updated = [];

  console.log("📡 Fetching Romania poll table...");
  const { data } = await axios.get(
    "https://ro.wikipedia.org/wiki/Alegeri_parlamentare_%C3%AEn_Rom%C3%A2nia,_2028#Sondaje_de_opinie"
  );
  const $ = cheerio.load(data);

  const table = $("table.wikitable").first();
  if (!table.length) {
    console.log("❌ Polling table not found");
    return updated;
  }

  table.find("tbody > tr").each((i, row) => {
    const cells = $(row).find("td");
    if (cells.length < 10) return;
  
    const anchor = $(cells[0]).find("a");
    const institute = anchor.text().trim();
    const sourceLink = anchor.attr("href") || null;
  
    const date = $(cells[1]).text().trim();
    if (!/\d{4}/.test(date)) return; // Skip headers / election rows
  
    const pollKey = `${institute}_${date.replace(/\s+/g, "_")}`;
  
    const results = {
      PSD: normalizeNumber($(cells[3]).text()),
      AUR: normalizeNumber($(cells[4]).text()),
      PNL: normalizeNumber($(cells[5]).text()),
      USR: normalizeNumber($(cells[6]).text()),
      SOS: normalizeNumber($(cells[7]).text()),
      POT: normalizeNumber($(cells[8]).text()),
      UDMR: normalizeNumber($(cells[9]).text()),
      SENS: normalizeNumber($(cells[10]).text()),
      PMP: normalizeNumber($(cells[11]).text()),
      FD: normalizeNumber($(cells[12]).text()),
      REPER: normalizeNumber($(cells[13]).text()),
      Others: normalizeNumber($(cells[14]).text()),
    };
  
    const pollData = {
      institute,
      published: date,
      link: sourceLink,
      results,
    };
  
    if (!prevState[pollKey] ||
        JSON.stringify(prevState[pollKey].results) !== JSON.stringify(results)) {
      updated.push(pollData);
    }
  
    state[pollKey] = pollData;
  });
  

  if (Object.keys(state).length > 0) {
    await saveState(state);
  }

  console.log(`✅ Scraped Romania: ${Object.keys(state).length} polls`);
  return updated;
}
