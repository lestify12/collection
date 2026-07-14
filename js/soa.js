/* ============================================================
   SOA (Statement of Account) reader — extracts the developer's
   "Payment Installment Breakdown" from an uploaded PDF: every
   installment's number, percentage and due date, plus the 1st
   installment date. Uses the vendored pdf.js (lazy-loaded).
   ============================================================ */

let pdfjsPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsPromise) pdfjsPromise = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "js/vendor/pdf.min.js";
    s.onload = () => {
      try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "js/vendor/pdf.worker.min.js"; } catch {}
      res(window.pdfjsLib);
    };
    s.onerror = () => rej(new Error("Could not load the PDF reader."));
    document.head.appendChild(s);
  });
  return pdfjsPromise;
}

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** "1-Nov-24" → "2024-11-01" */
function toISO(d) {
  const m = String(d).trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  const mm = MON[m[2].toLowerCase()];
  if (!mm) return null;
  let y = +m[3]; if (y < 100) y += 2000;
  return `${y}-${String(mm).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`;
}

// One installment row: "3rd Installment 2% 1-Jan-25". The percentage is what
// separates the breakdown from the plain "Agreed Payment Plan (Due)" list
// (which has no % column), so requiring a % targets the breakdown table.
const ROW_RE = /(\d+)\s*(?:st|nd|rd|th)\s+Installment\s+(\d+(?:\.\d+)?)\s*%\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})/ig;

/** Parse a SOA PDF → { ref, start, items:[{n, pct, date}] }. */
export async function parseSOA(file) {
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;

  // Concatenate every text item in reading order into one blob per document.
  // Row reconstruction by y-coordinate is fragile (sub-pixel splits drop rows);
  // the row regex is specific enough to match straight from the token stream.
  let text = "";
  for (let pn = 1; pn <= pdf.numPages; pn++) {
    const page = await pdf.getPage(pn);
    const tc = await page.getTextContent();
    for (const it of tc.items) if (it.str) text += it.str + " ";
  }
  text = text.replace(/\s+/g, " ");
  const ref = (text.match(/PHD\/SOA\/\d+/i) || [""])[0];

  const byN = new Map();
  ROW_RE.lastIndex = 0;
  let m;
  while ((m = ROW_RE.exec(text)) !== null) {
    const n = +m[1];
    if (!byN.has(n)) byN.set(n, { n, pct: +m[2], date: toISO(m[3]) });
  }
  const items = [...byN.values()].sort((a, b) => a.n - b.n);
  const start = items.length ? items[0].date : null;
  return { ref, start, items };
}
