// include.js (hardened partial loader)
// - Replaces any element with data-include="path/to/file.html" with the fetched HTML
// - Works with relative ("./partials/x.html") and absolute ("/partials/x.html") URLs
// - Never fails silently: it will render a visible error message on failure
// - Re-initializes Bootstrap JS components inside the injected partial

(function () {
  function resolveUrl(attr) {
    if (!attr) return null;
    try {
      // If it's already absolute (http/https), keep it
      if (/^https?:\/\//i.test(attr)) return attr;
      // If it starts with "/", use same origin
      if (attr.startsWith("/")) return window.location.origin + attr;
      // Otherwise resolve relative to current page
      const base = new URL(window.location.href);
      return new URL(attr, base).toString();
    } catch (e) {
      console.warn("[include] URL resolve error for:", attr, e);
      return null;
    }
  }

  async function fetchText(url) {
    const isDev = !/^https?:\/\//.test(window.location.origin) || window.location.hostname === "localhost";
    const bust = isDev ? (url.includes("?") ? "&" : "?") + "v=" + Date.now() : "";
    const finalUrl = url + bust;
    const resp = await fetch(finalUrl, { credentials: "same-origin" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  }

  function initBootstrapInside(root) {
    // Re-init Bootstrap dropdowns/collapse if your navbar uses them
    try {
      if (window.bootstrap && root.querySelectorAll) {
        // Dropdowns
        root.querySelectorAll('[data-bs-toggle="dropdown"]').forEach((el) => {
          // eslint-disable-next-line no-new
          new bootstrap.Dropdown(el);
        });
        // Collapses (e.g., navbar toggler)
        root.querySelectorAll('.collapse').forEach((el) => {
          // eslint-disable-next-line no-new
          new bootstrap.Collapse(el, { toggle: false });
        });
      }
    } catch (e) {
      console.warn("[include] bootstrap init skipped:", e);
    }
  }

  async function processIncludes() {
    const nodes = Array.from(document.querySelectorAll("[data-include]"));
    if (!nodes.length) return;

    await Promise.all(
      nodes.map(async (node) => {
        const srcAttr = node.getAttribute("data-include");
        const url = resolveUrl(srcAttr);
        if (!url) {
          node.outerHTML = `<div class="alert alert-danger m-2">Invalid include path: <code>${srcAttr}</code></div>`;
          return;
        }
        try {
          const html = await fetchText(url);
          // Inject
          node.innerHTML = html;

          // Allow nested includes (one level deep is usually enough)
          const nested = node.querySelectorAll("[data-include]");
          if (nested.length) {
            // Process nested after this tick to avoid recursion pitfalls
            setTimeout(processIncludes, 0);
          }

          // Re-init bootstrap components in the injected markup
          initBootstrapInside(node);

        } catch (err) {
          console.error("[include] failed:", url, err);
          node.outerHTML = `
            <div class="container">
              <div class="alert alert-warning my-2">
                <strong>Navbar failed to load</strong> from <code>${srcAttr}</code>.
                <div class="small text-muted">Error: ${String(err.message || err)}</div>
              </div>
            </div>`;
        }
      })
    );
  }

  // Run after DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", processIncludes);
  } else {
    processIncludes();
  }
})();


