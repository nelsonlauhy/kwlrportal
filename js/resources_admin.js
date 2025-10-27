// /js/resources_admin.js
// Uses the "id" field (4-char) as the business key for EDIT/DELETE/LOAD.

// ---------- Firestore ----------
function getDB() {
  return (window.db && typeof window.db.collection === 'function')
    ? window.db
    : firebase.firestore();
}

let RES_COL = 'event_resources';
let RES_COL_LOCKED = false;
const CANDIDATE_COLLECTIONS = ['event_resources', 'resources'];

async function resolveAndLockCollection() {
  if (RES_COL_LOCKED) return RES_COL;
  const db = getDB();
  for (const name of CANDIDATE_COLLECTIONS) {
    try {
      const snap = await db.collection(name).limit(1).get();
      if (!snap.empty) { RES_COL = name; break; }
    } catch {}
  }
  RES_COL_LOCKED = true;
  console.info(`[resources_admin] Using collection "${RES_COL}" (locked)`);
  return RES_COL;
}
function resColRef() { return getDB().collection(RES_COL); }

// Helper: fetch the Firestore docRef by our 4-char "id" field
async function docRefByBusinessId(resourceId) {
  await resolveAndLockCollection();
  const q = await resColRef().where('id', '==', resourceId).limit(1).get();
  if (q.empty) return null;
  const doc = q.docs[0];
  return resColRef().doc(doc.id);
}

// ---------- UI refs ----------
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
const r_owners = document.getElementById('r_owners');
const r_requiresApproval = document.getElementById('r_requiresApproval');
const r_type = document.getElementById('r_type');
const r_mapsUrl = document.getElementById('r_mapsUrl');
const r_mapPreview = document.getElementById('r_mapPreview');
const r_mapHint = document.getElementById('r_mapHint');

// ---------- Maps helpers ----------
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

// ---------- ID generation (unique 4 chars) ----------
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // skip confusing chars
function randomId4() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}
async function generateUniqueId(maxTries = 12) {
  for (let i = 0; i < maxTries; i++) {
    const candidate = randomId4();
    const exists = await resColRef().where('id', '==', candidate).limit(1).get();
    if (exists.empty) return candidate;
  }
  throw new Error('Could not generate a unique ID. Try again.');
}

// ---------- List ----------
async function loadResourcesList() {
  resTBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Loading…</td></tr>';
  try {
    await resolveAndLockCollection();
    const snap = await resColRef().get();
    const items = [];
    snap.forEach(doc => items.push({ id: (doc.data().id || ''), ...doc.data(), __docId: doc.id }));

    if (!items.length) {
      resTBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No data found.</td></tr>';
      return;
    }

    // Sort by name asc
    items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

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
            <button type="button" class="btn btn-outline-primary"
                    data-act="edit" data-id="${d.id}" title="Edit">
              <i class="bi bi-pencil-square"></i>
            </button>
            <button type="button" class="btn btn-outline-danger"
                    data-act="del" data-id="${d.id}" title="Delete">
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

// ---------- Row actions ----------
resTBody.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  ev.preventDefault();

  const id = (btn.dataset.id || btn.closest('tr')?.dataset?.id || '').trim();
  const act = btn.dataset.act;
  if (!id) { showSaveMsg('Internal error: missing id', 'danger'); return; }

  try {
    if (act === 'edit') {
      await fillForm(id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (act === 'del') {
      if (!confirm('Delete this resource? This cannot be undone.')) return;
      const ref = await docRefByBusinessId(id);
      if (!ref) { showSaveMsg('Document not found.', 'danger'); return; }
      await ref.delete();
      await loadResourcesList();
      showSaveMsg('Resource deleted.', 'success');
      resetForm();
    }
  } catch (e) {
    console.error(`[resources_admin] ${act} failed:`, e);
    showSaveMsg((e && e.message) ? e.message : String(e), 'danger');
  }
});

// ---------- Form helpers ----------
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
  r_owners.value = 'training@livingrealtykw.com';
  r_requiresApproval.checked = false;
  r_type.value = 'room';
  r_mapsUrl.value = '';
  updateMapPreview('', '');
}
btnResetForm?.addEventListener('click', resetForm);
btnNewRes?.addEventListener('click', () => { resetForm(); r_name.focus(); });

// ---------- Load one doc into form (EDIT by id) ----------
async function fillForm(resourceId) {
  const ref = await docRefByBusinessId(resourceId);
  if (!ref) {
    showSaveMsg(`Document not found in "${RES_COL}".`, 'danger');
    return;
  }
  const doc = await ref.get();
  if (!doc.exists) {
    showSaveMsg(`Document not found in "${RES_COL}".`, 'danger');
    return;
  }
  const d = doc.data();
  r_id.value = d.id || '';
  resDocId.textContent = `# ${doc.id}`; // Firestore docId (for debug)
  r_name.value = d.name || '';
  r_branch.value = d.branch || '';
  r_address.value = d.address || '';
  r_capacity.value = d.capacity ?? 0;
  r_owners.value = d.owners || 'training@livingrealtykw.com';
  r_requiresApproval.checked = !!d.requiresApproval;
  r_type.value = d.type || 'room';
  r_mapsUrl.value = d.mapsUrl || '';
  updateMapPreview(d.mapsEmbedUrl || '', d.mapsUrl || '');
}

// ---------- Save ----------
btnSaveRes?.addEventListener('click', async () => {
  saveMsg.classList.add('d-none');
  saveBusy?.classList.remove('d-none');
  try {
    if (!RES_COL_LOCKED) await resolveAndLockCollection();

    if (!r_name.value.trim()) throw new Error('Name is required.');
    if (!r_branch.value) throw new Error('Branch is required.');
    if (!r_address.value.trim()) throw new Error('Address is required.');

    // Build/normalize Maps URLs
    const { mapsUrl, mapsEmbedUrl } = normalizeMapsUrl(r_mapsUrl.value, r_address.value);

    // Owners: store as string (comma-separated) as requested
    const owners = (r_owners.value || 'training@livingrealtykw.com').trim();

    // Prepare payload
    const payload = {
      id: (r_id.value || '').trim(),                 // 4-char key
      name: r_name.value.trim(),
      type: (r_type.value || 'room'),
      branch: r_branch.value,
      address: r_address.value.trim(),
      capacity: parseInt(r_capacity.value || '0', 10) || 0,
      requiresApproval: !!r_requiresApproval.checked,
      owners,
      mapsUrl: mapsUrl || '',
      mapsEmbedUrl: mapsEmbedUrl || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    if (payload.id) {
      // UPDATE existing: look up by id
      const ref = await docRefByBusinessId(payload.id);
      if (!ref) { throw new Error('Document not found for update.'); }
      await ref.set(payload, { merge: true });
      showSaveMsg('Updated successfully.');
    } else {
      // CREATE new: generate unique 4-char id
      const newId = await generateUniqueId();
      payload.id = newId;
      const ref = await resColRef().add({
        ...payload,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      r_id.value = newId;
      resDocId.textContent = `# ${ref.id}`;
      showSaveMsg('Created successfully.');
    }

    await loadResourcesList();
  } catch (e) {
    showSaveMsg('Error: ' + (e.message || e), 'danger');
  } finally {
    saveBusy?.classList.add('d-none');
  }
});
