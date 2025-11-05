import { BlobServiceClient } from "@azure/storage-blob";
import axios from "axios";
import * as cheerio from "cheerio";

const CONN_STRING = process.env.STORAGE_ACCOUNT_CONNECTION_STRING;
const CONTAINER = process.env.STATE_CONTAINER_NAME;
const BLOB_NAME = process.env.STATE_BLOB_DE || "state-de.json";

const blobService = BlobServiceClient.fromConnectionString(CONN_STRING);
const containerClient = blobService.getContainerClient(CONTAINER);
const blobClient = containerClient.getBlockBlobClient(BLOB_NAME);

// ---------- utils ----------
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function loadState() {
  try {
    if (!(await blobClient.exists())) return {};
    const dl = await blobClient.download();
    const text = await streamToString(dl.readableStreamBody);
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function saveState(state) {
  const body = JSON.stringify(state, null, 2);
  await blobClient.upload(body, Buffer.byteLength(body), { overwrite: true });
}

// 17.10.2025  |  October 10, 2025  |  03.11.2025
function parseDateFlexible(s) {
  if (!s) return null;
  const txt = s.trim().replace(/\u00A0/g, " "); // normalize nbsp
  // 03.11.2025 or 3.11.2025
  const m1 = txt.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m1) {
    const [, d, mo, y] = m1;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // dd.mm.yy (rare)
  const m1b = txt.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/);
  if (m1b) {
    const [, d, mo, yy] = m1b;
    const y = Number(yy) < 50 ? `20${yy}` : `19${yy}`;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // English month (the index page sometimes shows EN)
  const m2 = txt.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})$/i);
  if (m2) {
    const months = {
      january: "01", february: "02", march: "03", april: "04",
      may: "05", june: "06", july: "07", august: "08",
      september: "09", october: "10", november: "11", december: "12",
    };
    const mo = months[m2[1].toLowerCase()];
    const d = m2[2].padStart(2, "0");
    const y = m2[3];
    return `${y}-${mo}-${d}`;
  }
  // German month (in case some institute uses it): 17. Oktober 2025
  const m3 = txt.match(/^(\d{1,2})\.\s*(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+(\d{4})$/i);
  if (m3) {
    const map = {
      januar: "01", februar: "02", märz: "03", maerz: "03", april: "04",
      mai: "05", juni: "06", juli: "07", august: "08",
      september: "09", oktober: "10", november: "11", dezember: "12",
    };
    const d = m3[1].padStart(2, "0");
    const mo = map[m3[2].toLowerCase().replace("ä", "ae")];
    const y = m3[3];
    if (mo) return `${y}-${mo}-${d}`;
  }
  return null; // fallback
}

function normVal(txt) {
  if (!txt) return null;
  const t = txt.replace(",", ".").replace("%", "").trim();
  if (t === "–" || t === "-" || t === "") return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

// ---------- per-institute scraper ----------
/**
 * We scrape the institute’s own page. Each has a single 'wilko' table:
 * Columns (after date & spacer) are:
 *  CDU/CSU, SPD, GRÜNE, FDP, LINKE, AfD, FW, BSW, Sonstige, spacer, Befragte, Zeitraum
 * We only take the **first valid poll row** (class usually 's'), not 'ws' (election).
 * We keep 9 groups: CDU, SPD, GRU, FDP, LIN, AFD, FW (only if present), BSW, Others.
 */
async function fetchInstituteLatest(base, { name, path }) {
  const url = `${base}${path}`;
  const { data } = await axios.get(url, { responseType: "text" });
  const $ = cheerio.load(data);

  const table = $("table.wilko").first();
  if (!table.length) return null;

  // pick the first tbody row that is a normal survey (avoid .ws election result rows)
  const rows = table.find("tbody > tr");
  let row = null;
  for (const el of rows.toArray()) {
    const $el = $(el);
    const tds = $el.find("td");
    if (!tds.length) continue;
    const dateCell = $(tds[0]);
    const dateTxt = dateCell.text().trim();
    // skip rows with class 'ws' or non-date
    const isElection = dateCell.hasClass("ws") || /Bundestagswahl/i.test($(el).text());
    const parsed = parseDateFlexible(dateTxt);
    if (!isElection && parsed) {
      row = el;
      break;
    }
  }
  if (!row) return null;

  const tds = $(row).find("td");
  // Guard for minimal cell count (we expect at least up to 'Sonstige' = index 10)
  if (tds.length < 11) return null;

  const published = parseDateFlexible($(tds[0]).text());

  // Indices per the header order on institute pages:
  // 0 date | 1 spacer | 2 CDU | 3 SPD | 4 GRU | 5 FDP | 6 LIN | 7 AfD | 8 FW | 9 BSW | 10 Sonstige
  const CDU = normVal($(tds[2]).text());
  const SPD = normVal($(tds[3]).text());
  const GRU = normVal($(tds[4]).text());
  const FDP = normVal($(tds[5]).text());
  const LIN = normVal($(tds[6]).text());
  const AFD = normVal($(tds[7]).text());
  const FW  = normVal($(tds[8]).text());
  const BSW = normVal($(tds[9]).text());
  const Others = normVal($(tds[10]).text());

  const results = {
    CDU, SPD, GRU, FDP, LIN, AFD,
    // FW only when present:
    ...(FW !== null ? { FW } : {}),
    BSW, Others,
  };

  return {
    institute: name,
    link: url,
    published,
    results,
  };
}

// ---------- main export ----------
/**
 * Scrapes latest polls from 8 institutes (pages), returns ONLY new/changed vs state.
 * Institutes:
 *  - Allensbach, Verian(Emnid), Forsa, Forschungsgruppe Wahlen (Politbarometer),
 *    GMS, Infratest dimap, INSA, YouGov
 */
export default async function scrapeGermany() {
  const base = "https://www.wahlrecht.de/umfragen/";
  const institutes = [
    { name: "Allensbach",         path: "allensbach.htm" },
    { name: "Verian(Emnid)",      path: "emnid.htm" },
    { name: "Forsa",              path: "forsa.htm" },
    { name: "Forsch’gr.Wahlen",   path: "politbarometer.htm" },
    { name: "GMS",                path: "gms.htm" },
    { name: "Infratestdimap",     path: "dimap.htm" },
    { name: "INSA",               path: "insa.htm" },
    { name: "Yougov",             path: "yougov.htm" },
  ];

  const prev = await loadState();
  const next = { ...prev };
  const updated = [];

  for (const inst of institutes) {
    try {
      const poll = await fetchInstituteLatest(base, inst);
      if (!poll || !poll.published) continue;

      const key = `${poll.institute}_${poll.published}`;

      // If we don't have it OR results changed, emit update
      const prevPoll = prev[key];
      const changed =
        !prevPoll ||
        JSON.stringify(prevPoll.results) !== JSON.stringify(poll.results);

      if (changed) {
        updated.push(poll);
      }

      // Always keep the latest entry for this institute (single line per your request)
      next[key] = poll;
    } catch (e) {
      // Keep going; one institute failing shouldn't stop others
      // You can log this from the caller
    }
  }

  if (Object.keys(next).length) {
    await saveState(next);
  }

  return updated;
}
