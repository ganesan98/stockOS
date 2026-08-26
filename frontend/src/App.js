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

const API = "https://portfolioos-backend-1qdb.onrender.com";

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
    if (!ticker.trim()) return;

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

      setInfo(iRes.data);
      setRisk(rRes.data);
      setMc(mRes.data);
      setHistory(hRes.data.slice(-60));
      setSummary(sRes.data.summary);
    } catch (err) {
      console.error(err);
      setError("Could not fetch data. Check the ticker symbol and try again.");
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
    if (value > 1) return "positive";
    if (value > 0) return "warning";
    return "negative";
  }

  function riskLevel(value) {
    const numeric = Math.abs(Number(value));

    if (numeric < 1) {
      return { label: "LOW", className: "positive" };
    }

    if (numeric < 2.5) {
      return { label: "MODERATE", className: "warning" };
    }

    return { label: "HIGH", className: "negative" };
  }

  function formatNumber(value, decimals = 2) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return "—";
    }

    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
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
        (h) => h.ticker.trim() && h.amount !== ""
      );

      if (!validHoldings.length) {
        setError("Add at least one stock before analyzing.");
        setLoading(false);
        return;
      }

      const payload = {
        holdings: validHoldings.map((h) => ({
          ticker: h.ticker.trim().toUpperCase(),
          amount: parseFloat(h.amount),
        })),
      };

      const res = await axios.post(`${API}/portfolio/risk`, payload);

      setPortfolio(res.data);
    } catch (err) {
      console.error(err);
      setError("Failed to analyze portfolio. Check your holdings.");
    } finally {
      setLoading(false);
    }
  }

  function updateHolding(index, field, value) {
    const updated = [...holdings];
    updated[index][field] = value;
    setHoldings(updated);
  }

  function removeHolding(index) {
    if (holdings.length === 1) return;

    setHoldings(holdings.filter((_, i) => i !== index));
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
                Risk intelligence for modern portfolios
              </p>
            </div>
          </div>

          <div className="status-pill">
            <span className="status-dot" />
            MARKET ANALYTICS
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
                <span className="eyebrow">MARKET SCANNER</span>
                <h2>Analyze a security</h2>
                <p>
                  Enter a Yahoo Finance ticker to generate a complete
                  risk profile.
                </p>
              </div>

              <div className="search-bar">
                <div className="search-input-wrap">
                  <span className="search-icon">$</span>

                  <input
                    value={ticker}
                    onChange={(e) => setTicker(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && analyze()
                    }
                    placeholder="Enter ticker — AAPL, TCS.NS, RELIANCE.NS"
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
                      <span className="button-arrow">→</span>
                    </>
                  )}
                </button>
              </div>

              <div className="search-hint">
                <span>Examples</span>
                AAPL · MSFT · TCS.NS · RELIANCE.NS
              </div>
            </section>

            {error && (
              <div className="error-banner">
                <span>!</span>
                {error}
              </div>
            )}

            {loading && (
              <div className="loading-panel">
                <div className="loading-line" />
                <div>
                  <strong>Running risk analysis</strong>
                  <p>
                    Fetching market data and running Monte Carlo
                    simulations...
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
                      {String(info.name || ticker)
                        .charAt(0)
                        .toUpperCase()}
                    </div>

                    <div>
                      <div className="stock-name">
                        {info.name || "Unknown Security"}
                      </div>

                      <div className="stock-meta">
                        <span>
                          {ticker.trim().toUpperCase()}
                        </span>
                        <i />
                        <span>{info.currency || "USD"}</span>
                        <i />
                        <span>LIVE ANALYSIS</span>
                      </div>
                    </div>
                  </div>

                  <div className="stock-price">
                    <span className="price-label">
                      CURRENT PRICE
                    </span>

                    <strong>
                      {info.currency || "$"}{" "}
                      {formatNumber(info.price)}
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
                      6 SIGNALS
                    </span>
                  </div>

                  <div className="metrics-grid">
                    <MetricCard
                      label="Daily Volatility"
                      value={`${formatNumber(
                        risk.volatility,
                        3
                      )}%`}
                      detail={riskLevel(risk.volatility).label}
                      tone={riskLevel(risk.volatility).className}
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
                      tone={sharpeColor(risk.sharpe_ratio)}
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
                      value={formatNumber(
                        mc.expected_price
                      )}
                      detail="1 YEAR FORECAST"
                      tone="positive"
                    />

                    <MetricCard
                      label="Worst Case"
                      value={formatNumber(mc.worst_case)}
                      detail="DOWNSIDE SCENARIO"
                      tone="negative"
                    />

                    <MetricCard
                      label="Best Case"
                      value={formatNumber(mc.best_case)}
                      detail="UPSIDE SCENARIO"
                      tone="positive"
                    />
                  </div>
                </section>

                {/* AI SUMMARY */}
                {summary && (
                  <section className="ai-card">
                    <div className="ai-header">
                      <div className="ai-icon">✦</div>

                      <div>
                        <span className="eyebrow">
                          AI RISK ANALYSIS
                        </span>
                        <h3>What the numbers mean</h3>
                      </div>

                      <span className="ai-badge">
                        GENERATED
                      </span>
                    </div>

                    <p>{summary}</p>
                  </section>
                )}

                {/* CHARTS */}
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
                          tick={{ fill: "#555", fontSize: 11 }}
                          width={45}
                        />

                        <Tooltip
                          contentStyle={{
                            background: "#11151a",
                            border: "1px solid #293039",
                            borderRadius: "8px",
                            color: "#fff",
                          }}
                          labelStyle={{
                            color: "#777",
                            marginBottom: "4px",
                          }}
                          formatter={(value) => [
                            formatNumber(value),
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
                            stroke: "#00ff88",
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
                        MONTE CARLO ENGINE
                      </span>
                      <h2>Potential price scenarios</h2>
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
                      />

                      <Scenario
                        label="VaR 95%"
                        value={mc.var_95}
                        tone="negative"
                      />

                      <Scenario
                        label="Expected"
                        value={mc.expected_price}
                        tone="neutral"
                      />

                      <Scenario
                        label="Current"
                        value={mc.current_price}
                        tone="neutral"
                      />

                      <Scenario
                        label="Best"
                        value={mc.best_case}
                        tone="positive"
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
                            price: mc.worst_case,
                          },
                          {
                            label: "VaR 95%",
                            price: mc.var_95,
                          },
                          {
                            label: "Expected",
                            price: mc.expected_price,
                          },
                          {
                            label: "Current",
                            price: mc.current_price,
                          },
                          {
                            label: "Best",
                            price: mc.best_case,
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
                          width={50}
                        />

                        <Tooltip
                          contentStyle={{
                            background: "#11151a",
                            border: "1px solid #293039",
                            borderRadius: "8px",
                          }}
                          formatter={(value) => [
                            formatNumber(value),
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
                  PORTFOLIO BUILDER
                </span>
                <h2>Analyze your portfolio</h2>
                <p>
                  Add your holdings to calculate portfolio-level
                  risk, volatility and correlations.
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
                <div className="holding-row" key={index}>
                  <div className="holding-input">
                    <span>$</span>

                    <input
                      placeholder="Ticker e.g. TCS.NS"
                      value={holding.ticker}
                      onChange={(e) =>
                        updateHolding(
                          index,
                          "ticker",
                          e.target.value
                        )
                      }
                    />
                  </div>

                  <div className="holding-input amount-input">
                    <span>₹</span>

                    <input
                      type="number"
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
                    onClick={() => removeHolding(index)}
                    disabled={holdings.length === 1}
                    title="Remove holding"
                  >
                    ×
                  </button>
                </div>
              ))}

              <div className="holdings-footer">
                <button
                  className="add-btn"
                  onClick={() =>
                    setHoldings([
                      ...holdings,
                      { ticker: "", amount: "" },
                    ])
                  }
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
                      <span className="button-arrow">→</span>
                    </>
                  )}
                </button>
              </div>
            </section>

            {error && (
              <div className="error-banner">
                <span>!</span>
                {error}
              </div>
            )}

            {loading && (
              <div className="loading-panel">
                <div className="loading-line" />

                <div>
                  <strong>
                    Calculating portfolio risk
                  </strong>

                  <p>
                    Fetching holdings and calculating
                    correlations...
                  </p>
                </div>
              </div>
            )}

            {portfolio && (
              <>
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
                      value={`₹${formatNumber(
                        portfolio.total_value
                      )}`}
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
                        portfolio.weights
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
                        portfolio.correlation
                      ).map(([pair, val]) => (
                        <div
                          className="corr-row"
                          key={pair}
                        >
                          <span>
                            {pair.replace(
                              "_",
                              " ↔ "
                            )}
                          </span>

                          <span className="corr-val">
                            {val}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </>
            )}
          </>
        )}

        <footer>
          <span>PORTFOLIOOS</span>
          <span>RISK INTELLIGENCE ENGINE</span>
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
        <span className="metric-label">{label}</span>

        <span className={`metric-signal ${tone}`}>
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

function Scenario({ label, value, tone }) {
  return (
    <div className="scenario">
      <span>{label}</span>

      <strong className={tone}>
        {value === null || value === undefined
          ? "—"
          : Number(value).toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
      </strong>
    </div>
  );
}