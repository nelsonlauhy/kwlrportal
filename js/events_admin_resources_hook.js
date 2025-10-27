// /js/events_admin_resources_hook.js
(function () {
  const CANDIDATE_COLLECTIONS = ['event_resources', 'resources']; // try both
  const db = () => firebase.firestore();
  let RES_COL = 'event_resources';

  async function resolveResourcesCollection() {
    for (const name of CANDIDATE_COLLECTIONS) {
      try {
        const snap = await db().collection(name).limit(1).get();
        if (!snap.empty) {
          console.info(`[events_hook] Using collection "${name}" for resource dropdown.`);
          RES_COL = name;
          return;
        }
      } catch (e) {
        console.warn(`[events_hook] Probe failed for "${name}":`, e?.message || e);
      }
    }
    console.info(`[events_hook] No docs found; defaulting to "${RES_COL}".`);
  }

  async function populateEventResourceSelect() {
    const select = document.getElementById('f_resourceId');
    const nameBox = document.getElementById('f_resourceName');
    const capBox  = document.getElementById('f_capacity');
    if (!select) return;

    select.innerHTML = '<option value="">-- Select Resource --</option>';

    try {
      await resolveResourcesCollection();
      const snap = await db().collection(RES_COL).get();
      const items = [];
      snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));

      const active = items.filter(x => !!x.isActive);

      // sort by displayOrder asc, then name asc
      active.sort((a, b) => {
        const ao = a.displayOrder ?? 0, bo = b.displayOrder ?? 0;
        if (ao !== bo) return ao - bo;
        const an = (a.name || '').toLowerCase(), bn = (b.name || '').toLowerCase();
        return an.localeCompare(bn);
      });

      console.info(`[events_hook] Loaded ${active.length} active resources from "${RES_COL}".`);

      active.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = `${d.name || ''} — ${d.branch || ''}`;
        opt.dataset.capacity = d.capacity ?? 0;
        opt.dataset.name = d.name || '';
        select.appendChild(opt);
      });

      select.addEventListener('change', () => {
        const opt = select.selectedOptions[0];
        if (!opt) return;
        const cap = parseInt(opt.dataset.capacity || '0', 10) || 0;
        const name= opt.dataset.name || '';
        if (nameBox) nameBox.value = name;
        if (capBox && (!capBox.value || capBox.value === '0')) capBox.value = String(cap);
      });
    } catch (e) {
      console.warn('[events hook] load resources failed:', e);
    }
  }

  document.addEventListener('DOMContentLoaded', populateEventResourceSelect);
})();
