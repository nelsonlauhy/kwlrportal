// /js/include.js
(function () {
  async function loadPartials() {
    const nodes = document.querySelectorAll("[data-include]");
    const tasks = Array.from(nodes).map(async (el) => {
      const url = el.getAttribute("data-include");
      if (!url) return;

      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        const html = await res.text();
        el.innerHTML = html;
      } catch (e) {
        console.error("Failed to include:", url, e);
      }
    });

    await Promise.all(tasks);
    document.dispatchEvent(new CustomEvent("partials:loaded"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadPartials, { once: true });
  } else {
    loadPartials();
  }
})();

