"use client";

import { useState, useEffect } from "react";
import styles from "./page.module.css";
import { calcIntersite } from "./calculator";
import { loadSiteData, parseInput, combinedLabel, downloadCSV, allowedCluster } from "./utils";
import HelpPanel from "./HelpPanel";

export default function IntersiteDistancePage() {
  // ── Site data ──────────────────────────────────────────────────────────────
  const [siteData,  setSiteData]  = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    loadSiteData()
      .then(setSiteData)
      .catch((e) => setLoadError("Failed to load site data: " + e.message));
  }, []);

  // ── User inputs ────────────────────────────────────────────────────────────
  const [inputText,     setInputText]     = useState("");
  const [coneHalfWidth, setConeHalfWidth] = useState(60);
  const [maxCandidates, setMaxCandidates] = useState(3);
  const [maxDistance,   setMaxDistance]   = useState("");
  const [excludeCoSite, setExcludeCoSite] = useState(false);
  const [mode,          setMode]          = useState("mutual"); // "mutual" | "source" | "target"
  const [allowedRanks,  setAllowedRanks]  = useState([1, 2, 3]);
  const [maxOffsetTarget, setMaxOffsetTarget] = useState(""); // source mode only; blank = no limit

  // ── UI state ───────────────────────────────────────────────────────────────
  const [results,        setResults]        = useState(null);
  const [processing,     setProcessing]     = useState(false);
  const [parseErrors,    setParseErrors]    = useState([]);
  const [helpOpen,       setHelpOpen]       = useState(false);

  // ── Derived ────────────────────────────────────────────────────────────────
  const validResults   = results?.filter((r) => r.type === "result")  ?? [];
  const errorResults   = results?.filter((r) => r.type === "error")   ?? [];
  const emptyResults   = results?.filter((r) => r.type === "empty")   ?? [];
  const blockedResults = results?.filter((r) => r.type === "blocked") ?? [];
  const noBandResults  = results?.filter((r) => r.type === "no_l1800") ?? [];
  const isReady = siteData && inputText.trim() && !processing;

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleProcess = () => {
    const { query, errors } = parseInput(inputText);
    setParseErrors(errors);
    if (query.length === 0) return;

    setProcessing(true);
    setResults(null);

    // Defer one tick so React renders the "Processing…" button state first.
    setTimeout(() => {
      try {
        const maxDist = maxDistance ? parseFloat(maxDistance) : null;
        const maxOffsetTgt =
          mode === "source" && maxOffsetTarget !== "" ? parseFloat(maxOffsetTarget) : null;
        const res = calcIntersite(
          siteData, query, coneHalfWidth, maxCandidates,
          maxDist, excludeCoSite, mode, allowedRanks, allowedCluster, maxOffsetTgt
        );
        setResults(res);
      } catch (e) {
        setParseErrors([...errors, "Processing failed: " + e.message]);
      } finally {
        setProcessing(false);
      }
    }, 10);
  };

  const toggleRank = (rank) =>
    setAllowedRanks((prev) =>
      prev.includes(rank) ? prev.filter((r) => r !== rank) : [...prev, rank].sort()
    );

  const handleReset = () => {
    setInputText("");
    setResults(null);
    setParseErrors([]);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={styles.container}>

      {/* ── Header ── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <a href="/" className={styles.crumb}>Toolkit</a>
          <span className={styles.crumbDivider}>/</span>
          <span className={styles.crumbCurrent}>Intersite Distance</span>
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
          <h1 className={styles.title}>Intersite Distance</h1>
          <p className={styles.subtitle}>
            Find the nearest neighbor sectors for each source sector, filtered by
            azimuth cone — only targets that are facing each other are returned.
          </p>
        </div>

        {loadError && <div className={styles.error}>{loadError}</div>}

        {/* ── Help panel ── */}
        {helpOpen && <HelpPanel />}

        {/* ── Step 1 — Input ── */}
        <section className={styles.section}>
          <div className={styles.stepLabel}>
            <span className={styles.stepNumber}>1</span>
            <span>Paste sectors</span>
          </div>
          <p className={styles.fieldHint}>
            Supports 2 formats per line:
            <span className={styles.formatList}>
              <code>SLIA</code> (LRD only — expands to S1, S2, S3) &nbsp;&middot;&nbsp;
              <code>SLIA_S1</code> (LRD + sector)
            </span>
          </p>
          <textarea
            className={styles.textarea}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={"LINA\nLUC7\nSLIA_S1\nSLIA_S2"}
            rows={6}
            spellCheck={false}
          />
          {parseErrors.length > 0 && (
            <div className={styles.error}>
              {parseErrors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </section>

        {/* ── Step 2 — Settings ── */}
        <section className={styles.section}>
          <div className={styles.stepLabel}>
            <span className={styles.stepNumber}>2</span>
            <span>Settings</span>
          </div>

          <div className={styles.settingsGrid}>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Cone half-width (°)</label>
              <input
                type="number"
                className={styles.input}
                value={coneHalfWidth}
                min={1}
                max={180}
                onChange={(e) => setConeHalfWidth(parseInt(e.target.value) || 60)}
              />
              <p className={styles.fieldHint}>±° from boresight. Default 60 = 120° sector width.</p>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Max candidates</label>
              <input
                type="number"
                className={styles.input}
                value={maxCandidates}
                min={1}
                max={20}
                onChange={(e) => setMaxCandidates(parseInt(e.target.value) || 3)}
              />
              <p className={styles.fieldHint}>Top N neighbors to return per sector.</p>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Max distance (m)</label>
              <input
                type="number"
                className={styles.input}
                value={maxDistance}
                placeholder="e.g. 5000"
                min={0}
                onChange={(e) => setMaxDistance(e.target.value)}
              />
              <p className={styles.fieldHint}>Leave blank for no limit.</p>
            </div>
          </div>

          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={excludeCoSite}
              onChange={(e) => setExcludeCoSite(e.target.checked)}
            />
            <span>
              Exclude co-site sectors
              <span className={styles.fieldHint}> — skip neighbors on the same site (same LRD).</span>
            </span>
          </label>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Facing mode</label>
            <select
              className={styles.input}
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="mutual">Mutual facing (both face each other)</option>
              <option value="source">Source facing only</option>
              <option value="target">Target facing only</option>
            </select>
            <p className={styles.fieldHint}>
              {mode === "mutual"
                ? "Target must fall in the source cone AND source must fall in the target cone."
                : mode === "source"
                ? "Target only needs to fall in the source cone. Target sectors per site are ranked by how directly they point back (Offset tgt)."
                : "Source only needs to fall in the target cone. Target sectors per site are ranked by how directly they point back (Offset tgt)."}
            </p>
          </div>

          {(mode === "source" || mode === "target") && (
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Keep target ranks (by Offset tgt, per site)</label>
              <div className={styles.rankRow}>
                {[1, 2, 3].map((rank) => (
                  <label key={rank} className={styles.rankCheck}>
                    <input
                      type="checkbox"
                      checked={allowedRanks.includes(rank)}
                      onChange={() => toggleRank(rank)}
                    />
                    <span>Rank {rank}</span>
                  </label>
                ))}
              </div>
              <p className={styles.fieldHint}>
                Rank 1 = target sector pointing most directly back at the source.
              </p>
            </div>
          )}

          {mode === "source" && (
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Max Offset Target (degree)</label>
              <input
                type="number"
                className={styles.input}
                value={maxOffsetTarget}
                onChange={(e) => setMaxOffsetTarget(e.target.value)}
                placeholder="blank = no limit"
                min={0}
                max={180}
              />
              <p className={styles.fieldHint}>
                Drops candidates whose Offset tgt exceeds this before ranking, then
                re-ranks the survivors. Combines with the rank filter above.
              </p>
            </div>
          )}

          <button
            className={styles.primaryButton}
            onClick={handleProcess}
            disabled={!isReady}
          >
            {!siteData ? "Loading site data…" : processing ? "Processing…" : "Process"}
          </button>
        </section>

        {/* ── Step 3 — Result ── */}
        {results && (
          <section className={styles.section}>
            <div className={styles.stepLabel}>
              <span className={styles.stepNumber}>3</span>
              <span>Result</span>
            </div>

            <div className={styles.resultStats}>
              <span className={styles.statHighlight}>{validResults.length}</span>{" "}
              candidate pairs from{" "}
              <span className={styles.statHighlight}>
                {new Set(validResults.map((r) => r.sourceNo)).size}
              </span>{" "}
              source sectors
            </div>

            {blockedResults.map((r, i) => (
              <div key={i} className={styles.warning}>
                Not permitted: <strong>{r.lrd}</strong> sector {r.sector} — outside your allowed cluster.
              </div>
            ))}
            {errorResults.map((r, i) => (
              <div key={i} className={styles.error}>
                Not found in data: <strong>{r.lrd}</strong> sector {r.sector}
              </div>
            ))}
            {noBandResults.map((r, i) => (
              <div key={i} className={styles.error}>
                band not active in data: <strong>{r.lrd}</strong> sector {r.sector}
              </div>
            ))}
            {emptyResults.map((r, i) => (
              <div key={i} className={styles.warning}>
                No candidates: <strong>{r.lrdSource}</strong> sector {r.sectorSource} (az {r.azimuthSource}°)
              </div>
            ))}

            {validResults.length > 0 && (
              <>
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>src#</th>
                        <th>LRD_Sec source</th>
                        <th>Az src</th>
                        <th>Cluster src</th>
                        <th>cand#</th>
                        <th>Dist (m)</th>
                        <th>Bearing</th>
                        <th>Offset src</th>
                        <th>Offset tgt</th>
                        <th>LRD_Sec target</th>
                        <th>Az tgt</th>
                        <th>Cluster tgt</th>
                        <th>Mode</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validResults.map((r, i) => (
                        <tr key={i} className={r.candidateNo === 1 ? styles.rowFirst : ""}>
                          <td className={styles.cellMono}>{r.sourceNo}</td>
                          <td className={styles.cellAccent}>{combinedLabel(r.lrdSource, r.sectorSource)}</td>
                          <td className={styles.cellMono}>{r.azimuthSource}°</td>
                          <td className={styles.cellMuted}>{r.clusterSource || "—"}</td>
                          <td className={styles.cellMono}>{r.candidateNo}</td>
                          <td className={styles.cellDist}>{r.distanceM.toLocaleString()}</td>
                          <td className={styles.cellMono}>{r.bearing}°</td>
                          <td className={styles.cellOffset}>{r.angleOffsetSrc}°</td>
                          <td className={styles.cellOffset}>{r.angleOffsetTgt}°</td>
                          <td className={styles.cellAccent}>{combinedLabel(r.lrdTarget, r.sectorTarget)}</td>
                          <td className={styles.cellMono}>{r.azimuthTarget}°</td>
                          <td className={styles.cellMuted}>{r.clusterTarget || "—"}</td>
                          <td className={styles.cellMuted}>{r.mode}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className={styles.actions}>
                  <button
                    className={styles.primaryButton}
                    onClick={() => downloadCSV(results)}
                  >
                    Download CSV
                  </button>
                  <button className={styles.linkButton} onClick={handleReset}>
                    Start over
                  </button>
                </div>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
