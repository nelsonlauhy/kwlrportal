// /js/events_admin_resources_hook.js
(function () {
  const RES_COL = 'event_resources';
  const col = () => firebase.firestore().collection(RES_COL);

  async function populateEventResourceSelect() {
    const select = document.getElementById('f_resourceId');
    const nameBox = document.getElementById('f_resourceName');
    const capBox  = document.getElementById('f_capacity');
    if (!select) return;

    select.innerHTML = '<option value="">-- Select Resource --</option>';
    try {
      const snap = await col()
        .where('isActive','==', true)
        .orderBy('displayOrder','asc')
        .orderBy('name','asc')
        .get();

      snap.forEach(doc => {
        const d = doc.data();
        const opt = document.createElement('option');
        opt.value = doc.id;
        opt.textContent = `${d.name} — ${d.branch}`;
        opt.dataset.capacity = d.capacity ?? 0;
        opt.dataset.name = d.name || '';
        select.appendChild(opt);
      });

      // Autofill when user changes selection
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

  // Populate once DOM is ready
  document.addEventListener('DOMContentLoaded', populateEventResourceSelect);
})();
