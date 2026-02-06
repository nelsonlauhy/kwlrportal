(function () {
  const db = window.db;
  if (!db) {
    console.error('[events_admin_locations_vA] window.db missing. Check firebaseConfig.js');
    return;
  }

  // UI elements
  const locationFilter = document.getElementById('locationFilter');
  const f_resourceId   = document.getElementById('f_resourceId');
  const f_resourceName = document.getElementById('f_resourceName');
  const f_capacity     = document.getElementById('f_capacity');

  const f_newName      = document.getElementById('f_newLocationName');
  const wrapNew        = document.getElementById('newLocationDetailsWrap');
  const f_newAddress   = document.getElementById('f_newLocationAddress');
  const f_newOwners    = document.getElementById('f_newLocationOwners');
  const f_newMapsUrl   = document.getElementById('f_newLocationMapsUrl');
  const f_newMapsEmbed = document.getElementById('f_newLocationMapsEmbedUrl');

  // cache resources
  window.KWLR = window.KWLR || {};
  window.KWLR.resourceMap = new Map(); // id -> resource

  function addOpt(sel, value, text) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    sel.appendChild(o);
  }

  function toggleNewDetails() {
    if (!wrapNew || !f_newName) return;
    const typed = (f_newName.value || '').trim();
    if (typed) wrapNew.classList.remove('d-none');
    else wrapNew.classList.add('d-none');
  }

  async function loadResources() {
    // If you have a field like "name" in resources, orderBy works.
    // If some old docs missing "name", Firestore orderBy might fail.
    // If that’s a concern, remove orderBy and sort client-side.
    let snap;
    try {
      snap = await db.collection('resources').orderBy('name').get();
    } catch (e) {
      console.warn('[events_admin_locations_vA] orderBy(name) failed; fallback to unsorted get()', e);
      snap = await db.collection('resources').get();
    }

    const list = [];
    window.KWLR.resourceMap.clear();

    snap.forEach(doc => {
      const data = doc.data() || {};
      const name = (data.name || '').trim();
      if (!name) return;
      const item = { id: doc.id, ...data, name };
      window.KWLR.resourceMap.set(doc.id, item);
      list.push(item);
    });

    // client-side sort to ensure stable
    list.sort((a, b) => (a.name || '').localeCompare((b.name || ''), undefined, { sensitivity: 'base' }));

    // filter dropdown
    if (locationFilter) {
      locationFilter.querySelectorAll('option:not([value="ALL"])').forEach(o => o.remove());
      list.forEach(r => addOpt(locationFilter, r.name, r.name));
    }

    // modal dropdown
    if (f_resourceId) {
      f_resourceId.innerHTML = '';
      addOpt(f_resourceId, '', '-- Select --');
      list.forEach(r => addOpt(f_resourceId, r.id, r.name));
    }
  }

  // When choosing existing resource -> autofill name/capacity
  if (f_resourceId) {
    f_resourceId.addEventListener('change', () => {
      const id = f_resourceId.value;
      const r = window.KWLR.resourceMap.get(id);
      if (!r) {
        if (f_resourceName) f_resourceName.value = '';
        return;
      }
      if (f_resourceName) f_resourceName.value = r.name || '';
      if (f_capacity && r.capacity !== undefined && r.capacity !== null && r.capacity !== '') {
        f_capacity.value = r.capacity;
      }
    });
  }

  // Toggle details wrap
  if (f_newName && wrapNew) {
    f_newName.addEventListener('input', toggleNewDetails);
    toggleNewDetails();
  }

  // Expose a reload for other scripts
  window.KWLR.reloadResources = loadResources;

  /**
   * Ensure a resource exists before saving an event.
   * - If f_newLocationName has value => create resource (or reuse by exact name)
   * - Else => use selected f_resourceId
   *
   * Returns: { resourceId: string, resourceName: string }
   */
  window.KWLR.ensureResourceForEventSave = async function ensureResourceForEventSave() {
    const typedName = (f_newName && f_newName.value || '').trim();

    // 1) User typed a NEW location name -> create in resources
    if (typedName) {
      // Duplicate guard (exact match by name)
      // This avoids creating duplicates without adding new schema.
      const q = await db.collection('resources').where('name', '==', typedName).limit(1).get();
      if (!q.empty) {
        const doc = q.docs[0];
        const existing = doc.data() || {};
        if (f_resourceId) f_resourceId.value = doc.id;
        if (f_resourceName) f_resourceName.value = typedName;
        // clear new name after linking (optional)
        // f_newName.value = '';
        return { resourceId: doc.id, resourceName: typedName };
      }

      const curUser = (window.KWLR && window.KWLR.currentUser) || {};

      const payload = {
        name: typedName,
        address: (f_newAddress && f_newAddress.value || '').trim(),
        mapsUrl: (f_newMapsUrl && f_newMapsUrl.value || '').trim(),
        mapsEmbedUrl: (f_newMapsEmbed && f_newMapsEmbed.value || '').trim(),
        owners: ((f_newOwners && f_newOwners.value) || 'training@livingrealtykw.com').trim(),

        // keep existing schema fields you showed
        capacity: (f_capacity && f_capacity.value !== '' && !isNaN(Number(f_capacity.value))) ? Number(f_capacity.value) : null,
        requiresApproval: false,
        type: 'room',

        // Branch removed from user flow => leave blank (don’t break old data)
        branch: '',

        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: { name: curUser.name || '', email: curUser.email || '' }
      };

      const ref = await db.collection('resources').add(payload);

      // refresh dropdown cache & UI
      await loadResources();
      if (f_resourceId) f_resourceId.value = ref.id;
      if (f_resourceName) f_resourceName.value = typedName;

      return { resourceId: ref.id, resourceName: typedName };
    }

    // 2) Use existing selection
    const selectedId = (f_resourceId && f_resourceId.value) || '';
    if (selectedId) {
      const r = window.KWLR.resourceMap.get(selectedId);
      const nm = (r && r.name) ? r.name : (f_resourceName ? f_resourceName.value : '');
      if (f_resourceName) f_resourceName.value = nm || '';
      return { resourceId: selectedId, resourceName: nm || '' };
    }

    // 3) None
    if (f_resourceName) f_resourceName.value = '';
    return { resourceId: '', resourceName: '' };
  };

  // Init
  loadResources().catch(err => console.error('[events_admin_locations_vA] loadResources failed:', err));
})();
