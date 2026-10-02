import { PublicOptionsExchange } from "./crypto-exchanges.js";
import { OptionHistory, OptionRecorder } from "./option-history.js";
import { fitSABR, deltaSkew, gammaExposure } from "./option-surface.js";
import {
  portfolioRisk,
  strategyCandidates,
  backtestOptions,
} from "./option-portfolio.js";
import { DeribitOptions, termStructure } from "./deribit.js";
import { calculateGreeks, greekCurve } from "./greeks.js";
import { watchlistQuotes } from "./watchlist.js";
import {
  uiConfig,
  configureUI,
  importScriptFile,
  saveLayout,
  listLayouts,
  readLayout,
  deleteLayout,
} from "./workspace-ui.js";
import { randomUUID } from "node:crypto";
import {
  demoBars,
  fetchBinance,
  parseCSV,
  durations,
  validateBars,
  validateTrades,
} from "./data.js";
import { examples } from "./examples.js";
import { runBacktest, simulate, validateSource } from "./backtest.js";
import { orderflow } from "./orderflow.js";
import { libraryCall } from "./library.js";
import {
  configureEdge,
  edgeConfig,
  edgeOverview,
  edgeCall,
} from "./edge-stats.js";
import { whaleConfig, configureWhale, whaleCall } from "./whale-options.js";
import { UnusualWhales } from "./unusual-whales.js";
import {
  credential,
  credentialStatus,
  saveCredentials,
} from "./credentials.js";
import { WhaleRunner, engineConfig, configureEngine } from "./whale-runner.js";
import { BinanceLive } from "./live.js";
import { ResearchJobs, compareRuns } from "./research.js";
import * as store from "./store.js";
import { auditStrategy } from "./strategy-audit.js";
import { dataQuality, providerCapabilities } from "./data-quality.js";
import { runOptionStudy, stopOptionStudies } from "./option-study.js";
import { compareOptionRuns } from "./option-comparison.js";
let liveWrite = Promise.resolve();
export const live = new BinanceLive({
  onClosed: (dataset) => {
    const snapshot = structuredClone(dataset);
    liveWrite = liveWrite
      .catch(() => {})
      .then(() => store.write("bars", snapshot));
    liveWrite.catch((error) =>
      console.warn("Could not persist settled live candles:", error.message),
    );
  },
});
export const deribit = new DeribitOptions();
export const cryptoExchanges = {
  deribit,
  bybit: new PublicOptionsExchange("bybit"),
  okx: new PublicOptionsExchange("okx"),
};
function cryptoFor(exchange = "deribit") {
  const provider = cryptoExchanges[exchange];
  if (!provider) throw Error("Unsupported crypto options exchange.");
  return provider;
}
export const optionHistory = new OptionHistory();
export const optionRecorder = new OptionRecorder({
  history: optionHistory,
  fetchSnapshot: async (args) => {
    const provider =
      args.exchange === "deribit"
        ? new DeribitOptions()
        : new PublicOptionsExchange(args.exchange);
    try {
      return await provider.refresh(args);
    } finally {
      provider.stop();
    }
  },
});
async function researchSnapshot(args) {
  if (args.snapshotId)
    return (await optionHistory.get(args.snapshotId)).snapshot;
  const snapshot = cryptoFor(args.exchange).snapshot();
  if (!snapshot.rows?.length)
    throw Error("Load a crypto option chain or choose an archived snapshot.");
  return snapshot;
}
export const optionsProvider = new UnusualWhales();
export const whaleRunner = new WhaleRunner();
export const researchJobs = new ResearchJobs();
export function shutdown() {
  stopOptionStudies();
  optionRecorder.stop();
  for (const provider of Object.values(cryptoExchanges)) provider.stop();
  live.stop();
  researchJobs.stop();
  optionsProvider.stop();
  whaleRunner.stop();
}
async function datasetFor(args) {
  return structuredClone(
    args.dataset ??
      (live.active ? live.snapshot().dataset : null) ??
      (await store.read("bars")) ?? {
        bars: demoBars(),
        symbol: "DEMO",
        timeframe: "1h",
        origin: "Synthetic demonstration",
      },
  );
}
export async function dispatch(action, args = {}) {
  switch (action) {
    case "optionHistoryBackfill": {
      const token = await credential("massiveKey");
      if (!token)
        throw Error(
          "Add a Massive API key in Settings with historical options quote access.",
        );
      const result = await runOptionStudy([], args, {
        mode: "licensed",
        token,
      });
      const saved = await optionHistory.saveMany(result.snapshots, {
        imported: true,
      });
      return {
        saved: saved.length,
        ids: saved.map((r) => r.id),
        requests: result.requests,
        provider: result.provider,
        warnings: result.warnings,
      };
    }
    case "optionCompareRuns": {
      if (!Array.isArray(args.ids)) throw Error("Choose run IDs.");
      const runs = await Promise.all(
        args.ids.map((id) => store.read("option-runs", id)),
      );
      if (runs.some((r) => !r)) throw Error("Option run not found.");
      return compareOptionRuns(runs, args);
    }
    case "optionRunSummary": {
      const run = await store.read("option-runs", args.id);
      if (!run) throw Error("Option run not found.");
      const r = run.result;
      return {
        id: run.id,
        createdAt: run.createdAt,
        kind: r.kind,
        basis: r.basis,
        metrics: r.metrics,
        rules: r.rules ?? null,
        openPositions: r.openPositions ?? [],
        fills: r.fills?.length ?? 0,
        closedTrades: r.trades?.length ?? 0,
        sourceObservations: r.usedQuotes?.length ?? 0,
        warnings: r.warnings,
      };
    }
    case "providerCapabilities":
      return providerCapabilities;
    case "dataQuality":
      return dataQuality(args.snapshot ?? (await datasetFor(args)));
    case "strategyAudit": {
      const dataset = await datasetFor(args);
      const result = await auditStrategy({ ...dataset, ...args });
      const report = {
        id: randomUUID(),
        createdAt: Date.now(),
        source: args.source,
        inputs: args.inputs ?? {},
        dataset,
        result,
      };
      await store.write("audits", report, report.id);
      return report;
    }
    case "optionStrategy": {
      if (
        !Array.isArray(args.ids) ||
        args.ids.length < 3 ||
        args.ids.length > 2000 ||
        new Set(args.ids).size !== args.ids.length
      )
        throw Error("Select 3–2000 distinct snapshots.");
      const records = [];
      let bytes = 0;
      for (const id of args.ids) {
        const record = await optionHistory.get(id);
        bytes += record.bytes;
        if (bytes > 100000000)
          throw Error(
            "Study source exceeds 100 MB; split the selected date range.",
          );
        records.push(record);
      }
      const result = await runOptionStudy(records, args),
        run = { id: randomUUID(), createdAt: Date.now(), result };
      await store.write("option-runs", run, run.id);
      return run;
    }
    case "cryptoRefresh": {
      for (const provider of Object.values(cryptoExchanges)) provider.stop();
      return cryptoFor(args.exchange).refresh(args);
    }
    case "cryptoSelect":
      return cryptoFor(args.exchange).select(args);
    case "cryptoStart":
      return cryptoFor(args.exchange).start(args);
    case "cryptoStop":
      return cryptoFor(args.exchange).stop();
    case "cryptoSnapshot":
      return cryptoFor(args.exchange).snapshot();
    case "optionHistoryList":
      return optionHistory.list(args);
    case "optionHistoryCoverage":
      return optionHistory.coverage(args);
    case "optionHistorySave": {
      const s = cryptoFor(args.exchange).snapshot();
      if (Date.now() - s.fetchedAt > 60000)
        throw Error(
          "Refresh the full chain before archiving; this snapshot is older than one minute.",
        );
      return optionHistory.save(s);
    }
    case "optionHistoryGet": {
      const r = await optionHistory.get(args.id);
      return {
        ...r,
        snapshot: {
          ...r.snapshot,
          term: termStructure(
            r.snapshot.rows,
            r.snapshot.spot,
            r.snapshot.fetchedAt,
          ),
        },
      };
    }
    case "optionHistoryDelete":
      return optionHistory.remove(args.id);
    case "optionHistoryImport":
      return optionHistory.import(args.json);
    case "optionHistoryExport":
      return optionHistory.export(args.ids);
    case "optionHistoryCompare":
      return optionHistory.compare(args.ids);
    case "optionRecordStart":
      return optionRecorder.start(args);
    case "optionRecordStop":
      return optionRecorder.stop();
    case "optionRecordStatus":
      return optionRecorder.status();
    case "optionSurface": {
      const snapshot = await researchSnapshot(args);
      return {
        fit: fitSABR(snapshot, args),
        skew: deltaSkew(snapshot, args),
        gamma: gammaExposure(snapshot, args),
        candidates: strategyCandidates(snapshot, args.expiry),
      };
    }
    case "optionSkew":
      return deltaSkew(await researchSnapshot(args), args);
    case "optionPortfolio":
      return portfolioRisk(await researchSnapshot(args), args);
    case "optionBacktest": {
      if (
        !Array.isArray(args.ids) ||
        args.ids.length < 2 ||
        args.ids.length > 100 ||
        new Set(args.ids).size !== args.ids.length
      )
        throw Error("Choose 2–100 distinct archived snapshots.");
      const records = await Promise.all(
        args.ids.map((id) => optionHistory.get(id)),
      );
      const result = backtestOptions(records, args);
      const run = { id: randomUUID(), createdAt: Date.now(), result };
      await store.write("option-runs", run, run.id);
      return run;
    }
    case "optionRuns":
      return (await store.list("option-runs"))
        .map(({ id, createdAt, result }) => ({
          id,
          createdAt,
          basis: result.basis,
          metrics: result.metrics,
        }))
        .sort((a, b) => b.createdAt - a.createdAt);
    case "optionRunGet": {
      const run = await store.read("option-runs", args.id);
      if (!run) throw Error("Option run not found.");
      return run;
    }
    case "deribitRefresh":
      return deribit.refresh(args);
    case "deribitSelect":
      return deribit.select(args);
    case "deribitStart":
      return deribit.start(args);
    case "deribitStop":
      return deribit.stop();
    case "deribitSnapshot":
      return deribit.snapshot();
    case "optionsGreeks":
      return {
        values: calculateGreeks(args.model),
        curve: args.curve ? greekCurve(args.model, args.curve) : null,
      };
    case "watchlistQuotes":
      return watchlistQuotes(args.symbols);
    case "uiConfig":
      return uiConfig();
    case "uiConfigure":
      return configureUI(args);
    case "importScriptFile": {
      const script = importScriptFile(args);
      return store.write("scripts", script, script.id);
    }
    case "layoutSave":
      return saveLayout(args);
    case "layoutList":
      return listLayouts();
    case "layoutRead":
      return readLayout(args.id);
    case "layoutActivate": {
      const saved = await readLayout(args.id);
      live.stop();
      optionsProvider.stop();
      await liveWrite;
      if (saved.snapshot.dataset) {
        saved.snapshot.dataset = {
          ...saved.snapshot.dataset,
          origin: "Saved layout • " + saved.snapshot.dataset.origin,
        };
        await store.write("bars", saved.snapshot.dataset);
      }
      return saved;
    }
    case "layoutDelete":
      return deleteLayout(args.id);
    case "workspace":
      return {
        dataset: (await store.read("bars")) ?? {
          bars: demoBars(),
          symbol: "DEMO",
          timeframe: "1h",
          origin: "Synthetic demonstration",
        },
        scripts: [...examples, ...(await store.list("scripts"))],
        runs: (await store.list("runs"))
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 30),
        savedStudies: (await store.list("research-index"))
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 20)
          .map(({ id, kind, status, createdAt }) => ({
            id,
            kind,
            status:
              status === "running"
                ? (researchJobs.jobs.get(id)?.status ?? "unavailable")
                : status,
            createdAt,
          })),
        dataDir: store.dataDir,
      };
    case "loadMarket": {
      live.stop();
      await liveWrite;
      const bars = await fetchBinance(args);
      return store.write("bars", {
        bars,
        symbol: args.symbol,
        timeframe: args.timeframe,
        origin: "Binance • closed candles",
        loadedAt: Date.now(),
      });
    }
    case "importBars": {
      live.stop();
      await liveWrite;
      if (!durations[args.timeframe]) throw new Error("Unsupported timeframe.");
      return store.write("bars", {
        bars: args.csv ? parseCSV(args.csv) : validateBars(args.bars),
        symbol: String(args.symbol || "CSV").slice(0, 40),
        timeframe: args.timeframe,
        origin: "Imported OHLCV",
        loadedAt: Date.now(),
      });
    }
    case "saveScript": {
      const source = validateSource(args.source),
        id = args.id ?? randomUUID();
      const script = {
        id,
        name: String(args.name || "Untitled").slice(0, 100),
        source,
        provenance: args.provenance ?? null,
        updatedAt: Date.now(),
      };
      return store.write("scripts", script, id);
    }
    case "backtest": {
      const dataset = await datasetFor(args);
      const result = await runBacktest({
        ...dataset,
        source: args.source,
        settings: args.settings,
        inputs: args.inputs,
      });
      const run = {
        id: randomUUID(),
        createdAt: Date.now(),
        source: args.source,
        settings: args.settings ?? {},
        inputs: args.inputs ?? {},
        dataset,
        result,
      };
      await store.write("runs", run, run.id);
      return run;
    }
    case "liveStart":
      return live.start(args);
    case "liveSnapshot":
      return live.snapshot();
    case "liveStop": {
      const snapshot = live.stop();
      await liveWrite;
      return snapshot;
    }
    case "liveFlow":
      return live.flow(args);
    case "liveSaveTrades":
      return store.write("trades", live.tradeSnapshot());
    case "researchStart":
      return researchJobs.start({ ...args, dataset: await datasetFor(args) });
    case "researchGet":
      return researchJobs.get(args.id);
    case "researchCancel":
      return researchJobs.cancel(args.id);
    case "compareRuns": {
      if (
        !Array.isArray(args.ids) ||
        new Set(args.ids).size !== args.ids.length
      )
        throw new Error("Choose distinct saved runs.");
      const runs = await Promise.all(
        args.ids.map((id) => store.read("runs", id)),
      );
      if (runs.some((run) => !run)) throw new Error("Saved run not found.");
      return compareRuns(runs);
    }
    case "researchSaveRun": {
      const job = await researchJobs.get(args.id);
      if (job.status !== "completed")
        throw new Error("Study must complete before saving a run.");
      const r = job.result;
      let result,
        inputs,
        dataset = r.dataset;
      if (r.kind === "sweep") {
        const candidate = r.candidates.find((c) => c.index === args.index);
        if (!candidate?.result)
          throw new Error("Choose a completed candidate.");
        result = candidate.result;
        inputs = candidate.inputs;
      } else {
        const fold = r.folds.find((f) => f.index === args.fold);
        if (!fold) throw new Error("Choose an existing fold.");
        result = fold.testResult;
        inputs = fold.inputs;
        dataset = {
          ...dataset,
          bars: dataset.bars.slice(fold.window.testStart, fold.window.testEnd),
        };
      }
      const run = {
        id: randomUUID(),
        createdAt: Date.now(),
        source: r.source,
        settings: r.settings,
        inputs: { ...r.inputs, ...inputs },
        dataset,
        result,
        researchId: job.id,
      };
      return store.write("runs", run, run.id);
    }
    case "simulate":
      return simulate(args.trades, args.options);
    case "importTrades":
      return store.write("trades", {
        trades: args.csv
          ? parseCSV(args.csv, "trades")
          : validateTrades(args.trades),
        symbol: String(args.symbol || "CSV").slice(0, 40),
        importedAt: Date.now(),
      });
    case "orderflow": {
      const stored = await store.read("trades");
      if (!stored)
        throw new Error(
          "Import trade CSV first. OHLCV candles do not contain aggressor-side data.",
        );
      return { ...orderflow(stored.trades, args), symbol: stored.symbol };
    }
    case "libraryList":
      return libraryCall("library_list_indicators", {
        page: args.page ?? 0,
        page_size: 24,
        ...args,
      });
    case "librarySearch":
      return libraryCall("library_search", {
        query: args.query,
        type: "indicators",
        limit: 24,
      });
    case "librarySource":
      return libraryCall("library_get_source_code", { slug: args.slug });
    case "libraryDetail":
      return libraryCall("library_get_indicator", { slug: args.slug });
    case "edgeConfig":
      return edgeConfig();
    case "edgeConfigure":
      return configureEdge(args);
    case "edgeOverview":
      return edgeOverview();
    case "edgeCoverage":
      return edgeCall("coverage");
    case "edgePresets":
      return edgeCall("presets", args);
    case "edgeReport":
      return edgeCall("report", args);
    case "edgeQuery":
      return edgeCall("query", args);
    case "edgeFields":
      return edgeCall("fields", args);
    case "edgeSessions":
      return edgeCall("sessions", args);
    case "edgeSessionBars":
      return edgeCall("sessionBars", args);
    case "providerSettings":
      return {
        credentials: await credentialStatus(),
        engine: await engineConfig(),
        engineStatus: whaleRunner.status(),
        whale: await whaleConfig(),
      };
    case "saveCredentials":
      return saveCredentials(args);
    case "engineConfigure":
      return configureEngine(args);
    case "engineStart":
      return whaleRunner.start();
    case "engineStop":
      return whaleRunner.stop();
    case "optionsRefresh":
      return optionsProvider.refresh(args);
    case "optionsStart":
      return optionsProvider.start(args);
    case "optionsStop":
      return optionsProvider.stop();
    case "optionsSnapshot":
      return optionsProvider.snapshot();
    case "whaleConfig":
      return whaleConfig();
    case "whaleConfigure":
      return configureWhale(args);
    case "whaleStatus":
      return whaleCall("status");
    case "whaleRecent":
      return whaleCall("recent", args);
    case "whaleTop":
      return whaleCall("top", args);
    case "whaleEvent":
      return whaleCall("event", args);
    case "whaleGex":
      return whaleCall("gex", args);
    case "whaleOiDeltas":
      return whaleCall("oiDeltas", args);
    case "whaleMaxPain":
      return whaleCall("maxPain", args);
    case "whaleIvRank":
      return whaleCall("ivRank", args);
    case "whaleNetFlow":
      return whaleCall("netFlow", args);
    default:
      throw new Error("Unknown app operation.");
  }
}
