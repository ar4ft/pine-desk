import { calculateGreeks, greekCurve, greekLessons } from "../core/greeks.js";
export const escapeHTML = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const esc = escapeHTML;
export const formatValue = (n, d = 4) =>
  Number.isFinite(n)
    ? Math.abs(n) > 0 && Math.abs(n) < 0.0001
      ? n.toExponential(3)
      : n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";
export function curveSVG(
  series,
  { xLabel = "", yLabel = "", current = null } = {},
) {
  const all = series
    .flatMap((s) => s.points)
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!all.length) return "<p>No valid observations for this chart.</p>";
  const xs = all.map((p) => p.x),
    ys = all.map((p) => p.y),
    xmin = Math.min(...xs),
    xmax = Math.max(...xs),
    ymin = Math.min(...ys),
    ymax = Math.max(...ys),
    x = (v) => 64 + ((v - xmin) / (xmax - xmin || 1)) * 666,
    y = (v) => 250 - ((v - ymin) / (ymax - ymin || 1)) * 215;
  return `<svg class="option-curve" viewBox="0 0 780 310" role="img" aria-label="${esc(yLabel)} versus ${esc(xLabel)}"><title>${esc(yLabel)} versus ${esc(xLabel)}</title>${Array.from(
    { length: 5 },
    (_, i) => {
      const v = ymin + ((ymax - ymin) * i) / 4;
      return `<line x1="64" x2="730" y1="${y(v)}" y2="${y(v)}" class="curve-grid"/><text x="58" y="${y(v) + 4}" text-anchor="end">${formatValue(v, 3)}</text>`;
    },
  ).join(
    "",
  )}${[xmin, (xmin + xmax) / 2, xmax].map((v) => `<text x="${x(v)}" y="273" text-anchor="middle">${formatValue(v, 2)}</text>`).join("")}${series
    .map(
      (s, i) =>
        `<path fill="none" stroke="var(--${i === 0 ? "green" : "red"})" stroke-width="2.5" d="${s.points
          .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
          .map((p, j) => `${j ? "L" : "M"}${x(p.x)},${y(p.y)}`)
          .join(" ")}"/>${s.points
          .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
          .map(
            (p) =>
              `<circle cx="${x(p.x)}" cy="${y(p.y)}" r="4" fill="transparent"><title>${esc(s.name)} · ${esc(xLabel)} ${formatValue(p.x)} · ${esc(yLabel)} ${formatValue(p.y)}</title></circle>`,
          )
          .join("")}`,
    )
    .join(
      "",
    )}${current && current.x >= xmin && current.x <= xmax && Number.isFinite(current.y) ? `<line x1="${x(current.x)}" x2="${x(current.x)}" y1="35" y2="250" stroke="var(--muted)" stroke-dasharray="4 4"/><circle cx="${x(current.x)}" cy="${y(current.y)}" r="5" fill="var(--text)"/>` : ""}<text x="390" y="299" text-anchor="middle">${esc(xLabel)}</text><text x="64" y="18">${esc(yLabel)}</text></svg><div class="curve-legend">${series.map((s, i) => `<span style="color:var(--${i === 0 ? "green" : "red"})">● ${esc(s.name)}</span>`).join("")}</div>`;
}
export function newLearningState() {
  return {
    model: {
      spot: 100,
      strike: 100,
      days: 30,
      volatility: 30,
      exerciseStyle: "european",
      rate: 4,
      dividend: 0,
      type: "call",
    },
    metric: "delta",
    axis: "spot",
  };
}
export function learningView(state) {
  return `<div class="page-intro"><span class="eyebrow">OPTIONS EDUCATION</span><h1>Build intuition, one Greek at a time.</h1><p>Move a parameter and watch an option’s price and sensitivities change.</p></div><div class="learning-grid"><section class="learning-controls"><h2>Model inputs</h2><label>Exercise model<select id="learn-style"><option value="european" ${state.model.exerciseStyle !== "american" ? "selected" : ""}>European BSM</option><option value="american" ${state.model.exerciseStyle === "american" ? "selected" : ""}>American CRR tree</option></select></label><label>Cash dividends JSON [{"days":30,"amount":1}]<textarea id="learn-cash-dividends">${esc(JSON.stringify(state.model.cashDividends ?? []))}</textarea></label><p>American mode uses an approximate 300-step tree with optional cash dividends. Higher Greeks are unavailable.</p><label>Option type<select id="learn-type">${["call", "put"].map((t) => `<option ${state.model.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>${[
    ["spot", "Spot", 0.01, 1e9, 1],
    ["strike", "Strike", 0.01, 1e9, 1],
    ["days", "Days remaining", 0.1, 3650, 0.1],
    ["volatility", "IV (%)", 0.1, 300, 0.1],
    ["rate", "Annual rate (%)", -20, 50, 0.1],
    ["dividend", "Annual dividend yield (%)", -20, 50, 0.1],
  ]
    .map(
      ([key, label, min, max, step]) =>
        `<label>${label}<input data-model-number="${key}" aria-label="${label}" type="number" min="${min}" max="${max}" step="${step}" value="${state.model[key]}"><input data-model-slider="${key}" aria-label="${label} slider" type="range" min="${["spot", "strike"].includes(key) ? Math.max(0.01, state.model[key] * 0.5) : min}" max="${["spot", "strike"].includes(key) ? Math.min(1e9, state.model[key] * 1.5) : max}" step="${step}" value="${state.model[key]}"></label>`,
    )
    .join(
      "",
    )}<div class="learning-presets"><button data-learn-preset="atm">ATM call</button><button data-learn-preset="expiry">Near expiry</button><button data-learn-preset="put">Long put</button></div></section><section><div class="learning-chart-controls"><label>Sensitivity<select id="learn-metric">${Object.entries(
    greekLessons,
  )
    .map(
      ([k, [name]]) =>
        `<option value="${k}" ${state.metric === k ? "selected" : ""}>${name}</option>`,
    )
    .join("")}</select></label><label>Horizontal axis<select id="learn-axis">${[
    ["spot", "Spot"],
    ["days", "Days remaining"],
    ["volatility", "IV (%)"],
  ]
    .map(
      ([k, name]) =>
        `<option value="${k}" ${state.axis === k ? "selected" : ""}>${name}</option>`,
    )
    .join(
      "",
    )}</select></label></div><div id="learn-error" role="alert"></div><div class="plot-card" id="learn-curve"></div><div class="learning-explanation" id="learn-explanation"></div><div class="greek-cards" id="learn-values"></div></section></div><section class="learning-note"><h2>Try an experiment</h2><p>Choose “Near expiry”, select Gamma, and compare the curve with the 30-day ATM preset. The peak becomes narrower and taller as expiry approaches. Then select Theta and explore the cost of that sensitivity.</p><label>For a small spot rise, what does a positive delta suggest?<select id="learn-answer"><option value="">Choose an answer…</option><option value="price">The option premium rises locally</option><option value="vol">Implied volatility must rise</option><option value="certain">The option will certainly expire in the money</option></select></label><p id="learn-feedback" aria-live="polite"></p></section><details class="learning-note"><summary>Model, formulas and units</summary><p>Black–Scholes–Merton: European exercise, constant volatility, continuous rates and dividend yield, 365 calendar days per year. One underlying unit; quote-currency premiums. Vega and Rho use one percentage-point changes; Theta, Charm and Color use one elapsed calendar day. Higher volatility derivatives use percentage-point units consistently.</p><p>These hypothetical curves are separate from exchange Greeks. American mode uses a step-sensitive CRR tree and an escrowed cash-dividend approximation; higher Greeks remain unavailable. These curves do not reproduce inverse crypto settlement, transaction costs, volatility smiles or jumps.</p><pre>d₁ = [ln(S/K) + (r − q + σ²/2)T] / (σ√T)<br>d₂ = d₁ − σ√T<br>Call = S e^(−qT) N(d₁) − K e^(−rT) N(d₂)<br>Put = K e^(−rT) N(−d₂) − S e^(−qT) N(−d₁)<br>Call − Put = S e^(−qT) − K e^(−rT)</pre><p>The displayed sensitivities are local derivatives. Large parameter changes need full repricing.</p></details>`;
}
export function paintLearning(state) {
  const error = document.querySelector("#learn-error");
  if (!error) return;
  try {
    const result = calculateGreeks(state.model),
      lesson = greekLessons[state.metric];
    error.textContent = "";
    document.querySelector("#learn-curve").innerHTML = curveSVG(
      [{ name: lesson[0], points: greekCurve(state.model, state) }],
      {
        xLabel: {
          spot: "Spot (quote units)",
          days: "Days remaining",
          volatility: "IV (%)",
        }[state.axis],
        yLabel: lesson[0],
        current: { x: state.model[state.axis], y: result[state.metric] },
      },
    );
    document.querySelector("#learn-explanation").innerHTML =
      `<h2>${lesson[0]} <span>${formatValue(result[state.metric])}</span></h2><small>${lesson[1]}</small><p>${lesson[2]}</p>`;
    document.querySelector("#learn-values").innerHTML = Object.entries(
      greekLessons,
    )
      .map(
        ([key, [name, unit]]) =>
          `<button data-learn-greek="${key}" class="${key === state.metric ? "selected" : ""}"><small>${name}</small><strong>${formatValue(result[key])}</strong><span>${unit}</span></button>`,
      )
      .join("");
    document.querySelectorAll("[data-learn-greek]").forEach(
      (el) =>
        (el.onclick = () => {
          state.metric = el.dataset.learnGreek;
          document.querySelector("#learn-metric").value = state.metric;
          paintLearning(state);
        }),
    );
  } catch (e) {
    error.textContent = e.message;
    for (const id of ["learn-curve", "learn-values", "learn-explanation"])
      document.querySelector("#" + id).innerHTML = "";
  }
}
export function bindLearning(state, render) {
  if (!document.querySelector("#learn-type")) return;
  for (const attribute of ["modelNumber", "modelSlider"])
    document
      .querySelectorAll(
        attribute === "modelNumber"
          ? "[data-model-number]"
          : "[data-model-slider]",
      )
      .forEach(
        (el) =>
          (el.oninput = () => {
            const key = el.dataset[attribute];
            state.model[key] = el.value === "" ? NaN : Number(el.value);
            const other = document.querySelector(
              `[data-${attribute === "modelNumber" ? "model-slider" : "model-number"}="${key}"]`,
            );
            if (
              attribute === "modelNumber" &&
              ["spot", "strike"].includes(key) &&
              Number.isFinite(state.model[key]) &&
              state.model[key] > 0
            ) {
              other.min = Math.max(0.01, state.model[key] * 0.5);
              other.max = Math.min(1e9, state.model[key] * 1.5);
            }
            other.value = el.value;
            paintLearning(state);
          }),
      );
  document.querySelector("#learn-style").onchange = (e) => {
    state.model.exerciseStyle = e.target.value;
    if (
      e.target.value === "american" &&
      !["price", "delta", "gamma", "vega", "theta", "rho"].includes(
        state.metric,
      )
    ) {
      state.metric = "price";
      document.querySelector("#learn-metric").value = "price";
    }
    paintLearning(state);
  };
  document.querySelector("#learn-cash-dividends").onchange = (e) => {
    try {
      state.model.cashDividends = JSON.parse(e.target.value);
      paintLearning(state);
    } catch (error) {
      document.querySelector("#learn-error").textContent = error.message;
    }
  };
  document.querySelector("#learn-type").onchange = (e) => {
    state.model.type = e.target.value;
    paintLearning(state);
  };
  for (const key of ["metric", "axis"])
    document.querySelector("#learn-" + key).onchange = (e) => {
      state[key] = e.target.value;
      paintLearning(state);
    };
  document.querySelectorAll("[data-learn-preset]").forEach(
    (el) =>
      (el.onclick = () => {
        state.model = {
          spot: 100,
          strike: 100,
          days: el.dataset.learnPreset === "expiry" ? 1 : 30,
          volatility: 30,
          rate: 4,
          dividend: 0,
          type: el.dataset.learnPreset === "put" ? "put" : "call",
        };
        render();
      }),
  );
  document.querySelector("#learn-answer").onchange = (e) => {
    document.querySelector("#learn-feedback").textContent =
      e.target.value === "price"
        ? "Correct. Delta describes the local premium change with spot, holding other inputs fixed."
        : e.target.value
          ? "Try again. Delta describes spot sensitivity; it does not guarantee an outcome."
          : "";
  };
  paintLearning(state);
}
