import { dataQuality } from "../core/data-quality.js";
import { escapeHTML as esc } from "./options-learning.js";
export function qualityView(snapshot, { archive = false } = {}) {
  if (!snapshot) return "";
  const q = dataQuality(snapshot),
    missing = Object.entries(q.missing).filter(([, count]) => count),
    stamp = q.observedAt ? new Date(q.observedAt).toISOString() : "unknown";
  return `<details class="learning-note data-quality"><summary>Data quality · ${esc(q.provider)} · ${archive ? "archived observation" : esc(q.status)} · ${q.contracts ? `${q.contracts} contracts` : `${q.bars} bars`}</summary><p>Observed ${esc(stamp)}${!archive && q.ageMs !== null ? ` · ${(q.ageMs / 1000).toFixed(0)} seconds ago` : ""}. ${esc(q.coverage)}</p><p>${q.crossed} crossed quotes · ${q.gaps.length} recorded gaps. ${missing.map(([key, count]) => `${key}: ${count} missing`).join(" · ") || "No missing option fields in loaded rows."}</p><p>${esc(q.limitations.join(" "))}</p></details>`;
}
export function workflowView(state) {
  const steps = [
    ["Data", "workspace", "Choose a source and check coverage"],
    ["Strategy", "workspace", "Write Pine or choose options rules"],
    ["Validate", "backtest", "Check bias, warmup and costs"],
    ["Compare", "backtest", "Inspect out-of-sample results"],
  ];
  return `<nav class="research-workflow" aria-label="Research workflow">${steps.map(([label, page, help], i) => `<button data-workflow="${i}" data-target-page="${page}" title="${help}"><small>${i + 1}</small>${label}</button>`).join("")}<button data-workflow="options" data-target-page="crypto">Options research</button></nav>`;
}
export function bindWorkflow({ navigate }) {
  document
    .querySelectorAll("[data-workflow]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          navigate(button.dataset.targetPage, button.dataset.workflow)),
    );
}
