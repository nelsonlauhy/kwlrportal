// /js/resources_admin.js (FIXED)
// FIX: Edit/Delete now uses Firestore docId (always exists).
// Keeps 4-char "id" as optional business key; auto-generates on create,
// and can backfill on update if missing.

(function () {
  /* ---------- Firestore ---------- */
  function getDB() {
    return (window.db && typeof window.db.collection === "function") ? window.db : firebase.firestore();
  }

  let RES_COL = "event_resources";
  let RES_COL_LOCKED = false;
  const CANDIDATE_COLLECTIONS = ["event_resources", "resources"];

  async function resolveAndLockCollection() {
    if (RES_COL_LOCKED) return RES_COL;
    const db = getDB();
    for (const name of CANDIDATE_COLLECTIONS) {
      try {
        const snap = await db.collection(name).limit(1).get();
        // If collection exists (even empty), this might still throw depending on rules.
        // We'll accept the first collection we can read.
        RES_COL = name;
        break;
      } catch (_) {}
    }
    RES_COL_LOCKED = true;
    console.info(`[resources_admin] Using collection "${RES_COL}" (locked)`);
    return RES_COL;
  }
  function resColRef() { return getDB().collection(RES_COL); }

  /* ---------- UI refs ---------- */
  const resTBody = document.getElementById("resTBody");
  const btnNewRes = document.getElementById("btnNewRes");
  const btnResetForm = document.getElementById("btnResetForm");
  const btnSaveRes = document.getElementById("btnSaveRes");
  const saveBusy = document.getElementById("saveBusy");
  const saveMsg = document.getElementById("saveMsg");
  const resDocId = document.getElementById("resDocId");

  const r_id = document.getElementById("r_id");
  const r_name = document.getElementById("r_name");
  const r_branch = document.getElementById("r_branch");
  const r_address = document.getElementById("r_address");
  const r_capacity = document.getElementById("r_capacity");
  const r_owners = document.getElementById("r_owners");
  const r_requiresApproval = document.getElementById("r_requiresApproval");
  const r_type = document.getElementById("r_type");
  const r_mapsUrl = document.getElementById("r_mapsUrl");
  const r_mapPreview = document.getElementById("r_mapPreview");
  const r_mapHint = document.getElementById("r_mapHint");

  // Track current editing docId (Firestore doc.id)
  let CURRENT_DOCID = null;

  /* ---------- Maps helpers ---------- */
  function buildEmbedFromAddress(address) {
    const q = encodeURIComponent(address || "");
    return `https://www.google.com/maps?q=${q}&output=embed`;
  }
  function normalizeMapsUrl(input, address) {
    if (!input) return { mapsUrl: "", mapsEmbedUrl: address ? buildEmbedFromAddress(address) : "" };
    try {
      const u = new URL(input.trim());
      if (u.hostname.includes("google.com") && u.pathname.startsWith("/maps/embed")) {
        return { mapsUrl: input.trim(), mapsEmbedUrl: input.trim() };
      }
      if (u.hostname.includes("google.com") && u.pathname.startsWith("/maps")) {
        const q = u.searchParams.get("q") || "";
        const text = q || address || u.pathname.replace("/maps", "").replace(/\/*$/, "").replaceAll("/", " ").trim();
        return { mapsUrl: input.trim(), mapsEmbedUrl: buildEmbedFromAddress(text) };
      }
      if (u.hostname === "maps.app.goo.gl" || u.hostname === "goo.gl") {
        return { mapsUrl: input.trim(), mapsEmbedUrl: buildEmbedFromAddress(address) };
      }
      return { mapsUrl: input.trim(), mapsEmbedUrl: buildEmbedFromAddress(input.trim()) };
    } catch {
      return { mapsUrl: "", mapsEmbedUrl: buildEmbedFromAddress(input) };
    }
  }
  function updateMapPreview(embedUrl, originalUrl) {
    if (embedUrl) {
      r_mapPreview.src = embedUrl;
      r_mapHint.textContent = originalUrl ? "Previewing embed converted from your Maps link." : "Preview from address.";
    } else {
      r_mapPreview.removeAttribute("src");
      r_mapHint.textContent = "No map to preview.";
    }
  }
  function refreshPreviewFromInputs() {
    const { mapsEmbedUrl } = normalizeMapsUrl(r_mapsUrl.value, r_address.value);
    updateMapPreview(mapsEmbedUrl, r_mapsUrl.value);
  }
  r_mapsUrl?.addEventListener("input", refreshPreviewFromInputs);
  r_address?.addEventListener("input", refreshPreviewFromInputs);

  /* ---------- ID generation (unique 4 chars) ---------- */
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // skip confusing chars
  function randomId4() {
    let s = "";
    for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s;
  }
  async function generateUniqueId(maxTries = 12) {
    for (let i = 0; i < maxTries; i++) {
      const candidate = randomId4();
      const exists = await resColRef().where("id", "==", candidate).limit(1).get();
      if (exists.empty) return candidate;
    }
    throw new Error("Could not generate a unique ID. Try again.");
  }

  /* ---------- UI helpers ---------- */
  function showSaveMsg(text, type = "success") {
    if (!saveMsg) return;
    saveMsg.className = `small alert alert-${type}`;
    saveMsg.textContent = text;
    saveMsg.classList.remove("d-none");
    clearTimeout(showSaveMsg._t);
    showSaveMsg._t = setTimeout(() => saveMsg.classList.add("d-none"), 2500);
  }

  function resetForm() {
    CURRENT_DOCID = null;
    if (r_id) r_id.value = "";
    if (resDocId) resDocId.textContent = "";
    if (r_name) r_name.value = "";
    if (r_branch) r_branch.value = "";
    if (r_address) r_address.value = "";
    if (r_capacity) r_capacity.value = "0";
    if (r_owners) r_owners.value = "training@livingrealtykw.com";
    if (r_requiresApproval) r_requiresApproval.checked = false;
    if (r_type) r_type.value = "room";
    if (r_mapsUrl) r_mapsUrl.value = "";
    updateMapPreview("", "");
  }

  btnResetForm?.addEventListener("click", resetForm);
  btnNewRes?.addEventListener("click", () => { resetForm(); r_name?.focus(); });

  /* ---------- List ---------- */
  async function loadResourcesList() {
    if (!resTBody) return;
    resTBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Loading…</td></tr>';

    try {
      await resolveAndLockCollection();

      // NOTE: no orderBy to avoid missing index / missing fields
      const snap = await resColRef().get();

      const items = [];
      snap.forEach((doc) => {
        const d = doc.data() || {};
        items.push({
          __docId: doc.id,
          id: (d.id || ""),          // optional
          name: d.name || "",
          branch: d.branch || "",
          address: d.address || "",
          capacity: (d.capacity ?? 0),
          _raw: d
        });
      });

      if (!items.length) {
        resTBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No data found.</td></tr>';
        return;
      }

      items.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

      let i = 0;
      resTBody.innerHTML = items.map((d) => `
        <tr data-docid="${d.__docId}">
          <td>${++i}</td>
          <td>${escapeHtml(d.name)}</td>
          <td>${escapeHtml(d.branch)}</td>
          <td>${escapeHtml(d.address)}</td>
          <td class="text-end">${Number(d.capacity ?? 0)}</td>
          <td>
            <div class="btn-group btn-group-sm">
              <button type="button" class="btn btn-outline-primary"
                      data-act="edit" data-docid="${d.__docId}" title="Edit">
                <i class="bi bi-pencil-square"></i>
              </button>
              <button type="button" class="btn btn-outline-danger"
                      data-act="del" data-docid="${d.__docId}" title="Delete">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `).join("");
    } catch (e) {
      console.error("[resources_admin] load error:", e);
      resTBody.innerHTML = `<tr><td colspan="6" class="text-danger py-4">${escapeHtml(e.message || String(e))}</td></tr>`;
    }
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
  }

  document.addEventListener("DOMContentLoaded", loadResourcesList);

  /* ---------- Row actions (docId-based) ---------- */
  resTBody?.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button[data-act]");
    if (!btn) return;
    ev.preventDefault();

    const act = btn.dataset.act;
    const docId = (btn.dataset.docid || btn.closest("tr")?.dataset?.docid || "").trim();
    if (!docId) { showSaveMsg("Internal error: missing docId", "danger"); return; }

    try {
      await resolveAndLockCollection();
      const ref = resColRef().doc(docId);

      if (act === "edit") {
        await fillFormByDocId(ref);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (act === "del") {
        if (!confirm("Delete this resource? This cannot be undone.")) return;
        await ref.delete();
        await loadResourcesList();
        showSaveMsg("Resource deleted.", "success");
        resetForm();
      }
    } catch (e) {
      console.error(`[resources_admin] ${act} failed:`, e);
      showSaveMsg((e && e.message) ? e.message : String(e), "danger");
    }
  });

  /* ---------- Load one doc into form ---------- */
  async function fillFormByDocId(ref) {
    const doc = await ref.get();
    if (!doc.exists) {
      showSaveMsg(`Document not found in "${RES_COL}".`, "danger");
      return;
    }
    const d = doc.data() || {};
    CURRENT_DOCID = doc.id;

    // Derive embed if missing (legacy docs)
    let embed = d.mapsEmbedUrl || "";
    if (!embed) {
      const derived = normalizeMapsUrl(d.mapsUrl || "", d.address || "");
      embed = derived.mapsEmbedUrl || "";
      if (embed) {
        try { await ref.set({ mapsEmbedUrl: embed }, { merge: true }); } catch (_) {}
      }
    }

    r_id.value = d.id || "";
    resDocId.textContent = `# ${doc.id}`; // Firestore docId (debug)
    r_name.value = d.name || "";
    r_branch.value = d.branch || "";
    r_address.value = d.address || "";
    r_capacity.value = (d.capacity ?? 0);
    r_owners.value = d.owners || "training@livingrealtykw.com";
    r_requiresApproval.checked = !!d.requiresApproval;
    r_type.value = d.type || "room";
    r_mapsUrl.value = d.mapsUrl || "";
    updateMapPreview(embed, d.mapsUrl || "");
  }

  /* ---------- Save (docId-based update; generate id if needed) ---------- */
  btnSaveRes?.addEventListener("click", async () => {
    saveMsg?.classList.add("d-none");
    saveBusy?.classList.remove("d-none");

    try {
      await resolveAndLockCollection();

      if (!r_name.value.trim()) throw new Error("Name is required.");
      if (!r_branch.value) throw new Error("Branch is required.");
      if (!r_address.value.trim()) throw new Error("Address is required.");

      const { mapsUrl, mapsEmbedUrl } = normalizeMapsUrl(r_mapsUrl.value, r_address.value);
      const owners = (r_owners.value || "training@livingrealtykw.com").trim();

      // If this doc has no business id, we can backfill one (optional but useful)
      let businessId = (r_id.value || "").trim();

      const payload = {
        id: businessId || "",                 // optional 4-char key
        name: r_name.value.trim(),
        type: (r_type.value || "room"),
        branch: r_branch.value,
        address: r_address.value.trim(),
        capacity: parseInt(r_capacity.value || "0", 10) || 0,
        requiresApproval: !!r_requiresApproval.checked,
        owners,
        mapsUrl: mapsUrl || "",
        mapsEmbedUrl: mapsEmbedUrl || "",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      if (CURRENT_DOCID) {
        // Update existing doc by docId
        const ref = resColRef().doc(CURRENT_DOCID);

        // Backfill businessId if empty (optional)
        if (!businessId) {
          businessId = await generateUniqueId();
          payload.id = businessId;
          r_id.value = businessId;
        }

        await ref.set(payload, { merge: true });
        showSaveMsg("Updated successfully.");
        resDocId.textContent = `# ${CURRENT_DOCID}`;
      } else {
        // Create new doc
        if (!businessId) {
          businessId = await generateUniqueId();
          payload.id = businessId;
        }
        const ref = await resColRef().add({
          ...payload,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        CURRENT_DOCID = ref.id;
        r_id.value = businessId;
        resDocId.textContent = `# ${ref.id}`;
        showSaveMsg("Created successfully.");
      }

      await loadResourcesList();
    } catch (e) {
      showSaveMsg("Error: " + (e.message || e), "danger");
    } finally {
      saveBusy?.classList.add("d-none");
    }
  });
})();
