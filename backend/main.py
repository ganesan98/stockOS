from fastapi import FastAPI, HTTPException
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

# Create Gemini client using the API key
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

    try:
        info = stock.info
    except Exception as e:
        print(f"Yahoo Finance info error for {ticker}: {e}")

        # Try fast_info as a fallback
        try:
            fast_info = stock.fast_info

            price = fast_info.get("lastPrice")
            currency = fast_info.get("currency")

            return {
                "ticker": ticker,
                "name": ticker,
                "price": price,
                "currency": currency,
            }

        except Exception as fallback_error:
            print(f"Yahoo Finance fallback error for {ticker}: {fallback_error}")

            raise HTTPException(
                status_code=503,
                detail="Yahoo Finance is temporarily unavailable. Please try again."
            )

    return {
        "ticker": ticker,
        "name": info.get("longName") or ticker,
        "price": info.get("currentPrice"),
        "currency": info.get("currency"),
    }


@app.get("/stock/{ticker}/history")
def get_history(ticker: str, period: str = "1y"):
    try:
        stock = yf.Ticker(ticker)
        hist = stock.history(period=period)

        if hist.empty:
            raise HTTPException(
                status_code=404,
                detail=f"No historical data found for {ticker}"
            )

        hist = hist[["Close"]].reset_index()
        hist["Date"] = hist["Date"].astype(str)

        return hist.to_dict(orient="records")

    except HTTPException:
        raise
    except Exception as e:
        print(f"Yahoo Finance history error for {ticker}: {e}")

        raise HTTPException(
            status_code=503,
            detail="Yahoo Finance is temporarily unavailable. Please try again."
        )


@app.get("/stock/{ticker}/risk")
def get_risk(ticker: str):
    try:
        stock = yf.Ticker(ticker)
        hist = stock.history(period="1y")

        if hist.empty:
            raise HTTPException(
                status_code=404,
                detail=f"No historical data found for {ticker}"
            )

        prices = hist["Close"].tolist()
        returns = get_returns(prices)

        return {
            "ticker": ticker,
            "volatility": round(volatility(returns) * 100, 3),
            "sharpe_ratio": round(sharpe_ratio(returns), 3),
            "var_95": round(historical_var(returns) * 100, 3),
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Risk calculation error for {ticker}: {e}")

        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve stock data right now. Please try again."
        )


@app.get("/stock/{ticker}/montecarlo")
def get_montecarlo(ticker: str):
    try:
        stock = yf.Ticker(ticker)
        hist = stock.history(period="1y")

        if hist.empty:
            raise HTTPException(
                status_code=404,
                detail=f"No historical data found for {ticker}"
            )

        prices = hist["Close"].tolist()

        return monte_carlo(prices)

    except HTTPException:
        raise
    except Exception as e:
        print(f"Monte Carlo error for {ticker}: {e}")

        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve stock data right now. Please try again."
        )


@app.get("/stock/{ticker}/summary")
def get_summary(ticker: str):
    try:
        stock = yf.Ticker(ticker)

        # Historical price data
        hist = stock.history(period="1y")

        if hist.empty:
            raise HTTPException(
                status_code=404,
                detail=f"No historical data found for {ticker}"
            )

        prices = hist["Close"].tolist()

        # Try to get company information
        try:
            info = stock.info
        except Exception as e:
            print(f"Yahoo Finance info error for {ticker}: {e}")

            # Fallback to fast_info
            try:
                fast_info = stock.fast_info

                name = ticker
                current_price = fast_info.get("lastPrice")

            except Exception as fallback_error:
                print(
                    f"Yahoo Finance fast_info error for {ticker}: "
                    f"{fallback_error}"
                )

                name = ticker
                current_price = prices[-1]

        else:
            name = info.get("longName") or ticker
            current_price = info.get("currentPrice") or prices[-1]

        returns = get_returns(prices)

        risk_data = {
            "ticker": ticker,
            "name": name,
            "price": current_price,
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

    except HTTPException:
        raise
    except Exception as e:
        print(f"Summary error for {ticker}: {e}")

        raise HTTPException(
            status_code=503,
            detail="Unable to generate stock summary right now. Please try again."
        )


@app.post("/portfolio/risk")
def portfolio_risk(data: dict):
    holdings = data.get("holdings", [])

    if not holdings:
        raise HTTPException(
            status_code=400,
            detail="No holdings provided."
        )

    total_value = sum(h["amount"] for h in holdings)

    if total_value <= 0:
        raise HTTPException(
            status_code=400,
            detail="Portfolio value must be greater than zero."
        )

    all_returns = {}
    weights = {}

    for h in holdings:
        ticker = h["ticker"]

        try:
            stock = yf.Ticker(ticker)
            hist = stock.history(period="1y")

            if hist.empty:
                raise HTTPException(
                    status_code=404,
                    detail=f"No historical data found for {ticker}"
                )

            prices = hist["Close"].tolist()

            all_returns[ticker] = get_returns(prices)
            weights[ticker] = h["amount"] / total_value

        except HTTPException:
            raise
        except Exception as e:
            print(f"Portfolio data error for {ticker}: {e}")

            raise HTTPException(
                status_code=503,
                detail=f"Unable to retrieve data for {ticker}. Please try again."
            )

    tickers = list(all_returns.keys())

    min_len = min(len(r) for r in all_returns.values())

    portfolio_returns = np.zeros(min_len)

    for t in tickers:
        portfolio_returns += (
            weights[t] * np.array(all_returns[t])[:min_len]
        )

    corr_matrix = {}

    for t1, t2 in combinations(tickers, 2):
        min_pair_len = min(
            len(all_returns[t1]),
            len(all_returns[t2])
        )

        r1 = all_returns[t1][:min_pair_len]
        r2 = all_returns[t2][:min_pair_len]

        corr = float(np.corrcoef(r1, r2)[0, 1])

        corr_matrix[f"{t1}_{t2}"] = round(corr, 3)

    return {
        "total_value": total_value,
        "weights": {
            t: round(weights[t] * 100, 2)
            for t in tickers
        },
        "portfolio_volatility": round(
            float(np.std(portfolio_returns)) * 100,
            3
        ),
        "portfolio_sharpe": round(
            sharpe_ratio(portfolio_returns),
            3
        ),
        "portfolio_var_95": round(
            float(historical_var(portfolio_returns)) * 100,
            3
        ),
        "correlation": corr_matrix,
    }