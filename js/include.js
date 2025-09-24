// /js/include.js — robust partial loader with path fallbacks & visible errors
(function () {
  const log = (...args) => console.log("[include]", ...args);

  function buildCandidates(srcAttr) {
    // If absolute http(s), just use it
    if (/^https?:\/\//i.test(srcAttr)) return [srcAttr];

    const path = srcAttr.trim();

    // Current page info
    const { pathname, origin } = window.location;

    const candidates = [];

    // 1) As provided (relative to current page)
    candidates.push(new URL(path, window.location.href).toString());

    // 2) Root-relative
    if (!path.startsWith("/")) {
      candidates.push(origin + (path.startsWith("./") ? path.slice(1) : "/" + path));
    } else {
      candidates.push(origin + path);
    }

    // 3) One-level up (../)
    const oneUp = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
    const parent1 = oneUp.substring(0, oneUp.lastIndexOf("/")) || "/";
    candidates.push(new URL(path.replace(/^\.\//, ""), origin + parent1 + "/").toString());

    // 4) Two-levels up (../../)
    const parent2 = parent1.substring(0, parent1.lastIndexOf("/")) || "/";
    candidates.push(new URL(path.replace(/^\.\//, ""), origin + parent2 + "/").toString());

    // De-dup
    return [...new Set(candidates)];
  }

  async function tryFetch(url) {
    try {
      const resp = await fetch(url, { credentials: "same-origin" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.text();
    } catch (e) {
      throw e;
    }
  }

  function initBootstrapInside(root) {
    if (!window.bootstrap || !root.querySelectorAll) return;
    try {
      root.querySelectorAll('[data-bs-toggle="dropdown"]').forEach((el) => new bootstrap.Dropdown(el));
      root.querySelectorAll(".collapse").forEach((el) => new bootstrap.Collapse(el, { toggle: false }));
    } catch (e) {
      log("bootstrap init skipped:", e);
    }
  }

  async function processNode(node) {
    const srcAttr = node.getAttribute("data-include");
    if (!srcAttr) return;

    const candidates = buildCandidates(srcAttr);
    log("attempting", srcAttr, "->", candidates);

    let html = null, used = null, lastErr = null;
    for (const url of candidates) {
      try {
        html = await tryFetch(url);
        used = url;
        log("loaded:", used);
        break;
      } catch (e) {
        lastErr = e;
        log("failed:", url, e.message || e);
      }
    }

    if (!html) {
      node.innerHTML = `
        <div class="container">
          <div class="alert alert-warning my-2">
            <strong>Partial failed to load:</strong> <code>${srcAttr}</code>
            <div class="small text-muted">Tried ${candidates.length} paths. Last error: ${String(lastErr && lastErr.message || lastErr)}</div>
          </div>
        </div>`;
      return;
    }

    node.innerHTML = html;
    node.setAttribute("data-include-loaded-from", used);

    // Nested includes (one pass is usually enough)
    const nested = node.querySelectorAll("[data-include]");
    if (nested.length) setTimeout(processIncludes, 0);

    initBootstrapInside(node);
  }

  async function processIncludes() {
    const nodes = Array.from(document.querySelectorAll("[data-include]"));
    await Promise.all(nodes.map(processNode));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", processIncludes);
  } else {
    processIncludes();
  }
})();
