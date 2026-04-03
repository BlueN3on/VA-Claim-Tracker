// popup.js v1.1.2

const PHASES = [
  { key: "CLAIM_RECEIVED",                      label: "Claim Received" },
  { key: "INITIAL_REVIEW",                      label: "Initial Review" },
  { key: "EVIDENCE_GATHERING_REVIEW_DECISION",  label: "Evidence / Review / Decision" },
  { key: "PREPARATION_FOR_DECISION",            label: "Preparation for Decision" },
  { key: "PENDING_DECISION_APPROVAL",           label: "Pending Decision Approval" },
  { key: "PREPARATION_FOR_NOTIFICATION",        label: "Preparation for Notification" },
  { key: "COMPLETE",                            label: "Complete" }
];

const CLAIM_TYPE_LABELS = {
  "020SUPP":      "Supplemental Claim",
  "020HLR":       "Higher Level Review",
  "110HLR":       "Higher Level Review",
  "400CORRC":     "Compensation Claim",
  "290TP":        "Compensation Claim",
  "130DPNEBNADJ": "Dependency Claim",
  "010LCOMP":     "Original Compensation Claim"
};

const STATUS_LABELS = {
  "CLAIM_RECEIVED":                      "Claim Received",
  "INITIAL_REVIEW":                      "Initial Review",
  "EVIDENCE_GATHERING_REVIEW_DECISION":  "Evidence / Review / Decision",
  "PREPARATION_FOR_DECISION":            "Preparation for Decision",
  "PENDING_DECISION_APPROVAL":           "Pending Decision Approval",
  "PREPARATION_FOR_NOTIFICATION":        "Preparation for Notification",
  "COMPLETE":                            "Complete"
};

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setLoading() {
  const content = document.getElementById("content");
  content.textContent = "";
  content.appendChild(el("p", "loading", "Loading…"));
}

function showError(msg) {
  const content = document.getElementById("content");
  content.textContent = "";
  content.appendChild(el("p", "error", msg));
}

// --- Get claim ID: tab URL → storage → first open claim ---
async function resolveClaimId() {
  // 1. Try active tab URL
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const url = tabs[0]?.url || "";
    const match = url.match(/your-claims\/(\d+)/);
    if (match) {
      await browser.storage.local.set({ claimId: match[1] });
      return match[1];
    }
  } catch(e) {}

  // 2. Try stored ID
  const stored = await browser.storage.local.get("claimId");
  if (stored.claimId) return stored.claimId;

  // 3. Auto-detect: fetch all claims, use first open one
  try {
    const all = await fetchAllClaims();
    const open = all.find(c => !c.closeDate);
    if (open) {
      await browser.storage.local.set({ claimId: open.id });
      return open.id;
    }
  } catch(e) {}

  return null;
}

// --- API calls ---
async function fetchClaim(claimId) {
  const r = await fetch(`https://api.va.gov/v0/benefits_claims/${claimId}`, { credentials: "include" });
  if (!r.ok) throw new Error(`Claim API ${r.status}`);
  const j = await r.json();
  const a = j.data.attributes;
  return {
    claimId,
    claimType: a.claimType,
    claimTypeCode: a.claimTypeCode,
    claimDate: a.claimDate,
    status: a.status,
    currentPhase: a.claimPhaseDates?.latestPhaseType,
    phaseChangeDate: a.claimPhaseDates?.phaseChangeDate,
    previousPhases: a.claimPhaseDates?.previousPhases,
    minEstDate: a.minEstClaimDate,
    maxEstDate: a.maxEstClaimDate,
    contentions: a.contentions,
    documentsNeeded: a.documentsNeeded,
    decisionLetterSent: a.decisionLetterSent,
    developmentLetterSent: a.developmentLetterSent,
    jurisdiction: a.jurisdiction,
    supportingDocuments: a.supportingDocuments,
    trackedItems: a.trackedItems,
    closeDate: a.closeDate
  };
}

async function fetchAllClaims() {
  const r = await fetch("https://api.va.gov/v0/benefits_claims", { credentials: "include" });
  if (!r.ok) throw new Error(`All claims API ${r.status}`);
  const j = await r.json();
  return j.data.map(c => ({
    id: c.id,
    type: c.type,
    claimTypeCode: c.attributes?.claimTypeCode,
    claimDate: c.attributes?.claimDate,
    closeDate: c.attributes?.closeDate,
    status: c.attributes?.status,
    phase: c.attributes?.claimPhaseDates?.latestPhaseType
  }));
}

async function fetchDisabilityRating() {
  const r = await fetch("https://api.va.gov/v0/rated_disabilities", { credentials: "include" });
  if (!r.ok) throw new Error(`Rating API ${r.status}`);
  const j = await r.json();
  // Handle multiple possible response shapes
  const attrs = j.data?.attributes || j.data || j;
  console.log("Rating response:", JSON.stringify(attrs));
  return attrs;
}

// --- Change detection ---
function checkForChanges(oldData, newData) {
  const changes = [];
  if (oldData.currentPhase !== newData.currentPhase) {
    const oldLabel = PHASES.find(p => p.key === oldData.currentPhase)?.label || oldData.currentPhase;
    const newLabel = PHASES.find(p => p.key === newData.currentPhase)?.label || newData.currentPhase;
    changes.push({ title: "Claim Phase Updated", message: `${oldLabel} → ${newLabel}` });
  }
  if (oldData.minEstDate !== newData.minEstDate || oldData.maxEstDate !== newData.maxEstDate) {
    changes.push({ title: "Estimated Dates Changed", message: `Now: ${formatDate(newData.minEstDate)} – ${formatDate(newData.maxEstDate)}` });
  }
  changes.forEach(({ title, message }) => {
    browser.notifications.create({ type: "basic", title: `VA Claim Tracker: ${title}`, message, iconUrl: "icons/icon48.png" });
  });
}

// --- Render: Progress Bar ---
function renderProgressBar(currentPhase) {
  const currentIndex = PHASES.findIndex(p => p.key === currentPhase);
  const wrapper = el("div", "card");
  wrapper.appendChild(el("div", "card-title", "Claim Progress"));
  const bar = el("div", "progress-bar");
  PHASES.forEach((phase, i) => {
    const step = el("div", "progress-step");
    if (i < currentIndex) step.classList.add("done");
    if (i === currentIndex) step.classList.add("active");
    const dot = el("div", "progress-dot");
    dot.textContent = i < currentIndex ? "✓" : i + 1;
    step.appendChild(dot);
    step.appendChild(el("div", "progress-label", phase.label));
    bar.appendChild(step);
    if (i < PHASES.length - 1)
      bar.appendChild(el("div", i < currentIndex ? "progress-line done" : "progress-line"));
  });
  wrapper.appendChild(bar);
  return wrapper;
}

// --- Render: My Claim ---
function renderClaim(data) {
  const content = document.getElementById("content");
  content.textContent = "";
  content.appendChild(renderProgressBar(data.currentPhase));

  const overview = el("div", "card");
  overview.appendChild(el("div", "card-title", "Claim Overview"));
  overview.appendChild(el("div", "claim-type", CLAIM_TYPE_LABELS[data.claimTypeCode] || data.claimType || "Claim"));
  overview.appendChild(el("div", "claim-id", `Claim ID: ${data.claimId}`));
  [["Filed", formatDate(data.claimDate)], ["Jurisdiction", data.jurisdiction || "—"], ["Closed", data.closeDate ? formatDate(data.closeDate) : "Open"]].forEach(([l, v]) => {
    const row = el("div", "row");
    row.appendChild(el("span", "label", l));
    row.appendChild(el("span", "value", v));
    overview.appendChild(row);
  });
  content.appendChild(overview);

  const phaseCard = el("div", "card");
  phaseCard.appendChild(el("div", "card-title", "Current Phase"));
  const phaseIndex = PHASES.findIndex(p => p.key === data.currentPhase);
  phaseCard.appendChild(el("div", "phase-badge", `${phaseIndex + 1} – ${PHASES[phaseIndex]?.label || data.currentPhase}`));
  if (data.phaseChangeDate) {
    const r = el("div", "row");
    r.appendChild(el("span", "label", "Since"));
    r.appendChild(el("span", "value", formatDate(data.phaseChangeDate)));
    phaseCard.appendChild(r);
  }
  content.appendChild(phaseCard);

  if (data.minEstDate || data.maxEstDate) {
    const estCard = el("div", "card");
    estCard.appendChild(el("div", "card-title", "Estimated Completion"));
    estCard.appendChild(el("div", "est-range", `${formatDate(data.minEstDate)} – ${formatDate(data.maxEstDate)}`));
    content.appendChild(estCard);
  }

  if (data.contentions?.length) {
    const c = el("div", "card");
    c.appendChild(el("div", "card-title", "Claimed Conditions"));
    data.contentions.forEach(x => c.appendChild(el("div", "list-item", x.name)));
    content.appendChild(c);
  }

  const flagCard = el("div", "card");
  flagCard.appendChild(el("div", "card-title", "Status Flags"));
  [["Documents Needed", data.documentsNeeded], ["Decision Letter Sent", data.decisionLetterSent], ["Development Letter Sent", data.developmentLetterSent]].forEach(([l, v]) => {
    const row = el("div", "row");
    row.appendChild(el("span", "label", l));
    row.appendChild(el("span", v ? "flag-yes" : "flag-no", v ? "Yes" : "No"));
    flagCard.appendChild(row);
  });
  content.appendChild(flagCard);

  if (data.supportingDocuments?.length) {
    const d = el("div", "card");
    d.appendChild(el("div", "card-title", `Documents (${data.supportingDocuments.length})`));
    data.supportingDocuments.forEach(doc => {
      const item = el("div", "doc-item");
      item.appendChild(el("div", "doc-name", doc.originalFileName));
      item.appendChild(el("div", "doc-type", doc.documentTypeLabel));
      item.appendChild(el("div", "doc-date", formatDate(doc.uploadDate)));
      d.appendChild(item);
    });
    content.appendChild(d);
  }
}

// --- Render: All Claims ---
function renderAllClaims(claims) {
  const content = document.getElementById("content");
  content.textContent = "";
  if (!claims?.length) { content.appendChild(el("p", "loading", "No claims found.")); return; }

  const open   = claims.filter(c => !c.closeDate);
  const closed = claims.filter(c =>  c.closeDate);

  const renderGroup = (title, list) => {
    if (!list.length) return;
    const card = el("div", "card");
    card.appendChild(el("div", "card-title", title));
    list.forEach(c => {
      const item = el("div", "claim-list-item");
      const top = el("div", "claim-list-top");
      top.appendChild(el("span", "claim-list-type", CLAIM_TYPE_LABELS[c.claimTypeCode] || c.type || "Claim"));
      top.appendChild(el("span", "claim-list-id", `#${c.id}`));
      item.appendChild(top);
      const s = el("div", "claim-list-status", STATUS_LABELS[c.phase || c.status] || c.status || "—");
      if (c.closeDate) s.classList.add("status-complete");
      item.appendChild(s);
      const meta = el("div", "claim-list-meta");
      meta.appendChild(el("span", "", `Filed: ${formatDate(c.claimDate)}`));
      if (c.closeDate) meta.appendChild(el("span", "", `Closed: ${formatDate(c.closeDate)}`));
      item.appendChild(meta);
      card.appendChild(item);
    });
    content.appendChild(card);
  };

  renderGroup(`Open Claims (${open.length})`, open);
  renderGroup(`Closed Claims (${closed.length})`, closed);
}

// --- Render: Disability Rating ---
function renderRating(data) {
  const content = document.getElementById("content");
  content.textContent = "";
  if (!data) { content.appendChild(el("p", "loading", "Could not load disability rating.")); return; }

  // Normalize field names — handle both camelCase and snake_case
  const combined   = data.combinedDisabilityRating   ?? data.combined_disability_rating   ?? data.userPercentOfDisability ?? "—";
  const combDate   = data.combinedEffectiveDate       ?? data.combined_effective_date       ?? null;
  const legalDate  = data.legalEffectiveDate          ?? data.legal_effective_date          ?? null;
  const ratings    = data.individualRatings           ?? data.individual_ratings            ?? [];

  const card = el("div", "card");
  card.appendChild(el("div", "card-title", "Combined Disability Rating"));
  card.appendChild(el("div", "rating-combined", `${combined}%`));
  [["Combined Effective Date", formatDate(combDate)], ["Legal Effective Date", formatDate(legalDate)]].forEach(([l, v]) => {
    const r = el("div", "row");
    r.appendChild(el("span", "label", l));
    r.appendChild(el("span", "value", v));
    card.appendChild(r);
  });
  content.appendChild(card);

  const serviceConnected    = ratings.filter(r => r.decision === "Service Connected");
  const notServiceConnected = ratings.filter(r => r.decision !== "Service Connected");

  const renderGroup = (title, list) => {
    if (!list.length) return;
    const c = el("div", "card");
    c.appendChild(el("div", "card-title", `${title} (${list.length})`));
    list.forEach(r => {
      const item = el("div", "rating-item");
      const top = el("div", "rating-item-top");
      const pct = (r.ratingPercentage ?? r.rating_percentage) != null ? `${r.ratingPercentage ?? r.rating_percentage}%` : "—";
      top.appendChild(el("span", "rating-pct", pct));
      top.appendChild(el("span", "rating-name", r.diagnosticText ?? r.diagnostic_text ?? r.diagnosticTypeName ?? "—"));
      item.appendChild(top);
      const meta = el("div", "rating-item-meta");
      const code = r.diagnosticTypeCode ?? r.diagnostic_type_code;
      if (code) meta.appendChild(el("span", "rating-code", `Code: ${code}`));
      const eff = r.effectiveDate ?? r.effective_date;
      if (eff) meta.appendChild(el("span", "", `Effective: ${formatDate(eff)}`));
      const isStatic = r.staticInd ?? r.static_ind;
      if (isStatic != null) meta.appendChild(el("span", isStatic ? "flag-no" : "rating-not-static", isStatic ? "Static" : "Not Static"));
      item.appendChild(meta);
      c.appendChild(item);
    });
    content.appendChild(c);
  };

  renderGroup("Service-Connected Disabilities", serviceConnected);
  renderGroup("Not Service Connected", notServiceConnected);

  // Disclaimer
  const disc = el("div", "card disclaimer");
  disc.appendChild(el("div", "card-title", "Disclaimer"));
  disc.appendChild(el("p", "disclaimer-text",
    "Static/Not Static status and all rating data is sourced directly from VA.gov and displayed as-is. " +
    "This tool does not calculate, interpret, or modify your ratings. " +
    "For questions about your disability rating, contact the VA directly at 1-800-827-1000."
  ));
  content.appendChild(disc);
}

// --- State ---
let cachedClaim = null;
let cachedAllClaims = null;
let cachedRating = null;

async function switchTab(tab) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));

  if (tab === "claim") {
    if (cachedClaim) renderClaim(cachedClaim);
    return;
  }
  if (tab === "all") {
    if (cachedAllClaims) { renderAllClaims(cachedAllClaims); return; }
    setLoading();
    try { cachedAllClaims = await fetchAllClaims(); renderAllClaims(cachedAllClaims); }
    catch(e) { showError(`Could not load claims: ${e.message}`); }
    return;
  }
  if (tab === "rating") {
    if (cachedRating !== null) { renderRating(cachedRating); return; }
    setLoading();
    try { cachedRating = await fetchDisabilityRating(); renderRating(cachedRating); }
    catch(e) { showError(`Could not load rating: ${e.message}`); }
  }
}

// --- Main ---
(async () => {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  setLoading();

  const claimId = await resolveClaimId();

  if (!claimId) {
    const content = document.getElementById("content");
    content.textContent = "";
    content.appendChild(el("p", "loading", "Navigate to VA.gov and log in, then click this icon."));
    return;
  }

  try {
    const stored = await browser.storage.local.get(["claimData", "lastUpdated"]);
    const freshData = await fetchClaim(claimId);
    if (stored.claimData) checkForChanges(stored.claimData, freshData);
    const now = new Date().toISOString();
    await browser.storage.local.set({ claimData: freshData, lastUpdated: now });
    document.getElementById("last-updated").textContent =
      `Updated ${new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    cachedClaim = freshData;
    renderClaim(freshData);
  } catch(err) {
    const stored = await browser.storage.local.get("claimData");
    if (stored.claimData) {
      document.getElementById("last-updated").textContent = "⚠ Cached";
      cachedClaim = stored.claimData;
      renderClaim(stored.claimData);
    } else {
      showError(`Could not load claim: ${err.message}`);
    }
  }
})();
