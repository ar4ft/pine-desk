const paths = {
  workspace: '<path d="M4 19h16M5 14l4-5 4 3 6-8"/>',
  library:
    '<rect x="4" y="4" width="6" height="7" rx="1"/><rect x="14" y="4" width="6" height="7" rx="1"/><rect x="4" y="15" width="6" height="5" rx="1"/><rect x="14" y="15" width="6" height="5" rx="1"/>',
  backtest: '<path d="M4 19h16M5 15l4-4 4 2 6-8M15 5h4v4"/>',
  orderflow: '<path d="M4 6h11M4 12h16M4 18h8M18 4v4M15 16v4"/>',
  mcp: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
  edge: '<path d="M19 4H6l7 8-7 8h13"/>',
  whale: '<path d="M4 16c3-8 5 4 8-4s5 4 8-5M4 20h16"/>',
  options: '<path d="M4 7h16M4 17h16M8 4v6M16 14v6"/>',
  crypto:
    '<path d="M12 3l7 4v10l-7 4-7-4V7zM12 3v18M5 7l7 4 7-4M5 17l7-4 7 4"/>',
  education: '<path d="M3 8l9-4 9 4-9 4zM6 10v7c4 3 8 3 12 0v-7M21 8v8"/>',
  settings:
    '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M10 4H4v16h16v-6"/>',
  focus: '<path d="M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4"/>',
};
export function uiIcon(name) {
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.workspace}</svg>`;
}
export const navGroups = [
  ["Markets", ["workspace", "orderflow", "options", "crypto"]],
  ["Research", ["backtest", "library", "edge", "whale", "education"]],
  ["Connections", ["mcp", "settings"]],
];
