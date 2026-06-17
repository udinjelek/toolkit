// ─── Geometry helpers ─────────────────────────────────────────────────────────

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

// ─── ISD calculation ──────────────────────────────────────────────────────────

// Human-readable mode names shown in the output table / CSV.
const MODE_LABELS = {
  mutual: "Mutual Facing",
  source: "Source Facing Only",
  target: "Target Facing Only",
};

/**
 * For each { lrd, sector } in query, find the nearest neighbor candidates
 * from siteData that satisfy the facing-cone condition(s).
 *
 * Result item types:
 *   "result"  — valid candidate row
 *   "error"   — source LRD/sector not found in data
 *   "blocked" — source cluster not in allowedCluster
 *   "empty"   — source found but zero candidates after filtering
 */
export function calcIntersite(
  siteData,
  query,
  coneHalfWidth,
  maxCandidates,
  maxDistanceM,
  excludeCoSite,
  mode,
  allowedRanks,
  allowedCluster,
  maxOffsetTarget
) {
  const results = [];
  const modeLabel = MODE_LABELS[mode] ?? mode;

  query.forEach(({ lrd, sector }, idx) => {
    const sourceNo = idx + 1;
    const source = siteData.find((s) => s.lrd === lrd && s.sector === sector);

    if (!source) {
      // Distinguish the two failure modes so the user knows what to fix:
      //   no_l1800 — LRD exists in CSV but has no L1800 band row (band blank/other)
      //   error    — LRD/sector genuinely not present in the data
      const lrdUpper = lrd?.toUpperCase();
      const knownLrds = siteData.knownLrds;
      const lrdsWithL1800 = siteData.lrdsWithL1800;

      if (knownLrds?.has(lrdUpper) && !lrdsWithL1800?.has(lrdUpper)) {
        results.push({ type: "no_l1800", sourceNo, lrd, sector });
      } else {
        results.push({ type: "error", sourceNo, lrd, sector });
      }
      return;
    }

    if (!clusterAllowed(source.cluster, allowedCluster)) {
      results.push({ type: "blocked", sourceNo, lrd, sector, cluster: source.cluster });
      return;
    }

    // ── Build raw candidate list ──────────────────────────────────────────────
    const candidates = [];

    siteData.forEach((target) => {
      if (target.lrd === lrd && target.sector === sector) return; // skip self
      if (excludeCoSite && target.lrd === lrd) return;           // skip co-site

      const distM = haversine(source.lat, source.lon, target.lat, target.lon);
      if (maxDistanceM && distM > maxDistanceM) return;

      const bearingSrcToTgt = calcBearing(source.lat, source.lon, target.lat, target.lon);
      const bearingTgtToSrc = calcBearing(target.lat, target.lon, source.lat, source.lon);

      const srcFaces = isInCone(bearingSrcToTgt, source.azimuth, coneHalfWidth);
      const tgtFaces = isInCone(bearingTgtToSrc, target.azimuth, coneHalfWidth);

      if (mode === "mutual" && (!srcFaces || !tgtFaces)) return;
      if (mode === "source" && !srcFaces) return;
      if (mode === "target" && !tgtFaces) return;

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

    // ── Rank filtering (source / target modes) ────────────────────────────────
    let filtered = candidates;

    if (mode === "source") {
      // Rank each target SITE's matched sectors by how directly they point back
      // (angleOffsetTgt ascending = Rank 1). Keep only enabled ranks.
      const bySite = new Map();
      candidates.forEach((c) => {
        if (!bySite.has(c.lrdTarget)) bySite.set(c.lrdTarget, []);
        bySite.get(c.lrdTarget).push(c);
      });
      filtered = [];
      bySite.forEach((sectors) => {
        sectors
          // Drop candidates exceeding max offset target FIRST, so the ranks
          // below are assigned only to survivors (re-rank after removal).
          .filter((c) =>
            maxOffsetTarget == null || c.angleOffsetTgt <= maxOffsetTarget
          )
          .sort((a, b) => a.angleOffsetTgt - b.angleOffsetTgt)
          .forEach((c, ri) => {
            const rank = ri + 1;
            if (allowedRanks.includes(rank)) filtered.push({ ...c, offsetRank: rank });
          });
      });
    } else if (mode === "target") {
      // For each candidate target sector, rank all source-site sectors by how
      // directly the target faces them. Keep only the queried source sector's rank
      // if it's in allowedRanks.
      const sourceSiteSectors = siteData.filter((s) => s.lrd === lrd);
      filtered = [];
      candidates.forEach((c) => {
        const facedSourceSectors = sourceSiteSectors
          .map((ss) => {
            const bTgtToSs = calcBearing(c.tgtLat, c.tgtLon, ss.lat, ss.lon);
            const inCone = isInCone(bTgtToSs, c.azimuthTarget, coneHalfWidth);
            const offset = angleDiff(bTgtToSs, c.azimuthTarget);
            return { sector: ss.sector, inCone, offset };
          })
          .filter((x) => x.inCone)
          .sort((a, b) => a.offset - b.offset);

        const rankIdx = facedSourceSectors.findIndex((x) => x.sector === sector);
        if (rankIdx === -1) return;
        const rank = rankIdx + 1;
        if (allowedRanks.includes(rank)) filtered.push({ ...c, offsetRank: rank });
      });
    }

    // ── Sort by distance, take top N ─────────────────────────────────────────
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
        mode: modeLabel,
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

// ─── Cluster matcher ──────────────────────────────────────────────────────────
// Supports "*", glob (UMPR_*), exact match, or an array of patterns.
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
