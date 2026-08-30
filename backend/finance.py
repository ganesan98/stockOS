import numpy as np

def get_returns(prices: list):
    prices = np.array(prices, dtype=float)
    returns = np.diff(prices) / prices[:-1]
    return returns

def historical_var(returns, confidence=0.95):
    return float(np.percentile(returns, (1 - confidence) * 100))

def volatility(returns):
    return float(np.std(returns))

def sharpe_ratio(returns, risk_free_rate=0.07):
    daily_rf = risk_free_rate / 252
    excess = returns - daily_rf
    std = np.std(excess)
    if std == 0:
        return 0.0
    return float(np.mean(excess) / std * np.sqrt(252))

def monte_carlo(prices: list, simulations=10000, days=252):
    try:
        returns = get_returns(prices)
        mu = float(np.mean(returns))
        sigma = float(np.std(returns))
        last_price = float(prices[-1])

        # Guard against degenerate inputs
        if sigma == 0 or not np.isfinite(mu) or not np.isfinite(sigma):
            return {
                "simulations": simulations,
                "days": days,
                "current_price": round(last_price, 2),
                "var_95": round(last_price, 2),
                "var_99": round(last_price, 2),
                "var_95_loss_pct": 0.0,
                "expected_price": round(last_price, 2),
                "worst_case": round(last_price, 2),
                "best_case": round(last_price, 2),
            }

        # Vectorised simulation — much faster than a Python loop
        # and avoids potential NaN accumulation from repeated shocks.
        shocks = np.random.normal(mu, sigma, (simulations, days))
        # Replace any non-finite shocks with 0 to stay numerically stable
        shocks = np.where(np.isfinite(shocks), shocks, 0.0)
        growth = np.prod(1 + shocks, axis=1)
        results = last_price * growth

        # Drop any inf / nan results from extreme paths
        results = results[np.isfinite(results)]
        if len(results) == 0:
            results = np.array([last_price])

        var_95 = float(np.percentile(results, 5))
        var_99 = float(np.percentile(results, 1))

        return {
            "simulations": simulations,
            "days": days,
            "current_price": round(last_price, 2),
            "var_95": round(var_95, 2),
            "var_99": round(var_99, 2),
            "var_95_loss_pct": round((var_95 - last_price) / last_price * 100, 2),
            "expected_price": round(float(np.mean(results)), 2),
            "worst_case": round(float(np.min(results)), 2),
            "best_case": round(float(np.max(results)), 2),
        }

    except Exception as exc:
        # Last-resort fallback: return flat projection rather than crashing
        print(f"[monte_carlo] Numerical error: {exc}")
        last_price = float(prices[-1]) if prices else 0.0
        return {
            "simulations": simulations,
            "days": days,
            "current_price": round(last_price, 2),
            "var_95": round(last_price, 2),
            "var_99": round(last_price, 2),
            "var_95_loss_pct": 0.0,
            "expected_price": round(last_price, 2),
            "worst_case": round(last_price, 2),
            "best_case": round(last_price, 2),
        }