import { useState } from "react";
import axios from "axios";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import "./App.css";

const API =
  process.env.REACT_APP_API_URL ||
  "https://portfolioos-backend-1qdb.onrender.com";

export default function App() {
  const [ticker, setTicker] = useState("");
  const [info, setInfo] = useState(null);
  const [risk, setRisk] = useState(null);
  const [mc, setMc] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");

  const [holdings, setHoldings] = useState([
    { ticker: "", amount: "" },
  ]);

  const [portfolio, setPortfolio] = useState(null);
  const [mode, setMode] = useState("single");

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
      const t = ticker.trim().toUpperCase();

      const [iRes, rRes, mRes, hRes, sRes] = await Promise.all([
        axios.get(`${API}/stock/${t}`),
        axios.get(`${API}/stock/${t}/risk`),
        axios.get(`${API}/stock/${t}/montecarlo`),
        axios.get(`${API}/stock/${t}/history`),
        axios.get(`${API}/stock/${t}/summary`),
      ]);

      setTicker(t);
      setInfo(iRes.data);
      setRisk(rRes.data);
      setMc(mRes.data);
      setHistory(Array.isArray(hRes.data) ? hRes.data.slice(-60) : []);
      setSummary(sRes.data?.summary || "");
    } catch (err) {
      console.error(err);

      const backendMessage =
        err?.response?.data?.detail ||
        err?.response?.data?.message;

      setError(
        backendMessage ||
          "Could not retrieve the requested data. Check the ticker and try again."
      );
    } finally {
      setLoading(false);
    }
  }

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

  function sharpeColor(value) {
    const numeric = Number(value);

    if (numeric > 1) return "positive";
    if (numeric > 0) return "warning";
    return "negative";
  }

  function riskLevel(value) {
    const numeric = Math.abs(Number(value));

    if (numeric < 1) {
      return {
        label: "LOW",
        className: "positive",
      };
    }

    if (numeric < 2.5) {
      return {
        label: "MODERATE",
        className: "warning",
      };
    }

    return {
      label: "HIGH",
      className: "negative",
    };
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

    const safeCurrency =
      typeof currency === "string" && currency.trim()
        ? currency.toUpperCase()
        : "USD";

    try {
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: safeCurrency,
        maximumFractionDigits: 2,
      }).format(Number(value));
    } catch {
      return `${safeCurrency} ${formatNumber(value)}`;
    }
  }

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
          "Add at least one stock with a valid investment amount."
        );
        setLoading(false);
        return;
      }

      const payload = {
        holdings: validHoldings.map((holding) => ({
          ticker: holding.ticker.trim().toUpperCase(),
          amount: parseFloat(holding.amount),
        })),
      };

      const res = await axios.post(
        `${API}/portfolio/risk`,
        payload
      );

      setPortfolio(res.data);
    } catch (err) {
      console.error(err);

      const backendMessage =
        err?.response?.data?.detail ||
        err?.response?.data?.message;

      setError(
        backendMessage ||
          "Could not analyze the portfolio. Check your holdings and try again."
      );
    } finally {
      setLoading(false);
    }
  }

  function updateHolding(index, field, value) {
    setHoldings((current) =>
      current.map((holding, holdingIndex) =>
        holdingIndex === index
          ? {
              ...holding,
              [field]: value,
            }
          : holding
      )
    );
  }

  function removeHolding(index) {
    if (holdings.length === 1) return;

    setHoldings((current) =>
      current.filter((_, holdingIndex) => holdingIndex !== index)
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

  return (
    <div className="app-shell">
      <div className="background-glow glow-one" />
      <div className="background-glow glow-two" />

      <main className="container">
        {/* HEADER */}
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">P</div>

            <div>
              <h1>PortfolioOS</h1>

              <p>
                Stock and portfolio risk analysis
              </p>
            </div>
          </div>

          <div className="status-pill">
            <span className="status-dot" />
            LIVE MARKET DATA
          </div>
        </header>

        {/* NAVIGATION */}
        <section className="navigation">
          <div className="tabs">
            <button
              className={`tab ${
                mode === "single" ? "active" : ""
              }`}
              onClick={() => switchMode("single")}
            >
              <span>01</span>
              Single Stock
            </button>

            <button
              className={`tab ${
                mode === "portfolio" ? "active" : ""
              }`}
              onClick={() => switchMode("portfolio")}
            >
              <span>02</span>
              Portfolio
            </button>
          </div>
        </section>

        {/* SINGLE STOCK */}
        {mode === "single" && (
          <>
            {/* SEARCH */}
            <section className="search-section">
              <div className="search-heading">
                <span className="eyebrow">
                  STOCK ANALYSIS
                </span>

                <h2>Analyze a stock</h2>

                <p>
                  Enter a ticker to evaluate performance,
                  risk and simulated price scenarios.
                </p>
              </div>

              <div className="search-bar">
                <div className="search-input-wrap">
                  <span
                    className="search-icon"
                    aria-hidden="true"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle
                        cx="11"
                        cy="11"
                        r="7"
                      />
                      <path d="m20 20-3.5-3.5" />
                    </svg>
                  </span>

                  <input
                    value={ticker}
                    onChange={(e) =>
                      setTicker(e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !loading
                      ) {
                        analyze();
                      }
                    }}
                    placeholder="Enter ticker — AAPL, TCS.NS, RELIANCE.NS"
                    autoCapitalize="characters"
                    spellCheck="false"
                    autoComplete="off"
                  />
                </div>

                <button
                  className="primary-button"
                  onClick={analyze}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <span className="spinner" />
                      Analyzing
                    </>
                  ) : (
                    <>
                      Analyze
                      <span className="button-arrow">
                        →
                      </span>
                    </>
                  )}
                </button>
              </div>

              <div className="search-hint">
                <span>Examples</span>
                AAPL · MSFT · TCS.NS · RELIANCE.NS
              </div>
            </section>

            {error && mode === "single" && (
              <div className="error-banner">
                <span>!</span>
                {error}
              </div>
            )}

            {loading && mode === "single" && (
              <div className="loading-panel">
                <div className="loading-line" />

                <div>
                  <strong>
                    Running stock analysis
                  </strong>

                  <p>
                    Fetching market data and running
                    quantitative risk calculations...
                  </p>
                </div>
              </div>
            )}

            {/* STOCK RESULTS */}
            {info && risk && mc && (
              <>
                {/* STOCK HERO */}
                <section className="stock-hero">
                  <div className="stock-identity">
                    <div className="stock-avatar">
                      {String(
                        info.name || ticker
                      )
                        .charAt(0)
                        .toUpperCase()}
                    </div>

                    <div>
                      <div className="stock-name">
                        {info.name ||
                          "Unknown Security"}
                      </div>

                      <div className="stock-meta">
                        <span>
                          {ticker
                            .trim()
                            .toUpperCase()}
                        </span>

                        <i />

                        <span>
                          {info.currency ||
                            "USD"}
                        </span>

                        <i />

                        <span>
                          MARKET DATA
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="stock-price">
                    <span className="price-label">
                      CURRENT PRICE
                    </span>

                    <strong>
                      {formatCurrency(
                        info.price,
                        info.currency
                      )}
                    </strong>
                  </div>
                </section>

                {/* METRICS */}
                <section className="metrics-section">
                  <div className="section-heading-row">
                    <div>
                      <span className="eyebrow">
                        RISK SNAPSHOT
                      </span>

                      <h2>Key metrics</h2>
                    </div>

                    <span className="data-badge">
                      QUANTITATIVE
                    </span>
                  </div>

                  <div className="metrics-grid">
                    <MetricCard
                      label="Daily Volatility"
                      value={`${formatNumber(
                        risk.volatility,
                        3
                      )}%`}
                      detail={
                        riskLevel(
                          risk.volatility
                        ).label
                      }
                      tone={
                        riskLevel(
                          risk.volatility
                        ).className
                      }
                    />

                    <MetricCard
                      label="Sharpe Ratio"
                      value={formatNumber(
                        risk.sharpe_ratio,
                        3
                      )}
                      detail={
                        risk.sharpe_ratio > 1
                          ? "STRONG"
                          : risk.sharpe_ratio > 0
                          ? "POSITIVE"
                          : "WEAK"
                      }
                      tone={sharpeColor(
                        risk.sharpe_ratio
                      )}
                    />

                    <MetricCard
                      label="Value at Risk"
                      value={`${formatNumber(
                        risk.var_95,
                        3
                      )}%`}
                      detail="95% CONFIDENCE"
                      tone="negative"
                    />

                    <MetricCard
                      label="Expected Price"
                      value={formatCurrency(
                        mc.expected_price,
                        info.currency
                      )}
                      detail="1 YEAR SIMULATION"
                      tone="positive"
                    />

                    <MetricCard
                      label="Worst Case"
                      value={formatCurrency(
                        mc.worst_case,
                        info.currency
                      )}
                      detail="DOWNSIDE SCENARIO"
                      tone="negative"
                    />

                    <MetricCard
                      label="Best Case"
                      value={formatCurrency(
                        mc.best_case,
                        info.currency
                      )}
                      detail="UPSIDE SCENARIO"
                      tone="positive"
                    />
                  </div>
                </section>

                {/* AI SUMMARY */}
                {summary && (
                  <section className="ai-card">
                    <div className="ai-header">
                      <div className="ai-icon">
                        ✦
                      </div>

                      <div>
                        <span className="eyebrow">
                          RISK INTERPRETATION
                        </span>

                        <h3>
                          What the numbers mean
                        </h3>
                      </div>

                      <span className="ai-badge">
                        GEMINI
                      </span>
                    </div>

                    <p>{summary}</p>
                  </section>
                )}

                {/* HISTORICAL CHART */}
                <section className="charts-section">
                  <div className="section-heading-row">
                    <div>
                      <span className="eyebrow">
                        MARKET HISTORY
                      </span>

                      <h2>Price performance</h2>
                    </div>

                    <span className="chart-period">
                      LAST 60 DAYS
                    </span>
                  </div>

                  <div className="chart-box main-chart">
                    <div className="chart-topline">
                      <div>
                        <span className="chart-title">
                          Closing Price
                        </span>

                        <span className="chart-subtitle">
                          Historical market data
                        </span>
                      </div>

                      <div className="chart-indicator">
                        <span />
                        PRICE
                      </div>
                    </div>

                    <ResponsiveContainer
                      width="100%"
                      height={360}
                    >
                      <LineChart
                        data={history}
                        margin={{
                          top: 15,
                          right: 10,
                          left: 0,
                          bottom: 0,
                        }}
                      >
                        <XAxis
                          dataKey="Date"
                          hide
                        />

                        <YAxis
                          domain={["auto", "auto"]}
                          axisLine={false}
                          tickLine={false}
                          tick={{
                            fill: "#555",
                            fontSize: 11,
                          }}
                          width={50}
                        />

                        <Tooltip
                          contentStyle={{
                            background:
                              "#11151a",
                            border:
                              "1px solid #293039",
                            borderRadius: "8px",
                            color: "#fff",
                          }}
                          labelStyle={{
                            color: "#777",
                            marginBottom:
                              "4px",
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
                          stroke="#00ff88"
                          dot={false}
                          strokeWidth={2.5}
                          activeDot={{
                            r: 5,
                            stroke:
                              "#00ff88",
                            strokeWidth: 2,
                            fill: "#0a0d0f",
                          }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                {/* MONTE CARLO */}
                <section className="charts-section">
                  <div className="section-heading-row">
                    <div>
                      <span className="eyebrow">
                        MONTE CARLO SIMULATION
                      </span>

                      <h2>
                        Potential price scenarios
                      </h2>
                    </div>

                    <span className="chart-period">
                      1 YEAR
                    </span>
                  </div>

                  <div className="chart-box">
                    <div className="scenario-summary">
                      <Scenario
                        label="Worst"
                        value={mc.worst_case}
                        tone="negative"
                        currency={info.currency}
                      />

                      <Scenario
                        label="VaR 95%"
                        value={mc.var_95}
                        tone="negative"
                        currency={info.currency}
                      />

                      <Scenario
                        label="Expected"
                        value={mc.expected_price}
                        tone="neutral"
                        currency={info.currency}
                      />

                      <Scenario
                        label="Current"
                        value={mc.current_price}
                        tone="neutral"
                        currency={info.currency}
                      />

                      <Scenario
                        label="Best"
                        value={mc.best_case}
                        tone="positive"
                        currency={info.currency}
                      />
                    </div>

                    <ResponsiveContainer
                      width="100%"
                      height={280}
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
                            price: mc.var_95,
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
                          top: 15,
                          right: 10,
                          left: 0,
                          bottom: 5,
                        }}
                      >
                        <XAxis
                          dataKey="label"
                          axisLine={false}
                          tickLine={false}
                          tick={{
                            fill: "#555",
                            fontSize: 10,
                          }}
                        />

                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tick={{
                            fill: "#555",
                            fontSize: 10,
                          }}
                          width={60}
                          tickFormatter={(value) =>
                            formatNumber(
                              value,
                              0
                            )
                          }
                        />

                        <Tooltip
                          contentStyle={{
                            background:
                              "#11151a",
                            border:
                              "1px solid #293039",
                            borderRadius: "8px",
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
                          y={mc.current_price}
                          stroke="#444"
                          strokeDasharray="5 5"
                        />

                        <Line
                          type="monotone"
                          dataKey="price"
                          stroke="#ffcc00"
                          dot={{
                            r: 4,
                            fill: "#ffcc00",
                            strokeWidth: 0,
                          }}
                          activeDot={{
                            r: 6,
                          }}
                          strokeWidth={2}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              </>
            )}
          </>
        )}

        {/* PORTFOLIO */}
        {mode === "portfolio" && (
          <>
            <section className="search-section portfolio-intro">
              <div className="search-heading">
                <span className="eyebrow">
                  PORTFOLIO ANALYSIS
                </span>

                <h2>
                  Build and evaluate your portfolio
                </h2>

                <p>
                  Add your positions to measure
                  portfolio risk and compare the
                  risk-adjusted profile of each
                  holding.
                </p>
              </div>
            </section>

            <section className="holdings-panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">
                    YOUR HOLDINGS
                  </span>

                  <h3>Portfolio composition</h3>
                </div>

                <span className="holding-count">
                  {holdings.length}{" "}
                  {holdings.length === 1
                    ? "POSITION"
                    : "POSITIONS"}
                </span>
              </div>

              <div className="holding-header">
                <span>SECURITY</span>
                <span>INVESTMENT AMOUNT</span>
                <span />
              </div>

              {holdings.map((holding, index) => (
                <div
                  className="holding-row"
                  key={index}
                >
                  <div className="holding-input ticker-input">
                    <span className="ticker-prefix">
                      TICKER
                    </span>

                    <input
                      placeholder="e.g. TCS.NS"
                      value={holding.ticker}
                      onChange={(e) =>
                        updateHolding(
                          index,
                          "ticker",
                          e.target.value
                        )
                      }
                      autoCapitalize="characters"
                      spellCheck="false"
                      autoComplete="off"
                    />
                  </div>

                  <div className="holding-input amount-input">
                    <span>₹</span>

                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="40000"
                      value={holding.amount}
                      onChange={(e) =>
                        updateHolding(
                          index,
                          "amount",
                          e.target.value
                        )
                      }
                    />
                  </div>

                  <button
                    className="remove-button"
                    onClick={() =>
                      removeHolding(index)
                    }
                    disabled={holdings.length === 1}
                    title="Remove holding"
                    aria-label={`Remove holding ${
                      index + 1
                    }`}
                  >
                    ×
                  </button>
                </div>
              ))}

              <div className="holdings-footer">
                <button
                  className="add-btn"
                  onClick={addHolding}
                >
                  + Add another position
                </button>

                <button
                  className="primary-button portfolio-button"
                  onClick={analyzePortfolio}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <span className="spinner" />
                      Analyzing
                    </>
                  ) : (
                    <>
                      Analyze Portfolio
                      <span className="button-arrow">
                        →
                      </span>
                    </>
                  )}
                </button>
              </div>
            </section>

            {error && mode === "portfolio" && (
              <div className="error-banner">
                <span>!</span>
                {error}
              </div>
            )}

            {loading && mode === "portfolio" && (
              <div className="loading-panel">
                <div className="loading-line" />

                <div>
                  <strong>
                    Calculating portfolio risk
                  </strong>

                  <p>
                    Fetching holdings and calculating
                    portfolio statistics...
                  </p>
                </div>
              </div>
            )}

            {portfolio && (
              <>
                {/* PORTFOLIO SNAPSHOT */}
                <section className="metrics-section">
                  <div className="section-heading-row">
                    <div>
                      <span className="eyebrow">
                        PORTFOLIO SNAPSHOT
                      </span>

                      <h2>Risk overview</h2>
                    </div>
                  </div>

                  <div className="metrics-grid portfolio-metrics">
                    <MetricCard
                      label="Total Value"
                      value={formatCurrency(
                        portfolio.total_value,
                        "INR"
                      )}
                      detail="PORTFOLIO VALUE"
                      tone="positive"
                    />

                    <MetricCard
                      label="Portfolio Volatility"
                      value={`${formatNumber(
                        portfolio.portfolio_volatility,
                        3
                      )}%`}
                      detail="DAILY RISK"
                      tone="warning"
                    />

                    <MetricCard
                      label="Sharpe Ratio"
                      value={formatNumber(
                        portfolio.portfolio_sharpe,
                        3
                      )}
                      detail="RISK-ADJUSTED RETURN"
                      tone={sharpeColor(
                        portfolio.portfolio_sharpe
                      )}
                    />

                    <MetricCard
                      label="Portfolio VaR"
                      value={`${formatNumber(
                        portfolio.portfolio_var_95,
                        3
                      )}%`}
                      detail="95% CONFIDENCE"
                      tone="negative"
                    />
                  </div>
                </section>

                {/* HOLDING COMPARISON */}
                {Array.isArray(
                  portfolio.comparison
                ) &&
                  portfolio.comparison.length > 0 && (
                    <section className="comparison-section">
                      <div className="section-heading-row">
                        <div>
                          <span className="eyebrow">
                            HOLDING COMPARISON
                          </span>

                          <h2>
                            How your holdings compare
                          </h2>
                        </div>

                        <span className="chart-period">
                          RISK-ADJUSTED
                        </span>
                      </div>

                      <div className="comparison-card">
                        <div className="comparison-header">
                          <span>RANK</span>
                          <span>SECURITY</span>
                          <span>1Y RETURN</span>
                          <span>VOLATILITY</span>
                          <span>SHARPE</span>
                          <span>VAR 95%</span>
                          <span>SCORE</span>
                        </div>

                        {portfolio.comparison.map(
                          (stock) => (
                            <div
                              className={`comparison-row ${
                                stock.rank === 1
                                  ? "top-stock"
                                  : ""
                              }`}
                              key={stock.ticker}
                            >
                              <span className="rank">
                                #
                                {stock.rank}
                              </span>

                              <div className="comparison-security">
                                <strong>
                                  {
                                    stock.ticker
                                  }
                                </strong>

                                {stock.rank ===
                                  1 && (
                                  <small>
                                    STRONGEST
                                    PROFILE
                                  </small>
                                )}
                              </div>

                              <span
                                className={
                                  Number(
                                    stock.return_1y
                                  ) >= 0
                                    ? "comparison-positive"
                                    : "comparison-negative"
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
                                    ? "comparison-positive"
                                    : Number(
                                        stock.sharpe
                                      ) > 0
                                    ? "comparison-warning"
                                    : "comparison-negative"
                                }
                              >
                                {stock.sharpe}
                              </span>

                              <span>
                                {stock.var_95}
                                %
                              </span>

                              <strong className="comparison-score">
                                {stock.score}
                              </strong>
                            </div>
                          )
                        )}

                        <div className="comparison-footnote">
                          Score is relative to the
                          holdings in this portfolio
                          and is intended for
                          comparison, not as a
                          buy or sell recommendation.
                        </div>
                      </div>
                    </section>
                  )}

                {/* PORTFOLIO ALLOCATION + CORRELATION */}
                <section className="portfolio-grid">
                  <div className="chart-box portfolio-box">
                    <div className="chart-topline">
                      <div>
                        <span className="chart-title">
                          Portfolio Weights
                        </span>

                        <span className="chart-subtitle">
                          Allocation by position
                        </span>
                      </div>
                    </div>

                    <div className="corr-grid">
                      {Object.entries(
                        portfolio.weights || {}
                      ).map(([t, w]) => (
                        <div
                          className="corr-row"
                          key={t}
                        >
                          <div className="weight-name">
                            <span className="weight-dot" />
                            {t}
                          </div>

                          <span className="corr-val">
                            {w}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="chart-box portfolio-box">
                    <div className="chart-topline">
                      <div>
                        <span className="chart-title">
                          Correlation Matrix
                        </span>

                        <span className="chart-subtitle">
                          Relationship between holdings
                        </span>
                      </div>
                    </div>

                    <div className="corr-grid">
                      {Object.entries(
                        portfolio.correlation || {}
                      ).map(([pair, val]) => (
                        <div
                          className="corr-row"
                          key={pair}
                        >
                          <span>
                            {pair
                              .replaceAll(
                                "_",
                                " ↔ "
                              )}
                          </span>

                          <span className="corr-val">
                            {val}
                          </span>
                        </div>
                      ))}

                      {!Object.keys(
                        portfolio.correlation || {}
                      ).length && (
                        <div className="empty-state">
                          Correlation data is
                          unavailable for the current
                          portfolio.
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </>
            )}
          </>
        )}

        <footer>
          <span>PORTFOLIOOS</span>
          <span>
            QUANTITATIVE RISK ANALYTICS
          </span>
        </footer>
      </main>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = "positive",
}) {
  return (
    <div className="metric-card">
      <div className="metric-top">
        <span className="metric-label">
          {label}
        </span>

        <span
          className={`metric-signal ${tone}`}
          aria-hidden="true"
        >
          ●
        </span>
      </div>

      <div className={`metric-value ${tone}`}>
        {value}
      </div>

      <div className={`metric-detail ${tone}`}>
        {detail}
      </div>
    </div>
  );
}

function Scenario({
  label,
  value,
  tone,
  currency = "USD",
}) {
  return (
    <div className="scenario">
      <span>{label}</span>

      <strong className={tone}>
        {formatScenarioCurrency(
          value,
          currency
        )}
      </strong>
    </div>
  );
}

function formatScenarioCurrency(
  value,
  currency = "USD"
) {
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
      currency:
        typeof currency === "string" &&
        currency.trim()
          ? currency.toUpperCase()
          : "USD",
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