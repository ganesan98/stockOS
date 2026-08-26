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
  const [holdings, setHoldings] = useState([{ ticker: "", amount: "" }]);
  const [portfolio, setPortfolio] = useState(null);
  const [mode, setMode] = useState("single");

  async function analyze() {
    if (!ticker) return;

    setLoading(true);
    setError("");
    setSummary("");

    try {
      const t = ticker.toUpperCase();

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
      setError("Could not fetch data. Check ticker symbol.");
    }

    setLoading(false);
  }

  function sharpeColor(v) {
    if (v > 1) return "";
    if (v > 0) return "yellow";
    return "red";
  }

  return (
    <div className="container">
      <h1>PortfolioOS</h1>
      <p className="subtitle">Real-time risk intelligence — powered by Monte Carlo simulation</p>

      <div className="tabs">
        <button className={`tab ${mode === "single" ? "active" : ""}`} onClick={() => setMode("single")}>Single Stock</button>
        <button className={`tab ${mode === "portfolio" ? "active" : ""}`} onClick={() => setMode("portfolio")}>Portfolio</button>
      </div>

      {mode === "single" && (
        <>
          <div className="search">
            <input
              value={ticker}
              onChange={e => setTicker(e.target.value)}
              onKeyDown={e => e.key === "Enter" && analyze()}
              placeholder="e.g. TCS.NS / AAPL"
            />
            <button onClick={analyze}>Analyze</button>
          </div>

          {loading && <p className="loading">Running 10,000 simulations...</p>}
          {error && <p className="error">{error}</p>}

          {info && (
            <>
              <p className="section-title">{info.name} — {info.currency} {info.price}</p>
              <div className="cards">
                <div className="card">
                  <div className="label">Volatility (daily)</div>
                  <div className="value">{risk.volatility}%</div>
                </div>
                <div className="card">
                  <div className="label">Sharpe Ratio</div>
                  <div className={`value ${sharpeColor(risk.sharpe_ratio)}`}>{risk.sharpe_ratio}</div>
                </div>
                <div className="card">
                  <div className="label">VaR 95% (daily)</div>
                  <div className="value red">{risk.var_95}%</div>
                </div>
                <div className="card">
                  <div className="label">MC Expected Price</div>
                  <div className="value">{mc.expected_price}</div>
                </div>
                <div className="card">
                  <div className="label">MC Worst Case</div>
                  <div className="value red">{mc.worst_case}</div>
                </div>
                <div className="card">
                  <div className="label">MC Best Case</div>
                  <div className="value">{mc.best_case}</div>
                </div>
              </div>

              {summary && (
                <div className="summary">
                  <p className="summary-title">⚡ AI Risk Analysis</p>
                  <p>{summary}</p>
                </div>
              )}

              <div className="chart-box">
                <p className="section-title">Last 60 Days — Closing Price</p>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={history}>
                    <XAxis dataKey="Date" hide />
                    <YAxis domain={["auto", "auto"]} stroke="#444" />
                    <Tooltip contentStyle={{ background: "#111", border: "1px solid #333" }} labelStyle={{ color: "#666" }} />
                    <Line type="monotone" dataKey="Close" stroke="#00ff88" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="chart-box">
                <p className="section-title">Monte Carlo — Price Distribution (1 Year)</p>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={[
                    { label: "Worst", price: mc.worst_case },
                    { label: "VaR 95%", price: mc.var_95 },
                    { label: "Expected", price: mc.expected_price },
                    { label: "Current", price: mc.current_price },
                    { label: "Best", price: mc.best_case },
                  ]}>
                    <XAxis dataKey="label" stroke="#444" />
                    <YAxis stroke="#444" />
                    <Tooltip contentStyle={{ background: "#111", border: "1px solid #333" }} />
                    <ReferenceLine y={mc.current_price} stroke="#666" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="price" stroke="#ffcc00" dot strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </>
      )}

      {mode === "portfolio" && (
        <>
          {holdings.map((h, i) => (
            <div className="holding-row" key={i}>
              <input
                placeholder="Ticker e.g. TCS.NS"
                value={h.ticker}
                onChange={e => {
                  const updated = [...holdings];
                  updated[i].ticker = e.target.value;
                  setHoldings(updated);
                }}
              />
              <input
                placeholder="Amount e.g. 40000"
                value={h.amount}
                onChange={e => {
                  const updated = [...holdings];
                  updated[i].amount = e.target.value;
                  setHoldings(updated);
                }}
              />
            </div>
          ))}

          <button className="add-btn" onClick={() => setHoldings([...holdings, { ticker: "", amount: "" }])}>+ Add Stock</button>

          <div className="search">
            <button onClick={async () => {
              setLoading(true);
              try {
                const payload = {
                  holdings: holdings.map(h => ({
                    ticker: h.ticker.toUpperCase(),
                    amount: parseFloat(h.amount)
                  }))
                };
                const res = await axios.post(`${API}/portfolio/risk`, payload);
                setPortfolio(res.data);
              } catch { setError("Failed to analyze portfolio."); }
              setLoading(false);
            }}>Analyze Portfolio</button>
          </div>

          {loading && <p className="loading">Analyzing portfolio...</p>}
          {error && <p className="error">{error}</p>}

          {portfolio && (
            <>
              <div className="cards">
                <div className="card">
                  <div className="label">Total Value</div>
                  <div className="value">₹{portfolio.total_value.toLocaleString()}</div>
                </div>
                <div className="card">
                  <div className="label">Portfolio Volatility</div>
                  <div className="value">{portfolio.portfolio_volatility}%</div>
                </div>
                <div className="card">
                  <div className="label">Sharpe Ratio</div>
                  <div className={`value ${sharpeColor(portfolio.portfolio_sharpe)}`}>{portfolio.portfolio_sharpe}</div>
                </div>
                <div className="card">
                  <div className="label">VaR 95% (daily)</div>
                  <div className="value red">{portfolio.portfolio_var_95}%</div>
                </div>
              </div>

              <div className="chart-box">
                <p className="section-title">Portfolio Weights</p>
                <div className="corr-grid">
                  {Object.entries(portfolio.weights).map(([t, w]) => (
                    <div className="corr-row" key={t}>
                      <span>{t}</span>
                      <span className="corr-val">{w}%</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="chart-box">
                <p className="section-title">Correlation Between Holdings</p>
                <div className="corr-grid">
                  {Object.entries(portfolio.correlation).map(([pair, val]) => (
                    <div className="corr-row" key={pair}>
                      <span>{pair.replace("_", " ↔ ")}</span>
                      <span className="corr-val">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}