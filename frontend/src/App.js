import { useState } from "react";
import axios from "axios";
import TickerAutocomplete from "./TickerAutocomplete";
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

const API =
  process.env.REACT_APP_API_URL ||
  "https://portfolioos-backend-1qdb.onrender.com";

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

  const [holdings, setHoldings] = useState([
    { ticker: "", amount: "" },
  ]);

  const [portfolio, setPortfolio] = useState(null);

  const [mode, setMode] = useState("single");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /* -------------------------------------------------------
     Single stock analysis
     ------------------------------------------------------- */

  async function analyze() {
    if (!ticker.trim()) {
      setError("Enter a ticker symbol to continue.");
      return;
    }

    setLoading(true);
    setError("");

    setInfo(null);
    setRisk(null);
    setMc(null);
    setHistory([]);
    setSummary("");
    setPortfolio(null);

    try {
      const symbol = ticker.trim().toUpperCase();

      const [
        infoResponse,
        riskResponse,
        monteCarloResponse,
        historyResponse,
        summaryResponse,
      ] = await Promise.all([
        axios.get(`${API}/stock/${symbol}`),
        axios.get(`${API}/stock/${symbol}/risk`),
        axios.get(`${API}/stock/${symbol}/montecarlo`),
        axios.get(`${API}/stock/${symbol}/history`),
        axios.get(`${API}/stock/${symbol}/summary`),
      ]);

      setTicker(symbol);
      setInfo(infoResponse.data);
      setRisk(riskResponse.data);
      setMc(monteCarloResponse.data);

      setHistory(
        Array.isArray(historyResponse.data)
          ? historyResponse.data.slice(-60)
          : []
      );

      setSummary(
        summaryResponse.data?.summary || ""
      );
    } catch (err) {
      console.error(err);

      setError(
        err?.response?.data?.detail ||
          "Unable to retrieve this security. Check the ticker and try again."
      );
    } finally {
      setLoading(false);
    }
  }

  /* -------------------------------------------------------
     Portfolio analysis
     ------------------------------------------------------- */

  async function analyzePortfolio() {
    setLoading(true);
    setError("");

    setPortfolio(null);
    setInfo(null);
    setRisk(null);
    setMc(null);
    setHistory([]);
    setSummary("");

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
        setLoading(false);
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
    } catch (err) {
      console.error(err);

      setError(
        err?.response?.data?.detail ||
          "Unable to analyze this portfolio. Check the holdings and try again."
      );
    } finally {
      setLoading(false);
    }
  }

  /* -------------------------------------------------------
     UI helpers
     ------------------------------------------------------- */

  function switchMode(nextMode) {
    setMode(nextMode);

    setInfo(null);
    setRisk(null);
    setMc(null);
    setHistory([]);
    setSummary("");
    setPortfolio(null);
    setError("");
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

  const hasSingleResults =
    info && risk && mc;

  return (
    <div className="app">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

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
                PortfolioOS
              </div>

              <div className="brand-subtitle">
                Stock &amp; portfolio risk analyzer
              </div>
            </div>
          </div>

          <div className="connection-status">
            <span className="connection-dot" />
            Market data connected
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

            {loading && (
              <LoadingState
                title="Analyzing security"
                description="Retrieving market data and calculating risk metrics."
              />
            )}

            {hasSingleResults && (
              <>
                {/* STOCK HEADER */}

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

                {/* RISK OVERVIEW */}

                <section className="content-section">
                  <SectionHeading
                    eyebrow="RISK OVERVIEW"
                    title="Key metrics"
                    description="Derived from one year of historical price data."
                  />

                  <div className="metric-grid">
                    <MetricCard
                      label="Daily volatility"
                      value={`${formatNumber(
                        risk.volatility,
                        3
                      )}%`}
                      caption={
                        riskTone(
                          risk.volatility
                        ) === "positive"
                          ? "Lower risk"
                          : riskTone(
                              risk.volatility
                            ) === "warning"
                          ? "Moderate"
                          : "Higher risk"
                      }
                      tone={riskTone(
                        risk.volatility
                      )}
                    />

                    <MetricCard
                      label="Sharpe ratio"
                      value={formatNumber(
                        risk.sharpe_ratio,
                        3
                      )}
                      caption={
                        risk.sharpe_ratio > 1
                          ? "Strong"
                          : risk.sharpe_ratio > 0
                          ? "Positive"
                          : "Weak"
                      }
                      tone={sharpeTone(
                        risk.sharpe_ratio
                      )}
                    />

                    <MetricCard
                      label="Value at Risk"
                      value={`${formatNumber(
                        risk.var_95,
                        3
                      )}%`}
                      caption="95% confidence"
                      tone="negative"
                    />

                    <MetricCard
                      label="Expected price"
                      value={formatCurrency(
                        mc.expected_price,
                        info.currency
                      )}
                      caption="1 year simulation"
                      tone="positive"
                    />
                  </div>
                </section>

                {/* HISTORY + INTERPRETATION */}

                <section className="two-column-section">
                  <div className="panel chart-panel">
                    <SectionHeading
                      eyebrow="PRICE HISTORY"
                      title="Recent performance"
                      description="Last 60 trading sessions"
                      compact
                    />

                    <div className="chart-container">
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
                                info.currency
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
                    </div>
                  </div>

                  {summary && (
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

                      <p className="interpretation-copy">
                        {summary}
                      </p>

                      <div className="interpretation-source">
                        <span className="source-dot" />
                        Generated from the calculated
                        risk metrics
                      </div>
                    </div>
                  )}
                </section>

                {/* MONTE CARLO */}

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
                          info.currency
                        }
                      />

                      <Scenario
                        label="VaR 95%"
                        value={mc.var_95}
                        tone="negative"
                        currency={
                          info.currency
                        }
                      />

                      <Scenario
                        label="Expected"
                        value={
                          mc.expected_price
                        }
                        tone="neutral"
                        currency={
                          info.currency
                        }
                      />

                      <Scenario
                        label="Current"
                        value={
                          mc.current_price
                        }
                        tone="neutral"
                        currency={
                          info.currency
                        }
                      />

                      <Scenario
                        label="Best case"
                        value={
                          mc.best_case
                        }
                        tone="positive"
                        currency={
                          info.currency
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
                                info.currency
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
                  disabled={loading}
                >
                  {loading ? (
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
              <ErrorBanner message={error} />
            )}

            {loading && (
              <LoadingState
                title="Analyzing portfolio"
                description="Retrieving holdings and calculating portfolio risk."
              />
            )}

            {portfolio && (
              <>
                {/* PORTFOLIO OVERVIEW */}

                <section className="content-section">
                  <SectionHeading
                    eyebrow="PORTFOLIO OVERVIEW"
                    title="Risk at a glance"
                    description="Portfolio-level statistics calculated from historical returns."
                  />

                  <div className="metric-grid">
                    <MetricCard
                      label="Total value"
                      value={formatCurrency(
                        portfolio.total_value,
                        "INR"
                      )}
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
                      value={formatNumber(
                        portfolio.portfolio_sharpe,
                        3
                      )}
                      caption="Risk-adjusted return"
                      tone={sharpeTone(
                        portfolio.portfolio_sharpe
                      )}
                    />

                    <MetricCard
                      label="Value at Risk"
                      value={`${formatNumber(
                        portfolio.portfolio_var_95,
                        3
                      )}%`}
                      caption="95% confidence"
                      tone="negative"
                    />
                  </div>
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
                            <span>Score</span>
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

                                <strong className="score-cell">
                                  {stock.score}
                                </strong>
                              </div>
                            )
                          )}
                        </div>

                        <div className="table-note">
                          The score combines return,
                          Sharpe ratio, volatility and
                          downside risk. It ranks only
                          the holdings entered into this
                          portfolio.
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
                      description="Relationship between portfolio holdings."
                      compact
                    />

                    <div className="detail-list">
                      {Object.entries(
                        portfolio.correlation ||
                          {}
                      ).length > 0 ? (
                        Object.entries(
                          portfolio.correlation
                        ).map(
                          ([pair, value]) => (
                            <div
                              className="detail-row"
                              key={pair}
                            >
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
                          )
                        )
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
          <span>PORTFOLIOOS</span>
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

function ErrorBanner({ message }) {
  return (
    <div className="error-banner">
      <span className="error-icon">!</span>

      <div>
        <strong>
          Something went wrong
        </strong>

        <p>{message}</p>
      </div>
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