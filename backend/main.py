from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf

from finance import (
    get_returns,
    historical_var,
    volatility,
    sharpe_ratio,
    monte_carlo,
)

import os
import json
import asyncio
import time
import math
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv
from groq import Groq
from itertools import combinations
import numpy as np


def safe_float(value, decimals=3, fallback=0.0):
    """
    Round a float and replace NaN / Inf with `fallback`
    so the value is always JSON-serializable.
    """
    try:
        v = float(value)
        if not math.isfinite(v):
            return fallback
        return round(v, decimals)
    except (TypeError, ValueError):
        return fallback


# =========================================================
# CONFIGURATION
# =========================================================

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = "openai/gpt-oss-120b"

client = Groq(
    api_key=GROQ_API_KEY
)

# Thread pool for running blocking yfinance calls concurrently
# inside async endpoints.
_executor = ThreadPoolExecutor(max_workers=10)

app = FastAPI(
    title="PortfolioOS API",
    description="Stock and portfolio risk analytics API",
    version="1.0.0",
)

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# =========================================================
# TICKER DIRECTORY
# =========================================================

TICKERS_PATH = os.path.join(
    os.path.dirname(__file__),
    "tickers.json",
)

try:
    with open(TICKERS_PATH, "r") as f:
        TICKER_DIRECTORY = json.load(f)

except Exception as e:
    print(
        f"Could not load ticker directory: {e}"
    )
    TICKER_DIRECTORY = []


for _entry in TICKER_DIRECTORY:
    _entry["_symbol_lower"] = _entry[
        "symbol"
    ].lower()

    _entry["_name_lower"] = _entry[
        "name"
    ].lower()


# =========================================================
# HELPERS — RESILIENT YFINANCE FETCHING
# =========================================================

def _fetch_history_sync(ticker: str, period: str = "1y", timeout: int = 10):
    """
    Blocking yfinance history fetch with explicit timeout.
    Called inside a thread pool from async endpoints.
    """
    stock = yf.Ticker(ticker)
    hist = stock.history(period=period, timeout=timeout)
    return stock, hist


def fetch_history_with_retry(
    ticker: str,
    period: str = "1y",
    retries: int = 3,
    backoff: float = 1.5,
    timeout: int = 10,
):
    """
    Synchronous wrapper: fetch yfinance history with automatic retries.
    Suitable for use inside a thread pool executor.

    Raises HTTPException(503) after all retries are exhausted.
    """
    last_error = None

    for attempt in range(retries):
        try:
            stock = yf.Ticker(ticker)
            hist = stock.history(period=period, timeout=timeout)
            return stock, hist

        except Exception as exc:
            last_error = exc
            print(
                f"[yfinance] history attempt {attempt + 1}/{retries} "
                f"failed for {ticker}: {exc}"
            )

            if attempt < retries - 1:
                time.sleep(backoff * (attempt + 1))

    raise HTTPException(
        status_code=503,
        detail=(
            f"Yahoo Finance is temporarily unavailable for {ticker}. "
            "Please try again in a moment."
        ),
    )


def fetch_info_with_retry(
    stock,
    ticker: str,
    retries: int = 3,
    backoff: float = 1.5,
):
    """
    Synchronous wrapper: fetch yfinance info dict with retries,
    falling back to fast_info on repeated failure.
    """
    last_error = None

    for attempt in range(retries):
        try:
            return stock.info

        except Exception as exc:
            last_error = exc
            print(
                f"[yfinance] info attempt {attempt + 1}/{retries} "
                f"failed for {ticker}: {exc}"
            )

            if attempt < retries - 1:
                time.sleep(backoff * (attempt + 1))

    # Final fallback: fast_info
    try:
        fi = stock.fast_info
        return {
            "longName": ticker,
            "currentPrice": getattr(fi, "last_price", None),
            "currency": getattr(fi, "currency", "USD"),
        }
    except Exception as fallback_exc:
        print(
            f"[yfinance] fast_info fallback failed for {ticker}: "
            f"{fallback_exc}"
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "Yahoo Finance is temporarily unavailable. "
                "Please try again."
            ),
        )


# =========================================================
# HELPERS — SCORING
# =========================================================

def normalize_scores(
    values,
    higher_is_better=True,
):
    """
    Convert values into relative 0-100 scores.

    This score is only meaningful for comparing the
    holdings entered into the same portfolio.
    """

    if not values:
        return []

    low = min(values)
    high = max(values)

    if high == low:
        return [50.0] * len(values)

    scores = []

    for value in values:
        score = (
            (value - low)
            / (high - low)
        ) * 100

        if not higher_is_better:
            score = 100 - score

        scores.append(score)

    return scores


def build_stock_comparison(stock_stats):
    """
    Create a relative risk-adjusted comparison.

    Score weighting:
        30% -> 1-year return
        40% -> Sharpe ratio
        15% -> volatility
        15% -> downside risk / VaR
    """

    if not stock_stats:
        return []

    comparison = list(
        stock_stats.values()
    )

    return_scores = normalize_scores(
        [
            stock["return_1y"]
            for stock in comparison
        ],
        higher_is_better=True,
    )

    sharpe_scores = normalize_scores(
        [
            stock["sharpe"]
            for stock in comparison
        ],
        higher_is_better=True,
    )

    volatility_scores = normalize_scores(
        [
            stock["volatility"]
            for stock in comparison
        ],
        higher_is_better=False,
    )

    var_scores = normalize_scores(
        [
            abs(stock["var_95"])
            for stock in comparison
        ],
        higher_is_better=False,
    )

    for index, stock in enumerate(
        comparison
    ):
        score = (
            return_scores[index] * 0.30
            + sharpe_scores[index] * 0.40
            + volatility_scores[index] * 0.15
            + var_scores[index] * 0.15
        )

        stock["score"] = round(
            float(score),
            1,
        )

    comparison.sort(
        key=lambda stock: stock["score"],
        reverse=True,
    )

    for rank, stock in enumerate(
        comparison,
        start=1,
    ):
        stock["rank"] = rank

    return comparison


# =========================================================
# ROOT / WARMUP
# =========================================================

@app.get("/")
def root():
    return {
        "message": "PortfolioOS backend is live"
    }


@app.get("/ping")
def ping():
    """
    Lightweight keep-alive / warmup endpoint.
    The frontend calls this on page load and tab-refocus so the
    Render free-tier dyno is already warm before the user hits Analyze.
    """
    return {"status": "ok"}


# =========================================================
# TICKER SEARCH
# =========================================================

@app.get("/search")
def search_tickers(
    q: str,
    limit: int = 10,
):
    query = q.strip().lower()

    if not query:
        return {
            "results": []
        }

    limit = max(
        1,
        min(limit, 25),
    )

    symbol_matches = []
    name_matches = []

    for entry in TICKER_DIRECTORY:
        if len(symbol_matches) >= limit:
            break

        if entry["_symbol_lower"] == query:
            symbol_matches.insert(
                0,
                entry,
            )

        elif entry[
            "_symbol_lower"
        ].startswith(query):
            symbol_matches.append(
                entry
            )

        elif (
            len(symbol_matches)
            + len(name_matches)
            < limit
            and query in entry["_name_lower"]
        ):
            name_matches.append(
                entry
            )

    symbol_matches.sort(
        key=lambda e: e["symbol"]
    )

    combined = (
        symbol_matches
        + name_matches
    )[:limit]

    results = [
        {
            "symbol": entry["symbol"],
            "name": entry["name"],
            "exchange": entry["exchange"],
            "etf": entry["etf"],
        }
        for entry in combined
    ]

    return {
        "results": results
    }


# =========================================================
# STOCK INFORMATION
# =========================================================

@app.get("/stock/{ticker}")
def get_stock(ticker: str):
    ticker = ticker.strip().upper()

    stock = yf.Ticker(ticker)

    info = fetch_info_with_retry(stock, ticker)

    return {
        "ticker": ticker,
        "name": (
            info.get("longName")
            or ticker
        ),
        "price": info.get(
            "currentPrice"
        ),
        "currency": info.get(
            "currency"
        ),
    }


# =========================================================
# HISTORICAL DATA
# =========================================================

@app.get("/stock/{ticker}/history")
def get_history(
    ticker: str,
    period: str = "1y",
):
    ticker = ticker.strip().upper()

    try:
        _stock, hist = fetch_history_with_retry(
            ticker, period=period
        )

        if hist.empty:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No historical data found "
                    f"for {ticker}"
                ),
            )

        hist = hist[
            ["Close"]
        ].reset_index()

        hist["Date"] = hist[
            "Date"
        ].astype(str)

        return hist.to_dict(
            orient="records"
        )

    except HTTPException:
        raise

    except Exception as e:
        print(
            "Yahoo Finance history error "
            f"for {ticker}: {e}"
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Yahoo Finance is temporarily "
                "unavailable. Please try again."
            ),
        )


# =========================================================
# STOCK RISK
# =========================================================

@app.get("/stock/{ticker}/risk")
def get_risk(ticker: str):
    ticker = ticker.strip().upper()

    try:
        _stock, hist = fetch_history_with_retry(ticker)

        if hist.empty:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No historical data found "
                    f"for {ticker}"
                ),
            )

        prices = hist[
            "Close"
        ].tolist()

        returns = get_returns(
            prices
        )

        return {
            "ticker": ticker,
            "volatility": round(
                volatility(returns) * 100,
                3,
            ),
            "sharpe_ratio": round(
                sharpe_ratio(returns),
                3,
            ),
            "var_95": round(
                historical_var(returns) * 100,
                3,
            ),
        }

    except HTTPException:
        raise

    except Exception as e:
        print(
            f"Risk calculation error for "
            f"{ticker}: {e}"
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Unable to retrieve stock data "
                "right now. Please try again."
            ),
        )


# =========================================================
# MONTE CARLO
# =========================================================

@app.get("/stock/{ticker}/montecarlo")
def get_montecarlo(ticker: str):
    ticker = ticker.strip().upper()

    try:
        _stock, hist = fetch_history_with_retry(ticker)

        if hist.empty:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No historical data found "
                    f"for {ticker}"
                ),
            )

        prices = hist[
            "Close"
        ].tolist()

        return monte_carlo(
            prices
        )

    except HTTPException:
        raise

    except Exception as e:
        print(
            f"Monte Carlo error for "
            f"{ticker}: {e}"
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Unable to retrieve stock data "
                "right now. Please try again."
            ),
        )


# =========================================================
# GROQ AI RISK SUMMARY
# =========================================================

@app.get("/stock/{ticker}/summary")
def get_summary(ticker: str):
    ticker = ticker.strip().upper()

    try:
        _stock, hist = fetch_history_with_retry(ticker)

        if hist.empty:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No historical data found "
                    f"for {ticker}"
                ),
            )

        prices = hist[
            "Close"
        ].tolist()

        clean_prices = [p for p in prices if math.isfinite(p)]
        last_price = clean_prices[-1] if clean_prices else 0.0

        # ---------------------------------------------
        # Company information
        # ---------------------------------------------

        try:
            info = fetch_info_with_retry(_stock, ticker, retries=2)
            name = (
                info.get("longName")
                or ticker
            )
            current_price = (
                info.get("currentPrice")
                or last_price
            )

        except Exception as e:
            print(
                f"Info fetch error in summary for {ticker}: {e}"
            )
            name = ticker
            current_price = last_price

        # ---------------------------------------------
        # Risk calculations
        # ---------------------------------------------

        returns = get_returns(
            prices
        )

        risk_data = {
            "ticker": ticker,
            "name": name,
            "price": current_price,
            "volatility": round(
                volatility(returns) * 100,
                3,
            ),
            "sharpe_ratio": round(
                sharpe_ratio(returns),
                3,
            ),
            "var_95": round(
                historical_var(returns) * 100,
                3,
            ),
            "mc": monte_carlo(
                prices
            ),
        }

        # ---------------------------------------------
        # Groq prompt
        # ---------------------------------------------

        prompt = f"""
You are a professional private banker explaining investment risk
to a retail investor.

Given this data for {risk_data['name']} ({ticker}):

- Current Price: {risk_data['price']}
- Daily Volatility: {risk_data['volatility']}%
- Sharpe Ratio: {risk_data['sharpe_ratio']}
- Historical VaR 95% (DAILY): {risk_data['var_95']}%
- Monte Carlo Expected Price (1yr):
  {risk_data['mc']['expected_price']}
- Monte Carlo Worst Case (1yr):
  {risk_data['mc']['worst_case']}
- Monte Carlo Best Case (1yr):
  {risk_data['mc']['best_case']}

Write exactly 3 concise sentences in plain English.

Sentence 1:
Describe the stock's overall risk profile using the daily volatility
and Sharpe ratio.

Sentence 2:
Explain the downside using the DAILY 95% VaR and the 1-year Monte
Carlo worst-case price.

Sentence 3:
Explain the 1-year Monte Carlo expected price and best-case price.

IMPORTANT ACCURACY RULES:

- VaR 95% above is a DAILY, one-day risk estimate.
- Never describe daily VaR as monthly, yearly, weekly, or any other
  time period.
- Do not invent or imply a probability for the Monte Carlo worst-case,
  expected-price, or best-case values.
- Do not say there is a "5% chance" of reaching a Monte Carlo price.
- The 95% VaR indicates the estimated loss threshold associated with
  the 5th percentile of DAILY returns; describe it only as one-day risk.
- Monte Carlo worst-case, expected, and best-case figures are
  ONE-YEAR simulated price scenarios, not guaranteed outcomes.
- Use the exact numerical values provided.
- Do not make up information.
- Do not provide a generic disclaimer.
- Do not say you are an AI.
- Keep the explanation balanced rather than overly bullish or bearish.
"""

        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a professional financial risk analyst. "
                        "Analyze only the numerical data provided. "
                        "Return a concise, clear explanation for a retail "
                        "investor. Do not reveal your reasoning process."
                    ),
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
            reasoning_effort="low",
            include_reasoning=False,
            temperature=0.3,
            max_completion_tokens=1024,
        )

        summary = (
            response
            .choices[0]
            .message
            .content
            .strip()
        )

        return {
            "summary": summary
        }

    except HTTPException:
        raise

    except Exception as e:
        print(
            f"Groq summary error for "
            f"{ticker}: {e}"
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Unable to generate stock summary "
                "right now. Please try again."
            ),
        )


# =========================================================
# PORTFOLIO RISK + COMPARISON  (async, concurrent fetching)
# =========================================================

def _fetch_ticker_data(ticker: str, amount: float, total_value: float):
    """
    Blocking worker that fetches 1 year of yfinance history and
    computes individual risk metrics for a single ticker.
    Returns a dict on success or raises an exception on failure.
    Runs inside a ThreadPoolExecutor.
    """
    _stock, hist = fetch_history_with_retry(ticker, retries=3, backoff=1.0)

    if hist.empty:
        raise ValueError(
            f"No historical data found for {ticker}"
        )

    prices = hist["Close"].tolist()

    clean_prices = [p for p in prices if math.isfinite(p)]

    if len(clean_prices) < 2:
        raise ValueError(
            f"Insufficient historical data for {ticker}"
        )

    returns = get_returns(clean_prices)

    # Strip any NaN / Inf that yfinance can produce for illiquid tickers
    returns = returns[np.isfinite(returns)]

    if len(returns) == 0:
        raise ValueError(
            f"Unable to calculate returns for {ticker}"
        )

    one_year_return = (
        (clean_prices[-1] / clean_prices[0]) - 1
    ) * 100

    return {
        "ticker": ticker,
        "returns": list(returns),
        "weight": amount / total_value,
        "stats": {
            "ticker": ticker,
            "return_1y": safe_float(one_year_return, 2),
            "volatility": safe_float(volatility(returns) * 100, 3),
            "sharpe": safe_float(sharpe_ratio(returns), 3),
            "var_95": safe_float(historical_var(returns) * 100, 3),
        },
    }


@app.post("/portfolio/risk")
async def portfolio_risk(data: dict):

    holdings = data.get(
        "holdings",
        [],
    )

    if not holdings:
        raise HTTPException(
            status_code=400,
            detail="No holdings provided.",
        )

    # -----------------------------------------------------
    # Validate holdings
    # -----------------------------------------------------

    cleaned_holdings = []

    for holding in holdings:

        ticker = str(
            holding.get(
                "ticker",
                "",
            )
        ).strip().upper()

        amount = holding.get(
            "amount"
        )

        if not ticker:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Every holding must have "
                    "a ticker."
                ),
            )

        try:
            amount = float(amount)

        except (
            TypeError,
            ValueError,
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid investment amount "
                    f"for {ticker}."
                ),
            )

        if amount <= 0:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Investment amount for "
                    f"{ticker} must be greater "
                    "than zero."
                ),
            )

        cleaned_holdings.append(
            {
                "ticker": ticker,
                "amount": amount,
            }
        )

    # -----------------------------------------------------
    # Merge duplicate tickers
    # -----------------------------------------------------

    merged_holdings = {}

    for holding in cleaned_holdings:

        ticker = holding[
            "ticker"
        ]

        merged_holdings[ticker] = (
            merged_holdings.get(
                ticker,
                0,
            )
            + holding["amount"]
        )

    holdings = [
        {
            "ticker": ticker,
            "amount": amount,
        }
        for ticker, amount
        in merged_holdings.items()
    ]

    # -----------------------------------------------------
    # Total portfolio value
    # -----------------------------------------------------

    total_value = sum(
        holding["amount"]
        for holding in holdings
    )

    if total_value <= 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "Portfolio value must be "
                "greater than zero."
            ),
        )

    # -----------------------------------------------------
    # Fetch all tickers CONCURRENTLY in thread pool
    # Each ticker gets a 20-second timeout.
    # Failed tickers are collected rather than crashing
    # the whole request.
    # -----------------------------------------------------

    loop = asyncio.get_running_loop()
    PER_TICKER_TIMEOUT = 20  # seconds

    async def fetch_one(ticker: str, amount: float):
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(
                    _executor,
                    _fetch_ticker_data,
                    ticker,
                    amount,
                    total_value,
                ),
                timeout=PER_TICKER_TIMEOUT,
            )
            return {"ok": True, "data": result}
        except asyncio.TimeoutError:
            print(f"[portfolio] Timeout fetching {ticker}")
            return {
                "ok": False,
                "ticker": ticker,
                "reason": f"{ticker} timed out — Yahoo Finance did not respond in time.",
            }
        except HTTPException as exc:
            return {
                "ok": False,
                "ticker": ticker,
                "reason": exc.detail,
            }
        except Exception as exc:
            print(f"[portfolio] Error for {ticker}: {exc}")
            return {
                "ok": False,
                "ticker": ticker,
                "reason": str(exc),
            }

    results = await asyncio.gather(
        *[
            fetch_one(h["ticker"], h["amount"])
            for h in holdings
        ]
    )

    # Separate successes from failures
    successes = [r for r in results if r["ok"]]
    failures = [r for r in results if not r["ok"]]

    if not successes:
        # Every ticker failed — surface meaningful detail
        failed_detail = "; ".join(
            f"{f['ticker']}: {f['reason']}" for f in failures
        )
        raise HTTPException(
            status_code=503,
            detail=f"Unable to fetch data for any holding. {failed_detail}",
            headers={"X-Failed-Tickers": ",".join(f["ticker"] for f in failures)},
        )

    # Warn about partial failures in the response body rather
    # than raising — callers can still show what succeeded.
    failed_tickers = [
        {"ticker": f["ticker"], "reason": f["reason"]}
        for f in failures
    ]

    # -----------------------------------------------------
    # Build combined data structures from successes
    # -----------------------------------------------------

    all_returns = {}
    weights = {}
    stock_stats = {}

    for r in successes:
        d = r["data"]
        ticker = d["ticker"]
        all_returns[ticker] = d["returns"]
        weights[ticker] = d["weight"]
        stock_stats[ticker] = d["stats"]

    # Re-normalise weights if some tickers failed and
    # their amounts are now missing from the denominator.
    if failures:
        successful_tickers = list(all_returns.keys())
        successful_amounts = {
            h["ticker"]: h["amount"]
            for h in holdings
            if h["ticker"] in successful_tickers
        }
        new_total = sum(successful_amounts.values())
        if new_total > 0:
            for t in successful_tickers:
                weights[t] = successful_amounts[t] / new_total
            total_value = new_total

    # -----------------------------------------------------
    # Portfolio returns
    # -----------------------------------------------------

    tickers = list(all_returns.keys())

    min_len = min(
        len(returns)
        for returns
        in all_returns.values()
    )

    if min_len <= 0:
        raise HTTPException(
            status_code=422,
            detail=(
                "Insufficient return history "
                "to calculate portfolio risk."
            ),
        )

    portfolio_returns = np.zeros(min_len)

    for ticker in tickers:
        portfolio_returns += (
            weights[ticker]
            * np.array(
                all_returns[ticker]
            )[:min_len]
        )

    # -----------------------------------------------------
    # Correlation matrix
    # -----------------------------------------------------

    corr_matrix = {}

    for ticker_one, ticker_two in combinations(
        tickers,
        2,
    ):
        min_pair_len = min(
            len(
                all_returns[
                    ticker_one
                ]
            ),
            len(
                all_returns[
                    ticker_two
                ]
            ),
        )

        r1 = all_returns[
            ticker_one
        ][:min_pair_len]

        r2 = all_returns[
            ticker_two
        ][:min_pair_len]

        if min_pair_len < 2:
            continue

        corr = float(
            np.corrcoef(
                r1,
                r2,
            )[0, 1]
        )

        if np.isnan(corr):
            corr = 0.0

        corr_matrix[
            f"{ticker_one}_{ticker_two}"
        ] = round(
            corr,
            3,
        )

    # -----------------------------------------------------
    # Relative holding comparison
    # -----------------------------------------------------

    comparison = build_stock_comparison(
        stock_stats
    )

    # -----------------------------------------------------
    # Final response
    # -----------------------------------------------------

    return {
        "total_value": round(
            total_value,
            2,
        ),

        "weights": {
            ticker: round(
                weights[ticker] * 100,
                2,
            )
            for ticker in tickers
        },

        "portfolio_volatility": safe_float(
            np.std(portfolio_returns) * 100,
            3,
        ),

        "portfolio_sharpe": safe_float(
            sharpe_ratio(portfolio_returns),
            3,
        ),

        "portfolio_var_95": safe_float(
            historical_var(portfolio_returns) * 100,
            3,
        ),

        "correlation": corr_matrix,

        "comparison": comparison,

        # Empty list when all tickers succeeded;
        # populated when some failed so the UI can surface detail.
        "failed_tickers": failed_tickers,
    }