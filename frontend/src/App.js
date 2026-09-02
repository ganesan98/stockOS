import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import TickerAutocomplete from "./TickerAutocomplete";
import { API } from "./api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ScatterChart,
  Scatter,
  CartesianGrid,
  ZAxis,
} from "recharts";
import "./App.css";

/* =========================================================
   FETCH WITH RETRY UTILITY
   Retries a function that returns a Promise up to `retries`
   times with exponential back-off before giving up.
   ========================================================= */

async function fetchWithRetry(fn, retries = 2, delay = 1500) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((res) =>
          setTimeout(res, delay * (attempt + 1))
        );
      }
    }
  }
  throw lastErr;
}

/* =========================================================
   ICONS
   ========================================================= */

const SearchIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

const ArrowRight = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </svg>
);

const PlusIcon = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

const TrashIcon = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M7 7l1 13h8l1-13" />
    <path d="M10 11v5" />
    <path d="M14 11v5" />
  </svg>
);

const ChartIcon = () => (
  <svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 19V5" />
    <path d="M4 19h16" />
    <path d="m7 15 3-4 3 2 5-6" />
  </svg>
);

const PortfolioIcon = () => (
  <svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="6" width="18" height="14" rx="2" />
    <path d="M8 6V4h8v2" />
    <path d="M12 12v4" />
    <path d="M10 14h4" />
  </svg>
);

const ShieldIcon = () => (
  <svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3 20 7v5c0 4.8-3.2 7.8-8 9-4.8-1.2-8-4.2-8-9V7z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const RetryIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

/* =========================================================
   APP
   ========================================================= */

export default function App() {
  const [ticker, setTicker] = useState("");
  const [info, setInfo] = useState(null);
  const [risk, setRisk] = useState(null);
  const [mc, setMc] = useState(null);
  const [history, setHistory] = useState([]);
  const [summary, setSummary] = useState("");

  // Per-endpoint error states for stock analysis
  const [infoError, setInfoError] = useState(null);
  const [riskError, setRiskError] = useState(null);
  const [mcError, setMcError] = useState(null);
  const [historyError, setHistoryError] = useState(null);

  const [holdings, setHoldings] = useState([
    { ticker: "", amount: "" },
  ]);

  const [portfolio, setPortfolio] = useState(null);

  const [mode, setMode] = useState("single");
  const [loading, setLoading] = useState(false);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState("");

  // Warmup / keep-alive state
  const [serverStatus, setServerStatus] = useState("idle"); // idle | pinging | awake | error
  const pingControllerRef = useRef(null);

  // Cold-start toast — shown after 5s if loading hasn't resolved
  const [showColdStartToast, setShowColdStartToast] = useState(false);
  const coldStartTimerRef = useRef(null);

  // What If rebalancing simulator state
  const [whatIfMode, setWhatIfMode] = useState(false);
  // simWeights: { [ticker]: newAmount (number) } — overrides from the sliders
  const [simWeights, setSimWeights] = useState({});

  /* -------------------------------------------------------
     WARMUP PING
     ------------------------------------------------------- */

  const pingServer = useCallback(async () => {
    // Abort any in-flight ping
    if (pingControllerRef.current) {
      pingControllerRef.current.abort();
    }
    const controller = new AbortController();
    pingControllerRef.current = controller;

    setServerStatus("pinging");
    try {
      await axios.get(`${API}/ping`, {
        signal: controller.signal,
        timeout: 35000,
      });
      setServerStatus("awake");
    } catch (err) {
      if (axios.isCancel(err) || err.name === "CanceledError") return;
      setServerStatus("error");
    }
  }, []);

  // Ping on mount
  useEffect(() => {
    pingServer();
  }, [pingServer]);

  // Re-ping when the user switches back to the tab
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        pingServer();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [pingServer]);

  /* -------------------------------------------------------
     COLD-START TOAST
     Shows a friendly hint after 5s of loading.
     ------------------------------------------------------- */

  function startColdStartTimer() {
    clearTimeout(coldStartTimerRef.current);
    coldStartTimerRef.current = setTimeout(() => {
      setShowColdStartToast(true);
    }, 5000);
  }

  function clearColdStartTimer() {
    clearTimeout(coldStartTimerRef.current);
    setShowColdStartToast(false);
  }

  /* -------------------------------------------------------
     INDIVIDUAL ENDPOINT FETCHERS
     Each can be called standalone for retry.
     ------------------------------------------------------- */

  const currentTickerRef = useRef(""); // track which symbol the callbacks belong to

  const fetchInfo = useCallback(async (symbol) => {
    setInfoError(null);
    try {
      const res = await fetchWithRetry(() =>
        axios.get(`${API}/stock/${symbol}`)
      );
      if (currentTickerRef.current === symbol) {
        setInfo(res.data);
      }
    } catch (err) {
      if (currentTickerRef.current === symbol) {
        setInfoError(
          err?.response?.data?.detail ||
            "Could not load stock info. Tap retry to try again."
        );
      }
    }
  }, []);

  const fetchRisk = useCallback(async (symbol) => {
    setRiskError(null);
    try {
      const res = await fetchWithRetry(() =>
        axios.get(`${API}/stock/${symbol}/risk`)
      );
      if (currentTickerRef.current === symbol) {
        setRisk(res.data);
      }
    } catch (err) {
      if (currentTickerRef.current === symbol) {
        setRiskError(
          err?.response?.data?.detail ||
            "Could not load risk metrics. Tap retry to try again."
        );
      }
    }
  }, []);

  const fetchMc = useCallback(async (symbol) => {
    setMcError(null);
    try {
      const res = await fetchWithRetry(() =>
        axios.get(`${API}/stock/${symbol}/montecarlo`)
      );
      if (currentTickerRef.current === symbol) {
        setMc(res.data);
      }
    } catch (err) {
      if (currentTickerRef.current === symbol) {
        setMcError(
          err?.response?.data?.detail ||
            "Could not load Monte Carlo simulation. Tap retry to try again."
        );
      }
    }
  }, []);

  const fetchHistory = useCallback(async (symbol) => {
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      const res = await fetchWithRetry(() =>
        axios.get(`${API}/stock/${symbol}/history`)
      );
      if (currentTickerRef.current === symbol) {
        setHistory(
          Array.isArray(res.data) ? res.data.slice(-60) : []
        );
      }
    } catch (err) {
      if (currentTickerRef.current === symbol) {
        setHistoryError(
          err?.response?.data?.detail ||
            "Could not load price history. Tap retry to try again."
        );
      }
    } finally {
      if (currentTickerRef.current === symbol) {
        setHistoryLoading(false);
      }
    }
  }, []);

  /* -------------------------------------------------------
     Single stock analysis
     ------------------------------------------------------- */

  async function analyze() {
    if (!ticker.trim()) {
      setError("Enter a ticker symbol to continue.");
      return;
    }

    const symbol = ticker.trim().toUpperCase();
    currentTickerRef.current = symbol;

    setError("");
    setTicker(symbol);
    setInfo(null);
    setRisk(null);
    setMc(null);
    setHistory([]);
    setHistoryLoading(false);
    setSummary("");
    setPortfolio(null);
    setInfoError(null);
    setRiskError(null);
    setMcError(null);
    setHistoryError(null);

    setLoading(true);
    setSummaryLoading(true);
    startColdStartTimer();

    // All 4 core data calls run independently so each section
    // renders as soon as its own endpoint returns.
    const infoPromise = fetchInfo(symbol);
    const riskPromise = fetchRisk(symbol);
    const mcPromise = fetchMc(symbol);
    const historyPromise = fetchHistory(symbol);

    // Slow AI summary runs independently and never blocks the rest.
    axios
      .get(`${API}/stock/${symbol}/summary`)
      .then((res) => {
        if (currentTickerRef.current === symbol) {
          setSummary(res.data?.summary || "");
        }
      })
      .catch((err) => {
        console.error("Risk interpretation error:", err);
      })
      .finally(() => {
        if (currentTickerRef.current === symbol) {
          setSummaryLoading(false);
        }
      });

    try {
      await Promise.all([
        infoPromise,
        riskPromise,
        mcPromise,
        historyPromise,
      ]);
    } catch (err) {
      // Individual error states already set above.
      // Only surface a top-level error if info (ticker validation)
      // returned a 404, meaning the symbol itself is invalid.
      if (err?.response?.status === 404) {
        setError(
          err?.response?.data?.detail ||
            "Unable to retrieve this security. Check the ticker and try again."
        );
      }
    } finally {
      setLoading(false);
      clearColdStartTimer();
    }
  }

  /* -------------------------------------------------------
     Portfolio analysis
     ------------------------------------------------------- */

  async function analyzePortfolio() {
    setPortfolioLoading(true);
    setError("");
    setPortfolio(null);
    startColdStartTimer();

    try {
      const validHoldings = holdings.filter(
        (holding) =>
          holding.ticker.trim() &&
          holding.amount !== "" &&
          Number(holding.amount) > 0
      );

      if (!validHoldings.length) {
        setError(
          "Add at least one stock and a valid investment amount."
        );
        setPortfolioLoading(false);
        clearColdStartTimer();
        return;
      }

      const payload = {
        holdings: validHoldings.map((holding) => ({
          ticker: holding.ticker.trim().toUpperCase(),
          amount: Number(holding.amount),
        })),
      };

      const response = await axios.post(
        `${API}/portfolio/risk`,
        payload
      );

      setPortfolio(response.data);

      // Surface partial failures from the backend
      const failed = response.data?.failed_tickers;
      if (failed && failed.length > 0) {
        const names = failed.map((f) => f.ticker).join(", ");
        setError(
          `Analysis succeeded with warnings — could not fetch data for: ${names}. ` +
            "Results shown exclude those holdings."
        );
      }
    } catch (err) {
      console.error(err);

      // Extract structured failed_tickers from error response if available
      const detail = err?.response?.data?.detail || "";
      const failedHeader =
        err?.response?.headers?.["x-failed-tickers"] || "";

      if (failedHeader) {
        const tickers = failedHeader.split(",").join(", ");
        setError(
          `Could not fetch data for: ${tickers}. ` +
            "Check those tickers and try again."
        );
      } else {
        setError(
          detail ||
            "Unable to analyze this portfolio. Check the holdings and try again."
        );
      }
    } finally {
      setPortfolioLoading(false);
      clearColdStartTimer();
    }
  }

  /* -------------------------------------------------------
     What If simulator
     ------------------------------------------------------- */

  function toggleWhatIf() {
    if (whatIfMode) {
      // Deactivate — reset everything
      setWhatIfMode(false);
      setSimWeights({});
    } else {
      // Activate — seed simWeights with the real portfolio amounts
      const seed = {};
      holdings.forEach((h) => {
        if (h.ticker.trim() && Number(h.amount) > 0) {
          seed[h.ticker.trim().toUpperCase()] = Number(h.amount);
        }
      });
      setSimWeights(seed);
      setWhatIfMode(true);
    }
  }

  function resetSimulation() {
    const seed = {};
    holdings.forEach((h) => {
      if (h.ticker.trim() && Number(h.amount) > 0) {
        seed[h.ticker.trim().toUpperCase()] = Number(h.amount);
      }
    });
    setSimWeights(seed);
  }

  /* -------------------------------------------------------
     UI helpers
     ------------------------------------------------------- */

  function switchMode(nextMode) {
    setMode(nextMode);
    setError("");

    if (nextMode === "portfolio") {
      // Re-ping when user enters portfolio tab — warms the server
      // before they hit Analyze.
      pingServer();
    }
  }

  function updateHolding(index, field, value) {
    setHoldings((current) =>
      current.map((holding, currentIndex) =>
        currentIndex === index
          ? {
              ...holding,
              [field]: value,
            }
          : holding
      )
    );
  }

  function addHolding() {
    setHoldings((current) => [
      ...current,
      {
        ticker: "",
        amount: "",
      },
    ]);
  }

  function removeHolding(index) {
    if (holdings.length === 1) return;

    setHoldings((current) =>
      current.filter(
        (_, currentIndex) => currentIndex !== index
      )
    );
  }

  function formatNumber(value, decimals = 2) {
    if (
      value === null ||
      value === undefined ||
      value === "" ||
      Number.isNaN(Number(value))
    ) {
      return "—";
    }

    return Number(value).toLocaleString("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function formatCurrency(value, currency = "USD") {
    if (
      value === null ||
      value === undefined ||
      value === "" ||
      Number.isNaN(Number(value))
    ) {
      return "—";
    }

    try {
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: String(
          currency || "USD"
        ).toUpperCase(),
        maximumFractionDigits: 2,
      }).format(Number(value));
    } catch {
      return `${currency || "USD"} ${formatNumber(value)}`;
    }
  }

  function riskTone(value) {
    const numeric = Math.abs(Number(value));

    if (numeric < 1) return "positive";
    if (numeric < 2.5) return "warning";

    return "negative";
  }

  function sharpeTone(value) {
    const numeric = Number(value);

    if (numeric > 1) return "positive";
    if (numeric > 0) return "warning";

    return "negative";
  }

  const riskReturnData =
    Array.isArray(portfolio?.comparison)
      ? portfolio.comparison.map((stock) => ({
          ticker: stock.ticker,
          return1y: Number(stock.return_1y),
          volatility: Number(stock.volatility),
          sharpe: Number(stock.sharpe),
          var95: Number(stock.var_95),
          score: Number(stock.score),
          weight: Number(
            portfolio?.weights?.[
              stock.ticker
            ] || 0
          ),
        }))
      : [];

  /*
   * Results are considered available when ANY part of
   * the stock analysis is ready, including the AI summary.
   */
  const hasSingleResults =
    info ||
    risk ||
    mc ||
    history.length > 0 ||
    historyLoading ||
    summaryLoading ||
    Boolean(summary) ||
    infoError ||
    riskError ||
    mcError ||
    historyError;

  /* -------------------------------------------------------
     SERVER STATUS LABEL
     ------------------------------------------------------- */
  const statusLabel =
    serverStatus === "pinging"
      ? "Waking up server…"
      : serverStatus === "awake"
      ? "Market data connected"
      : serverStatus === "error"
      ? "Server unreachable"
      : "Connecting…";

  const statusClass =
    serverStatus === "awake"
      ? "connection-status awake"
      : serverStatus === "error"
      ? "connection-status error"
      : "connection-status pinging";

  return (
    <div className="app">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      {/* COLD START TOAST */}
      {showColdStartToast && (
        <div
          className="cold-start-toast"
          role="status"
          aria-live="polite"
        >
          <span className="cold-start-icon">⏳</span>
          <div>
            <strong>Server waking up</strong>
            <p>
              The API may take a few seconds on first
              request — subsequent ones will be fast.
            </p>
          </div>
          <button
            className="cold-start-dismiss"
            onClick={() => setShowColdStartToast(false)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div className="app-frame">
        {/* ===================================================
            HEADER
           =================================================== */}

        <header className="header">
          <div className="brand-group">
            <div className="brand-logo">
              <span />
              <span />
              <span />
            </div>

            <div>
              <div className="brand-name">
                StockOS
              </div>

              <div className="brand-subtitle">
                Stock &amp; portfolio risk analyzer
              </div>
            </div>
          </div>

          <div className={statusClass}>
            <span
              className={`connection-dot ${
                serverStatus === "pinging" ? "pulsing" : ""
              }`}
            />
            {statusLabel}
          </div>
        </header>

        {/* ===================================================
            NAVIGATION
           =================================================== */}

        <nav className="main-nav">
          <button
            className={`nav-item ${
              mode === "single"
                ? "active"
                : ""
            }`}
            onClick={() =>
              switchMode("single")
            }
          >
            <ChartIcon />
            <span>Stocks</span>
          </button>

          <button
            className={`nav-item ${
              mode === "portfolio"
                ? "active"
                : ""
            }`}
            onClick={() =>
              switchMode("portfolio")
            }
          >
            <PortfolioIcon />
            <span>Portfolio</span>
          </button>
        </nav>

        {/* ===================================================
            SINGLE STOCK
           =================================================== */}

        {mode === "single" && (
          <main>
            <section className="page-intro">
              <div>
                <span className="section-kicker">
                  STOCK ANALYSIS
                </span>

                <h1>
                  Understand the risk behind a stock.
                </h1>

                <p>
                  Search a security to review
                  historical performance, risk
                  metrics and simulated price
                  scenarios.
                </p>
              </div>
            </section>

            <section className="search-panel">
              <label
                className="input-label"
                htmlFor="stock-search"
              >
                Security
              </label>

              <div className="search-row">
                <div className="search-field">
                  <span className="search-symbol">
                    <SearchIcon />
                  </span>

                  <TickerAutocomplete
                    inputId="stock-search"
                    value={ticker}
                    onChange={setTicker}
                    onSelect={(suggestion) => {
                      setTicker(suggestion.symbol);
                    }}
                    onEnter={() => {
                      if (!loading) analyze();
                    }}
                    placeholder="AAPL, MSFT, TCS.NS, RELIANCE.NS"
                  />
                </div>

                <button
                  className="action-button"
                  onClick={analyze}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <span className="button-spinner" />
                      Analyzing
                    </>
                  ) : (
                    <>
                      Analyze
                      <ArrowRight />
                    </>
                  )}
                </button>
              </div>

              <div className="example-row">
                <span>Try</span>

                <button
                  onClick={() => {
                    setTicker("AAPL");
                    setError("");
                  }}
                >
                  AAPL
                </button>

                <button
                  onClick={() => {
                    setTicker("MSFT");
                    setError("");
                  }}
                >
                  MSFT
                </button>

                <button
                  onClick={() => {
                    setTicker("TCS.NS");
                    setError("");
                  }}
                >
                  TCS.NS
                </button>

                <button
                  onClick={() => {
                    setTicker("RELIANCE.NS");
                    setError("");
                  }}
                >
                  RELIANCE.NS
                </button>
              </div>
            </section>

            {error && (
              <ErrorBanner message={error} />
            )}

            {loading && !hasSingleResults && (
              <LoadingState
                title="Analyzing security"
                description="Retrieving market data and calculating risk metrics."
              />
            )}

            {hasSingleResults && (
              <>
                {/* STOCK HEADER */}

                {infoError ? (
                  <EndpointErrorCard
                    label="Stock info"
                    message={infoError}
                    onRetry={() => fetchInfo(ticker)}
                  />
                ) : info ? (
                  <section className="security-header">
                    <div className="security-identity">
                      <div className="security-avatar">
                        {String(
                          info.name || ticker
                        )
                          .charAt(0)
                          .toUpperCase()}
                      </div>

                      <div>
                        <div className="security-name">
                          {info.name ||
                            "Unknown Security"}
                        </div>

                        <div className="security-meta">
                          <span>
                            {ticker.toUpperCase()}
                          </span>

                          <span className="meta-separator">
                            ·
                          </span>

                          <span>
                            {info.currency ||
                              "USD"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="price-block">
                      <span>
                        Current price
                      </span>

                      <strong>
                        {formatCurrency(
                          info.price,
                          info.currency
                        )}
                      </strong>
                    </div>
                  </section>
                ) : null}

                {/* RISK OVERVIEW */}

                {(risk || mc || riskError || mcError) && (
                  <section className="content-section">
                    <SectionHeading
                      eyebrow="RISK OVERVIEW"
                      title="Key metrics"
                      description="Derived from one year of historical price data."
                    />

                    <div className="metric-grid">
                      {riskError ? (
                        <EndpointErrorCard
                          label="Risk metrics"
                          message={riskError}
                          onRetry={() => fetchRisk(ticker)}
                          inline
                        />
                      ) : (
                        <>
                          <MetricCard
                            label="Daily volatility"
                            value={
                              risk
                                ? `${formatNumber(
                                    risk.volatility,
                                    3
                                  )}%`
                                : "Calculating"
                            }
                            caption={
                              risk
                                ? riskTone(
                                    risk.volatility
                                  ) === "positive"
                                  ? "Lower risk"
                                  : riskTone(
                                      risk.volatility
                                    ) === "warning"
                                  ? "Moderate"
                                  : "Higher risk"
                                : "Calculating…"
                            }
                            tone={
                              risk
                                ? riskTone(
                                    risk.volatility
                                  )
                                : "neutral"
                            }
                          />

                          <MetricCard
                            label="Sharpe ratio"
                            value={
                              risk
                                ? formatNumber(
                                    risk.sharpe_ratio,
                                    3
                                  )
                                : "Calculating"
                            }
                            caption={
                              risk
                                ? risk.sharpe_ratio > 1
                                  ? "Strong"
                                  : risk.sharpe_ratio > 0
                                  ? "Positive"
                                  : "Weak"
                                : "Calculating…"
                            }
                            tone={
                              risk
                                ? sharpeTone(
                                    risk.sharpe_ratio
                                  )
                                : "neutral"
                            }
                          />

                          <MetricCard
                            label="Value at Risk"
                            value={
                              risk
                                ? `${formatNumber(
                                    risk.var_95,
                                    3
                                  )}%`
                                : "Calculating"
                            }
                            caption="95% confidence"
                            tone={
                              risk
                                ? "negative"
                                : "neutral"
                            }
                          />
                        </>
                      )}

                      {mcError ? (
                        <EndpointErrorCard
                          label="Expected price"
                          message={mcError}
                          onRetry={() => fetchMc(ticker)}
                          inline
                        />
                      ) : (
                        <MetricCard
                          label="Expected price"
                          value={
                            mc
                              ? formatCurrency(
                                  mc.expected_price,
                                  info?.currency || "USD"
                                )
                              : "Calculating"
                          }
                          caption="1 year simulation"
                          tone={
                            mc
                              ? "positive"
                              : "neutral"
                          }
                        />
                      )}
                    </div>
                  </section>
                )}

                {/* HISTORY + INTERPRETATION */}

                {(history.length > 0 ||
                  historyLoading ||
                  historyError ||
                  summaryLoading ||
                  summary) && (
                  <section className="two-column-section">
                    <div className="panel chart-panel">
                      <SectionHeading
                        eyebrow="PRICE HISTORY"
                        title="Recent performance"
                        description="Last 60 trading sessions"
                        compact
                      />

                      <div className="chart-container">
                        {historyError ? (
                          <EndpointErrorCard
                            label="Price history"
                            message={historyError}
                            onRetry={() =>
                              fetchHistory(ticker)
                            }
                          />
                        ) : history.length > 0 ? (
                          <ResponsiveContainer
                            width="100%"
                            height={330}
                          >
                            <LineChart
                              data={history}
                              margin={{
                                top: 10,
                                right: 8,
                                left: -18,
                                bottom: 0,
                              }}
                            >
                              <XAxis
                                dataKey="Date"
                                hide
                              />

                              <YAxis
                                domain={[
                                  "auto",
                                  "auto",
                                ]}
                                axisLine={false}
                                tickLine={false}
                                tick={{
                                  fill: "#56616a",
                                  fontSize: 10,
                                }}
                                width={55}
                              />

                              <Tooltip
                                cursor={{
                                  stroke:
                                    "rgba(255,255,255,.08)",
                                }}
                                contentStyle={{
                                  background:
                                    "#10151a",
                                  border:
                                    "1px solid #263038",
                                  borderRadius:
                                    "8px",
                                  color:
                                    "#f0f4f2",
                                  boxShadow:
                                    "0 10px 30px rgba(0,0,0,.35)",
                                }}
                                labelStyle={{
                                  color: "#69737b",
                                  marginBottom:
                                    "5px",
                                }}
                                formatter={(value) => [
                                  formatCurrency(
                                    value,
                                    info?.currency || "USD"
                                  ),
                                  "Close",
                                ]}
                              />

                              <Line
                                type="monotone"
                                dataKey="Close"
                                stroke="#2be98c"
                                strokeWidth={2}
                                dot={false}
                                activeDot={{
                                  r: 4,
                                  stroke:
                                    "#2be98c",
                                  strokeWidth: 2,
                                  fill: "#0b0f12",
                                }}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        ) : (
                          <div
                            style={{
                              minHeight: 330,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "#56616a",
                              fontSize: "12px",
                              letterSpacing: "0.02em",
                            }}
                          >
                            Loading price history…
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="panel interpretation-panel">
                      <div className="interpretation-top">
                        <div className="interpretation-icon">
                          <ShieldIcon />
                        </div>

                        <div>
                          <span className="panel-kicker">
                            RISK INTERPRETATION
                          </span>

                          <h3>
                            Putting the numbers in context
                          </h3>
                        </div>
                      </div>

                      {summaryLoading ? (
                        <div className="interpretation-loading">
                          <span className="summary-skeleton-line" />
                          <span className="summary-skeleton-line" />
                          <span className="summary-skeleton-line short" />

                          <div className="interpretation-loading-note">
                            <span className="loading-dot" />
                            Generating risk interpretation
                          </div>
                        </div>
                      ) : summary ? (
                        <>
                          <p className="interpretation-copy">
                            {summary}
                          </p>

                          <div className="interpretation-source">
                            <span className="source-dot" />
                            Generated from the calculated
                            risk metrics
                          </div>
                        </>
                      ) : (
                        <div className="interpretation-loading-note">
                          <span className="loading-dot" />
                          Risk interpretation unavailable right now.
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {/* MONTE CARLO */}

                {mcError ? null : mc && (
                  <section className="content-section">
                    <SectionHeading
                      eyebrow="MONTE CARLO SIMULATION"
                      title="Potential price scenarios"
                      description="Illustrative outcomes based on historical return behaviour."
                      rightText="1 YEAR"
                    />

                    <div className="panel scenario-panel">
                      <div className="scenario-grid">
                        <Scenario
                          label="Worst case"
                          value={
                            mc.worst_case
                          }
                          tone="negative"
                          currency={
                            info?.currency || "USD"
                          }
                        />

                        <Scenario
                          label="VaR 95%"
                          value={mc.var_95}
                          tone="negative"
                          currency={
                            info?.currency || "USD"
                          }
                        />

                        <Scenario
                          label="Expected"
                          value={
                            mc.expected_price
                          }
                          tone="neutral"
                          currency={
                            info?.currency || "USD"
                          }
                        />

                        <Scenario
                          label="Current"
                          value={
                            mc.current_price
                          }
                          tone="neutral"
                          currency={
                            info?.currency || "USD"
                          }
                        />

                        <Scenario
                          label="Best case"
                          value={
                            mc.best_case
                          }
                          tone="positive"
                          currency={
                            info?.currency || "USD"
                          }
                        />
                      </div>

                      <div className="scenario-chart">
                        <ResponsiveContainer
                          width="100%"
                          height={290}
                        >
                          <LineChart
                            data={[
                              {
                                label: "Worst",
                                price:
                                  mc.worst_case,
                              },
                              {
                                label: "VaR 95%",
                                price:
                                  mc.var_95,
                              },
                              {
                                label: "Expected",
                                price:
                                  mc.expected_price,
                              },
                              {
                                label: "Current",
                                price:
                                  mc.current_price,
                              },
                              {
                                label: "Best",
                                price:
                                  mc.best_case,
                              },
                            ]}
                            margin={{
                              top: 10,
                              right: 8,
                              left: -14,
                              bottom: 0,
                            }}
                          >
                            <XAxis
                              dataKey="label"
                              axisLine={false}
                              tickLine={false}
                              tick={{
                                fill: "#56616a",
                                fontSize: 10,
                              }}
                            />

                            <YAxis
                              axisLine={false}
                              tickLine={false}
                              tick={{
                                fill: "#56616a",
                                fontSize: 10,
                              }}
                              width={58}
                            />

                            <Tooltip
                              contentStyle={{
                                background:
                                  "#10151a",
                                border:
                                  "1px solid #263038",
                                borderRadius:
                                  "8px",
                              }}
                              formatter={(value) => [
                                formatCurrency(
                                  value,
                                  info?.currency || "USD"
                                ),
                                "Price",
                              ]}
                            />

                            <ReferenceLine
                              y={
                                mc.current_price
                              }
                              stroke="#39434b"
                              strokeDasharray="5 5"
                            />

                            <Line
                              type="monotone"
                              dataKey="price"
                              stroke="#e5c85b"
                              strokeWidth={2}
                              dot={{
                                r: 4,
                                fill: "#e5c85b",
                                strokeWidth: 0,
                              }}
                              activeDot={{
                                r: 6,
                              }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </section>
                )}
              </>
            )}
          </main>
        )}

        {/* ===================================================
            PORTFOLIO
           =================================================== */}

        {mode === "portfolio" && (
          <main>
            <section className="page-intro">
              <div>
                <span className="section-kicker">
                  PORTFOLIO ANALYSIS
                </span>

                <h1>
                  Build a portfolio and compare the risk.
                </h1>

                <p>
                  Add your positions to understand
                  portfolio-level risk and see how
                  each holding compares on a
                  risk-adjusted basis.
                </p>
              </div>
            </section>

            {/* HOLDINGS */}

            <section className="panel holdings-panel">
              <div className="panel-header">
                <div>
                  <span className="panel-kicker">
                    POSITIONS
                  </span>

                  <h3>Your holdings</h3>
                </div>

                <span className="position-count">
                  {holdings.length}{" "}
                  {holdings.length === 1
                    ? "position"
                    : "positions"}
                </span>
              </div>

              <div className="holdings-labels">
                <span>Security</span>
                <span>Investment</span>
                <span />
              </div>

              <div className="holdings-list">
                {holdings.map(
                  (holding, index) => (
                    <div
                      className="holding-row"
                      key={index}
                    >
                      <div className="holding-field">
                        <span className="field-prefix">
                          TICKER
                        </span>

                        <TickerAutocomplete
                          inputId={`holding-ticker-${index}`}
                          value={holding.ticker}
                          onChange={(newValue) =>
                            updateHolding(
                              index,
                              "ticker",
                              newValue
                            )
                          }
                          onSelect={(suggestion) =>
                            updateHolding(
                              index,
                              "ticker",
                              suggestion.symbol
                            )
                          }
                          placeholder="e.g. TCS.NS"
                        />
                      </div>

                      <div className="holding-field amount-field">
                        <span className="currency-prefix">
                          ₹
                        </span>

                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="40,000"
                          value={
                            holding.amount
                          }
                          onChange={(event) =>
                            updateHolding(
                              index,
                              "amount",
                              event.target.value
                            )
                          }
                        />
                      </div>

                      <button
                        className="icon-button"
                        onClick={() =>
                          removeHolding(index)
                        }
                        disabled={
                          holdings.length === 1
                        }
                        aria-label={`Remove holding ${
                          index + 1
                        }`}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  )
                )}
              </div>

              <div className="holdings-actions">
                <button
                  className="secondary-button"
                  onClick={addHolding}
                >
                  <PlusIcon />
                  Add position
                </button>

                <button
                  className="action-button"
                  onClick={
                    analyzePortfolio
                  }
                  disabled={portfolioLoading}
                >
                  {portfolioLoading ? (
                    <>
                      <span className="button-spinner" />
                      Analyzing
                    </>
                  ) : (
                    <>
                      Analyze portfolio
                      <ArrowRight />
                    </>
                  )}
                </button>
              </div>
            </section>

            {error && (
              <ErrorBanner
                message={error}
                onRetry={
                  !portfolio
                    ? analyzePortfolio
                    : undefined
                }
                retryDisabled={portfolioLoading}
              />
            )}

            {portfolioLoading && (
              <LoadingState
                title="Analyzing portfolio"
                description="Fetching holdings concurrently and calculating portfolio risk."
              />
            )}

            {portfolio && (
              <>
                {/* WHAT IF BANNER */}
                {whatIfMode && (
                  <WhatIfBanner
                    onReset={resetSimulation}
                    onDeactivate={toggleWhatIf}
                  />
                )}

                {/* PORTFOLIO OVERVIEW */}

                <section className="content-section">
                  <div className="section-heading-row">
                    <SectionHeading
                      eyebrow="PORTFOLIO OVERVIEW"
                      title="Risk at a glance"
                      description="Portfolio-level statistics calculated from historical returns."
                    />

                    {/* What If toggle — only visible when portfolio is loaded */}
                    <button
                      className={`whatif-toggle ${whatIfMode ? "active" : ""}`}
                      onClick={toggleWhatIf}
                      title={
                        whatIfMode
                          ? "Exit What If mode"
                          : "Simulate portfolio rebalancing"
                      }
                    >
                      {whatIfMode ? "Exit What If" : "✦ What If"}
                    </button>
                  </div>

                  {/* What If Dashboard (Active) */}
                  {whatIfMode ? (
                    <WhatIfDashboard
                      holdings={holdings}
                      simWeights={simWeights}
                      setSimWeights={setSimWeights}
                      portfolio={portfolio}
                      formatCurrency={formatCurrency}
                    />
                  ) : (
                    /* Metrics — normal portfolio overview */
                    <div className="metric-grid">
                      <MetricCard
                        label="Total value"
                        value={formatCurrency(portfolio.total_value, "INR")}
                        caption="Portfolio value"
                        tone="positive"
                      />

                      <MetricCard
                        label="Volatility"
                        value={`${formatNumber(
                          portfolio.portfolio_volatility,
                          3
                        )}%`}
                        caption="Daily risk"
                        tone="warning"
                      />

                      <MetricCard
                        label="Sharpe ratio"
                        value={formatNumber(portfolio.portfolio_sharpe, 3)}
                        caption="Risk-adjusted return"
                        tone={sharpeTone(portfolio.portfolio_sharpe)}
                      />

                      <MetricCard
                        label="Value at Risk"
                        value={`${formatNumber(portfolio.portfolio_var_95, 3)}%`}
                        caption="95% confidence"
                        tone="negative"
                      />
                    </div>
                  )}
                </section>

                {/* COMPARISON TABLE */}

                {Array.isArray(
                  portfolio.comparison
                ) &&
                  portfolio.comparison.length > 0 && (
                    <section className="content-section">
                      <SectionHeading
                        eyebrow="HOLDING COMPARISON"
                        title="Which holdings stand out?"
                        description="A relative risk-adjusted comparison within this portfolio."
                        rightText="NOT A BUY / SELL SIGNAL"
                      />

                      <div className="panel comparison-panel">
                        <div className="comparison-table">
                          <div className="comparison-head">
                            <span>Rank</span>
                            <span>Security</span>
                            <span>1Y return</span>
                            <span>Volatility</span>
                            <span>Sharpe</span>
                            <span>VaR 95%</span>
                            <span>Gain / Loss</span>
                          </div>

                          {portfolio.comparison.map(
                            (stock) => (
                              <div
                                className={`comparison-row ${
                                  stock.rank === 1
                                    ? "is-top"
                                    : ""
                                }`}
                                key={
                                  stock.ticker
                                }
                              >
                                <span className="rank-cell">
                                  {stock.rank}
                                </span>

                                <div className="comparison-stock">
                                  <strong>
                                    {
                                      stock.ticker
                                    }
                                  </strong>

                                  {stock.rank ===
                                    1 && (
                                    <span>
                                      Strongest risk-adjusted
                                      profile
                                    </span>
                                  )}
                                </div>

                                <span
                                  className={
                                    Number(
                                      stock.return_1y
                                    ) >= 0
                                      ? "positive-text"
                                      : "negative-text"
                                  }
                                >
                                  {Number(
                                    stock.return_1y
                                  ) >= 0
                                    ? "+"
                                    : ""}
                                  {
                                    stock.return_1y
                                  }
                                  %
                                </span>

                                <span>
                                  {
                                    stock.volatility
                                  }
                                  %
                                </span>

                                <span
                                  className={
                                    Number(
                                      stock.sharpe
                                    ) > 1
                                      ? "positive-text"
                                      : Number(
                                          stock.sharpe
                                        ) > 0
                                      ? "warning-text"
                                      : "negative-text"
                                  }
                                >
                                  {
                                    stock.sharpe
                                  }
                                </span>

                                <span>
                                  {
                                    stock.var_95
                                  }
                                  %
                                </span>

                                <strong
                                  className={`gain-cell ${
                                    Number(
                                      stock.return_1y
                                    ) >= 0
                                      ? "positive-text"
                                      : "negative-text"
                                  }`}
                                >
                                  {(() => {
                                    const weightPct =
                                      Number(
                                        portfolio
                                          .weights?.[
                                          stock
                                            .ticker
                                        ]
                                      ) || 0;

                                    const invested =
                                      (weightPct /
                                        100) *
                                      Number(
                                        portfolio.total_value ||
                                          0
                                      );

                                    const gain =
                                      invested *
                                      (Number(
                                        stock.return_1y
                                      ) /
                                        100);

                                    return `${
                                      gain >= 0
                                        ? "+"
                                        : ""
                                    }${formatCurrency(
                                      gain,
                                      "INR"
                                    )}`;
                                  })()}
                                </strong>
                              </div>
                            )
                          )}
                        </div>

                        <div className="table-note">
                          Rank is based on a
                          risk-adjusted score combining
                          return, Sharpe ratio, volatility
                          and downside risk. Gain / loss
                          reflects the 1-year return
                          applied to your invested amount
                          for each holding.
                        </div>
                      </div>
                    </section>
                  )}

                {/* RISK / RETURN GRAPH */}

                {riskReturnData.length > 0 && (
                  <section className="content-section">
                    <SectionHeading
                      eyebrow="RISK / RETURN"
                      title="Where your holdings sit"
                      description="Higher return and lower volatility generally indicate a stronger risk-return position."
                      rightText="1Y RETURN · DAILY VOLATILITY"
                    />

                    <div className="panel risk-return-panel">
                      <div className="risk-return-chart">
                        <ResponsiveContainer
                          width="100%"
                          height={380}
                        >
                          <ScatterChart
                            margin={{
                              top: 20,
                              right: 24,
                              bottom: 18,
                              left: 8,
                            }}
                          >
                            <CartesianGrid
                              stroke="#1a2228"
                              strokeDasharray="3 5"
                              vertical={false}
                            />

                            <XAxis
                              type="number"
                              dataKey="volatility"
                              name="Daily volatility"
                              tick={{
                                fill: "#66717a",
                                fontSize: 10,
                              }}
                              tickLine={false}
                              axisLine={{
                                stroke:
                                  "#252e35",
                              }}
                              tickFormatter={(
                                value
                              ) =>
                                `${value}%`
                              }
                              label={{
                                value:
                                  "Daily volatility",
                                position:
                                  "insideBottom",
                                offset: -8,
                                fill:
                                  "#59646d",
                                fontSize: 10,
                              }}
                            />

                            <YAxis
                              type="number"
                              dataKey="return1y"
                              name="1Y return"
                              tick={{
                                fill: "#66717a",
                                fontSize: 10,
                              }}
                              tickLine={false}
                              axisLine={{
                                stroke:
                                  "#252e35",
                              }}
                              tickFormatter={(
                                value
                              ) =>
                                `${value}%`
                              }
                              label={{
                                value: "1Y return",
                                angle: -90,
                                position:
                                  "insideLeft",
                                fill:
                                  "#59646d",
                                fontSize: 10,
                              }}
                            />

                            <ZAxis
                              type="number"
                              dataKey="weight"
                              range={[
                                90,
                                360,
                              ]}
                              name="Portfolio weight"
                            />

                            <Tooltip
                              cursor={{
                                stroke:
                                  "rgba(255,255,255,0.12)",
                                strokeDasharray:
                                  "4 4",
                              }}
                              content={
                                <RiskReturnTooltip />
                              }
                            />

                            <Scatter
                              name="Holdings"
                              data={
                                riskReturnData
                              }
                              fill="#2be98c"
                            />
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="risk-return-footer">
                        <div className="risk-return-hint">
                          <div className="hint-axis">
                            <span className="hint-arrow">
                              ↖
                            </span>

                            <div>
                              <strong>
                                More attractive position
                              </strong>

                              <span>
                                Higher return with
                                lower volatility
                              </span>
                            </div>
                          </div>

                          <div className="hint-axis">
                            <span className="hint-arrow">
                              →
                            </span>

                            <div>
                              <strong>
                                More risk
                              </strong>

                              <span>
                                Volatility increases
                                toward the right
                              </span>
                            </div>
                          </div>

                          <div className="hint-axis">
                            <span className="hint-dot" />

                            <div>
                              <strong>
                                Larger circle
                              </strong>

                              <span>
                                Larger portfolio
                                allocation
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {/* ALLOCATION + CORRELATION */}

                <section className="two-column-section portfolio-detail-section">
                  <div className="panel">
                    <SectionHeading
                      eyebrow="ALLOCATION"
                      title="Portfolio weights"
                      description="Share of total invested capital."
                      compact
                    />

                    <div className="detail-list">
                      {Object.entries(
                        portfolio.weights ||
                          {}
                      ).map(
                        ([tickerName, weight]) => (
                          <div
                            className="detail-row"
                            key={tickerName}
                          >
                            <div className="detail-name">
                              <span className="detail-dot" />
                              <span>
                                {tickerName}
                              </span>
                            </div>

                            <strong>
                              {weight}%
                            </strong>
                          </div>
                        )
                      )}
                    </div>
                  </div>

                  <div className="panel">
                    <SectionHeading
                      eyebrow="DIVERSIFICATION"
                      title="Correlation"
                      description="How closely these two stocks move together."
                      compact
                    />

                    <div className="detail-list">
                      {Object.entries(
                        portfolio.correlation ||
                          {}
                      ).length > 0 ? (
                        <>
                          {Object.entries(
                            portfolio.correlation
                          ).map(
                            ([pair, value]) => {
                              const num = parseFloat(value);
                              let label, meaning;
                              if (num >= 0.85) {
                                label = "Very High";
                                meaning =
                                  "These stocks almost always move in the same direction — holding both offers little diversification benefit.";
                              } else if (num >= 0.6) {
                                label = "Moderately High";
                                meaning =
                                  "They often move together, so your risk is only partially spread across the two.";
                              } else if (num >= 0.3) {
                                label = "Moderate";
                                meaning =
                                  "Some shared movement, but they also diverge frequently — a decent diversification balance.";
                              } else if (num >= 0) {
                                label = "Low";
                                meaning =
                                  "They move somewhat independently, which helps reduce overall portfolio volatility.";
                              } else if (num >= -0.3) {
                                label = "Slightly Negative";
                                meaning =
                                  "They tend to move in opposite directions mildly — good for cushioning dips in either stock.";
                              } else {
                                label = "Strongly Negative";
                                meaning =
                                  "When one rises the other typically falls — these two act as natural hedges for each other.";
                              }
                              return (
                                <div key={pair}>
                                  <div className="detail-row">
                                    <span>
                                      {pair.replaceAll(
                                        "_",
                                        " ↔ "
                                      )}
                                    </span>

                                    <strong className="correlation-value">
                                      {value}
                                    </strong>
                                  </div>

                                  <div className="correlation-summary">
                                    <strong>{label} correlation.</strong>{" "}
                                    {meaning}
                                  </div>
                                </div>
                              );
                            }
                          )}
                        </>
                      ) : (
                        <div className="empty-detail">
                          Correlation data is
                          unavailable for this
                          portfolio.
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </>
            )}
          </main>
        )}

        <footer className="footer">
          <span>STOCKOS</span>
          <span>
            QUANTITATIVE RISK ANALYTICS
          </span>
        </footer>
      </div>
    </div>
  );
}

/* =========================================================
   REUSABLE COMPONENTS
   ========================================================= */

function WhatIfBanner({ onReset, onDeactivate }) {
  return (
    <div className="whatif-banner" role="status" aria-live="polite">
      <div className="whatif-banner-left">
        <span className="whatif-badge">SIMULATED — not saved</span>
      </div>
      <div className="whatif-banner-right">
        <button
          className="whatif-reset-btn"
          onClick={onReset}
          title="Snap back to real portfolio amounts"
        >
          ↺ Reset
        </button>
        <button
          className="whatif-exit-btn"
          onClick={onDeactivate}
          title="Exit What If mode"
        >
          ✕ Exit
        </button>
      </div>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  rightText,
  compact = false,
}) {
  return (
    <div
      className={`section-heading ${
        compact ? "compact" : ""
      }`}
    >
      <div>
        <span className="section-kicker">
          {eyebrow}
        </span>

        <h2>{title}</h2>

        {description && (
          <p>{description}</p>
        )}
      </div>

      {rightText && (
        <span className="section-note">
          {rightText}
        </span>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  caption,
  tone = "neutral",
}) {
  return (
    <article className="metric-card">
      <div className="metric-card-top">
        <span>{label}</span>

        <span
          className={`metric-dot ${tone}`}
        />
      </div>

      <strong
        className={`metric-number ${tone}`}
      >
        {value}
      </strong>

      <span
        className={`metric-caption ${tone}`}
      >
        {caption}
      </span>
    </article>
  );
}

/**
 * EndpointErrorCard
 * Shown inside a section when one specific endpoint fails.
 * Provides a targeted retry button so the user doesn't
 * have to re-run the full analysis.
 */
function EndpointErrorCard({ label, message, onRetry, inline = false }) {
  return (
    <div
      className={`endpoint-error-card ${inline ? "inline" : ""}`}
      role="alert"
    >
      <div className="endpoint-error-body">
        <span className="endpoint-error-label">{label}</span>
        <p className="endpoint-error-msg">{message}</p>
      </div>
      {onRetry && (
        <button
          className="endpoint-retry-btn"
          onClick={onRetry}
          aria-label={`Retry ${label}`}
        >
          <RetryIcon />
          Retry
        </button>
      )}
    </div>
  );
}

function Scenario({
  label,
  value,
  tone,
  currency,
}) {
  return (
    <div className="scenario-item">
      <span>{label}</span>

      <strong className={tone}>
        {formatScenarioValue(
          value,
          currency
        )}
      </strong>
    </div>
  );
}

function formatScenarioValue(
  value,
  currency
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "—";
  }

  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: String(
        currency || "USD"
      ).toUpperCase(),
      maximumFractionDigits: 2,
    }).format(Number(value));
  } catch {
    return Number(value).toLocaleString(
      "en-IN",
      {
        maximumFractionDigits: 2,
      }
    );
  }
}

function RiskReturnTooltip({
  active,
  payload,
}) {
  if (
    !active ||
    !payload ||
    !payload.length ||
    !payload[0]?.payload
  ) {
    return null;
  }

  const stock = payload[0].payload;

  return (
    <div className="risk-return-tooltip">
      <div className="tooltip-title">
        {stock.ticker}
      </div>

      <div className="tooltip-grid">
        <span>1Y return</span>

        <strong
          className={
            stock.return1y >= 0
              ? "positive-text"
              : "negative-text"
          }
        >
          {stock.return1y >= 0
            ? "+"
            : ""}
          {stock.return1y}%
        </strong>

        <span>Volatility</span>

        <strong>
          {stock.volatility}%
        </strong>

        <span>Sharpe</span>

        <strong>{stock.sharpe}</strong>

        <span>VaR 95%</span>

        <strong>{stock.var95}%</strong>

        <span>Portfolio weight</span>

        <strong>
          {stock.weight}%
        </strong>
      </div>
    </div>
  );
}

function ErrorBanner({ message, onRetry, retryDisabled }) {
  return (
    <div className="error-banner">
      <span className="error-icon">!</span>

      <div>
        <strong>
          Something went wrong
        </strong>

        <p>{message}</p>
      </div>

      {onRetry && (
        <button
          className="error-retry-btn"
          onClick={onRetry}
          disabled={retryDisabled}
          aria-label="Retry"
        >
          <RetryIcon />
          Retry
        </button>
      )}
    </div>
  );
}

function LoadingState({
  title,
  description,
}) {
  return (
    <div className="loading-state">
      <div className="loading-indicator">
        <span />
      </div>

      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}
// import React, { useRef, useState, useEffect } from "react";

export function WhatIfDashboard({ holdings, simWeights, setSimWeights, portfolio, formatCurrency }) {
  // 1. Gather data
  const baseHoldings = holdings
    .filter((h) => h.ticker.trim() && Number(h.amount) > 0)
    .map((h) => {
      const ticker = h.ticker.trim().toUpperCase();
      // Find return_1y from portfolio.comparison
      const comp = portfolio.comparison?.find(c => c.ticker === ticker);
      const return1y = comp ? Number(comp.return_1y) : 0;
      return {
        ticker,
        originalAmount: Number(h.amount),
        amount: simWeights[ticker] !== undefined ? simWeights[ticker] : Number(h.amount),
        return1y
      };
    });

  const totalValue = portfolio.total_value;

  // 2. Compute gains
  let currentGain = 0;
  let simGain = 0;
  baseHoldings.forEach(h => {
    currentGain += h.originalAmount * (h.return1y / 100);
    simGain += h.amount * (h.return1y / 100);
  });

  const gainDiff = simGain - currentGain;

  // 3. Slider Drag Logic
  const trackRef = useRef(null);

  const handlePointerDown = (e, dividerIndex) => {
    e.preventDefault();
    if (!trackRef.current) return;
    const trackRect = trackRef.current.getBoundingClientRect();
    
    // We are dragging the boundary between dividerIndex and dividerIndex + 1
    const leftItem = baseHoldings[dividerIndex];
    const rightItem = baseHoldings[dividerIndex + 1];

    const startX = e.clientX || (e.touches && e.touches[0].clientX);
    const startAmountLeft = leftItem.amount;
    const startAmountRight = rightItem.amount;

    const onPointerMove = (moveEvent) => {
      const currentX = moveEvent.clientX || (moveEvent.touches && moveEvent.touches[0].clientX);
      const deltaPx = currentX - startX;
      const deltaAmount = (deltaPx / trackRect.width) * totalValue;

      let newLeft = startAmountLeft + deltaAmount;
      let newRight = startAmountRight - deltaAmount;

      if (newLeft < 0) {
        newRight += newLeft;
        newLeft = 0;
      }
      if (newRight < 0) {
        newLeft += newRight;
        newRight = 0;
      }

      const nextWeights = { ...simWeights };
      // initialize all if missing
      baseHoldings.forEach(h => {
        if (nextWeights[h.ticker] === undefined) {
          nextWeights[h.ticker] = h.originalAmount;
        }
      });
      nextWeights[leftItem.ticker] = newLeft;
      nextWeights[rightItem.ticker] = newRight;
      
      setSimWeights(nextWeights);
    };

    const onPointerUp = () => {
      document.removeEventListener("mousemove", onPointerMove);
      document.removeEventListener("mouseup", onPointerUp);
      document.removeEventListener("touchmove", onPointerMove);
      document.removeEventListener("touchend", onPointerUp);
    };

    document.addEventListener("mousemove", onPointerMove);
    document.addEventListener("mouseup", onPointerUp);
    document.addEventListener("touchmove", onPointerMove, { passive: false });
    document.addEventListener("touchend", onPointerUp);
  };

  // Render Allocation Bar
  return (
    <div className="whatif-dashboard">
      <div className="whatif-panel panel">
        <div className="whatif-panel-header">
          <span className="panel-kicker">ALLOCATION</span>
          <span className="whatif-hint">Drag to move money between holdings</span>
        </div>

        <div className="allocation-track-wrapper">
          <div className="allocation-track" ref={trackRef}>
            {baseHoldings.map((h, i) => {
              const pct = (h.amount / totalValue) * 100;
              const isLast = i === baseHoldings.length - 1;
              const el = (
                <div key={h.ticker} className="allocation-segment" style={{ width: `${pct}%` }}>
                  <div className="segment-content">
                    <span className="segment-ticker">{h.ticker}</span>
                    <span className="segment-pct">{pct.toFixed(1)}%</span>
                    <span className="segment-amt">{formatCurrency(h.amount, "INR")}</span>
                  </div>
                  {!isLast && (
                    <div 
                      className="allocation-divider" 
                      onMouseDown={(e) => handlePointerDown(e, i)}
                      onTouchStart={(e) => handlePointerDown(e, i)}
                    >
                      <div className="divider-handle"></div>
                    </div>
                  )}
                </div>
              );
              return el;
            })}
          </div>
        </div>
      </div>

      <div className="whatif-results-grid">
        <div className="whatif-result-card panel">
          <span className="result-kicker">CURRENT PORTFOLIO</span>
          <div className="result-main">
            <span className="result-label">Historical 1Y gain:</span>
            <span className={`result-val ${currentGain >= 0 ? "positive-text" : "negative-text"}`}>
              {currentGain >= 0 ? "+" : ""}{formatCurrency(currentGain, "INR")}
            </span>
          </div>
          <div className="result-sub">
            Ending value: {formatCurrency(totalValue + currentGain, "INR")}
          </div>
        </div>

        <div className="whatif-result-card panel sim-card">
          <span className="result-kicker sim-kicker">WHAT IF</span>
          <div className="result-main">
            <span className="result-label">Historical 1Y gain:</span>
            <span className={`result-val ${simGain >= 0 ? "positive-text" : "negative-text"}`}>
              {simGain >= 0 ? "+" : ""}{formatCurrency(simGain, "INR")}
            </span>
          </div>
          <div className="result-sub">
            Ending value: {formatCurrency(totalValue + simGain, "INR")}
          </div>
        </div>
      </div>

      <div className="whatif-delta-banner">
        <div className="delta-content">
          <span className="delta-label">DIFFERENCE</span>
          <span className={`delta-val ${gainDiff >= 0 ? "positive-text" : "negative-text"}`}>
            {gainDiff >= 0 ? "+" : ""}{formatCurrency(gainDiff, "INR")} {gainDiff >= 0 ? "more" : "less"} historical 1Y gain
          </span>
          <span className="delta-disclaimer">Based on historical 1Y returns. Not a prediction.</span>
        </div>
      </div>
    </div>
  );
}

// import React, { useRef, useState, useEffect } from "react";

