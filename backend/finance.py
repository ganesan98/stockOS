import numpy as np

def get_returns(prices: list):
    prices = np.array(prices)
    returns = np.diff(prices) / prices[:-1]
    return returns
def historical_var(returns, confidence=0.95):
    return float(np.percentile(returns, (1 - confidence) * 100))

def volatility(returns):
    return float(np.std(returns))

def sharpe_ratio(returns, risk_free_rate=0.07):
    daily_rf = risk_free_rate / 252
    excess = returns - daily_rf
    return float(np.mean(excess) / np.std(excess) * np.sqrt(252))

def monte_carlo(prices: list, simulations=10000, days=252):
    returns = get_returns(prices)
    mu = np.mean(returns)
    sigma = np.std(returns)
    last_price = prices[-1]

    results = []
    for _ in range(simulations):
        path = [last_price]
        for _ in range(days):
            shock = np.random.normal(mu, sigma)
            path.append(path[-1] * (1 + shock))
        results.append(path[-1])

    results = np.array(results)
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