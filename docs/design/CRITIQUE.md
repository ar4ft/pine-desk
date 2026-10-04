# Independent design critique

One critic reviewed both rounds using the [App Designer rubric](https://github.com/fortvna/app-designer/blob/main/app-designer/references/critique.md), adapted from iPhone conventions to a Mac desktop. The critic inspected each individual PNG rather than scoring the concept description. Original screenshots were supplied for comparison. Review date: October 4, 2026 (America/Cancun).

## Scores

| Axis | Round 1 | Round 2 | Round 2 evidence |
| --- | ---: | ---: | --- |
| Concept on the pixel | 3 | 3 | Coherent instrument surfaces; still reads as a general research terminal. |
| Not the category average | 3 | 3 | Amber chrome differentiates it; chart/editor/sidebar remain familiar. |
| Not the skill's average | 3 | 4 | Candles, source and model curves go beyond an austere ruled layout. |
| Hierarchy | 4 | 4 | Price/chart, education curve and Run strategy lead their screens. |
| Typography | 4 | 4 | Clear headings/prices against compact controls and exact figures. |
| Colour | 3 | 4 | Amber models and darker light candles clarify colour roles. |
| Richness | 3 | 4 | Actual chart, source and sensitivity curve supply visual substance. |
| Rhythm and space | 3 | 4 | Compact empty states, aligned chart/editor and spaced credentials. |
| Craft details | 2 | 4 | SVG glyphs, credential insets, readable zero and unobscured content. |
| Native fluency, Mac adaptation | 4 | 4 | Desktop controls, navigation and visible keyboard focus/exit hints. |
| Signature | 2 | 4 | Chart takes the editor's width; Exit focus/Escape show the return path. |
| The feature test | 3 | 3 | Practical screenshots; still restrained and conventional. |
| Fidelity (additional redesign axis) | 3 | 4 | All destinations and retained tools are visibly present. |

Round 1: **not done**. Round 2: **done by the stop rule** — no score below 3, nine of twelve core axes at 4. The additional fidelity axis is not used to inflate the count. The 3s remain honest limitations; this is not a claim of design-award quality.

## Round 1 asks and responses

1. **Colour and chart craft:** use amber for educational curve/legend/readout, readable near-zero ticks, at least 56px axis-label space and darker default light candles while preserving custom colours. Landed in Round 2; axis inset is 112 SVG units, model zero normalizes very small numeric noise, and custom colours remain verbatim.
2. **Research empty states:** reduce height to about 210–230px, show controls sooner and replace the backtest emoji. Landed: 210px minimum, quiet neutral rails/amber marker, consistent SVG. No fake result curve was added.
3. **Credentials:** add 18px body insets and 16px row gaps, standardize external-link glyphs. Landed in both themes.
4. **Focus:** show shortcut, Exit focus/Escape and focused chart frames; capture retained tools below the fold. Landed. Browser tests verify that chart DOM and source survive focus changes.
5. **Preview notice:** move it into chrome so it cannot obscure chart/editor content. Landed in header; real execution errors still appear.

No asks were declined.

## Round 2 defects

The first Round 2 capture pass inherited the tools scroll position, obscuring destination headings. The critic requested top-of-page recaptures before scoring; capture-only scroll resets supplied those comparable views. The actual navigation defect was then corrected: destination changes reset scroll, while same-page work retains its position. Workflow target scrolling remains available. A regression checks navigation from the scrolled tools area. The final capture script asserts top-of-page navigation rather than forcing it.

The critic also found Crypto's Live expiry quotes checkbox above its label. It now uses an inline flex row with centred alignment and an 8px gap. These concrete corrections were made after the Round 2 scores and submitted to the same critic for final confirmation; they do not claim higher scores.

Final confirmation: the critic inspected ten final PNGs, confirmed both defects cleared and found no new concrete defect. All Round 2 scores remain unchanged; the stop criterion is satisfied.

The final all-destination audit also found Options controls overflowing at 1100px, low-contrast mint MCP tool names in light mode and remaining emoji-rendered external arrows. Form rows now wrap, tool names use primary ink and external links use the same SVG family. Library/flow empty states also use SVG. All eleven destinations pass the both-theme width regression. The same critic inspected ten supplemental 1100 × 800 frames and confirmed the visible fixes without raising scores or finding a regression; lower MCP links and the flow empty icon were outside those supplemental frames. The final 26-frame contact sheet includes all eleven destinations and the focus/tools states.

## Scan and adaptation

The upstream scanner found zero FAILs in the three-direction exploration. Every warning is answered: iPhone safe-area warnings refer to normal desktop header content, and extra hue families are semantic green/red market direction alongside the concept accent. The raw report is retained at [explore-shots/scan.json](explore-shots/scan.json).

Desktop captures are at 1×/1440 × 1000, with functional fit checks at 1100 × 800. The iPhone 375px layout, status bar, home indicator, haptics, SwiftUI and new icon deliverables were intentionally not applied to this existing Mac app. No generated or licensed upstream assets were copied into the product. Mac shortcut glyph rendering and physical-device motion feel remain outside the Linux screenshot review. Source and packaged Electron behavior are checked independently.

Final reviewed screens: [shots/sheet.png](shots/sheet.png), plus each full-resolution PNG linked by [shots/sheet.html](shots/sheet.html). Original workspace frames: [before](before/).
