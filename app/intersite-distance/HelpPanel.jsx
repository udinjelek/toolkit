"use client";

import { useState } from "react";
import Image from "next/image";
import styles from "./page.module.css";

const IMG_BASE = "/help/intersite-distance";

const TABS = [
  { id: "general", en: "General", id_: "Umum" },
  { id: "mutual", en: "Method: Mutual facing", id_: "Method: Mutual facing" },
  { id: "source", en: "Method: Source facing only", id_: "Method: Source facing only" },
  { id: "target", en: "Method: Target facing only", id_: "Method: Target facing only" },
];

// Technical terms (azimuth, cone, source, target, sector, rank, bearing) are
// intentionally kept in English in both languages — they are standard usage.
const T = {
  en: {
    title: "How it works",
    intro: (
      <>
        Start with <strong>General</strong> for the input format and what each setting
        does. The other three tabs explain each <strong>facing mode</strong> in detail.
      </>
    ),
    langLabel: "Language",

    inputFormat: (
      <>
        <strong>Input format:</strong> One row per entry. Two formats are accepted:{" "}
        <code>SLIA</code> (LRD only — automatically expands to sectors S1, S2 and S3)
        or <code>SLIA_S1</code> (LRD plus a specific sector number). The LRD is 4
        characters and may include digits, e.g. <code>LUC7</code>.
      </>
    ),
    settingsIntro: (
      <>
        The settings in <strong>Step 2</strong> control how neighbors are found and
        filtered. Here's what each one does:
      </>
    ),
    coneTerm: "Cone half-width (°)",
    coneDesc: (
      <>
        Half the angular width of a sector's beam, measured ±° from its boresight
        (azimuth). Default <strong>60</strong> means a 120° sector. A target counts as
        "inside the cone" when the bearing to it is within this many degrees of the
        azimuth. Larger = wider beam = more neighbors pass.
      </>
    ),
    maxCandTerm: "Max candidates",
    maxCandDesc: (
      <>
        The maximum number of neighbor rows returned per source sector. After all
        filtering, surviving candidates are sorted by distance (nearest first) and only
        the top N are kept.
      </>
    ),
    maxDistTerm: "Max distance (m)",
    maxDistDesc: (
      <>
        A hard distance cutoff in metres — any target farther than this is discarded
        before anything else. Leave it <strong>blank</strong> for no limit.
      </>
    ),
    coSiteTerm: "Exclude co-site sectors",
    coSiteDesc: (
      <>
        When checked, any sector sharing the same site (same LRD) as the source is
        skipped, so you only get neighbors on <em>other</em> sites.
      </>
    ),
    modeTerm: "Facing mode",
    modeDesc: "Decides which \"facing\" conditions a pair must satisfy. There are three — tap a name to read its full tutorial:",
    modeBrief: (
      <>
        <strong>Mutual</strong> — both sectors must face each other.{" "}
        <strong>Source only</strong> — only the source must face the target.{" "}
        <strong>Target only</strong> — only the target must face the source. The two
        "only" modes add a per-site <em>rank</em> filter, explained in their tabs.
      </>
    ),

    mutualIntro: (
      <>
        A pair is kept only when <em>both</em> sectors face each other. Two conditions
        must pass at the same time:
      </>
    ),
    mutualCond1: (
      <>
        <strong>Condition 1</strong> — the target falls inside the source's azimuth cone
        (bearing source → target is within ±half-width of the source azimuth).
      </>
    ),
    mutualCond2: (
      <>
        <strong>Condition 2</strong> — the source falls inside the target's azimuth cone
        (bearing target → source is within ±half-width of the target azimuth).
      </>
    ),
    mutualSuccessAlt: "Mutual facing — success: source and target cones overlap each other",
    mutualSuccessCap: (
      <>
        <strong>Pass</strong> — the source cone covers the target <em>and</em> the target
        cone covers the source. Both face each other, so the pair is kept.
      </>
    ),
    mutualFailAlt: "Mutual facing — failed: target does not fall inside the source cone",
    mutualFailCap: (
      <>
        <strong>Fail</strong> — here the target sits outside the source cone (or vice
        versa). Because one condition fails, the pair is dropped — even though the two
        sites may be close.
      </>
    ),

    sourceIntro: (
      <>
        Only <em>Condition 1</em> is required — the target just needs to fall inside the{" "}
        <strong>source</strong> cone. The target does not have to face back.
      </>
    ),
    sourceImgAlt: "Source facing only — target sectors ranked by how directly they point back",
    sourceCap: (
      <>
        The source sees three sectors on the target site. Each is scored by{" "}
        <em>Offset tgt</em> — how directly it points back at the source. Smallest offset
        = Rank 1.
      </>
    ),
    sourceRankIntro: (
      <>
        <strong>Ranking (per target site):</strong> for one target site, its matching
        sectors are sorted by Offset tgt (ascending). The most directly-pointing-back
        sector is Rank 1.
      </>
    ),
    sourceRank1: <><strong>y2 = 85°</strong> → Rank 1 (points back most directly)</>,
    sourceRank2: <><strong>y1 = 90°</strong> → Rank 2</>,
    sourceRank3: <><strong>y3 = 180°</strong> → Rank 3 (points away)</>,
    sourceExTitle: "Example — Rank 1 & 2 checked, Rank 3 unchecked",
    sourceExIntro: (
      <>
        The "Keep target ranks" checkboxes in Step 2 decide which ranks survive. With
        Rank 1 and Rank 2 checked but Rank 3 unchecked:
      </>
    ),
    sourceExKept1: <><strong>y2</strong> (Rank 1) — kept</>,
    sourceExKept2: <><strong>y1</strong> (Rank 2) — kept</>,
    sourceExDrop: <><strong>y3</strong> (Rank 3) — dropped</>,
    sourceExNote: "So this target site contributes only y2 and y1. The Rank 3 sector (y3) is removed before results are shown.",

    targetIntro: (
      <>
        Only <em>Condition 2</em> is required — the source just needs to fall inside the{" "}
        <strong>target</strong> cone. Ranking here is judged entirely from each{" "}
        <em>target's point of view</em>.
      </>
    ),
    targetImgAlt: "Target facing only — each target ranks the source-site sectors it faces",
    targetCap: (
      <>
        Source site has sectors S1, S2, S3. Each target looks at the source-site sectors
        it faces and ranks them. The rank of <strong>S1</strong> differs from target to
        target.
      </>
    ),
    targetRankIntro: (
      <>
        <strong>Reading the picture</strong> — where does <strong>S1</strong> sit in each
        target's own ranking?
      </>
    ),
    targetRankT1: <><strong>target 1</strong>: S1 is Rank 2</>,
    targetRankT2: <><strong>target 2</strong>: S1 is Rank 3</>,
    targetRankT3: <><strong>target 3</strong>: S1 is Rank 2</>,
    targetRankT4: <><strong>target 4</strong>: S1 is Rank 1</>,
    targetExTitle: "Example — querying source S1",
    targetExAll: <><strong>All ranks checked (1, 2, 3):</strong> S1 appears for every target it faces →</>,
    targetExAllResult: "target 1, target 2, target 3, target 4",
    targetExSome: (
      <>
        <strong>Rank 1 & 2 checked, Rank 3 unchecked:</strong> S1 is dropped wherever it
        ranks 3rd. Only <strong>target 2</strong> has S1 at Rank 3, so target 2 disappears →
      </>
    ),
    targetExSomeResult: "target 1, target 3, target 4",
    targetExNote: "target 2 is dropped because, from target 2's point of view, source S1 is its Rank 3 sector — and Rank 3 was unchecked.",
  },

  id: {
    title: "Cara kerja",
    intro: (
      <>
        Mulai dari <strong>Umum</strong> untuk format input dan fungsi tiap pengaturan.
        Tiga tab lainnya menjelaskan masing-masing <strong>facing mode</strong> secara detail.
      </>
    ),
    langLabel: "Bahasa",

    inputFormat: (
      <>
        <strong>Format input:</strong> Satu baris per entri. Dua format diterima:{" "}
        <code>SLIA</code> (hanya LRD — otomatis dipecah menjadi sector S1, S2, dan S3)
        atau <code>SLIA_S1</code> (LRD beserta nomor sector tertentu). LRD terdiri dari
        4 karakter dan boleh mengandung angka, misalnya <code>LUC7</code>.
      </>
    ),
    settingsIntro: (
      <>
        Pengaturan di <strong>Step 2</strong> mengatur bagaimana neighbor dicari dan
        disaring. Berikut fungsi masing-masing:
      </>
    ),
    coneTerm: "Cone half-width (°)",
    coneDesc: (
      <>
        Setengah lebar sudut beam sebuah sector, diukur ±° dari boresight (azimuth).
        Default <strong>60</strong> berarti sector selebar 120°. Sebuah target dianggap
        "di dalam cone" jika bearing ke arahnya berada dalam rentang derajat ini dari
        azimuth. Makin besar = beam makin lebar = makin banyak neighbor lolos.
      </>
    ),
    maxCandTerm: "Max candidates",
    maxCandDesc: (
      <>
        Jumlah maksimum baris neighbor yang dikembalikan per source sector. Setelah semua
        penyaringan, kandidat yang lolos diurutkan berdasarkan jarak (terdekat dulu) dan
        hanya N teratas yang disimpan.
      </>
    ),
    maxDistTerm: "Max distance (m)",
    maxDistDesc: (
      <>
        Batas jarak tegas dalam meter — target yang lebih jauh dari ini langsung dibuang
        sebelum proses lain. Biarkan <strong>kosong</strong> jika tanpa batas.
      </>
    ),
    coSiteTerm: "Exclude co-site sectors",
    coSiteDesc: (
      <>
        Jika dicentang, sector mana pun yang berada di site yang sama (LRD sama) dengan
        source akan dilewati, sehingga Anda hanya mendapat neighbor di site <em>lain</em>.
      </>
    ),
    modeTerm: "Facing mode",
    modeDesc: "Menentukan kondisi \"facing\" mana yang harus dipenuhi sepasang sector. Ada tiga — ketuk namanya untuk membaca tutorial lengkapnya:",
    modeBrief: (
      <>
        <strong>Mutual</strong> — kedua sector harus saling menghadap.{" "}
        <strong>Source only</strong> — hanya source yang harus menghadap target.{" "}
        <strong>Target only</strong> — hanya target yang harus menghadap source. Dua mode
        "only" menambahkan filter <em>rank</em> per site, dijelaskan di tab masing-masing.
      </>
    ),

    mutualIntro: (
      <>
        Sepasang sector hanya disimpan jika <em>keduanya</em> saling menghadap. Dua
        kondisi harus terpenuhi bersamaan:
      </>
    ),
    mutualCond1: (
      <>
        <strong>Kondisi 1</strong> — target berada di dalam cone azimuth source (bearing
        source → target dalam rentang ±half-width dari azimuth source).
      </>
    ),
    mutualCond2: (
      <>
        <strong>Kondisi 2</strong> — source berada di dalam cone azimuth target (bearing
        target → source dalam rentang ±half-width dari azimuth target).
      </>
    ),
    mutualSuccessAlt: "Mutual facing — berhasil: cone source dan target saling menutupi",
    mutualSuccessCap: (
      <>
        <strong>Lolos</strong> — cone source menutupi target <em>dan</em> cone target
        menutupi source. Keduanya saling menghadap, jadi pasangan ini disimpan.
      </>
    ),
    mutualFailAlt: "Mutual facing — gagal: target tidak berada di dalam cone source",
    mutualFailCap: (
      <>
        <strong>Gagal</strong> — di sini target berada di luar cone source (atau
        sebaliknya). Karena satu kondisi gagal, pasangan ini dibuang — meskipun kedua
        site mungkin berdekatan.
      </>
    ),

    sourceIntro: (
      <>
        Hanya <em>Kondisi 1</em> yang diperlukan — target cukup berada di dalam cone{" "}
        <strong>source</strong>. Target tidak harus menghadap balik.
      </>
    ),
    sourceImgAlt: "Source facing only — sector target diberi rank berdasarkan seberapa lurus mereka menghadap balik",
    sourceCap: (
      <>
        Source melihat tiga sector di site target. Masing-masing dinilai dengan{" "}
        <em>Offset tgt</em> — seberapa lurus ia menghadap balik ke source. Offset
        terkecil = Rank 1.
      </>
    ),
    sourceRankIntro: (
      <>
        <strong>Pemberian rank (per site target):</strong> untuk satu site target,
        sector-sector yang cocok diurutkan berdasarkan Offset tgt (menaik). Sector yang
        paling lurus menghadap balik adalah Rank 1.
      </>
    ),
    sourceRank1: <><strong>y2 = 85°</strong> → Rank 1 (menghadap balik paling lurus)</>,
    sourceRank2: <><strong>y1 = 90°</strong> → Rank 2</>,
    sourceRank3: <><strong>y3 = 180°</strong> → Rank 3 (menghadap menjauh)</>,
    sourceExTitle: "Contoh — Rank 1 & 2 dicentang, Rank 3 tidak dicentang",
    sourceExIntro: (
      <>
        Checkbox "Keep target ranks" di Step 2 menentukan rank mana yang bertahan. Dengan
        Rank 1 dan Rank 2 dicentang tetapi Rank 3 tidak:
      </>
    ),
    sourceExKept1: <><strong>y2</strong> (Rank 1) — disimpan</>,
    sourceExKept2: <><strong>y1</strong> (Rank 2) — disimpan</>,
    sourceExDrop: <><strong>y3</strong> (Rank 3) — dibuang</>,
    sourceExNote: "Jadi site target ini hanya menyumbang y2 dan y1. Sector Rank 3 (y3) dihapus sebelum hasil ditampilkan.",

    targetIntro: (
      <>
        Hanya <em>Kondisi 2</em> yang diperlukan — source cukup berada di dalam cone{" "}
        <strong>target</strong>. Pemberian rank di sini dinilai sepenuhnya dari{" "}
        <em>sudut pandang tiap target</em>.
      </>
    ),
    targetImgAlt: "Target facing only — tiap target memberi rank pada sector site source yang dihadapinya",
    targetCap: (
      <>
        Site source punya sector S1, S2, S3. Tiap target melihat sector site source yang
        dihadapinya lalu memberi rank. Rank <strong>S1</strong> berbeda dari satu target
        ke target lain.
      </>
    ),
    targetRankIntro: (
      <>
        <strong>Membaca gambar</strong> — di posisi mana <strong>S1</strong> berada dalam
        ranking tiap target?
      </>
    ),
    targetRankT1: <><strong>target 1</strong>: S1 adalah Rank 2</>,
    targetRankT2: <><strong>target 2</strong>: S1 adalah Rank 3</>,
    targetRankT3: <><strong>target 3</strong>: S1 adalah Rank 2</>,
    targetRankT4: <><strong>target 4</strong>: S1 adalah Rank 1</>,
    targetExTitle: "Contoh — query source S1",
    targetExAll: <><strong>Semua rank dicentang (1, 2, 3):</strong> S1 muncul untuk setiap target yang dihadapinya →</>,
    targetExAllResult: "target 1, target 2, target 3, target 4",
    targetExSome: (
      <>
        <strong>Rank 1 & 2 dicentang, Rank 3 tidak:</strong> S1 dibuang di mana pun ia
        ber-rank 3. Hanya <strong>target 2</strong> yang menempatkan S1 di Rank 3,
        sehingga target 2 hilang →
      </>
    ),
    targetExSomeResult: "target 1, target 3, target 4",
    targetExNote: "target 2 dibuang karena, dari sudut pandang target 2, source S1 adalah sector Rank 3-nya — dan Rank 3 tidak dicentang.",
  },
};

export default function HelpPanel() {
  const [tab, setTab] = useState("general");
  const [lang, setLang] = useState("en"); // "en" | "id"
  const t = T[lang];

  return (
    <section className={styles.helpPanel}>
      <div className={styles.helpHeaderRow}>
        <h2 className={styles.helpTitle}>{t.title}</h2>

        <div className={styles.langToggle} role="group" aria-label={t.langLabel}>
          <button
            className={`${styles.langButton} ${lang === "en" ? styles.langActive : ""}`}
            onClick={() => setLang("en")}
          >
            EN
          </button>
          <button
            className={`${styles.langButton} ${lang === "id" ? styles.langActive : ""}`}
            onClick={() => setLang("id")}
          >
            ID
          </button>
        </div>
      </div>

      <p className={styles.helpIntro}>{t.intro}</p>

      <div className={styles.tabBar}>
        {TABS.map((tb) => (
          <button
            key={tb.id}
            className={`${styles.tabButton} ${tab === tb.id ? styles.tabActive : ""}`}
            onClick={() => setTab(tb.id)}
          >
            {lang === "en" ? tb.en : tb.id_}
          </button>
        ))}
      </div>

      {tab === "general" && <GeneralTab t={t} goTo={setTab} />}
      {tab === "mutual" && <MutualTab t={t} />}
      {tab === "source" && <SourceTab t={t} />}
      {tab === "target" && <TargetTab t={t} />}
    </section>
  );
}

function GeneralTab({ t, goTo }) {
  return (
    <div className={styles.tutorialBody}>
      <div className={styles.helpRules}>{t.inputFormat}</div>

      <p className={styles.visualBody}>{t.settingsIntro}</p>

      <dl className={styles.settingList}>
        <div>
          <dt className={styles.settingTerm}>{t.coneTerm}</dt>
          <dd className={styles.settingDesc}>{t.coneDesc}</dd>
        </div>
        <div>
          <dt className={styles.settingTerm}>{t.maxCandTerm}</dt>
          <dd className={styles.settingDesc}>{t.maxCandDesc}</dd>
        </div>
        <div>
          <dt className={styles.settingTerm}>{t.maxDistTerm}</dt>
          <dd className={styles.settingDesc}>{t.maxDistDesc}</dd>
        </div>
        <div>
          <dt className={styles.settingTerm}>{t.coSiteTerm}</dt>
          <dd className={styles.settingDesc}>{t.coSiteDesc}</dd>
        </div>
        <div>
          <dt className={styles.settingTerm}>{t.modeTerm}</dt>
          <dd className={styles.settingDesc}>
            {t.modeDesc}
            <span className={styles.settingLinks}>
              <button className={styles.inlineTabLink} onClick={() => goTo("mutual")}>
                Mutual facing
              </button>
              <button className={styles.inlineTabLink} onClick={() => goTo("source")}>
                Source facing only
              </button>
              <button className={styles.inlineTabLink} onClick={() => goTo("target")}>
                Target facing only
              </button>
            </span>
            <span className={styles.settingModeBrief}>{t.modeBrief}</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

function MutualTab({ t }) {
  return (
    <div className={styles.tutorialBody}>
      <p className={styles.visualBody}>{t.mutualIntro}</p>
      <ul className={styles.tutorialList}>
        <li>{t.mutualCond1}</li>
        <li>{t.mutualCond2}</li>
      </ul>

      <figure className={styles.tutorialFigure}>
        <Image
          src={`${IMG_BASE}/intersite_method_mutual_facing_success.jpg`}
          alt={t.mutualSuccessAlt}
          width={900}
          height={620}
          className={styles.tutorialImage}
        />
        <figcaption className={styles.tutorialCaption}>{t.mutualSuccessCap}</figcaption>
      </figure>

      <figure className={styles.tutorialFigure}>
        <Image
          src={`${IMG_BASE}/intersite_method_mutual_facing_failed.jpg`}
          alt={t.mutualFailAlt}
          width={900}
          height={620}
          className={styles.tutorialImage}
        />
        <figcaption className={styles.tutorialCaption}>{t.mutualFailCap}</figcaption>
      </figure>
    </div>
  );
}

function SourceTab({ t }) {
  return (
    <div className={styles.tutorialBody}>
      <p className={styles.visualBody}>{t.sourceIntro}</p>

      <figure className={styles.tutorialFigure}>
        <Image
          src={`${IMG_BASE}/intersite_method_source_facing_only.jpg`}
          alt={t.sourceImgAlt}
          width={900}
          height={620}
          className={styles.tutorialImage}
        />
        <figcaption className={styles.tutorialCaption}>{t.sourceCap}</figcaption>
      </figure>

      <div className={styles.rankExplain}>
        <p className={styles.visualBody}>{t.sourceRankIntro}</p>
        <ul className={styles.tutorialList}>
          <li>{t.sourceRank1}</li>
          <li>{t.sourceRank2}</li>
          <li>{t.sourceRank3}</li>
        </ul>
      </div>

      <div className={styles.rankExample}>
        <div className={styles.rankExampleTitle}>{t.sourceExTitle}</div>
        <p className={styles.visualBody}>{t.sourceExIntro}</p>
        <ul className={styles.tutorialList}>
          <li>{t.sourceExKept1}</li>
          <li>{t.sourceExKept2}</li>
          <li>{t.sourceExDrop}</li>
        </ul>
        <p className={styles.fieldHint}>{t.sourceExNote}</p>
      </div>
    </div>
  );
}

function TargetTab({ t }) {
  return (
    <div className={styles.tutorialBody}>
      <p className={styles.visualBody}>{t.targetIntro}</p>

      <figure className={styles.tutorialFigure}>
        <Image
          src={`${IMG_BASE}/intersite_method_target_facing_only.jpg`}
          alt={t.targetImgAlt}
          width={1000}
          height={760}
          className={styles.tutorialImage}
        />
        <figcaption className={styles.tutorialCaption}>{t.targetCap}</figcaption>
      </figure>

      <div className={styles.rankExplain}>
        <p className={styles.visualBody}>{t.targetRankIntro}</p>
        <ul className={styles.tutorialList}>
          <li>{t.targetRankT1}</li>
          <li>{t.targetRankT2}</li>
          <li>{t.targetRankT3}</li>
          <li>{t.targetRankT4}</li>
        </ul>
      </div>

      <div className={styles.rankExample}>
        <div className={styles.rankExampleTitle}>{t.targetExTitle}</div>
        <p className={styles.visualBody}>{t.targetExAll}</p>
        <p className={styles.exampleResult}>{t.targetExAllResult}</p>
        <p className={styles.visualBody}>{t.targetExSome}</p>
        <p className={styles.exampleResult}>{t.targetExSomeResult}</p>
        <p className={styles.fieldHint}>{t.targetExNote}</p>
      </div>
    </div>
  );
}
