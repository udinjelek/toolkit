"use client";

import { useState, useRef, useMemo } from "react";
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
  const fileInputRef = useRef(null);

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
          {helpOpen ? "Hide" : "How it works"}
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
            <h2 className={styles.helpTitle}>How it works</h2>
            <ol className={styles.helpSteps}>
              <li>
                <strong>Upload a CSV.</strong> Data starts on row 2 (row 1 is
                the header).
                <div className={styles.helpImagePlaceholder}>
                  <span>Screenshot: input file</span>
                </div>
              </li>
              <li>
                <strong>Pick the key column.</strong> Defaults to "Cell type" if
                present. Rows with a value in this column start a new output
                row. Blank-key rows are continuations.
                <div className={styles.helpImagePlaceholder}>
                  <span>Screenshot: key selection</span>
                </div>
              </li>
              <li>
                <strong>Process &amp; download.</strong> Output keeps the same
                column structure but each record is consolidated into one row.
                <div className={styles.helpImagePlaceholder}>
                  <span>Screenshot: output file</span>
                </div>
              </li>
            </ol>
            <p className={styles.helpNote}>
              Rules: empty rows are skipped. Rows before the first key are
              dropped. Conflicts are resolved by keeping the latest value.
            </p>
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
