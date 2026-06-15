"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import Papa from "papaparse";
import styles from "./page.module.css";

// Excel-style column letter: 0 -> A, 25 -> Z, 26 -> AA
function columnLetter(index) {
  let result = "";
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

// Sniff the first non-empty line to guess comma vs tab.
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== "") || "";
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs > commas ? "\t" : ",";
}

// Normalize ragged rows, drop fully-empty rows, trim trailing empty columns.
function cleanGrid(grid) {
  let rows = grid.map((r) => r.map((c) => (c == null ? "" : String(c))));
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  rows = rows.map((r) => {
    const copy = r.slice();
    while (copy.length < width) copy.push("");
    return copy;
  });
  rows = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) return { grid: [], width: 0 };
  let w = width;
  while (w > 0 && rows.every((r) => (r[w - 1] || "").trim() === "")) w--;
  rows = rows.map((r) => r.slice(0, w));
  return { grid: rows, width: w };
}

// A "banner" row labels at most one column (e.g. a report title sitting above
// the real headers). It should not become an attribute level.
function isBannerRow(row) {
  const nonBlank = row.filter((c) => (c || "").trim() !== "").length;
  return nonBlank <= 1;
}

// Forward-fill blanks across each header level (merged-cell artifact),
// then return per-column identity arrays (one entry per header level).
// `headerRows` should already exclude banner/skipped rows.
function resolveHeaders(headerRows, width) {
  if (headerRows.length === 0) {
    return Array.from({ length: width }, () => []);
  }
  const filled = headerRows.map((row) => {
    const out = [];
    let last = "";
    for (let c = 0; c < width; c++) {
      const v = (row[c] || "").trim();
      if (v !== "") last = v;
      out.push(last);
    }
    return out;
  });
  const cols = [];
  for (let c = 0; c < width; c++) {
    cols.push(filled.map((levelRow) => levelRow[c]));
  }
  return cols;
}

function unpivot({ dataRows, colIdentities, idCols, excludeCols, dropBlank }) {
  const exclude = new Set(excludeCols);
  const idSet = new Set(idCols);
  const valueCols = [];
  for (let c = 0; c < colIdentities.length; c++) {
    if (!idSet.has(c) && !exclude.has(c)) valueCols.push(c);
  }
  const levels = colIdentities.length ? colIdentities[0].length : 1;
  const out = [];
  for (const row of dataRows) {
    const idVals = idCols.map((c) => row[c] ?? "");
    for (const vc of valueCols) {
      const value = row[vc] ?? "";
      if (dropBlank && String(value).trim() === "") continue;
      const attrs = colIdentities[vc] || [];
      const attrPadded = [];
      for (let l = 0; l < levels; l++) attrPadded.push(attrs[l] ?? "");
      out.push([...idVals, ...attrPadded, value]);
    }
  }
  return { rows: out, valueCols, levels };
}

// Label a column by its resolved header identity (joining multi-level with ›).
function colLabel(identity, index) {
  const parts = (identity || []).map((p) => (p || "").trim()).filter(Boolean);
  const name = parts.length ? parts.join(" › ") : "";
  return name || `(col ${columnLetter(index)})`;
}

// ---- Tutorial example tables (language-neutral, rendered in the help panel) ----

// Tutorial screenshots live in public/help/convert-pivot-to-table/
const HELP_IMG = "/help/convert-pivot-to-table";

// A plain result table with a header row (no row numbers).
function ExampleResult({ head, rows }) {
  return (
    <div className={styles.exSheetWrap}>
      <table className={styles.exSheet}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((c, ci) => (
                <td key={ci}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The example result, matching the screenshots: PIC + Region kept as identifiers,
// Branch Address + TOTAL excluded, Jan–Jun unpivoted into Month/Value.
// (First few rows shown; Debbie Whitfield's blank March is dropped.)
const EX_RESULT_HEAD = ["PIC", "Region", "Month", "Value"];
const EX_RESULT_ROWS = [
  ["Runick Naturia", "North", "Jan", "500"],
  ["Runick Naturia", "North", "Feb", "122"],
  ["Runick Naturia", "North", "Mar", "667"],
  ["…", "", "", ""],
  ["Debbie Whitfield", "West", "Jan", "301"],
  ["Debbie Whitfield", "West", "Feb", "432"],
  ["Debbie Whitfield", "West", "Apr", "851"],
];

const HELP = {
  en: {
    open: "How it works",
    close: "Hide",
    title: "Step-by-step guide",
    intro: (
      <>
        A <strong>pivot</strong> spreads one value across many columns — like a
        month's sales sitting under <em>Jan</em>, <em>Feb</em>, <em>Mar</em>.
        This tool turns that back into a plain table where every value gets its
        own row. That long shape is what you want for filtering, charts, and
        pivot tables. Below is the whole flow with a real example.
      </>
    ),
    startExampleTitle: "The example file we'll use",
    startExampleBody: (
      <>
        Say you upload this file. It lists people (<em>PIC</em>), their{" "}
        <em>Region</em> and <em>Branch Address</em>, then a column for each
        month (<em>Jan</em>–<em>Jun</em>) and a <em>TOTAL</em>. The numbers on
        the left are the row numbers the tool shows you.
      </>
    ),
    s1t: "Step 1 — Upload your file",
    s1b: (
      <>
        Choose a <em>.csv</em> or <em>.tsv</em> file. Comma or tab is detected
        automatically — you don't need to tell it which. The tool cleans the
        file (removes fully-empty rows and trailing empty columns) and shows you
        a preview.
      </>
    ),
    s2t: "Step 2 — Tell it which row the data starts on",
    s2b1: (
      <>
        This is the most important step. Look at the preview and find the first
        row that holds <em>actual data</em> (not headers). Then click that row's
        number on the left. In the example below the headers are on row 1 and
        the first person (<em>Runick Naturia</em>) is on row 2 — so you'd click{" "}
        <strong>2</strong>, and the blue <em>data →</em> marker confirms it.
      </>
    ),
    s2caseA: (
      <>
        <strong>If your data starts at row 2</strong> (one header row, the
        normal case): click the <strong>2</strong>. Row 1 becomes the header.
      </>
    ),
    s2caseB: (
      <>
        <strong>If there's a title row first</strong>, so data starts at row 3:
        click the <strong>3</strong>. The tool sees row 1 is just a title (only
        one cell filled) and <em>auto-skips</em> it — it shows crossed out. Row 2
        is used as the header.
      </>
    ),
    s2skip: (
      <>
        Each header row has a small <em>skip</em> button (top-left of the
        preview). If the tool guessed wrong, click it to flip that row between
        "use as a header" and "ignore." Stacked headers (e.g. a <em>year</em>{" "}
        row above a <em>quarter</em> row) each become their own column in the
        output.
      </>
    ),
    s3t: "Step 3 — Pick which columns to keep, drop, or convert",
    s3b: (
      <>
        Columns fall into three buckets. By default <strong>everything</strong>{" "}
        starts in <em>Values to unpivot</em> — see the left list below, holding
        all 10 columns. You move the ones you want to treat differently.
      </>
    ),
    s3id: (
      <>
        <strong>Identifiers</strong> — columns that describe each row and should
        stay as-is, like <em>PIC</em> and <em>Region</em>. Click <strong>ID</strong>{" "}
        on a column to move it here. These repeat next to every value.
      </>
    ),
    s3val: (
      <>
        <strong>Values to unpivot</strong> — the columns that get folded into
        rows (here <em>Jan</em> through <em>Jun</em>). You don't pick these;
        whatever you didn't make an identifier or exclude stays here
        automatically.
      </>
    ),
    s3ex: (
      <>
        <strong>Exclude</strong> — columns to throw away entirely, like{" "}
        <em>Branch Address</em> and the <em>TOTAL</em> column you don't want in
        the output. Click <strong>✕</strong> to move a column here.
      </>
    ),
    s3choice: "After your choices, the three lists look like the second image:",
    s4t: "Step 4 — Name the new columns and convert",
    s4b: (
      <>
        Converting creates two new columns: an <em>attribute</em> column holding
        the old header name (you might call it <em>Month</em>), and a{" "}
        <em>value</em> column holding the number (call it <em>Sales</em>). Rename
        them in the fields, then press <strong>Convert to table</strong>.
      </>
    ),
    s4result: "Here's what the example becomes (first rows shown):",
    rulesLabel: "Good to know:",
    rulesBody:
      "blank values are dropped by default (turn it off with the checkbox) — that's why a missing month for someone just won't appear. Title rows are auto-skipped but you can override. Comma and tab files are both detected automatically. Everything runs in your browser — nothing is uploaded.",
  },
  id: {
    open: "Cara kerja",
    close: "Tutup",
    title: "Panduan langkah demi langkah",
    intro: (
      <>
        <strong>Pivot</strong> menyebar satu nilai ke banyak kolom — misalnya
        penjualan per bulan ada di bawah <em>Jan</em>, <em>Feb</em>,{" "}
        <em>Mar</em>. Alat ini mengubahnya kembali jadi tabel biasa, di mana
        setiap nilai punya barisnya sendiri. Bentuk memanjang itulah yang
        gampang difilter, dibuat grafik, atau dibuat pivot lagi. Di bawah ini
        seluruh alurnya dengan contoh nyata.
      </>
    ),
    startExampleTitle: "Contoh file yang kita pakai",
    startExampleBody: (
      <>
        Misalnya kamu mengunggah file ini. Isinya nama orang (<em>PIC</em>),{" "}
        <em>Region</em> dan <em>Branch Address</em> mereka, lalu satu kolom per
        bulan (<em>Jan</em>–<em>Jun</em>) dan <em>TOTAL</em>. Angka di kiri
        adalah nomor baris yang ditampilkan alat ini.
      </>
    ),
    s1t: "Langkah 1 — Unggah file",
    s1b: (
      <>
        Pilih file <em>.csv</em> atau <em>.tsv</em>. Koma atau tab dideteksi
        otomatis — kamu tidak perlu memberi tahu. Alat ini membersihkan file
        (membuang baris yang seluruhnya kosong dan kolom kosong di ujung) lalu
        menampilkan pratinjau.
      </>
    ),
    s2t: "Langkah 2 — Tentukan dari baris mana data dimulai",
    s2b1: (
      <>
        Ini langkah terpenting. Lihat pratinjau dan cari baris pertama yang
        berisi <em>data asli</em> (bukan header). Lalu klik nomor baris itu di
        kiri. Pada contoh di bawah, header ada di baris 1 dan orang pertama
        (<em>Runick Naturia</em>) di baris 2 — jadi kamu klik <strong>2</strong>,
        dan penanda biru <em>data →</em> mengonfirmasinya.
      </>
    ),
    s2caseA: (
      <>
        <strong>Kalau data mulai di baris 2</strong> (satu baris header, kasus
        biasa): klik angka <strong>2</strong>. Baris 1 jadi header.
      </>
    ),
    s2caseB: (
      <>
        <strong>Kalau ada baris judul dulu</strong>, sehingga data mulai di
        baris 3: klik angka <strong>3</strong>. Alat ini melihat baris 1 cuma
        judul (hanya satu sel terisi) dan <em>otomatis melewatinya</em> — tampak
        dicoret. Baris 2 dipakai sebagai header.
      </>
    ),
    s2skip: (
      <>
        Setiap baris header punya tombol kecil <em>skip</em> (kiri atas
        pratinjau). Kalau tebakan alatnya salah, klik untuk membalik baris itu
        antara "dipakai sebagai header" dan "diabaikan". Header bertingkat
        (misalnya baris <em>tahun</em> di atas baris <em>kuartal</em>)
        masing-masing jadi kolom sendiri di hasil.
      </>
    ),
    s3t: "Langkah 3 — Pilih kolom mana yang disimpan, dibuang, atau dikonversi",
    s3b: (
      <>
        Kolom dibagi tiga kelompok. Secara default <strong>semuanya</strong>{" "}
        mulai di <em>Values to unpivot</em> — lihat daftar kiri di bawah, berisi
        semua 10 kolom. Kamu memindahkan yang ingin diperlakukan berbeda.
      </>
    ),
    s3id: (
      <>
        <strong>Identitas</strong> — kolom yang menjelaskan tiap baris dan harus
        tetap apa adanya, seperti <em>PIC</em> dan <em>Region</em>. Klik{" "}
        <strong>ID</strong> pada kolom untuk memindahkannya ke sini. Kolom ini
        diulang di samping tiap nilai.
      </>
    ),
    s3val: (
      <>
        <strong>Values to unpivot</strong> — kolom yang dilipat jadi baris (di
        sini <em>Jan</em> sampai <em>Jun</em>). Kamu tidak perlu memilihnya; apa
        pun yang tidak kamu jadikan identitas atau exclude otomatis tinggal di
        sini.
      </>
    ),
    s3ex: (
      <>
        <strong>Exclude</strong> — kolom yang dibuang sepenuhnya, seperti{" "}
        <em>Branch Address</em> dan kolom <em>TOTAL</em> yang tak kamu inginkan
        di hasil. Klik <strong>✕</strong> untuk memindahkan kolom ke sini.
      </>
    ),
    s3choice:
      "Setelah pilihanmu, ketiga daftar akan tampak seperti gambar kedua:",
    s4t: "Langkah 4 — Beri nama kolom baru dan konversi",
    s4b: (
      <>
        Konversi membuat dua kolom baru: kolom <em>atribut</em> yang menyimpan
        nama header lama (boleh kamu beri nama <em>Bulan</em>), dan kolom{" "}
        <em>nilai</em> yang menyimpan angkanya (beri nama <em>Penjualan</em>).
        Ganti namanya di kolom isian, lalu tekan{" "}
        <strong>Convert to table</strong>.
      </>
    ),
    s4result: "Inilah hasil dari contoh tadi (baris awal ditampilkan):",
    rulesLabel: "Perlu diketahui:",
    rulesBody:
      "nilai kosong dibuang secara default (matikan lewat kotak centang) — itu sebabnya bulan yang kosong untuk seseorang tidak akan muncul. Baris judul otomatis dilewati tapi bisa kamu ubah. File koma dan tab dideteksi otomatis. Semua berjalan di browser-mu — tidak ada yang diunggah.",
  },
};

const MAX_PREVIEW_GRID = 12; // rows shown in the raw preview
const MAX_PREVIEW_OUT = 12; // rows shown in the result preview

export default function ConvertPivotToTablePage() {
  const [file, setFile] = useState(null);
  const [grid, setGrid] = useState([]); // cleaned 2D array
  const [width, setWidth] = useState(0);
  const [dataStartRow, setDataStartRow] = useState(1); // 1-indexed: first data row
  const [skippedRows, setSkippedRows] = useState(() => new Set()); // 1-indexed header rows ignored as levels
  const [idCols, setIdCols] = useState([]); // ordered list of identifier col indices
  const [excludeCols, setExcludeCols] = useState([]); // excluded col indices
  const [dropBlank, setDropBlank] = useState(true);
  const [attrNames, setAttrNames] = useState([]); // names for each header level
  const [valueName, setValueName] = useState("Value");
  const [output, setOutput] = useState(null);
  const [outHeaders, setOutHeaders] = useState([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [lang, setLang] = useState("en");
  const fileInputRef = useRef(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("toolkit:help-lang");
      if (saved === "en" || saved === "id") setLang(saved);
    } catch (e) {
      /* ignore */
    }
  }, []);

  const changeLang = (l) => {
    setLang(l);
    try {
      localStorage.setItem("toolkit:help-lang", l);
    } catch (e) {
      /* ignore */
    }
  };

  const t = HELP[lang];

  const handleFile = (selectedFile) => {
    if (!selectedFile) return;
    setError("");
    setOutput(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const delimiter = detectDelimiter(text);
      const results = Papa.parse(text, {
        delimiter,
        skipEmptyLines: false,
      });
      if (results.errors.length > 0) {
        console.warn("Parse warnings:", results.errors);
      }
      const { grid: cleaned, width: w } = cleanGrid(results.data);
      if (cleaned.length === 0) {
        setError("That file has no usable rows. Try another file.");
        return;
      }
      setFile(selectedFile);
      setGrid(cleaned);
      setWidth(w);
      const defaultStart = Math.min(2, cleaned.length); // assume 1 header row
      setDataStartRow(defaultStart);
      // Auto-skip banner/title rows that sit within the header region.
      const autoSkip = new Set();
      for (let r = 1; r < defaultStart; r++) {
        if (isBannerRow(cleaned[r - 1])) autoSkip.add(r);
      }
      setSkippedRows(autoSkip);
      setIdCols([]);
      setExcludeCols([]);
      setOutput(null);
    };
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(selectedFile);
  };

  const changeDataStart = (rowNumber) => {
    setDataStartRow(rowNumber);
    // Re-detect banner rows within the new header region.
    setSkippedRows(() => {
      const next = new Set();
      for (let r = 1; r < rowNumber; r++) {
        if (isBannerRow(grid[r - 1])) next.add(r);
      }
      return next;
    });
    setOutput(null);
  };

  const toggleSkip = (rowNumber) => {
    setSkippedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
    setOutput(null);
  };

  // Resolved column identities depend on which rows are headers (minus skipped).
  const headerRowCount = Math.max(0, dataStartRow - 1);
  const colIdentities = useMemo(() => {
    if (grid.length === 0) return [];
    const headerRows = [];
    for (let r = 1; r <= headerRowCount; r++) {
      if (!skippedRows.has(r)) headerRows.push(grid[r - 1]);
    }
    if (headerRows.length === 0) {
      // No usable header: synthesize column-letter identities so columns stay pickable.
      return Array.from({ length: width }, (_, c) => [`Column ${columnLetter(c)}`]);
    }
    return resolveHeaders(headerRows, width);
  }, [grid, headerRowCount, skippedRows, width]);

  const levels = colIdentities.length ? colIdentities[0].length : 1;

  // Keep attribute-name inputs in sync with the number of header levels.
  useEffect(() => {
    setAttrNames((prev) => {
      const next = [];
      for (let i = 0; i < levels; i++) {
        next.push(prev[i] ?? (levels === 1 ? "Attribute" : `Attribute ${i + 1}`));
      }
      return next;
    });
  }, [levels]);

  // The pool of value columns = not identifier, not excluded.
  const valueColIndices = useMemo(() => {
    const idSet = new Set(idCols);
    const exSet = new Set(excludeCols);
    const out = [];
    for (let c = 0; c < colIdentities.length; c++) {
      if (!idSet.has(c) && !exSet.has(c)) out.push(c);
    }
    return out;
  }, [colIdentities, idCols, excludeCols]);

  // Available columns = neither identifier nor excluded (same as value pool).
  const moveToId = (c) => {
    setIdCols((prev) => [...prev, c]);
    setExcludeCols((prev) => prev.filter((x) => x !== c));
    setOutput(null);
  };
  const removeFromId = (c) => {
    setIdCols((prev) => prev.filter((x) => x !== c));
    setOutput(null);
  };
  const moveToExclude = (c) => {
    setExcludeCols((prev) => [...prev, c]);
    setIdCols((prev) => prev.filter((x) => x !== c));
    setOutput(null);
  };
  const removeFromExclude = (c) => {
    setExcludeCols((prev) => prev.filter((x) => x !== c));
    setOutput(null);
  };

  const handleProcess = () => {
    setError("");
    if (grid.length === 0) {
      setError("Upload a file first.");
      return;
    }
    if (valueColIndices.length === 0) {
      setError(
        "No value columns left to unpivot. Move some columns out of identifiers / exclude."
      );
      return;
    }
    const dataRows = grid.slice(dataStartRow - 1);
    if (dataRows.length === 0) {
      setError("No data rows below the start row. Lower the data start row.");
      return;
    }
    const { rows } = unpivot({
      dataRows,
      colIdentities,
      idCols,
      excludeCols,
      dropBlank,
    });
    const idLabels = idCols.map((c) => colLabel(colIdentities[c], c));
    const headerRow = [...idLabels, ...attrNames, valueName];
    setOutHeaders(headerRow);
    setOutput(rows);
  };

  const toCSV = () => Papa.unparse([outHeaders, ...output]);

  const handleDownload = () => {
    if (!output) return;
    const csv = toCSV();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const baseName = file.name.replace(/\.[^.]+$/i, "");
    a.href = url;
    a.download = `${baseName}_table.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(toCSV());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      setError("Couldn't copy to clipboard. Try the download instead.");
    }
  };

  const handleReset = () => {
    setFile(null);
    setGrid([]);
    setWidth(0);
    setDataStartRow(1);
    setSkippedRows(new Set());
    setIdCols([]);
    setExcludeCols([]);
    setOutput(null);
    setOutHeaders([]);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const previewGrid = grid.slice(0, MAX_PREVIEW_GRID);
  const previewOut = output ? output.slice(0, MAX_PREVIEW_OUT) : [];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <a href="/" className={styles.crumb}>
            Toolkit
          </a>
          <span className={styles.crumbDivider}>/</span>
          <span className={styles.crumbCurrent}>Convert Pivot to Table</span>
        </div>
        <button
          className={styles.helpButton}
          onClick={() => setHelpOpen(!helpOpen)}
          aria-expanded={helpOpen}
        >
          {helpOpen ? t.close : t.open}
        </button>
      </header>

      <main className={styles.main}>
        <div className={styles.intro}>
          <h1 className={styles.title}>Convert Pivot to Table</h1>
          <p className={styles.subtitle}>
            Your data is spread across columns (like one column per month)?
            This turns it back into a plain table with one row per value — ready
            for filtering, charts, and pivot tables. Handles title rows and
            stacked headers.
          </p>
        </div>

        {helpOpen && (
          <section className={styles.helpPanel}>
            <div className={styles.helpHeader}>
              <h2 className={styles.helpTitle}>{t.title}</h2>
              <div className={styles.langToggle} role="group" aria-label="Language">
                <button
                  type="button"
                  className={`${styles.langOption} ${lang === "en" ? styles.langOptionActive : ""}`}
                  onClick={() => changeLang("en")}
                  aria-pressed={lang === "en"}
                >
                  EN
                </button>
                <button
                  type="button"
                  className={`${styles.langOption} ${lang === "id" ? styles.langOptionActive : ""}`}
                  onClick={() => changeLang("id")}
                  aria-pressed={lang === "id"}
                >
                  ID
                </button>
              </div>
            </div>

            <p className={styles.helpIntro}>{t.intro}</p>

            {/* The running example file */}
            <div className={styles.tutorBlock}>
              <div className={styles.tutorEyebrow}>{t.startExampleTitle}</div>
              <p className={styles.tutorText}>{t.startExampleBody}</p>
              <img
                src={`${HELP_IMG}/1__table-example.png`}
                alt="Preview showing row numbers, a skip button on row 1, and a data marker on row 2"
                className={styles.tutorImg}
              />
            </div>

            <ol className={styles.tutorSteps}>
              {/* Step 1 */}
              <li>
                <span className={styles.tutorNum}>1</span>
                <div className={styles.tutorStepBody}>
                  <strong>{t.s1t}</strong>
                  <p>{t.s1b}</p>
                </div>
              </li>

              {/* Step 2 */}
              <li>
                <span className={styles.tutorNum}>2</span>
                <div className={styles.tutorStepBody}>
                  <strong>{t.s2t}</strong>
                  <p>{t.s2b1}</p>
                  <img
                    src={`${HELP_IMG}/1__table-example.png`}
                    alt="Row 2 marked as the data start, with row 1 as the header"
                    className={styles.tutorImg}
                  />
                  <div className={styles.caseGrid}>
                    <div className={styles.caseCard}>
                      <p>{t.s2caseA}</p>
                    </div>
                    <div className={styles.caseCard}>
                      <p>{t.s2caseB}</p>
                    </div>
                  </div>
                  <p className={styles.tutorSubNote}>{t.s2skip}</p>
                </div>
              </li>

              {/* Step 3 */}
              <li>
                <span className={styles.tutorNum}>3</span>
                <div className={styles.tutorStepBody}>
                  <strong>{t.s3t}</strong>
                  <p>{t.s3b}</p>
                  <img
                    src={`${HELP_IMG}/2__original_option.png`}
                    alt="Step 3 default: all 10 columns sit in Values, Identifiers and Exclude empty"
                    className={styles.tutorImg}
                  />
                  <ul className={styles.bucketList}>
                    <li>
                      <span className={`${styles.bucketDot} ${styles.bucketId}`} />
                      {t.s3id}
                    </li>
                    <li>
                      <span className={`${styles.bucketDot} ${styles.bucketVal}`} />
                      {t.s3val}
                    </li>
                    <li>
                      <span className={`${styles.bucketDot} ${styles.bucketEx}`} />
                      {t.s3ex}
                    </li>
                  </ul>
                  <p className={styles.tutorSubNote}>{t.s3choice}</p>
                  <img
                    src={`${HELP_IMG}/3__user_choice_option.png`}
                    alt="Step 3 after choosing: PIC and Region as Identifiers; Branch Address and TOTAL excluded; months left as Values"
                    className={styles.tutorImg}
                  />
                </div>
              </li>

              {/* Step 4 */}
              <li>
                <span className={styles.tutorNum}>4</span>
                <div className={styles.tutorStepBody}>
                  <strong>{t.s4t}</strong>
                  <p>{t.s4b}</p>
                  <p className={styles.tutorSubNote}>{t.s4result}</p>
                  <ExampleResult head={EX_RESULT_HEAD} rows={EX_RESULT_ROWS} />
                  <div className={styles.resultNote}>
                    Notice Debbie Whitfield has no March row — her March was
                    blank, and blanks are dropped by default. Branch Address and
                    TOTAL never appear — they were excluded.
                  </div>
                </div>
              </li>
            </ol>

            <div className={styles.helpRules}>
              <strong>{t.rulesLabel}</strong> {t.rulesBody}
            </div>
          </section>
        )}

        {/* Step 1: Upload */}
        <section className={styles.section}>
          <div className={styles.stepLabel}>
            <span className={styles.stepNumber}>1</span>
            <span>Upload CSV</span>
          </div>

          {!file ? (
            <label className={styles.dropzone}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                onChange={(e) => handleFile(e.target.files?.[0])}
                className={styles.fileInput}
              />
              <div className={styles.dropzoneInner}>
                <div className={styles.dropzoneIcon}>+</div>
                <div className={styles.dropzoneText}>
                  Click to choose a CSV or TSV file
                </div>
                <div className={styles.dropzoneHint}>
                  comma or tab delimited — detected automatically
                </div>
              </div>
            </label>
          ) : (
            <div className={styles.fileInfo}>
              <div className={styles.fileInfoLeft}>
                <div className={styles.fileName}>{file.name}</div>
                <div className={styles.fileMeta}>
                  {grid.length.toLocaleString()} rows · {width} columns
                </div>
              </div>
              <button className={styles.linkButton} onClick={handleReset}>
                Replace
              </button>
            </div>
          )}
        </section>

        {/* Step 2: Mark data start row */}
        {file && (
          <section className={styles.section}>
            <div className={styles.stepLabel}>
              <span className={styles.stepNumber}>2</span>
              <span>Mark where data starts</span>
            </div>
            <p className={styles.sectionHint}>
              Click a row number to set where your real data begins. Rows above
              become the header
              {headerRowCount >= 1
                ? ` — currently ${levels} attribute ${levels === 1 ? "level" : "levels"}`
                : ""}
              . Title rows are auto-skipped; use <em>skip</em> to ignore a
              header row, or <em>use</em> to bring it back.
            </p>

            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <tbody>
                  {previewGrid.map((row, ri) => {
                    const rowNumber = ri + 1; // 1-indexed
                    const isHeader = rowNumber < dataStartRow;
                    const isFirstData = rowNumber === dataStartRow;
                    const isSkipped = skippedRows.has(rowNumber);
                    return (
                      <tr
                        key={ri}
                        className={`${isHeader ? styles.headerRow : ""} ${isFirstData ? styles.firstDataRow : ""} ${isSkipped ? styles.skippedRow : ""}`}
                      >
                        <td className={styles.rowNumCell}>
                          <button
                            type="button"
                            className={`${styles.rowNumButton} ${isFirstData ? styles.rowNumButtonActive : ""}`}
                            onClick={() => changeDataStart(rowNumber)}
                            title={`Data starts at row ${rowNumber}`}
                          >
                            {rowNumber}
                          </button>
                        </td>
                        <td className={styles.rowTagCell}>
                          {isHeader && (
                            <button
                              type="button"
                              className={styles.skipToggle}
                              onClick={() => toggleSkip(rowNumber)}
                              title={isSkipped ? "Use as header level" : "Skip this row"}
                            >
                              {isSkipped ? "use" : "skip"}
                            </button>
                          )}
                          {isFirstData && <span className={styles.dataTag}>data →</span>}
                        </td>
                        {row.map((cell, ci) => (
                          <td key={ci}>{cell}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {grid.length > MAX_PREVIEW_GRID && (
              <div className={styles.previewLabel}>
                Showing first {MAX_PREVIEW_GRID} of {grid.length.toLocaleString()} rows
              </div>
            )}
          </section>
        )}

        {/* Step 3: Column roles */}
        {file && (
          <section className={styles.section}>
            <div className={styles.stepLabel}>
              <span className={styles.stepNumber}>3</span>
              <span>Assign columns</span>
            </div>
            <p className={styles.sectionHint}>
              Move columns into <em>Identifiers</em> to keep them as-is. Anything
              left in <em>Values to unpivot</em> gets folded into rows. Use{" "}
              <em>Exclude</em> to ignore a column entirely.
            </p>

            <div className={styles.columnPicker}>
              {/* Value pool (available) */}
              <div className={styles.pickerCol}>
                <div className={styles.pickerHead}>
                  Values to unpivot
                  <span className={styles.pickerCount}>{valueColIndices.length}</span>
                </div>
                <div className={styles.pickerList}>
                  {valueColIndices.length === 0 && (
                    <div className={styles.pickerEmpty}>none</div>
                  )}
                  {valueColIndices.map((c) => (
                    <div key={c} className={styles.chip}>
                      <span className={styles.chipLabel}>
                        {colLabel(colIdentities[c], c)}
                      </span>
                      <span className={styles.chipActions}>
                        <button
                          type="button"
                          className={styles.chipBtn}
                          onClick={() => moveToId(c)}
                          title="Make identifier"
                        >
                          ID
                        </button>
                        <button
                          type="button"
                          className={styles.chipBtn}
                          onClick={() => moveToExclude(c)}
                          title="Exclude"
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Identifiers */}
              <div className={styles.pickerCol}>
                <div className={styles.pickerHead}>
                  Identifiers
                  <span className={styles.pickerCount}>{idCols.length}</span>
                </div>
                <div className={styles.pickerList}>
                  {idCols.length === 0 && (
                    <div className={styles.pickerEmpty}>
                      click ID on a column →
                    </div>
                  )}
                  {idCols.map((c) => (
                    <div key={c} className={`${styles.chip} ${styles.chipId}`}>
                      <span className={styles.chipLabel}>
                        {colLabel(colIdentities[c], c)}
                      </span>
                      <button
                        type="button"
                        className={styles.chipBtn}
                        onClick={() => removeFromId(c)}
                        title="Remove"
                      >
                        ←
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Excluded */}
              <div className={styles.pickerCol}>
                <div className={styles.pickerHead}>
                  Exclude
                  <span className={styles.pickerCount}>{excludeCols.length}</span>
                </div>
                <div className={styles.pickerList}>
                  {excludeCols.length === 0 && (
                    <div className={styles.pickerEmpty}>optional</div>
                  )}
                  {excludeCols.map((c) => (
                    <div key={c} className={`${styles.chip} ${styles.chipExclude}`}>
                      <span className={styles.chipLabel}>
                        {colLabel(colIdentities[c], c)}
                      </span>
                      <button
                        type="button"
                        className={styles.chipBtn}
                        onClick={() => removeFromExclude(c)}
                        title="Restore"
                      >
                        ←
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Output column names */}
            <div className={styles.namesRow}>
              {attrNames.map((name, i) => (
                <div key={i} className={styles.nameField}>
                  <label className={styles.nameLabel}>
                    {levels === 1 ? "Attribute column" : `Attribute ${i + 1}`}
                  </label>
                  <input
                    className={styles.textInput}
                    value={name}
                    onChange={(e) => {
                      const v = e.target.value;
                      setAttrNames((prev) => {
                        const next = prev.slice();
                        next[i] = v;
                        return next;
                      });
                      setOutput(null);
                    }}
                  />
                </div>
              ))}
              <div className={styles.nameField}>
                <label className={styles.nameLabel}>Value column</label>
                <input
                  className={styles.textInput}
                  value={valueName}
                  onChange={(e) => {
                    setValueName(e.target.value);
                    setOutput(null);
                  }}
                />
              </div>
            </div>

            <div className={styles.optionsRow}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={dropBlank}
                  onChange={(e) => {
                    setDropBlank(e.target.checked);
                    setOutput(null);
                  }}
                />
                Drop rows with blank values
              </label>
              <button className={styles.primaryButton} onClick={handleProcess}>
                Convert to table
              </button>
            </div>
          </section>
        )}

        {/* Step 4: Result */}
        {output && (
          <section className={styles.section}>
            <div className={styles.stepLabel}>
              <span className={styles.stepNumber}>4</span>
              <span>Result</span>
            </div>
            <div className={styles.resultStats}>
              <span className={styles.statHighlight}>
                {(grid.length - (dataStartRow - 1)).toLocaleString()}
              </span>{" "}
              data rows ×{" "}
              <span className={styles.statHighlight}>{valueColIndices.length}</span>{" "}
              value columns →{" "}
              <span className={styles.statHighlight}>
                {output.length.toLocaleString()}
              </span>{" "}
              output rows
            </div>

            <div className={styles.previewWrapper}>
              <div className={styles.previewLabel}>
                Preview (first {previewOut.length} of {output.length.toLocaleString()} rows)
              </div>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {outHeaders.map((h, i) => (
                        <th key={i}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewOut.map((row, ri) => (
                      <tr key={ri}>
                        {outHeaders.map((_, ci) => (
                          <td key={ci}>{row[ci] ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={styles.actions}>
              <button className={styles.primaryButton} onClick={handleDownload}>
                Download CSV
              </button>
              <button className={styles.secondaryButton} onClick={handleCopy}>
                {copied ? "Copied" : "Copy to clipboard"}
              </button>
              <button className={styles.linkButton} onClick={handleReset}>
                Start over
              </button>
            </div>
          </section>
        )}

        {error && <div className={styles.error}>{error}</div>}
      </main>
    </div>
  );
}
