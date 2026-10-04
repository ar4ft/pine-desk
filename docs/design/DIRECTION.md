# Pine Desk — optical bench

Self-authored brief, inferred from the existing app and the requested redesign. Pine Desk is a Mac research workspace for collecting market data, writing Pine scripts, studying strategies and learning options. Its first action is inspecting a chart or editing a strategy. It should feel precise, legible and calm. Existing features, provider connections, app name, saved content, chart tools and appearance controls are kept. No generated images, paid assets or replacement runtime are required.

This follows [App Designer](https://github.com/fortvna/app-designer) at the inspected revision recorded below, with desktop geometry, pointer targets and Mac conventions instead of iPhone chrome, haptics or SwiftUI. Source is not copied into the product. The repository has no declared license; only the method and temporary review tooling are used.

## Current app

The audit found competing utility panels before the chart, mixed Unicode/emoji navigation icons, small low-contrast labels, many nested boxes and a green accent that also carried market meaning. At 1440 × 1000, the chart began around y=730. Light mode left several component colours inherited from dark styles.

Keep: all eleven destinations; chart drawings/indicators; Pine editor and errors; data loading/live streams/import; strategies, saved results and MCP; providers and credential settings; options surfaces/history/replay; education; layouts and watchlists; system/light/dark appearance and custom candle colours. Lose: faux user-avatar decoration, inconsistent navigation glyphs, always-present public-catalog “LIVE” badge, utility panels above the core action. Mac system-font rendering and real-device motion are not assessed by Linux screenshots. Source and packaged Electron behavior are verified separately.

Navigation destinations are unchanged. Their grouping is now Markets, Research and Connections. Layout, watchlist and quality controls move below the chart. No feature is removed. Existing packaged app icon is preserved.

## Three rendered directions

See [explore.html](explore.html) and [exploration.png](exploration.png). All use actual synthetic demo candles, labeled as synthetic.

1. **Optical bench**: object family; charcoal ground; system display typography; amber selection/actions; layered instrument surfaces. Selected because the chart and editor are the product's working instruments.
2. **Market atlas**: printed family; ice-white ground; serif headings; carmine action; plotted map/rule language. Good for reports, but display serif is less suited to the everyday editing workspace.
3. **Marine observatory**: place family; cobalt colour field; rounded headings; white controls; immersive colour. Distinct, but the ground competes with financial chart semantics and consumes contrast headroom.

The old dark/grotesque/green UI differs from the selected object/dark/system-display/orange/material direction in concept family, display treatment, accent and richness. The screen's richness comes from the actual chart, optical curve controls, and material separation; there is no decorative photography or invented account balance.

## Tokens

| Role | Dark | Light |
| --- | --- | --- |
| Ground | #171a1f | #edf1f4 |
| Chrome | #1c2026 | #f5f7f9 |
| Raised surface | #20242b | #ffffff |
| Primary ink | #e9edf1 | #24313d |
| Secondary ink | #a7b0bc | #536373 |
| Quiet ink | #929eac | #657585 |
| Rule | #3d454f | #c9d2db |
| Action fill | #e9b56e | #e5ac61 |
| Accent ink | #e9b56e | #80520f |
| On action | #271b0b | #30210d |

Amber means action or selection. Green/red retain market direction, independently configurable candle colours, and real success/error meanings. The default candle colours render darker in light mode (#198467 / #bd4259); other user-selected values are used verbatim. Pricing-model curves use amber rather than implying returns.

SF/system text for native Mac controls, system display for prices/titles and SF Mono/ui-monospace for source and exact codes. Sizes: 11 metadata, 12 supporting controls, 13 body, 16 section, 23 model values, 25 instrument label, 32 primary price/title. Tabular figures for changing values. Desktop controls ≥34 px; navigation ≥38 px. Spacing uses 4/8/12/16/20/24/32; content margin 24, sidebar 204, radii 6 for controls and 8 for working panels. Dense desktop charts deliberately do not adopt a 96 px phone hero or 44 px mobile toolbar everywhere.

## Signature: Focus chart

Trigger: Focus chart button or Cmd/Ctrl + Shift + F. Editor, research step links and auxiliary tools recede; the existing chart expands without destruction or reloading. Selection feedback runs for 160 ms. Button becomes Exit focus; Escape restores the editor and tools. No Mac haptic is fabricated. Reduced motion removes the effect and retains the same state change. Source and chart DOM remain intact.

## Content

Keep live user content and imported source verbatim. Screens use the current synthetic demonstration: DEMO, 500 settled bars, 1h, last close 78,578.83, EMA crossover source; no provider connection is implied. Empty options screens explain Refresh chain; backtests use the existing empty/saved-run states. Credential fields show configuration state without values. Source timestamps and modelling warnings remain readable.
Inspected App Designer revision: `bd00d7273dbec878950f979f78b12f5166e29008`.
