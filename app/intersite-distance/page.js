"use client";

import { useState, useEffect } from "react";
import Papa from "papaparse";
import styles from "./page.module.css";

// ─── Config ───────────────────────────────────────────────────────────────────
// Option A: local CSV in /public/data/
// const DATA_URL = "/help/intersite-distance/swap_progress.csv";
//
// Option B: Google Sheet published to web as CSV
//   File → Share → Publish to web → pick the sheet → CSV
//   Make sure the sheet's column headers match what the parser reads:
//   Band, Sector, LRD, eNodeBLongitude, eNodeBLatitude, Azimuth, Cluster
const DATA_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTfzxJcNYS4UzMnvHWBqtO25arwjXz-pjViqggHHBJv1ZGG612I_QtSc0DTJ1zRm52JO1qH3JoCyC7G/pub?output=csv";

// Cluster allow-list — gates INPUT only (which sectors a user may query as a source).
// Neighbor candidates are NOT affected; targets in any cluster still appear.
//   "*"                       → everyone
//   "UMPR_*"                  → glob match
//   "UMPR_01"                 → exact match
//   ["UMPR_*", "XYZ_*"]       → multiple patterns
const allowedCluster = "UMPR_*";

// ─── Geometry ─────────────────────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcBearing(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function angleDiff(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff <= 180 ? diff : 360 - diff;
}

function isInCone(bearing, azimuth, halfWidth) {
  return angleDiff(bearing, azimuth) <= halfWidth;
}

// Cluster matcher — supports "*", glob (UMPR_*), exact, or an array of patterns.
function clusterAllowed(cluster, allowed) {
  const patterns = Array.isArray(allowed) ? allowed : [allowed];
  return patterns.some((p) => {
    if (p === "*") return true;
    const re = new RegExp(
      "^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
      "i"
    );
    return re.test(cluster || "");
  });
}

// ─── Data loading ─────────────────────────────────────────────────────────────
async function loadSiteData() {
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();

  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const seen = new Set();
        const rows = results.data
          .filter((r) => {
            // Filter L1800 band only
            if (r.Band !== "L1800") return false;
            // TODO: rows with empty Sector but valid Azimuth are dropped here.
            // Revisit later — may want to auto-assign sector number based on azimuth order per site.
            if (!r.Sector || r.Sector.trim() === "") return false;
            return true;
          })
          .map((r) => ({
            lrd: r.LRD?.trim().toUpperCase(),
            sector: parseInt(r.Sector),
            lon: parseFloat(r.eNodeBLongitude),
            lat: parseFloat(r.eNodeBLatitude),
            azimuth: parseInt(r.Azimuth),
            cluster: r.Cluster?.trim() || "",
          }))
          .filter((r) => {
            if (!r.lrd || isNaN(r.sector) || isNaN(r.lon) || isNaN(r.lat) || isNaN(r.azimuth))
              return false;
            // Deduplicate by LRD + sector
            const key = `${r.lrd}|${r.sector}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

        resolve(rows);
      },
      error: reject,
    });
  });
}

// ─── ISD calculation ──────────────────────────────────────────────────────────
function calcIntersite(siteData, query, coneHalfWidth, maxCandidates, maxDistanceM, excludeCoSite, mode, allowedRanks) {
  const results = [];

  query.forEach(({ lrd, sector }, idx) => {
    const sourceNo = idx + 1;
    const source = siteData.find((s) => s.lrd === lrd && s.sector === sector);

    if (!source) {
      results.push({ type: "error", sourceNo, lrd, sector });
      return;
    }

    // Gate INPUT only — neighbor candidates can still be in any cluster.
    if (!clusterAllowed(source.cluster, allowedCluster)) {
      results.push({ type: "blocked", sourceNo, lrd, sector, cluster: source.cluster });
      return;
    }

    const candidates = [];

    siteData.forEach((target) => {
      if (target.lrd === lrd && target.sector === sector) return;
      // Exclude co-site: skip any sector on the same site (same LRD).
      if (excludeCoSite && target.lrd === lrd) return;

      const distM = haversine(source.lat, source.lon, target.lat, target.lon);
      if (maxDistanceM && distM > maxDistanceM) return;

      const bearingSrcToTgt = calcBearing(source.lat, source.lon, target.lat, target.lon);
      const bearingTgtToSrc = calcBearing(target.lat, target.lon, source.lat, source.lon);

      // Cone conditions depend on mode:
      const srcFaces = isInCone(bearingSrcToTgt, source.azimuth, coneHalfWidth); // target in source cone
      const tgtFaces = isInCone(bearingTgtToSrc, target.azimuth, coneHalfWidth); // source in target cone
      if (mode === "mutual") {
        if (!srcFaces || !tgtFaces) return; // both must face
      } else if (mode === "source") {
        if (!srcFaces) return; // only source must face target
      } else if (mode === "target") {
        if (!tgtFaces) return; // only target must face source
      }

      const angleOffsetSrc = Math.round(angleDiff(bearingSrcToTgt, source.azimuth) * 10) / 10;
      const angleOffsetTgt = Math.round(angleDiff(bearingTgtToSrc, target.azimuth) * 10) / 10;

      candidates.push({
        distanceM: Math.round(distM * 10) / 10,
        bearing: Math.round(bearingSrcToTgt * 10) / 10,
        angleOffsetSrc,
        angleOffsetTgt,
        lrdTarget: target.lrd,
        sectorTarget: target.sector,
        azimuthTarget: target.azimuth,
        clusterTarget: target.cluster,
        tgtLat: target.lat,
        tgtLon: target.lon,
      });
    });

    let filtered = candidates;
    if (mode === "source") {
      // SOURCE facing: rank each target SITE's matched sectors by how directly
      // they point back (Offset tgt, ascending = Rank 1). Keep enabled ranks.
      const bySite = new Map();
      candidates.forEach((c) => {
        if (!bySite.has(c.lrdTarget)) bySite.set(c.lrdTarget, []);
        bySite.get(c.lrdTarget).push(c);
      });
      filtered = [];
      bySite.forEach((sectors) => {
        sectors
          .sort((a, b) => a.angleOffsetTgt - b.angleOffsetTgt)
          .forEach((c, ri) => {
            const rank = ri + 1;
            if (allowedRanks.includes(rank)) {
              filtered.push({ ...c, offsetRank: rank });
            }
          });
      });
    } else if (mode === "target") {
      // TARGET facing: rank is from the TARGET sector's point of view.
      // For each candidate target sector, look at ALL sectors of the SOURCE site
      // that fall inside that target's cone, rank them by how directly the target
      // faces them (offset ascending = Rank 1). The rank of the queried source
      // sector within that list is this candidate's rank. Keep enabled ranks.
      const sourceSiteSectors = siteData.filter((s) => s.lrd === lrd);
      filtered = [];
      candidates.forEach((c) => {
        // c corresponds to one target sector (lrdTarget/sectorTarget/azimuthTarget at c's coords).
        // Rebuild which source-site sectors this target faces.
        const facedSourceSectors = sourceSiteSectors
          .map((ss) => {
            const bTgtToSs = calcBearing(c.tgtLat, c.tgtLon, ss.lat, ss.lon);
            const inCone = isInCone(bTgtToSs, c.azimuthTarget, coneHalfWidth);
            const offset = angleDiff(bTgtToSs, c.azimuthTarget);
            return { sector: ss.sector, inCone, offset };
          })
          .filter((x) => x.inCone)
          .sort((a, b) => a.offset - b.offset);

        const idx = facedSourceSectors.findIndex((x) => x.sector === sector);
        if (idx === -1) return; // queried source sector not actually faced (safety)
        const rank = idx + 1;
        if (allowedRanks.includes(rank)) {
          filtered.push({ ...c, offsetRank: rank });
        }
      });
    }

    filtered.sort((a, b) => a.distanceM - b.distanceM);
    const top = filtered.slice(0, maxCandidates);

    if (top.length === 0) {
      results.push({
        type: "empty",
        sourceNo,
        lrdSource: lrd,
        sectorSource: sector,
        azimuthSource: source.azimuth,
      });
      return;
    }

    top.forEach((c, ci) => {
      results.push({
        type: "result",
        sourceNo,
        lrdSource: lrd,
        sectorSource: sector,
        azimuthSource: source.azimuth,
        clusterSource: source.cluster,
        candidateNo: ci + 1,
        offsetRank: c.offsetRank ?? null,
        distanceM: c.distanceM,
        bearing: c.bearing,
        angleOffsetSrc: c.angleOffsetSrc,
        angleOffsetTgt: c.angleOffsetTgt,
        lrdTarget: c.lrdTarget,
        sectorTarget: c.sectorTarget,
        azimuthTarget: c.azimuthTarget,
        clusterTarget: c.clusterTarget,
      });
    });
  });

  return results;
}

// ─── Input parser ─────────────────────────────────────────────────────────────
// Supported formats per line:
//   SLIA_S1   — 4-letter LRD + "_S" + sector (e.g. from cell ID naming)
//   SLIA\t1   — tab separated (paste from Excel)
//   SLIA,1    — comma separated
function parseInput(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const query = [];
  const errors = [];
  // Output format follows the FIRST recognized input row:
  //   true  → combined "LRD_Sx" (e.g. SLIA_S1)
  //   false → split LRD + sector columns
  let combinedFormat = null;

  lines.forEach((line, i) => {
    // Format 1: XXXX_SY (e.g. SLIA_S1, PDPO_S3)
    const shortMatch = line.match(/^([A-Za-z]{4})_S(\d+)$/i);
    if (shortMatch) {
      if (combinedFormat === null) combinedFormat = true;
      query.push({ lrd: shortMatch[1].toUpperCase(), sector: parseInt(shortMatch[2]) });
      return;
    }

    // Format 2: tab or comma separated (e.g. SLIA\t1 or SLIA,1)
    const parts = line.split(/[\t,]/).map((p) => p.trim());
    if (parts.length >= 2) {
      const lrd = parts[0].toUpperCase();
      const sector = parseInt(parts[1]);
      if (lrd && !isNaN(sector)) {
        if (combinedFormat === null) combinedFormat = false;
        query.push({ lrd, sector });
        return;
      }
    }

    errors.push(`Line ${i + 1}: "${line}" — unrecognized format`);
  });

  return { query, errors, combinedFormat: combinedFormat ?? false };
}

// Format an LRD + sector pair as combined "LRD_Sx" string.
function combinedLabel(lrd, sector) {
  return `${lrd}_S${sector}`;
}

// ─── Download ─────────────────────────────────────────────────────────────────
function downloadCSV(results, combinedFormat) {
  const headers = combinedFormat
    ? [
        "source_no", "lrd_sector_source", "azimuth_source", "cluster_source",
        "candidate_no", "distance_m", "bearing",
        "angle_offset_src", "angle_offset_tgt",
        "lrd_sector_target", "azimuth_target", "cluster_target",
      ]
    : [
        "source_no", "lrd_source", "sector_source", "azimuth_source", "cluster_source",
        "candidate_no", "distance_m", "bearing",
        "angle_offset_src", "angle_offset_tgt",
        "lrd_target", "sector_target", "azimuth_target", "cluster_target",
      ];
  const rows = results
    .filter((r) => r.type === "result")
    .map((r) =>
      combinedFormat
        ? [
            r.sourceNo, combinedLabel(r.lrdSource, r.sectorSource), r.azimuthSource, r.clusterSource,
            r.candidateNo, r.distanceM, r.bearing,
            r.angleOffsetSrc, r.angleOffsetTgt,
            combinedLabel(r.lrdTarget, r.sectorTarget), r.azimuthTarget, r.clusterTarget,
          ]
        : [
            r.sourceNo, r.lrdSource, r.sectorSource, r.azimuthSource, r.clusterSource,
            r.candidateNo, r.distanceM, r.bearing,
            r.angleOffsetSrc, r.angleOffsetTgt,
            r.lrdTarget, r.sectorTarget, r.azimuthTarget, r.clusterTarget,
          ]
    );
  const csv = Papa.unparse([headers, ...rows]);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "intersite_distance.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function IntersiteDistancePage() {
  const [siteData, setSiteData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [inputText, setInputText] = useState("");
  const [coneHalfWidth, setConeHalfWidth] = useState(60);
  const [maxCandidates, setMaxCandidates] = useState(3);
  const [maxDistance, setMaxDistance] = useState("");
  const [excludeCoSite, setExcludeCoSite] = useState(false);
  const [mode, setMode] = useState("mutual"); // "mutual" | "source"
  const [allowedRanks, setAllowedRanks] = useState([1, 2, 3]);
  const [results, setResults] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [parseErrors, setParseErrors] = useState([]);
  const [combinedFormat, setCombinedFormat] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    loadSiteData()
      .then(setSiteData)
      .catch((e) => setLoadError("Failed to load site data: " + e.message));
  }, []);

  const handleProcess = () => {
    const { query, errors, combinedFormat: fmt } = parseInput(inputText);
    setParseErrors(errors);
    setCombinedFormat(fmt);
    if (query.length === 0) return;

    setProcessing(true);
    setResults(null);
    setTimeout(() => {
      try {
        const maxDist = maxDistance ? parseFloat(maxDistance) : null;
        const res = calcIntersite(siteData, query, coneHalfWidth, maxCandidates, maxDist, excludeCoSite, mode, allowedRanks);
        setResults(res);
      } catch (e) {
        setParseErrors([...errors, "Processing failed: " + e.message]);
      } finally {
        setProcessing(false);
      }
    }, 10);
  };

  const toggleRank = (rank) => {
    setAllowedRanks((prev) =>
      prev.includes(rank) ? prev.filter((r) => r !== rank) : [...prev, rank].sort()
    );
  };

  const handleReset = () => {
    setInputText("");
    setResults(null);
    setParseErrors([]);
  };

  const validResults = results?.filter((r) => r.type === "result") ?? [];
  const errorResults = results?.filter((r) => r.type === "error") ?? [];
  const emptyResults = results?.filter((r) => r.type === "empty") ?? [];
  const blockedResults = results?.filter((r) => r.type === "blocked") ?? [];

  const isReady = siteData && inputText.trim() && !processing;

  return (
    <div className={styles.container}>
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

        {/* Help panel */}
        {helpOpen && (
          <section className={styles.helpPanel}>
            <div className={styles.helpHeader}>
              <h2 className={styles.helpTitle}>How it works</h2>
            </div>
            <p className={styles.helpIntro}>
              For each source sector, the tool scans all other sectors and returns the
              top <strong>N nearest neighbors</strong> that satisfy two conditions
              simultaneously.
            </p>
            <div className={styles.visualBlock}>
              <div className={styles.visualHeader}>Two-cone filter</div>
              <p className={styles.visualBody}>
                <em>Condition 1</em> — the target must fall within the source sector's
                azimuth cone (the bearing from source → target is within ±half-width of
                the source azimuth).{" "}
                <em>Condition 2</em> — the source must fall within the target's azimuth
                cone (the bearing from target → source is within ±half-width of the
                target azimuth). Both must pass — meaning the two sectors are
                effectively <em>facing each other</em>.
              </p>
            </div>
            <div className={styles.helpRules}>
              <strong>Input format:</strong> One row per sector. Each row is LRD and
              sector number, separated by a tab or comma. Copying two columns from Excel
              and pasting here works directly — Excel uses tab as the column separator.
            </div>
          </section>
        )}

        {/* Step 1 — Input */}
        <section className={styles.section}>
          <div className={styles.stepLabel}>
            <span className={styles.stepNumber}>1</span>
            <span>Paste sectors</span>
          </div>
          <p className={styles.fieldHint}>
            Supports 3 formats per line — mix and match freely:
            <span className={styles.formatList}>
              <code>SLIA_S1</code> &nbsp;&middot;&nbsp;
              <code>SLIA&nbsp;&nbsp;1</code> (tab) &nbsp;&middot;&nbsp;
              <code>SLIA,1</code> (comma)
            </span>
          </p>
          <textarea
            className={styles.textarea}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={"SLIA_S1\nSLIA_S2\nSLIA\t3\nPDPO,1"}
            rows={6}
            spellCheck={false}
          />
          {parseErrors.length > 0 && (
            <div className={styles.error}>
              {parseErrors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}
        </section>

        {/* Step 2 — Settings */}
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
              <p className={styles.fieldHint}>
                ±° from boresight. Default 60 = 120° sector width.
              </p>
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

          <button
            className={styles.primaryButton}
            onClick={handleProcess}
            disabled={!isReady}
          >
            {!siteData
              ? "Loading site data…"
              : processing
              ? "Processing…"
              : "Process"}
          </button>
        </section>

        {/* Step 3 — Result */}
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
                        {combinedFormat ? (
                          <th>LRD_Sec source</th>
                        ) : (
                          <>
                            <th>LRD source</th>
                            <th>Sec</th>
                          </>
                        )}
                        <th>Az src</th>
                        <th>Cluster src</th>
                        <th>cand#</th>
                        <th>Dist (m)</th>
                        <th>Bearing</th>
                        <th>Offset src</th>
                        <th>Offset tgt</th>
                        {combinedFormat ? (
                          <th>LRD_Sec target</th>
                        ) : (
                          <>
                            <th>LRD target</th>
                            <th>Sec</th>
                          </>
                        )}
                        <th>Az tgt</th>
                        <th>Cluster tgt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validResults.map((r, i) => (
                        <tr
                          key={i}
                          className={r.candidateNo === 1 ? styles.rowFirst : ""}
                        >
                          <td className={styles.cellMono}>{r.sourceNo}</td>
                          {combinedFormat ? (
                            <td className={styles.cellAccent}>{combinedLabel(r.lrdSource, r.sectorSource)}</td>
                          ) : (
                            <>
                              <td className={styles.cellAccent}>{r.lrdSource}</td>
                              <td className={styles.cellMono}>{r.sectorSource}</td>
                            </>
                          )}
                          <td className={styles.cellMono}>{r.azimuthSource}°</td>
                          <td className={styles.cellMuted}>{r.clusterSource || "—"}</td>
                          <td className={styles.cellMono}>{r.candidateNo}</td>
                          <td className={styles.cellDist}>{r.distanceM.toLocaleString()}</td>
                          <td className={styles.cellMono}>{r.bearing}°</td>
                          <td className={styles.cellOffset}>{r.angleOffsetSrc}°</td>
                          <td className={styles.cellOffset}>{r.angleOffsetTgt}°</td>
                          {combinedFormat ? (
                            <td className={styles.cellAccent}>{combinedLabel(r.lrdTarget, r.sectorTarget)}</td>
                          ) : (
                            <>
                              <td className={styles.cellAccent}>{r.lrdTarget}</td>
                              <td className={styles.cellMono}>{r.sectorTarget}</td>
                            </>
                          )}
                          <td className={styles.cellMono}>{r.azimuthTarget}°</td>
                          <td className={styles.cellMuted}>{r.clusterTarget || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className={styles.actions}>
                  <button
                    className={styles.primaryButton}
                    onClick={() => downloadCSV(results, combinedFormat)}
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
