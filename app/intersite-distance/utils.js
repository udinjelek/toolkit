import Papa from "papaparse";

// ─── Config ───────────────────────────────────────────────────────────────────
// Option A: local CSV in /public/data/
// export const DATA_URL = "/help/intersite-distance/swap_progress.csv";
//
// Option B: Google Sheet published to web as CSV
//   File → Share → Publish to web → pick the sheet → CSV
//   Column headers must match: Band, Sector, LRD, eNodeBLongitude, eNodeBLatitude, Azimuth, Cluster
export const DATA_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTfzxJcNYS4UzMnvHWBqtO25arwjXz-pjViqggHHBJv1ZGG612I_QtSc0DTJ1zRm52JO1qH3JoCyC7G/pub?output=csv";

// Cluster allow-list — gates INPUT only (which sectors a user may query as source).
// Neighbor candidates are NOT affected; targets in any cluster still appear.
//   "*"                → everyone
//   "UMPR_*"           → glob match
//   "UMPR_01"          → exact match
//   ["UMPR_*","XYZ_*"] → multiple patterns
export const allowedCluster = "UMPR_*";

// ─── Data loader ──────────────────────────────────────────────────────────────

export async function loadSiteData() {
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();

  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const seen = new Set();

        // Track every LRD seen in the raw CSV (any band) and which of those have
        // at least one L1800 row. Lets the calculator tell apart:
        //   "LRD not in CSV at all"  vs  "LRD exists but has no L1800 band".
        const knownLrds = new Set();
        const lrdsWithL1800 = new Set();
        results.data.forEach((r) => {
          const lrd = r.LRD?.trim().toUpperCase();
          if (!lrd) return;
          knownLrds.add(lrd);
          if (r.Band === "L1800") lrdsWithL1800.add(lrd);
        });

        const rows = results.data
          .filter((r) => {
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
            const key = `${r.lrd}|${r.sector}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

        // Attach lookup sets as metadata (non-enumerable so existing code that
        // iterates/serializes `rows` is unaffected).
        Object.defineProperty(rows, "knownLrds", { value: knownLrds, enumerable: false });
        Object.defineProperty(rows, "lrdsWithL1800", { value: lrdsWithL1800, enumerable: false });

        resolve(rows);
      },
      error: reject,
    });
  });
}

// ─── Input parser ─────────────────────────────────────────────────────────────
// Supported formats per line:
//   LINA     — bare 4-letter LRD, auto-expands to S1, S2, S3
//   SLIA_S1  — 4-letter LRD + "_S" + sector
//   SLIA\t1  — tab separated (paste from Excel)
//   SLIA,1   — comma separated

export function parseInput(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const query = [];
  const errors = [];
  // combinedFormat follows the FIRST recognised row:
  //   true  → "LRD_Sx" style output columns
  //   false → split LRD + sector columns
  let combinedFormat = null;

  lines.forEach((line, i) => {
    // Bare 4-letter LRD (e.g. "LINA") → expand to S1, S2, S3.
    const bareMatch = line.match(/^([A-Za-z]{4})$/);
    if (bareMatch) {
      if (combinedFormat === null) combinedFormat = true;
      const lrd = bareMatch[1].toUpperCase();
      [1, 2, 3].forEach((s) => query.push({ lrd, sector: s }));
      return;
    }

    const shortMatch = line.match(/^([A-Za-z]{4})_S(\d+)$/i);
    if (shortMatch) {
      if (combinedFormat === null) combinedFormat = true;
      query.push({ lrd: shortMatch[1].toUpperCase(), sector: parseInt(shortMatch[2]) });
      return;
    }

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

// ─── Label helper ─────────────────────────────────────────────────────────────

export function combinedLabel(lrd, sector) {
  return `${lrd}_S${sector}`;
}

// ─── CSV export ───────────────────────────────────────────────────────────────

export function downloadCSV(results, combinedFormat) {
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
