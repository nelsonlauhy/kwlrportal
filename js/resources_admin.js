// /js/resources_admin.js — collection locking fix

/* ---------- Firestore helpers ---------- */
function getDB() {
  return (window.db && typeof window.db.collection === 'function')
    ? window.db
    : firebase.firestore();
}

let RES_COL = 'event_resources';
let RES_COL_LOCKED = false;
const CANDIDATE_COLLECTIONS = ['event_resources', 'resources'];

/**
 * Resolve which collection to use. We do this ONCE, then lock it
 * so all subsequent operations use the same collection.
 */
async function resolveAndLockCollection() {
  if (RES_COL_LOCKED) return RES_COL;

  const db = getDB();
  for (const name of CANDIDATE_COLLECTIONS) {
    try {
      const snap = await db.collection(name).limit(1).get();
      if (!snap.empty) {
        RES_COL = name;
        break;
      }
    } catch (e) {
      console.warn('[resources_admin] probe failed', name, e?.message || e);
    }
  }

  RES_COL_LOCKED = true;
  console.info(`[resources_admin] Using collection "${RES_COL}" (locked)`);
  return RES_COL;
}
function resColRef() { return getDB().collection(RES_COL); }

/* ---------- UI refs ---------- */
const resTBody = document.getElementById('resTBody');
const btnNewRes = document.getElementById('btnNewRes');
const btnResetForm = document.getElementById('btnResetForm');
const btnSaveRes = document.getElementById('btnSaveRes');
const saveBusy = document.getElementById('saveBusy');
const saveMsg = document.getElementById('saveMsg');
const resDocId = document.getElementById('resDocId');

const r_id = document.getElementById('r_id');
const r_name = document.getElementById('r_name');
const r_branch = document.getElementById('r_branch');
const r_address = document.getElementById('r_address');
const r_capacity = document.getElementById('r_capacity');
const r_mapsUrl = document.getElementById('r_mapsUrl');
const r_mapPreview = document.getElementById('r_mapPreview');
const r_mapHint = document.getElementById('r_mapHint');

/* ---------- Maps helpers ---------- */
function buildEmbedFromAddress(address) {
  const q = encodeURIComponent(address || '');
  return `https://www.google.com/maps?q=${q}&output=embed`;
}
function normalizeMapsUrl(input, address) {
  if (!input) return { mapsUrl: '', mapsEmbedUrl: address ? buildEmbedFromAddress(address) : '' };
  try {
    const u = new URL(input.trim());
    if (u.hostname.includes('google.com') && u.pathname.startsWith('/maps/embed')) {
      return { mapsUrl: input.trim(), mapsEmbedUrl: input.trim() };
    }
    if (u.hostname.includes('google.com') && u.pathname.startsWith('/maps')) {
      const q = u.searchParams.get('q') || '';
      const text = q || address || u.pathname.replace('/maps', '').replace(/\/*$/, '').replaceAll('/', ' ').trim();
      return { mapsUrl: input.trim(), mapsEmbedUrl: buildEmbedFromAddress(text) };
    }
    if (u.hostname === 'maps.app.goo.gl' || u.hostname === 'goo.gl') {
      return { mapsUrl: input.trim(), mapsEmbedUrl: buildEmbedFromAddress(address) };
    }
    return { mapsUrl: input.trim(), mapsEmbedUrl: buildEmbedFromAddress(input.trim()) };
  } catch {
    return { mapsUrl: '', mapsEmbedUrl: buildEmbedFromAddress(input) };
  }
}
function updateMapPreview(embedUrl, originalUrl) {
  if (embedUrl) {
    r_mapPreview.src = embedUrl;
    r_mapHint.textContent = originalUrl ? 'Previewing embed converted from your Maps link.' : 'Preview from address.';
  } else {
    r_mapPreview.removeAttribute('src');
    r_mapHint.textContent = 'No map to preview.';
  }
}
function refreshPreviewFromInputs() {
  const { mapsEmbedUrl } = normalizeMapsUrl(r_mapsUrl.value, r_address.value);
  updateMapPreview(mapsEmbedUrl, r_mapsUrl.value);
}
r_mapsUrl.addEventListener('input', refreshPreviewFromInputs);
r_address.addEventListener('input', refreshPreviewFromInputs);

/* ---------- List ---------- */
async function loadResourcesList() {
  resTBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Loading…</td></tr>';
  try {
    await resolveAndLockCollection();

    const snap = await resColRef().get();
    const items = [];
    snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));

    if (!items.length) {
      resTBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No data found.</td></tr>';
      return;
    }

    let i = 0;
    resTBody.innerHTML = items.map(d => `
      <tr data-id="${d.id}" data-col="${RES_COL}">
        <td>${++i}</td>
        <td>${d.name || ''}</td>
        <td>${d.branch || ''}</td>
        <td>${d.address || ''}</td>
        <td class="text-end">${d.capacity ?? 0}</td>
        <td>
          <div class="btn-group btn-group-sm">
            <button type="button" class="btn btn-outline-primary" data-act="edit" title="Edit">
              <i class="bi bi-pencil-square"></i>
            </button>
            <button type="button" class="btn btn-outline-danger" data-act="del" title="Delete">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('[resources_admin] load error:', e);
    resTBody.innerHTML = `<tr><td colspan="6" class="text-danger py-4">${e.message || e}</td></tr>`;
  }
}
document.addEventListener('DOMContentLoaded', loadResourcesList);

/* ---------- Row actions ---------- */
resTBody.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  ev.preventDefault();

  const tr = btn.closest('tr');
  const id = tr?.dataset?.id;
  const act = btn.dataset.act;
  if (!id) return;

  try {
    if (act === 'edit') {
      await fillForm(id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (act === 'del') {
      if (!confirm('Delete this resource? This cannot be undone.')) return;
      await resColRef().doc(id).delete();
      await loadResourcesList();
      showSaveMsg('Resource deleted.', 'success');
      resetForm();
    }
  } catch (e) {
    console.error(`[resources_admin] ${act} failed:`, e);
    showSaveMsg((e && e.message) ? e.message : String(e), 'danger');
  }
});

/* ---------- Form helpers ---------- */
function showSaveMsg(text, type='success') {
  saveMsg.className = `small alert alert-${type}`;
  saveMsg.textContent = text;
  saveMsg.classList.remove('d-none');
  clearTimeout(showSaveMsg._t);
  showSaveMsg._t = setTimeout(() => saveMsg.classList.add('d-none'), 2500);
}
function resetForm() {
  r_id.value = '';
  resDocId.textContent = '';
  r_name.value = '';
  r_branch.value = '';
  r_address.value = '';
  r_capacity.value = '0';
  r_mapsUrl.value = '';
  updateMapPreview('', '');
}
btnResetForm?.addEventListener('click', resetForm);
btnNewRes?.addEventListener('click', () => { resetForm(); r_name.focus(); });

/* ---------- Load one doc into form (EDIT) ---------- */
async function fillForm(id) {
  // DO NOT re-resolve here; collection is locked
  const doc = await resColRef().doc(id).get();
  if (!doc.exists) {
    // show a helpful debug with current collection
    showSaveMsg(`Document not found in "${RES_COL}".`, 'danger');
    console.warn('[resources_admin] doc not found:', id, 'in collection', RES_COL);
    return;
  }
  const d = doc.data();
  r_id.value = doc.id;
  resDocId.textContent = `# ${doc.id}`;
  r_name.value = d.name || '';
  r_branch.value = d.branch || '';
  r_address.value = d.address || '';
  r_capacity.value = d.capacity ?? 0;
  r_mapsUrl.value = d.mapsUrl || '';
  updateMapPreview(d.mapsEmbedUrl || '', d.mapsUrl || '');
}

/* ---------- Save ---------- */
btnSaveRes?.addEventListener('click', async () => {
  saveMsg.classList.add('d-none');
  saveBusy?.classList.remove('d-none');
  try {
    // Use locked collection
    if (!RES_COL_LOCKED) await resolveAndLockCollection();

    if (!r_name.value.trim()) throw new Error('Name is required.');
    if (!r_branch.value) throw new Error('Branch is required.');
    if (!r_address.value.trim()) throw new Error('Address is required.');

    const { mapsUrl, mapsEmbedUrl } = normalizeMapsUrl(r_mapsUrl.value, r_address.value);
    const payload = {
      name: r_name.value.trim(),
      branch: r_branch.value,
      address: r_address.value.trim(),
      capacity: parseInt(r_capacity.value || '0', 10) || 0,
      mapsUrl: mapsUrl || '',
      mapsEmbedUrl: mapsEmbedUrl || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    const id = r_id.value;
    if (id) {
      await resColRef().doc(id).set(payload, { merge: true });
      showSaveMsg('Updated successfully.');
    } else {
      const docRef = await resColRef().add({
        ...payload,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      r_id.value = docRef.id;
      resDocId.textContent = `# ${docRef.id}`;
      showSaveMsg('Created successfully.');
    }

    await loadResourcesList();
  } catch (e) {
    showSaveMsg('Error: ' + (e.message || e), 'danger');
  } finally {
    saveBusy?.classList.add('d-none');
  }
});
