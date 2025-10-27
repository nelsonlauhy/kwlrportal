// /js/resources_admin.js

/*************************************************
 *  MSAL SESSION-FIRST AUTH GUARD
 *  - Reuse existing sign-in (from event-admin.html)
 *  - Never hang the spinner: shows UI once account is present
 *************************************************/
(async function () {
  const authGate = document.getElementById('authGate');
  const appWrap  = document.getElementById('appWrap');

  const INTERNAL_DOMAINS = [
    'livingrealtykw.com',
    'livinggroupinc.com',
    'livingrealty.com',
    'kwliving.com'
  ];

  const show403 = (msg) => {
    authGate.innerHTML = `
      <div class="container py-5">
        <div class="alert alert-danger">
          <strong>Access denied.</strong> ${msg || 'This page is restricted to internal staff.'}
        </div>
        <a class="btn btn-outline-secondary" href="/index.html">Back to Portal</a>
      </div>`;
  };

  // Wait up to maxMs for window._auth to exist (auth.js init), polling every stepMs
  const waitForMsal = async (maxMs = 10000, stepMs = 120) => {
    const start = Date.now();
    while (!(window._auth && typeof window._auth.getAllAccounts === 'function')) {
      if (Date.now() - start > maxMs) return false;
      await new Promise(r => setTimeout(r, stepMs));
    }
    return true;
  };

  try {
    // 1) Ensure MSAL instance exists (from /js/auth.js)
    const hasMsal = await waitForMsal();
    if (!hasMsal) {
      console.warn('[Resources] MSAL instance not found after wait. Cannot confirm sign-in.');
      show403('Authentication not initialized. Please open Events Admin first or contact IT.');
      return;
    }

    // 2) Reuse existing account if present
    let account = window._auth.getActiveAccount() || window._auth.getAllAccounts()?.[0] || null;

    // Try silent acquire first to refresh cache (no popup)
    if (!account) {
      try {
        const silent = await window._auth.acquireTokenSilent?.({ scopes: ['User.Read'] });
        account = silent?.account || window._auth.getAllAccounts()?.[0] || null;
      } catch (_) { /* ignore and try interactive below */ }
    }

    // 3) If still nothing, do an interactive sign-in
    if (!account) {
      try {
        const loginResp = await window._auth.signIn(['User.Read']);
        account = loginResp?.account || null;
        if (account) window._auth.setActiveAccount(account);
      } catch (e) {
        console.warn('[Resources] Login popup aborted or blocked:', e);
        show403('Sign-in is required to access Resources Admin.');
        return;
      }
    }

    // 4) Enforce internal domains
    const email = (account && (account.username ||
      (account.idTokenClaims && (account.idTokenClaims.email || account.idTokenClaims.preferred_username)))) || '';
    if (!email) { show403('Could not determine your email.'); return; }
    const domain = (email.split('@')[1] || '').toLowerCase();
    if (!INTERNAL_DOMAINS.includes(domain)) {
      show403(`Your account (${email}) is not an internal staff mailbox.`);
      return;
    }

    // 5) Unlock the UI
    authGate.classList.add('d-none');
    appWrap.classList.remove('d-none');
  } catch (err) {
    const msg = (err && (err.message || String(err))) || '';
    // Swallow extension noise if present
    if (msg.includes('A listener indicated an asynchronous response')) {
      console.warn('[Resources] Extension message issue suppressed.');
      authGate.classList.add('d-none');
      appWrap.classList.remove('d-none');
      return;
    }
    console.error('[Resources] Fatal init error:', err);
    show403('Initialization failed. Please refresh or contact IT.');
  }
})();

/*************************************************
 *  FIRESTORE: Auto-detect collection name
 *************************************************/
let RES_COL = 'event_resources'; // default
const CANDIDATE_COLLECTIONS = ['event_resources', 'resources']; // try in this order
const db = () => firebase.firestore();

async function resolveResourcesCollection() {
  for (const name of CANDIDATE_COLLECTIONS) {
    try {
      const snap = await db().collection(name).limit(1).get();
      if (!snap.empty) {
        console.info(`[resources_admin] Using collection "${name}" (found ${snap.size} doc in probe).`);
        RES_COL = name;
        return;
      }
    } catch (e) {
      console.warn(`[resources_admin] Probe failed for "${name}":`, e?.message || e);
    }
  }
  console.info(`[resources_admin] No docs found in ${CANDIDATE_COLLECTIONS.join(' / ')}. Defaulting to "${RES_COL}".`);
}
function resColRef() { return db().collection(RES_COL); }

/*************************************************
 *  UI Elements
 *************************************************/
const resTBody         = document.getElementById('resTBody');
const btnNewRes        = document.getElementById('btnNewRes');
const btnResetForm     = document.getElementById('btnResetForm');
const btnSaveRes       = document.getElementById('btnSaveRes');
const saveBusy         = document.getElementById('saveBusy');
const saveMsg          = document.getElementById('saveMsg');
const resDocId         = document.getElementById('resDocId');

const r_id             = document.getElementById('r_id');
const r_name           = document.getElementById('r_name');
const r_branch         = document.getElementById('r_branch');
const r_address        = document.getElementById('r_address');
const r_capacity       = document.getElementById('r_capacity');
const r_displayOrder   = document.getElementById('r_displayOrder');
const r_mapsUrl        = document.getElementById('r_mapsUrl');
const r_mapPreview     = document.getElementById('r_mapPreview');
const r_mapHint        = document.getElementById('r_mapHint');
const r_isActive       = document.getElementById('r_isActive');

/*************************************************
 *  Google Maps helpers
 *************************************************/
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
      const text = q || address || u.pathname.replace('/maps','').replace(/\/*$/,'').replaceAll('/',' ').trim();
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

/*************************************************
 *  List (client-side sort; no index required)
 *************************************************/
async function loadResourcesList() {
  resTBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">Loading…</td></tr>';
  try {
    await resolveResourcesCollection(); // decide which collection to use

    const snap = await resColRef().get(); // simple get
    const items = [];
    snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
    console.info(`[resources_admin] Loaded ${items.length} resources from "${RES_COL}".`);

    // sort: displayOrder ASC, then name ASC
    items.sort((a, b) => {
      const ao = a.displayOrder ?? 0, bo = b.displayOrder ?? 0;
      if (ao !== bo) return ao - bo;
      const an = (a.name || '').toLowerCase(), bn = (b.name || '').toLowerCase();
      return an.localeCompare(bn);
    });

    if (!items.length) {
      resTBody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center text-muted py-4">
            No resources found in <code>${RES_COL}</code>.<br>
            Click <strong>New Resource</strong> to add your first one.
          </td>
        </tr>`;
      return;
    }

    let i = 0;
    resTBody.innerHTML = items.map(d => `
      <tr data-id="${d.id}">
        <td>${++i}</td>
        <td>${d.name || ''}</td>
        <td>${d.branch || ''}</td>
        <td>${d.address || ''}</td>
        <td class="text-end">${d.capacity ?? 0}</td>
        <td class="text-center">${d.isActive ? '<span class="badge text-bg-success">Yes</span>' : '<span class="badge text-bg-secondary">No</span>'}</td>
        <td class="text-end">${d.displayOrder ?? 0}</td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary" data-act="edit"><i class="bi bi-pencil-square"></i></button>
            <button class="btn btn-outline-danger" data-act="del"><i class="bi bi-trash"></i></button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    console.error(e);
    resTBody.innerHTML = '<tr><td colspan="8" class="text-danger py-4">Failed to load resources.</td></tr>';
  }
}
document.addEventListener('DOMContentLoaded', loadResourcesList);

/*************************************************
 *  Row actions
 *************************************************/
resTBody.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button'); if (!btn) return;
  const tr = btn.closest('tr'); const id = tr?.dataset?.id; if (!id) return;
  const act = btn.dataset.act;

  if (act === 'edit') {
    await fillForm(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (act === 'del') {
    if (!confirm('Delete this resource? This cannot be undone.')) return;
    try {
      await resColRef().doc(id).delete();
      await loadResourcesList();
      showSaveMsg('Resource deleted.', 'success');
      resetForm();
    } catch (e) {
      showSaveMsg('Delete failed: ' + (e.message || e), 'danger');
    }
  }
});

/*************************************************
 *  Form helpers
 *************************************************/
function showSaveMsg(text, type='success') {
  saveMsg.className = `small mt-2 alert alert-${type}`;
  saveMsg.textContent = text;
  saveMsg.classList.remove('d-none');
  setTimeout(() => saveMsg.classList.add('d-none'), 2500);
}
function resetForm() {
  r_id.value = '';
  resDocId.textContent = '';
  r_name.value = '';
  r_branch.value = '';
  r_address.value = '';
  r_capacity.value = '0';
  r_displayOrder.value = '0';
  r_mapsUrl.value = '';
  r_isActive.checked = true;
  updateMapPreview('', '');
}
btnResetForm?.addEventListener('click', resetForm);
btnNewRes?.addEventListener('click', () => { resetForm(); r_name.focus(); });

async function fillForm(id) {
  try {
    await resolveResourcesCollection();
    const doc = await resColRef().doc(id).get();
    if (!doc.exists) throw new Error('Not found');
    const d = doc.data();
    r_id.value = doc.id; resDocId.textContent = `# ${doc.id}`;
    r_name.value = d.name || '';
    r_branch.value = d.branch || '';
    r_address.value = d.address || '';
    r_capacity.value = d.capacity ?? 0;
    r_displayOrder.value = d.displayOrder ?? 0;
    r_isActive.checked = !!d.isActive;
    r_mapsUrl.value = d.mapsUrl || '';
    updateMapPreview(d.mapsEmbedUrl || '', d.mapsUrl || '');
  } catch (e) {
    showSaveMsg('Load failed: ' + (e.message || e), 'danger');
  }
}

/*************************************************
 *  Save
 *************************************************/
btnSaveRes?.addEventListener('click', async () => {
  saveMsg.classList.add('d-none');
  saveBusy.classList.remove('d-none');

  try {
    await resolveResourcesCollection();

    if (!r_name.value.trim()) throw new Error('Name is required.');
    if (!r_branch.value) throw new Error('Branch is required.');
    if (!r_address.value.trim()) throw new Error('Address is required.');

    const capacity = parseInt(r_capacity.value || '0', 10) || 0;
    const displayOrder = parseInt(r_displayOrder.value || '0', 10) || 0;
    const { mapsUrl, mapsEmbedUrl } = normalizeMapsUrl(r_mapsUrl.value, r_address.value);

    const payload = {
      name: r_name.value.trim(),
      branch: r_branch.value,
      address: r_address.value.trim(),
      capacity,
      displayOrder,
      isActive: !!r_isActive.checked,
      mapsUrl: mapsUrl || '',
      mapsEmbedUrl: mapsEmbedUrl || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    const id = r_id.value;
    if (id) {
      await resColRef().doc(id).set(payload, { merge: true });
      showSaveMsg('Resource updated.', 'success');
    } else {
      const docRef = await resColRef().add({
        ...payload,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      r_id.value = docRef.id;
      resDocId.textContent = `# ${docRef.id}`;
      showSaveMsg('Resource created.', 'success');
    }

    await loadResourcesList();
  } catch (e) {
    showSaveMsg(e.message || 'Save failed.', 'danger');
  } finally {
    saveBusy.classList.add('d-none');
  }
});
