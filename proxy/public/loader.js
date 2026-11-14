// dokploy-ext loader : ajoute les modules au menu de Dokploy et affiche leur panneau.
// Si l'interface de Dokploy change et que le menu est introuvable, un bouton flottant
// prend le relais. En cas d'erreur, Dokploy continue de fonctionner normalement.
(() => {
  if (window.__dokployExt) return;
  window.__dokployExt = true;

  const tr = (_fr, en) => en;
  // Version of this loader (?v= on its script tag), used to key module URLs and spot updates.
  const LOADED = document.currentScript ? new URL(document.currentScript.src).searchParams.get("v") : null;
  const ALL_MODULES = [
    {
      id: "storage",
      title: tr("Stockage", "Storage"),
      src: "/_ext/static/modules/storage.js",
      requires: "storage",
      icon: '<path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>',
    },
    {
      id: "cloudflare",
      title: "Cloudflare",
      src: "/_ext/static/modules/cloudflare.js",
      icon: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
      requires: "cloudflare",
    },
  ];
  ALL_MODULES.push({ id: "pihole", title: "Pi-hole", src: "/_ext/static/modules/pihole.js", requires: "pihole", icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>' });
  ALL_MODULES.push({ id: "settings", title: "Settings", src: "/_ext/static/modules/settings.js", requires: "settings", icon: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>' });
  ALL_MODULES.unshift({ id: "dashboard", title: "Dashboard", src: "/_ext/static/modules/dashboard.js", icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' });
  ALL_MODULES.push({id:"operations", title:"Operations", src:"/_ext/static/modules/operations.js", icon:'<path d="M3 12h4l3-8 4 16 3-8h4"/>'});
  let MODULES = [];
  const HASH = (id) => `#ext-${id}`;
  const svg = (inner, cls = "") =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${cls}">${inner}</svg>`;

  let current = null; // { id, host, unmount, ro }
  let menuSeen = false;

  // ---------------------------------------------------------------- menu
  function findMenu() {
    const groups = [...document.querySelectorAll('[data-sidebar="group"]')];
    const home =
      groups.find((g) => g.querySelector('[data-sidebar="group-label"]')?.textContent.trim() === "Home") || groups[0];
    return home?.querySelector('[data-sidebar="menu"]') || null;
  }

  function ensureMenu() {
    const menu = findMenu();
    if (!menu) return;
    menuSeen = true;
    document.getElementById("dokploy-ext-fab")?.remove();
    for (const m of MODULES) {
      let item = menu.querySelector(`[data-ext-item="${m.id}"]`);
      if (!item) {
        const tpl = menu.querySelector('[data-sidebar="menu-item"]');
        if (!tpl) return;
        item = tpl.cloneNode(true);
        item.dataset.extItem = m.id;
        const link = item.querySelector('[data-sidebar="menu-button"]') || item.querySelector("a");
        if (!link) return;
        // garde les classes de Dokploy, remplace le contenu
        const iconCls = (link.querySelector("svg")?.getAttribute("class") || "").replace(/\btext-primary\b/g, "");
        link.classList.remove("bg-border");
        link.removeAttribute("data-active");
        if (link.tagName === "A") link.setAttribute("href", HASH(m.id));
        link.innerHTML = `${svg(m.icon, iconCls)}<span>${m.title}</span>`;
        link.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          open(m.id);
        });
        menu.appendChild(item);
      }
      let n = item.nextElementSibling;
      while (n && (n.dataset.extItem || n.dataset.extLanguage)) n = n.nextElementSibling;
      if (n) menu.appendChild(item); // une entrée Dokploy est passée après : on redescend
      const link = item.querySelector('[data-sidebar="menu-button"]') || item.querySelector("a");
      if (m.id === "settings" && link && updateAvailable && !link.querySelector("[data-ext-badge]")) {
        const dot = document.createElement("span");
        dot.dataset.extBadge = "1";
        dot.title = "Update available";
        dot.setAttribute("aria-label", "Update available");
        dot.style.cssText = "margin-left:auto;width:8px;height:8px;border-radius:9999px;background:var(--primary);flex:none";
        link.appendChild(dot);
      }
      const on = current?.id === m.id;
      link?.classList.toggle("bg-border", on);
      link?.querySelector("svg")?.classList.toggle("text-primary", on);
    }
    // Entrée active de Dokploy : éteinte tant qu'un module est ouvert, rallumée ensuite.
    const sidebar = menu.closest('[data-sidebar="sidebar"]') || document;
    if (current) {
      sidebar.querySelectorAll('[data-sidebar="menu-button"].bg-border').forEach((b) => {
        if (b.closest("[data-ext-item]")) return;
        b.classList.remove("bg-border");
        b.dataset.extWasActive = "1";
        const svg = b.querySelector("svg.text-primary");
        if (svg) { svg.classList.remove("text-primary"); svg.dataset.extWasPrimary = "1"; }
      });
    } else {
      sidebar.querySelectorAll('[data-ext-was-active]').forEach((b) => { b.classList.add("bg-border"); delete b.dataset.extWasActive; });
      sidebar.querySelectorAll('[data-ext-was-primary]').forEach((v) => { v.classList.add("text-primary"); delete v.dataset.extWasPrimary; });
    }
  }

  function ensureFab() {
    if (menuSeen || document.getElementById("dokploy-ext-fab")) return;
    const b = document.createElement("button");
    b.id = "dokploy-ext-fab";
    b.title = tr("Modules Dokploy Plus", "Dokploy Plus modules");
    b.innerHTML = svg(MODULES[0].icon);
    Object.assign(b.style, {
      position: "fixed", right: "16px", bottom: "16px", zIndex: 60, width: "44px", height: "44px",
      borderRadius: "999px", border: "1px solid var(--x-border)", background: "var(--x-card)",
      color: "var(--x-fg)", display: "grid", placeItems: "center", cursor: "pointer",
    });
    b.querySelector("svg").style.width = "20px";
    applyPalette(b);
    b.onclick = () => (current ? close() : open(MODULES[0].id));
    document.body.appendChild(b);
  }

  // ---------------------------------------------------------------- couleurs
  // On lit les couleurs calculées des classes Tailwind de Dokploy (quel que soit leur format :
  // hsl, oklch…) et on les passe aux modules en variables --x-*.
  const PROBES = {
    bg: ["bg-background", "backgroundColor"], fg: ["text-foreground", "color"],
    card: ["bg-card", "backgroundColor"], "card-fg": ["text-card-foreground", "color"],
    muted: ["bg-muted", "backgroundColor"], "muted-fg": ["text-muted-foreground", "color"],
    border: ["border border-border", "borderTopColor"], primary: ["bg-primary", "backgroundColor"],
    destructive: ["bg-destructive", "backgroundColor"],
  };
  const transparent = (c) => !c || c === "transparent" || /^rgba\(.*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
  function palette() {
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;left:-9999px";
    document.body.appendChild(probe);
    const p = {};
    for (const [k, [cls, prop]] of Object.entries(PROBES)) {
      probe.className = cls;
      const c = getComputedStyle(probe)[prop];
      if (!transparent(c)) p[k] = c;
    }
    probe.remove();
    const dark = document.documentElement.classList.contains("dark");
    p.bg ??= getComputedStyle(document.body).backgroundColor || (dark ? "#000" : "#fff");
    p.fg ??= getComputedStyle(document.body).color || (dark ? "#fafafa" : "#0a0a0a");
    p.card ??= p.bg; p["card-fg"] ??= p.fg; p.muted ??= p.card;
    p["muted-fg"] ??= dark ? "#a1a1aa" : "#71717a"; p.border ??= dark ? "#27272a" : "#e4e4e7";
    p.primary ??= p.fg; p.destructive ??= "#dc2626";
    return p;
  }
  function applyPalette(el) {
    if (!el) return;
    for (const [k, v] of Object.entries(palette())) el.style.setProperty(`--x-${k}`, v);
  }
  // changement de thème clair / sombre
  new MutationObserver(() => {
    applyPalette(document.getElementById("dokploy-ext-fab"));
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });

  // ---------------------------------------------------------------- page du module
  // Le module s'affiche à la place du contenu de la page Dokploy (même conteneur, même
  // en-tête et même défilement) et utilise directement les classes shadcn/Tailwind de Dokploy.
  // Repli : panneau superposé si la structure de la page n'est pas reconnue.
  function mainArea() {
    return document.querySelector('main[data-slot="sidebar-inset"]') || document.querySelector("main");
  }
  function contentArea(main) {
    if (!main) return null;
    const kids = [...main.children].filter((e) => e.tagName === "DIV" && e.id !== "dokploy-ext-page");
    return kids.reverse().find((e) => e.classList.contains("flex-col") && e.classList.contains("w-full")) || null;
  }
  function breadcrumb(main) {
    const links = main?.querySelectorAll('header [data-slot="breadcrumb-link"], header nav[aria-label="breadcrumb"] a');
    return links?.length ? links[links.length - 1] : null;
  }

  async function open(id) {
    const m = MODULES.find((x) => x.id === id);
    if (!m) return;
    if (current?.id === id) return;
    close();
    const main = mainArea();
    const content = contentArea(main);
    const host = document.createElement("div");
    host.id = "dokploy-ext-page";
    host.dataset.extModule = id;
    current = { id, host, unmount: null, content, crumb: null, crumbText: null, prevScroll: main?.scrollTop || 0 };
    if (content) {
      host.className = content.className; // même marges que le conteneur de Dokploy
      content.style.display = "none";
      content.after(host);
      if (main) main.scrollTop = 0;
      const crumb = breadcrumb(main);
      if (crumb) {
        const textNode = [...crumb.childNodes].reverse().find((n) => n.nodeType === 3 && n.textContent.trim());
        if (textNode) { current.crumb = textNode; current.crumbText = textNode.textContent; textNode.textContent = m.title; }
      }
    } else {
      host.className = "bg-background text-foreground p-4";
      Object.assign(host.style, { position: "fixed", inset: "0", zIndex: 40, overflow: "auto" });
      document.body.appendChild(host);
    }
    history.replaceState(history.state, "", location.pathname + location.search + HASH(id));
    ensureMenu();
    try {
      const mod = await import(`${m.src}?v=${encodeURIComponent(LOADED || Date.now())}`);
      if (current?.host !== host) return;
      current.unmount = mod.mount(host, { api: (p, options = {}) => fetch(`/_ext/api${p}`, { ...options, credentials: "same-origin" }) });
    } catch (e) {
      // A tab opened before an update still runs the previous loader: its modules may be gone.
      let live = null;
      try { live = (await (await fetch("/_ext/health", { cache: "no-store" })).json()).version; } catch {}
      if (current?.host !== host) return;
      if (live && LOADED && live !== LOADED) {
        host.textContent = `Dokploy Plus was updated to ${live}. Reload the page to continue. `;
        const reload = document.createElement("button");
        reload.type = "button";
        reload.textContent = "Reload";
        reload.className = "underline font-medium";
        reload.onclick = () => location.reload();
        host.appendChild(reload);
      } else host.textContent = `${tr("Module indisponible", "Module unavailable")} (${m.title}): ${String(e.message || e)}`;
    }
  }

  function close() {
    if (!current) return;
    const c = current;
    current = null;
    try { c.unmount?.(); } catch {}
    c.host.remove();
    if (c.content) c.content.style.display = "";
    if (c.crumb && c.crumb.isConnected && c.crumb.textContent !== c.crumbText) c.crumb.textContent = c.crumbText;
    if (location.hash.startsWith("#ext-")) history.replaceState(history.state, "", location.pathname + location.search);
    ensureMenu();
  }

  // Changement de page dans Dokploy -> on ferme le panneau.
  for (const fn of ["pushState", "replaceState"]) {
    const orig = history[fn];
    history[fn] = function (state, title, url) {
      const before = location.pathname;
      const r = orig.apply(this, arguments);
      if (location.pathname !== before) {
        if (current) close();
        if (!started) start(); // ex. : connexion faite sans recharger la page
      }
      return r;
    };
  }
  window.addEventListener("popstate", () => current && !location.hash.startsWith("#ext-") && close());
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.('[data-sidebar="sidebar"] a[href]');
    if (current && a && !a.closest("[data-ext-item]")) close();
  }, true);

  // ---------------------------------------------------------------- démarrage
  let started = false;
  let checking = false;
  let updateAvailable = false;
  async function start() {
    if (started || checking) return;
    checking = true;
    let me;
    try {
      me = await (await fetch("/_ext/api/me", { credentials: "same-origin" })).json();
    } catch { checking = false; return; }
    checking = false;
    if (!me?.allowed) return;
    started = true;
    MODULES = ALL_MODULES.filter((m) => !m.requires || me.modules?.[m.requires]);
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; ensureMenu(); });
    }).observe(document.body, { childList: true, subtree: true });
    ensureMenu();
    setTimeout(ensureFab, 8000);
    // Owner only: a dot on Settings when a newer release exists (checked server-side, cached 6 h).
    if (me.owner) fetch("/_ext/api/update", { credentials: "same-origin" }).then((r) => r.json()).then((u) => { if (u.available) { updateAvailable = true; ensureMenu(); } }).catch(() => {});
    const fromHash = MODULES.find((m) => location.hash === HASH(m.id));
    if (fromHash) open(fromHash.id);
    // In-page links such as <a href="#ext-settings"> open the module.
    window.addEventListener("hashchange", () => {
      const m = MODULES.find((x) => location.hash === HASH(x.id));
      if (m && current?.id !== m.id) open(m.id);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
