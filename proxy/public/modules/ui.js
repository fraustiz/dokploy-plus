// Shared building blocks for Dokploy Plus modules: Dokploy's shadcn/ui class names (v0.31),
// lucide icons, and a tiny i18n helper (French or English, from the browser language).
// Match the official Dokploy dashboard language.
const LANG = "en";
const LOCALE = "en-US";
const t = (_fr, en) => en;
// ------------------------------------------------------------------ classes shadcn (Dokploy v0.31)
const C = {
  page: "w-full",
  outer: "group/card flex flex-col text-sm text-card-foreground ring-1 ring-foreground/10 h-full bg-sidebar p-2.5 rounded-xl",
  inner: "rounded-xl bg-background shadow-md",
  header: "group/card-header @container/card-header grid auto-rows-min items-start gap-1.5 rounded-t-xl p-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto]",
  title: "font-heading leading-snug font-medium text-xl flex flex-row gap-2",
  titleIcon: "size-6 text-muted-foreground self-center",
  desc: "text-sm text-muted-foreground",
  action: "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
  content: "p-6 space-y-2 py-8 border-t",
  card: "group/card flex flex-col rounded-xl bg-card text-sm text-card-foreground ring-1 ring-foreground/10",
  cardHeader: "group/card-header @container/card-header grid auto-rows-min items-start gap-1.5 rounded-t-xl p-6",
  cardTitle: "font-heading text-base leading-snug font-medium",
  cardContent: "p-6 pt-0",
  btnOutlineSm: "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 border-border bg-background hover:bg-muted hover:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50 h-9 gap-1.5 px-3",
  badge: "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-all",
  badgeV: {
    outline: "border-border text-foreground",
    secondary: "border-transparent bg-secondary text-secondary-foreground",
    green: "border-transparent select-none items-center whitespace-nowrap font-medium bg-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-500 text-emerald-600 text-xs h-4 px-1 py-1 rounded-md",
    orange: "border-transparent select-none items-center whitespace-nowrap font-medium bg-orange-600/20 dark:bg-orange-500/15 dark:text-orange-500 text-orange-600 text-xs h-4 px-1 py-1 rounded-md",
    yellow: "border-transparent select-none items-center whitespace-nowrap font-medium bg-yellow-600/20 dark:bg-yellow-500/15 dark:text-yellow-500 text-yellow-600 text-xs h-4 px-1 py-1 rounded-md",
    red: "border-transparent select-none items-center whitespace-nowrap font-medium bg-red-600/20 dark:bg-red-500/15 text-destructive text-xs h-4 px-1 py-1 rounded-md",
    blank: "border-transparent select-none items-center whitespace-nowrap font-medium dark:bg-white/15 bg-black/15 text-foreground text-xs h-4 px-1 py-1 rounded-md",
  },
  alert: {
    warning: "flex items-start flex-row gap-4 rounded-lg p-2 bg-orange-50 dark:bg-orange-950 text-orange-600 dark:text-orange-400",
    error: "flex items-start flex-row gap-4 rounded-lg p-2 bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400",
    info: "flex items-start flex-row gap-4 rounded-lg p-2 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400",
  },
  progress: "relative flex h-4 w-full items-center overflow-x-hidden rounded-full bg-muted",
  progressBar: "size-full flex-1 bg-primary transition-all",
  tableWrap: "rounded-md border",
  tableContainer: "relative w-full overflow-x-auto",
  table: "w-full caption-bottom text-sm",
  thead: "[&_tr]:border-b",
  tbody: "[&_tr:last-child]:border-0",
  tr: "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
  th: "h-12 px-4 text-left align-middle font-medium whitespace-nowrap text-foreground",
  td: "p-4 align-middle whitespace-nowrap",
  muted: "text-muted-foreground",
  small: "text-xs text-muted-foreground",
};

// ------------------------------------------------------------------ icônes lucide (comme Dokploy)
const ICON = {
  hardDrive: '<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  alertCircle: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  alertTriangle: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
};
const icon = (name, cls = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide ${cls}">${ICON[name]}</svg>`;

// ------------------------------------------------------------------ helpers
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const nf = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const badge = (v, text, extra = "") => `<span data-slot="badge" class="${C.badge} ${C.badgeV[v]} ${extra}">${text}</span>`;
const alertBlock = (type, html) => {
  const ic = { warning: "alertCircle", error: "alertTriangle", info: "info" }[type];
  return `<div class="${C.alert[type]}"><div class="shrink-0 mt-0.5">${icon(ic, "text-current size-4")}</div>
    <div class="flex-1 min-w-0"><span class="text-sm text-current">${html}</span></div></div>`;
};


// More components (button.tsx, tabs.tsx, input.tsx, select.tsx, switch.tsx, label.tsx, dialog.tsx, alert-dialog.tsx)
const BTN = "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";
Object.assign(C, {
  btnPrimary: `${BTN} bg-primary text-primary-foreground hover:bg-primary/80 h-10 gap-1.5 px-4 py-2`,
  btnOutline: `${BTN} border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50 h-10 gap-1.5 px-4 py-2`,
  btnDestructive: `${BTN} bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40 h-10 gap-1.5 px-4 py-2`,
  btnOutlineIcon: `${BTN} border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50 size-10`,
  btnGhostIcon: `${BTN} hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50 size-9 rounded-[min(var(--radius-md),12px)]`,
  tabsList: "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-1 text-muted-foreground h-10 bg-muted",
  tab: "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-3 py-1.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground data-active:shadow-sm",
  input: "h-10 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30",
  select: "flex w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 h-10 dark:bg-input/30 dark:hover:bg-input/50",
  label: "flex items-center gap-2 text-sm leading-none font-medium select-none",
  switch: "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[size=default]:h-5 data-[size=default]:w-9 data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80",
  switchThumb: "pointer-events-none block rounded-full bg-background ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=default]/switch:data-checked:translate-x-[18px] dark:data-checked:bg-primary-foreground group-data-[size=default]/switch:data-unchecked:translate-x-0 dark:data-unchecked:bg-foreground",
  overlay: "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs",
  dialog: "fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto overscroll-contain rounded-xl bg-popover p-6 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-lg",
  alertDialog: "group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-6 text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none max-w-[calc(100%-2rem)] sm:max-w-lg",
});
Object.assign(ICON, {
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  arrowUpRight: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  arrowDownRight: '<path d="m7 7 10 10"/><path d="M17 7v10H7"/>',
  grip: '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
  reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
});

export { C, ICON, icon, esc, nf, badge, alertBlock, t, LANG, LOCALE };
