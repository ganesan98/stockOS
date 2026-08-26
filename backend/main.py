from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
from finance import get_returns, historical_var, volatility, sharpe_ratio, monte_carlo
import os
from dotenv import load_dotenv
from google import genai
from itertools import combinations
import numpy as np

# Load environment variables from .env
load_dotenv()

# Create Gemini client using the API key from .env
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "PortfolioOS backend is live"}


@app.get("/stock/{ticker}")
def get_stock(ticker: str):
    stock = yf.Ticker(ticker)
    info = stock.info

    return {
        "ticker": ticker,
        "name": info.get("longName"),
        "price": info.get("currentPrice"),
        "currency": info.get("currency"),
    }


@app.get("/stock/{ticker}/history")
def get_history(ticker: str, period: str = "1y"):
    stock = yf.Ticker(ticker)
    hist = stock.history(period=period)
    hist = hist[["Close"]].reset_index()
    hist["Date"] = hist["Date"].astype(str)

    return hist.to_dict(orient="records")


@app.get("/stock/{ticker}/risk")
def get_risk(ticker: str):
    stock = yf.Ticker(ticker)
    hist = stock.history(period="1y")
    prices = hist["Close"].tolist()
    returns = get_returns(prices)

    return {
        "ticker": ticker,
        "volatility": round(volatility(returns) * 100, 3),
        "sharpe_ratio": round(sharpe_ratio(returns), 3),
        "var_95": round(historical_var(returns) * 100, 3),
    }


@app.get("/stock/{ticker}/montecarlo")
def get_montecarlo(ticker: str):
    stock = yf.Ticker(ticker)
    hist = stock.history(period="1y")
    prices = hist["Close"].tolist()

    return monte_carlo(prices)


@app.get("/stock/{ticker}/summary")
def get_summary(ticker: str):
    stock = yf.Ticker(ticker)
    hist = stock.history(period="1y")
    prices = hist["Close"].tolist()
    info = stock.info
    returns = get_returns(prices)

    risk_data = {
        "ticker": ticker,
        "name": info.get("longName"),
        "price": info.get("currentPrice"),
        "volatility": round(volatility(returns) * 100, 3),
        "sharpe_ratio": round(sharpe_ratio(returns), 3),
        "var_95": round(historical_var(returns) * 100, 3),
        "mc": monte_carlo(prices),
    }

    prompt = f"""
You are a professional private banker explaining investment risk
to a retail investor.

Given this data for {risk_data['name']} ({ticker}):

- Current Price: {risk_data['price']}
- Daily Volatility: {risk_data['volatility']}%
- Sharpe Ratio: {risk_data['sharpe_ratio']}
- Historical VaR 95%: {risk_data['var_95']}%
- Monte Carlo Expected Price (1yr): {risk_data['mc']['expected_price']}
- Monte Carlo Worst Case: {risk_data['mc']['worst_case']}
- Monte Carlo Best Case: {risk_data['mc']['best_case']}

Write a 3 sentence plain-English risk summary.

Be direct and specific with the numbers.
Explain what the risk means for the investor's actual money.
Avoid financial jargon.
Do not give a generic disclaimer.
"""

    response = client.models.generate_content(
        model="gemini-3.6-flash",
        contents=prompt
    )

    return {"summary": response.text}

@app.post("/portfolio/risk")
def portfolio_risk(data: dict):
    holdings = data.get("holdings", [])
    total_value = sum(h["amount"] for h in holdings)
    
    all_returns = {}
    weights = {}
    
    for h in holdings:
        stock = yf.Ticker(h["ticker"])
        hist = stock.history(period="1y")
        prices = hist["Close"].tolist()
        all_returns[h["ticker"]] = get_returns(prices)
        weights[h["ticker"]] = h["amount"] / total_value

    tickers = list(all_returns.keys())
    portfolio_returns = np.zeros(len(list(all_returns.values())[0]))
    
    min_len = min(len(r) for r in all_returns.values())

    portfolio_returns = np.zeros(min_len)
    for t in tickers:
        portfolio_returns += weights[t] * np.array(all_returns[t])[:min_len]    

    corr_matrix = {}
    for t1, t2 in combinations(tickers, 2):
        min_len = min(len(all_returns[t1]), len(all_returns[t2]))
        r1 = all_returns[t1][:min_len]
        r2 = all_returns[t2][:min_len]
        corr = float(np.corrcoef(r1, r2)[0, 1])
        corr_matrix[f"{t1}_{t2}"] = round(corr, 3)

    return {
        "total_value": total_value,
        "weights": {t: round(weights[t] * 100, 2) for t in tickers},
        "portfolio_volatility": round(float(np.std(portfolio_returns)) * 100, 3),
        "portfolio_sharpe": round(sharpe_ratio(portfolio_returns), 3),
        "portfolio_var_95": round(float(historical_var(portfolio_returns)) * 100, 3),
        "correlation": corr_matrix,
    }