"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import Papa from "papaparse";
import styles from "./page.module.css";

// Generate a friendly Excel-style column letter (A, B, ..., Z, AA, AB, ...)
function columnLetter(index) {
  let result = "";
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

// Find the first column matching "Cell type" (case-insensitive)
function findDefaultKeyIndex(headers) {
  const idx = headers.findIndex(
    (h) => h && h.trim().toLowerCase() === "cell type"
  );
  return idx >= 0 ? idx : null;
}

// Translations for the help panel
const HELP_TRANSLATIONS = {
  en: {
    buttonOpen: "How it works",
    buttonClose: "Hide",
    title: "How it works",
    intro: (
      <>
        This tool collapses multiple rows that belong to the same record into
        one row. The grouping is controlled by a <strong>key column</strong> —
        a column you choose where each non-blank value marks the start of a
        new record. Rows where the key column is blank are treated as
        continuations and merged into the previous record.
      </>
    ),
    step1Title: "1. Start with a CSV where records are split across rows.",
    step1Body: (
      <>
        Here the data spans many rows because different fields are logged at
        slightly different moments. Notice column B (<em>Cell type</em>) — it
        has <em>"Serving"</em> on some rows and is blank on others. The blank
        rows are continuations of the most recent <em>"Serving"</em> row.
      </>
    ),
    step2Title: "2. Pick that column as the key.",
    step2Body: (
      <>
        The tool defaults to <em>Cell type</em> if it finds one. If a name
        appears more than once, the column letter is shown in parentheses — e.g.{" "}
        <em>Cell type (B)</em> vs <em>Cell type (J)</em> — so you know which
        one you're selecting.
      </>
    ),
    step3Title: "3. Get one consolidated row per record.",
    step3Body: (
      <>
        Every continuation row folds upward into the most recent keyed row.
        The output keeps the same columns, but each record is now a single
        tidy row ready for analysis.
      </>
    ),
    visualTitle: "How rows are grouped",
    visualBody: (
      <>
        Each colored box is one record. The box starts at a row where{" "}
        <em>Cell type</em> has a value (the key) and extends down through the
        blank-key rows beneath it until the next keyed row appears. The arrows
        show how values from continuation rows are merged into the keyed row
        above them.
      </>
    ),
    rulesLabel: "Rules:",
    rulesBody:
      "empty rows are skipped. Rows that appear before the first key value are dropped. If two rows in the same group both have a value in the same column, the later value wins.",
  },
  id: {
    buttonOpen: "Cara kerja",
    buttonClose: "Tutup",
    title: "Cara kerja",
    intro: (
      <>
        Alat ini menggabungkan beberapa baris yang termasuk dalam satu data
        menjadi satu baris. Pengelompokan dikendalikan oleh{" "}
        <strong>kolom kunci</strong> — kolom yang kamu pilih, di mana setiap
        nilai yang tidak kosong menandai awal data baru. Baris yang kolom
        kuncinya kosong dianggap sebagai lanjutan dan digabung ke data
        sebelumnya.
      </>
    ),
    step1Title:
      "1. Mulai dengan CSV yang datanya terpecah ke beberapa baris.",
    step1Body: (
      <>
        Di sini data tersebar di banyak baris karena tiap kolom dicatat pada
        waktu yang sedikit berbeda. Perhatikan kolom B (<em>Cell type</em>) —
        ada nilai <em>"Serving"</em> di beberapa baris dan kosong di baris
        lainnya. Baris yang kosong adalah lanjutan dari baris{" "}
        <em>"Serving"</em> sebelumnya.
      </>
    ),
    step2Title: "2. Pilih kolom tersebut sebagai kunci.",
    step2Body: (
      <>
        Alat ini otomatis memilih <em>Cell type</em> jika ditemukan. Jika ada
        nama kolom yang muncul lebih dari sekali, huruf kolomnya akan
        ditampilkan dalam tanda kurung — misalnya <em>Cell type (B)</em> vs{" "}
        <em>Cell type (J)</em> — supaya kamu tahu mana yang dipilih.
      </>
    ),
    step3Title: "3. Dapatkan satu baris utuh per data.",
    step3Body: (
      <>
        Setiap baris lanjutan akan dilipat ke atas, masuk ke baris berkunci
        terakhir. Hasilnya tetap pakai kolom yang sama, tapi tiap data
        sekarang jadi satu baris rapi yang siap dianalisis.
      </>
    ),
    visualTitle: "Cara baris dikelompokkan",
    visualBody: (
      <>
        Tiap kotak berwarna adalah satu data. Kotak dimulai dari baris yang
        kolom <em>Cell type</em>-nya berisi (baris kunci), lalu memanjang ke
        bawah lewat baris-baris kosong sampai bertemu baris kunci berikutnya.
        Tanda panah menunjukkan bagaimana nilai dari baris lanjutan
        digabungkan ke baris kunci di atasnya.
      </>
    ),
    rulesLabel: "Aturan:",
    rulesBody:
      "baris yang seluruhnya kosong akan dilewati. Baris yang muncul sebelum nilai kunci pertama akan dibuang. Jika dua baris dalam satu grup punya nilai di kolom yang sama, nilai yang lebih baru yang dipakai.",
  },
};

// Core collapse logic
function collapseRows(rows, keyIndex) {
  const output = [];
  let currentRow = null;

  for (const row of rows) {
    // Skip completely empty rows
    const isEmpty = row.every((cell) => cell === "" || cell == null);
    if (isEmpty) continue;

    const keyValue = row[keyIndex];
    const hasKey = keyValue !== "" && keyValue != null;

    if (hasKey) {
      // Start a new output row
      currentRow = [...row];
      output.push(currentRow);
    } else if (currentRow !== null) {
      // Continuation row — overwrite non-blank cells into current output row
      for (let i = 0; i < row.length; i++) {
        const cell = row[i];
        if (cell !== "" && cell != null) {
          currentRow[i] = cell;
        }
      }
    }
    // If no currentRow yet (rows before first key), drop them
  }

  return output;
}

export default function CollapseRowsByKeyPage() {
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [keyIndex, setKeyIndex] = useState(null);
  const [output, setOutput] = useState(null);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [lang, setLang] = useState("en");
  const fileInputRef = useRef(null);

  // Load saved language preference on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("toolkit:help-lang");
      if (saved === "en" || saved === "id") {
        setLang(saved);
      }
    } catch (e) {
      // localStorage may be unavailable (private mode, etc.) — silently ignore
    }
  }, []);

  const changeLang = (newLang) => {
    setLang(newLang);
    try {
      localStorage.setItem("toolkit:help-lang", newLang);
    } catch (e) {
      // ignore
    }
  };

  const t = HELP_TRANSLATIONS[lang];

  const handleFile = (selectedFile) => {
    if (!selectedFile) return;
    setError("");
    setOutput(null);

    Papa.parse(selectedFile, {
      skipEmptyLines: false,
      complete: (results) => {
        if (results.errors.length > 0) {
          console.warn("Parse warnings:", results.errors);
        }
        const data = results.data;
        if (data.length === 0) {
          setError("File is empty.");
          return;
        }
        const parsedHeaders = data[0] || [];
        const parsedRows = data.slice(1);
        setFile(selectedFile);
        setHeaders(parsedHeaders);
        setRows(parsedRows);
        const defaultKey = findDefaultKeyIndex(parsedHeaders);
        setKeyIndex(defaultKey);
      },
      error: (err) => {
        setError("Could not parse CSV: " + err.message);
      },
    });
  };

  const handleProcess = () => {
    if (keyIndex === null || keyIndex === undefined) {
      setError("Please pick a key column first.");
      return;
    }
    setError("");
    setProcessing(true);
    setTimeout(() => {
      try {
        const result = collapseRows(rows, keyIndex);
        setOutput(result);
      } catch (e) {
        setError("Processing failed: " + e.message);
      } finally {
        setProcessing(false);
      }
    }, 10);
  };

  const handleDownload = () => {
    if (!output) return;
    const csv = Papa.unparse([headers, ...output]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const baseName = file.name.replace(/\.csv$/i, "");
    a.href = url;
    a.download = `${baseName}_collapsed.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!output) return;
    const csv = Papa.unparse([headers, ...output]);
    try {
      await navigator.clipboard.writeText(csv);
      // Quick visual confirmation could be added here
    } catch (e) {
      setError("Copy failed: " + e.message);
    }
  };

  const handleReset = () => {
    setFile(null);
    setHeaders([]);
    setRows([]);
    setKeyIndex(null);
    setOutput(null);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Build dropdown options with duplicate-aware labels
  const dropdownOptions = useMemo(() => {
    const seen = new Map();
    headers.forEach((h) => {
      const name = (h ?? "").trim() || "(empty)";
      seen.set(name, (seen.get(name) || 0) + 1);
    });
    return headers.map((h, i) => {
      const name = (h ?? "").trim() || "(empty)";
      const needsLetter = seen.get(name) > 1;
      const label = needsLetter ? `${name} (${columnLetter(i)})` : name;
      return { value: i, label };
    });
  }, [headers]);

  const previewRows = output ? output.slice(0, 10) : [];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <a href="/" className={styles.crumb}>Toolkit</a>
          <span className={styles.crumbDivider}>/</span>
          <span className={styles.crumbCurrent}>Collapse Rows by Key</span>
        </div>
        <button
          className={styles.helpButton}
          onClick={() => setHelpOpen(!helpOpen)}
          aria-expanded={helpOpen}
        >
          {helpOpen ? t.buttonClose : t.buttonOpen}
        </button>
      </header>

      <main className={styles.main}>
        <div className={styles.intro}>
          <h1 className={styles.title}>Collapse Rows by Key</h1>
          <p className={styles.subtitle}>
            Merge continuation rows into single records. Rows where the key
            column is blank are folded into the previous row with a key.
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

            <div className={styles.visualBlock}>
              <div className={styles.visualHeader}>{t.visualTitle}</div>
              <p className={styles.visualBody}>{t.visualBody}</p>
              <img
                src="/help/collapse-rows-by-key/logic-process.jpeg"
                alt="Visual explanation of how rows are grouped by key"
                className={styles.helpImage}
              />
            </div>

            <ol className={styles.helpSteps}>
              <li>
                <div className={styles.helpStepText}>
                  <strong>{t.step1Title}</strong>
                  <p>{t.step1Body}</p>
                </div>
                <img
                  src="/help/collapse-rows-by-key/input.jpeg"
                  alt="Input CSV"
                  className={styles.helpImage}
                />
              </li>

              <li>
                <div className={styles.helpStepText}>
                  <strong>{t.step2Title}</strong>
                  <p>{t.step2Body}</p>
                </div>
                <img
                  src="/help/collapse-rows-by-key/pick-key.jpeg"
                  alt="Picking the key column"
                  className={styles.helpImage}
                />
              </li>

              <li>
                <div className={styles.helpStepText}>
                  <strong>{t.step3Title}</strong>
                  <p>{t.step3Body}</p>
                </div>
                <img
                  src="/help/collapse-rows-by-key/output.jpeg"
                  alt="Output CSV"
                  className={styles.helpImage}
                />
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
                accept=".csv,text/csv"
                onChange={(e) => handleFile(e.target.files?.[0])}
                className={styles.fileInput}
              />
              <div className={styles.dropzoneInner}>
                <div className={styles.dropzoneIcon}>+</div>
                <div className={styles.dropzoneText}>
                  Click to choose a CSV file
                </div>
                <div className={styles.dropzoneHint}>
                  or drag and drop here
                </div>
              </div>
            </label>
          ) : (
            <div className={styles.fileInfo}>
              <div className={styles.fileInfoLeft}>
                <div className={styles.fileName}>{file.name}</div>
                <div className={styles.fileMeta}>
                  {rows.length.toLocaleString()} rows · {headers.length} columns
                </div>
              </div>
              <button
                className={styles.linkButton}
                onClick={handleReset}
              >
                Replace
              </button>
            </div>
          )}
        </section>

        {/* Step 2: Pick key column */}
        {file && (
          <section className={styles.section}>
            <div className={styles.stepLabel}>
              <span className={styles.stepNumber}>2</span>
              <span>Pick key column</span>
            </div>
            <div className={styles.selectGroup}>
              <select
                className={styles.select}
                value={keyIndex ?? ""}
                onChange={(e) => setKeyIndex(parseInt(e.target.value, 10))}
              >
                <option value="" disabled>
                  Choose a column…
                </option>
                {dropdownOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <button
                className={styles.primaryButton}
                onClick={handleProcess}
                disabled={keyIndex === null || processing}
              >
                {processing ? "Processing…" : "Process"}
              </button>
            </div>
          </section>
        )}

        {/* Step 3: Result */}
        {output && (
          <section className={styles.section}>
            <div className={styles.stepLabel}>
              <span className={styles.stepNumber}>3</span>
              <span>Result</span>
            </div>
            <div className={styles.resultStats}>
              <span className={styles.statHighlight}>
                {rows.length.toLocaleString()}
              </span>{" "}
              input rows →{" "}
              <span className={styles.statHighlight}>
                {output.length.toLocaleString()}
              </span>{" "}
              output rows
            </div>

            <div className={styles.previewWrapper}>
              <div className={styles.previewLabel}>
                Preview (first {previewRows.length} of {output.length} rows)
              </div>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {headers.map((h, i) => (
                        <th key={i}>{h || `(col ${columnLetter(i)})`}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, ri) => (
                      <tr key={ri}>
                        {headers.map((_, ci) => (
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
                Copy to clipboard
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
