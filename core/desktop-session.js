// Routes agent actions through the same service and renderer as desktop actions.
// A panel snapshot is captured before a research job can outlive a chart change.
export function desktopDispatcher({ dispatch, renderer, notify = () => {} }) {
  return async (action, args) => {
    if (action.startsWith("desktop")) return renderer(action, args);
    if (
      [
        "loadMarket",
        "importBars",
        "liveStart",
        "liveStop",
        "optionsRefresh",
        "optionsStart",
        "optionsStop",
        "cryptoRefresh",
        "cryptoStart",
        "cryptoStop",
        "cryptoSelect",
      ].includes(action)
    )
      return renderer("serviceAction", { action, args });
    if (
      [
        "workspace",
        "backtest",
        "researchStart",
        "strategyAudit",
        "dataQuality",
      ].includes(action)
    ) {
      const snapshot = await renderer("researchSnapshot", {});
      if (action === "workspace")
        return {
          ...(await dispatch(action, args)),
          dataset: snapshot.dataset,
          desktop: snapshot.desktop,
        };
      args = { ...args, dataset: structuredClone(snapshot.dataset) };
    }
    const result = await dispatch(action, args);
    if (
      ["saveScript", "backtest", "researchSaveRun", "importTrades"].includes(
        action,
      )
    )
      notify(action);
    return result;
  };
}
