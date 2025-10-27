// /js/events_admin_resources_hook.js
(function () {
  const RES_COL = 'event_resources';
  const col = () => firebase.firestore().collection(RES_COL);

  async function populateEventResourceSelect() {
    const select = document.getElementById('f_resourceId');
    const nameBox = document.getElementById('f_resourceName');
    const capBox  = document.getElementById('f_capacity');
    if (!select) return;

    // temporary option
    select.innerHTML = '<option value="">-- Select Resource --</option>';

    try {
      // Fetch all, then client-filter and client-sort to avoid composite indexes
      const snap = await col().get();
      const items = [];
      snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));

      // filter active only
      const active = items.filter(x => !!x.isActive);

      // sort by displayOrder asc, then name asc
      active.sort((a, b) => {
        const ao = a.displayOrder ?? 0, bo = b.displayOrder ?? 0;
        if (ao !== bo) return ao - bo;
        const an = (a.name || '').toLowerCase(), bn = (b.name || '').toLowerCase();
        return an.localeCompare(bn);
      });

      // populate
      active.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = `${d.name || ''} — ${d.branch || ''}`;
        opt.dataset.capacity = d.capacity ?? 0;
        opt.dataset.name = d.name || '';
        select.appendChild(opt);
      });

      // Auto-fill when user changes selection
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
