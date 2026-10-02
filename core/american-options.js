// Independent CRR tree with an escrowed-cash-dividend approximation.
export function americanTree(p) {
  const { spot: S, strike: K, days, volatility, type } = p,
    N = p.steps ?? 300,
    r = (p.rate ?? 0) / 100,
    q = (p.dividend ?? 0) / 100,
    T = days / 365,
    v = volatility / 100,
    dt = T / N;
  if (
    ![S, K, days, volatility, r, q].every(Number.isFinite) ||
    S <= 0 ||
    K <= 0 ||
    days <= 0 ||
    days > 3650 ||
    volatility <= 0 ||
    volatility > 300 ||
    !["call", "put"].includes(type) ||
    !Number.isInteger(N) ||
    N < 50 ||
    N > 1000
  )
    throw Error("Invalid American tree inputs.");
  const dividends = p.cashDividends ?? [];
  if (
    !Array.isArray(dividends) ||
    dividends.length > 50 ||
    dividends.some(
      (d) =>
        !Number.isFinite(d.days) ||
        !Number.isFinite(d.amount) ||
        d.days <= 0 ||
        d.days > days ||
        d.amount < 0,
    )
  )
    throw Error(
      "Cash dividends need positive future days and nonnegative amounts within expiry.",
    );
  const pv = (t) =>
      dividends.reduce(
        (sum, d) =>
          sum +
          (d.days / 365 > t ? d.amount * Math.exp(-r * (d.days / 365 - t)) : 0),
        0,
      ),
    prepaid = S - pv(0);
  if (prepaid <= 0)
    throw Error("Dividends exceed spot in the escrow approximation.");
  const up = Math.exp(v * Math.sqrt(dt)),
    down = 1 / up,
    prob = (Math.exp((r - q) * dt) - down) / (up - down),
    discount = Math.exp(-r * dt);
  if (prob < 0 || prob > 1)
    throw Error(
      "Tree probability is outside [0,1]; increase steps or revise extreme inputs.",
    );
  const intrinsic = (spot) =>
      Math.max(0, type === "call" ? spot - K : K - spot),
    node = (level, j) =>
      prepaid * Math.pow(up, j) * Math.pow(down, level - j) + pv(level * dt);
  const values = Array.from({ length: N + 1 }, (_, j) => intrinsic(node(N, j)));
  let second, first;
  for (let level = N - 1; level >= 0; level--) {
    for (let j = 0; j <= level; j++)
      values[j] = Math.max(
        intrinsic(node(level, j)),
        discount * (prob * values[j + 1] + (1 - prob) * values[j]),
      );
    if (level === 2) second = values.slice(0, 3);
    if (level === 1) first = values.slice(0, 2);
  }
  const delta = (first[1] - first[0]) / (node(1, 1) - node(1, 0)),
    upDelta = (second[2] - second[1]) / (node(2, 2) - node(2, 1)),
    downDelta = (second[1] - second[0]) / (node(2, 1) - node(2, 0));
  return {
    price: values[0],
    delta,
    gamma: (upDelta - downDelta) / ((node(2, 2) - node(2, 0)) / 2),
    continuation: discount * (prob * first[1] + (1 - prob) * first[0]),
    intrinsic: intrinsic(S),
  };
}
export function americanGreeks(input) {
  const p = { ...input },
    base = americanTree(p),
    price = (overrides) => americanTree({ ...p, ...overrides }).price,
    h = 0.01,
    time = Math.min(0.1, p.days / 10);
  return {
    ...base,
    vega:
      (price({ volatility: p.volatility + h }) -
        price({ volatility: p.volatility - h })) /
      (2 * h),
    rho:
      (price({ rate: (p.rate ?? 0) + h }) -
        price({ rate: (p.rate ?? 0) - h })) /
      (2 * h),
    theta:
      (price({
        days: p.days + time,
        cashDividends: (p.cashDividends ?? []).map((d) => ({
          ...d,
          days: d.days + time,
        })),
      }) -
        price({
          days: p.days - time,
          cashDividends: (p.cashDividends ?? [])
            .filter((d) => d.days > time)
            .map((d) => ({ ...d, days: d.days - time })),
        })) /
      (-2 * time),
    vanna: null,
    vomma: null,
    charm: null,
    speed: null,
    color: null,
    zomma: null,
    ultima: null,
    d1: null,
    d2: null,
    model: { ...p, exerciseStyle: "american" },
    modelNote:
      "CRR early exercise with escrowed cash dividends; approximate, step-sensitive. Higher Greeks are unavailable.",
  };
}
