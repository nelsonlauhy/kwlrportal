// /js/resources_admin.js (Locations wording + hide Branch everywhere)
// - List: removes Branch column output (no <td> branch)
// - Save: does NOT require branch, does NOT write branch
// - Edit fill: ignores branch
// - Backward compatible: old docs may still have branch field; we just don’t show/use it.

(function () {
  /* ---------- Firestore ---------- */
  function getDB() {
    return (window.db && typeof window.db.collection === "function")
      ? window.db
      : firebase.firestore();
  }

  let RES_COL = "resources"; // default
  let RES_COL_LOCKED = false;
  const CANDIDATE_COLLECTIONS = ["event_resources", "resources"];

  async function resolveAndLockCollection() {
    if (RES_COL_LOCKED) return RES_COL;

    const db = getDB();

    // Prefer non-empty
    for (const name of CANDIDATE_COLLECTIONS) {
      try {
        const snap = await db.collection(name).limit(1).get();
        if (!snap.empty) {
          RES_COL = name;
          RES_COL_LOCKED = true;
          console.info(`[resources_admin] Using collection "${RES_COL}" (non-empty)`);
          return RES_COL;
        }
      } catch (_) {}
    }

    // Fallback: first readable
    for (const name of ["resources", "event_resources"]) {
      try {
        await db.collection(name).limit(1).get();
        RES_COL = name;
        RES_COL_LOCKED = true;
        console.info(`[resources_admin] Using collection "${RES_COL}" (fallback)`);
        return RES_COL;
      } catch (_) {}
    }

    RES_COL = "resources";
    RES_COL_LOCKED = true;
    console.warn(`[resources_admin] Could not verify collections; defaulting to "${RES_COL}"`);
    return RES_COL;
  }

  function resColRef() {
    return getDB().collection(RES_COL);
  }

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
  // Branch hidden in HTML; keep null-safe ref
  const r_branch = document.getElementById("r_branch"); // may be null / hidden
  const r_address = document.getElementById("r_address");
  const r_capacity = document.getElementById("r_capacity");
  const r_owners = document.getElementById("r_owners");
  const r_requiresApproval = document.getElementById("r_requiresApproval");
  const r_type = document.getElementById("r_type");
  const r_mapsUrl = document.getElementById("r_mapsUrl");
  const r_mapPreview = document.getElementById("r_mapPreview");
  const r_mapHint = document.getElementById("r_mapHint");

  // Track current editing docId
  let CURRENT_DOCID = null;

  /* ---------- Helpers ---------- */
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }

  function showSaveMsg(text, type = "success") {
    if (!saveMsg) return;
    saveMsg.className = `small alert alert-${type}`;
    saveMsg.textContent = text;
    saveMsg.classList.remove("d-none");
    clearTimeout(showSaveMsg._t);
    showSaveMsg._t = setTimeout(() => saveMsg.classList.add("d-none"), 2500);
  }

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
    if (!r_mapPreview || !r_mapHint) return;
    if (embedUrl) {
      r_mapPreview.src = embedUrl;
      r_mapHint.textContent = originalUrl ? "Previewing embed converted from your Maps link." : "Preview from address.";
    } else {
      r_mapPreview.removeAttribute("src");
      r_mapHint.textContent = "No map to preview.";
    }
  }

  function refreshPreviewFromInputs() {
    const { mapsEmbedUrl } = normalizeMapsUrl(r_mapsUrl?.value, r_address?.value);
    updateMapPreview(mapsEmbedUrl, r_mapsUrl?.value);
  }

  r_mapsUrl?.addEventListener("input", refreshPreviewFromInputs);
  r_address?.addEventListener("input", refreshPreviewFromInputs);

  /* ---------- ID generation (optional business key) ---------- */
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
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

  /* ---------- Form reset ---------- */
  function resetForm() {
    CURRENT_DOCID = null;
    if (r_id) r_id.value = "";
    if (resDocId) resDocId.textContent = "";
    if (r_name) r_name.value = "";
    // keep branch untouched (hidden); but clear if exists
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

  /* ---------- Load list (HIDE BRANCH) ---------- */
  async function loadResourcesList() {
    if (!resTBody) return;
    // table now has 5 columns (#,Name,Address,Capacity,Actions)
    resTBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">Loading…</td></tr>';

    try {
      await resolveAndLockCollection();

      const snap = await resColRef().get();
      const items = [];
      snap.forEach((doc) => {
        const d = doc.data() || {};
        items.push({
          __docId: doc.id,
          name: d.name || "",
          address: d.address || "",
          capacity: (d.capacity ?? 0),
        });
      });

      if (!items.length) {
        resTBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">
          No data found in <span class="mono">${escapeHtml(RES_COL)}</span>.
        </td></tr>`;
        return;
      }

      items.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

      let i = 0;
      resTBody.innerHTML = items.map((d) => `
        <tr data-docid="${escapeHtml(d.__docId)}">
          <td>${++i}</td>
          <td>${escapeHtml(d.name)}</td>
          <td>${escapeHtml(d.address)}</td>
          <td class="text-end">${Number(d.capacity ?? 0)}</td>
          <td>
            <div class="btn-group btn-group-sm">
              <button type="button" class="btn btn-outline-primary"
                      data-act="edit" data-docid="${escapeHtml(d.__docId)}" title="Edit">
                <i class="bi bi-pencil-square"></i>
              </button>
              <button type="button" class="btn btn-outline-danger"
                      data-act="del" data-docid="${escapeHtml(d.__docId)}" title="Delete">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `).join("");
    } catch (e) {
      console.error("[resources_admin] load error:", e);
      resTBody.innerHTML = `<tr><td colspan="5" class="text-danger py-4">${escapeHtml(e.message || String(e))}</td></tr>`;
    }
  }

  document.addEventListener("DOMContentLoaded", loadResourcesList);

  /* ---------- Row actions ---------- */
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
        if (!confirm("Delete this location? This cannot be undone.")) return;
        await ref.delete();
        await loadResourcesList();
        showSaveMsg("Location deleted.", "success");
        resetForm();
      }
    } catch (e) {
      console.error(`[resources_admin] ${act} failed:`, e);
      showSaveMsg((e && e.message) ? e.message : String(e), "danger");
    }
  });

  /* ---------- Fill form (IGNORE BRANCH) ---------- */
  async function fillFormByDocId(ref) {
    const doc = await ref.get();
    if (!doc.exists) {
      showSaveMsg(`Document not found in "${RES_COL}".`, "danger");
      return;
    }
    const d = doc.data() || {};
    CURRENT_DOCID = doc.id;

    let embed = d.mapsEmbedUrl || "";
    if (!embed) {
      const derived = normalizeMapsUrl(d.mapsUrl || "", d.address || "");
      embed = derived.mapsEmbedUrl || "";
      if (embed) {
        try { await ref.set({ mapsEmbedUrl: embed }, { merge: true }); } catch (_) {}
      }
    }

    if (r_id) r_id.value = d.id || "";
    if (resDocId) resDocId.textContent = `# ${doc.id}`;
    if (r_name) r_name.value = d.name || "";
    // branch ignored; but clear hidden field if exists
    if (r_branch) r_branch.value = d.branch || "";
    if (r_address) r_address.value = d.address || "";
    if (r_capacity) r_capacity.value = d.capacity ?? 0;
    if (r_owners) r_owners.value = d.owners || "training@livingrealtykw.com";
    if (r_requiresApproval) r_requiresApproval.checked = !!d.requiresApproval;
    if (r_type) r_type.value = d.type || "room";
    if (r_mapsUrl) r_mapsUrl.value = d.mapsUrl || "";
    updateMapPreview(embed, d.mapsUrl || "");
  }

  /* ---------- Save (NO BRANCH) ---------- */
  btnSaveRes?.addEventListener("click", async () => {
    saveMsg?.classList.add("d-none");
    saveBusy?.classList.remove("d-none");

    try {
      await resolveAndLockCollection();

      if (!r_name?.value.trim()) throw new Error("Name is required.");
      if (!r_address?.value.trim()) throw new Error("Address is required.");

      const { mapsUrl, mapsEmbedUrl } = normalizeMapsUrl(r_mapsUrl?.value || "", r_address?.value || "");
      const owners = (r_owners?.value || "training@livingrealtykw.com").trim();

      let businessId = (r_id?.value || "").trim();

      const payload = {
        id: businessId || "",
        name: r_name.value.trim(),
        type: (r_type?.value || "room"),
        // branch intentionally not written in Version A
        address: r_address.value.trim(),
        capacity: parseInt(r_capacity?.value || "0", 10) || 0,
        requiresApproval: !!r_requiresApproval?.checked,
        owners,
        mapsUrl: mapsUrl || "",
        mapsEmbedUrl: mapsEmbedUrl || "",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      if (CURRENT_DOCID) {
        const ref = resColRef().doc(CURRENT_DOCID);

        // optional backfill id if empty
        if (!businessId) {
          businessId = await generateUniqueId();
          payload.id = businessId;
          if (r_id) r_id.value = businessId;
        }

        await ref.set(payload, { merge: true });
        showSaveMsg("Updated successfully.");
      } else {
        if (!businessId) {
          businessId = await generateUniqueId();
          payload.id = businessId;
        }

        const ref = await resColRef().add({
          ...payload,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });

        CURRENT_DOCID = ref.id;
        if (r_id) r_id.value = businessId;
        if (resDocId) resDocId.textContent = `# ${ref.id}`;
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
