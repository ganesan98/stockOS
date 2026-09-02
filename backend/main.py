from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
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
import threading
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

# Thread pool for running blocking data-fetch calls concurrently
# inside async endpoints.
_executor = ThreadPoolExecutor(max_workers=10)


# =========================================================
# IN-MEMORY CACHE
# =========================================================
# Simple dict-based cache with per-entry TTL.
# No external dependency — appropriate for a single-worker
# Render deployment. All accesses are protected by a lock
# so concurrent requests don't race on the same key.
#
# TTLs are configurable via env vars (easy to tune without
# re-deploying):
#   CACHE_QUOTE_TTL_SECONDS   — quote data   (default 3 min)
#   CACHE_TS_TTL_SECONDS      — time series  (default 20 min)

CACHE_QUOTE_TTL = int(os.getenv("CACHE_QUOTE_TTL_SECONDS", "180"))   # 3 min
CACHE_TS_TTL    = int(os.getenv("CACHE_TS_TTL_SECONDS",    "1200"))  # 20 min

_cache: dict = {}          # key -> (stored_at_epoch, value)
_cache_lock = threading.Lock()


def _cache_get(key: str, ttl: int):
    """Return cached value if it exists and hasn't expired, else None."""
    with _cache_lock:
        entry = _cache.get(key)
    if entry is not None:
        stored_at, value = entry
        if (time.time() - stored_at) < ttl:
            print(f"[cache] HIT  {key}")
            return value
    print(f"[cache] MISS {key}")
    return None


def _cache_set(key: str, value) -> None:
    """Store value in the cache with the current timestamp."""
    with _cache_lock:
        _cache[key] = (time.time(), value)

app = FastAPI(
    title="StockOS API",
    description="Stock and portfolio risk analytics API",
    version="1.0.0",
)

_default_origins = ",".join(
    [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://stockos-zwxi.vercel.app",
    ]
)

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", _default_origins).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
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
# HELPERS — RESILIENT DATA FETCHING
# =========================================================

def fetch_history_with_retry(
    ticker: str,
    period: str = "1y",
    retries: int = 3,
    backoff: float = 1.5,
):
    """
    Synchronous wrapper: fetch yfinance time series with automatic retries.
    Results are cached per (ticker, period) for CACHE_TS_TTL seconds.
    Suitable for use inside a thread pool executor.
    
    Returns (yf.Ticker, pd.DataFrame).
    """
    cache_key = f"ts:{ticker}:{period}"
    cached = _cache_get(cache_key, CACHE_TS_TTL)
    if cached is not None:
        return yf.Ticker(ticker), cached

    stock = yf.Ticker(ticker)

    last_error = None
    for attempt in range(retries):
        try:
            hist = stock.history(period=period)
            
            # yfinance returns an empty DataFrame if symbol is invalid
            if hist.empty:
                _cache_set(cache_key, pd.DataFrame())
                return stock, pd.DataFrame()

            # Ensure we have a Date index (not Datetime if yfinance returns that)
            hist.index = hist.index.strftime('%Y-%m-%d')
            hist.index.name = "Date"

            _cache_set(cache_key, hist)
            return stock, hist

        except Exception as exc:
            last_error = exc
            err_str = str(exc).lower()
            
            if "not found" in err_str or "delisted" in err_str or "no data found" in err_str:
                _cache_set(cache_key, pd.DataFrame())
                return stock, pd.DataFrame()
                
            print(
                f"[yfinance] history attempt {attempt + 1}/{retries} "
                f"failed for {ticker}: {exc}"
            )
            if attempt < retries - 1:
                time.sleep(backoff * (attempt + 1))

    # After retries exhausted, differentiate based on last_error
    err_str = str(last_error).lower() if last_error else ""
    if "timeout" in err_str or "connection" in err_str or "readTimeout" in err_str:
        raise HTTPException(
            status_code=504,
            detail=f"Network timeout while fetching data for {ticker}. Please check your connection and try again."
        )
    
    raise HTTPException(
        status_code=503,
        detail=(
            f"Data provider (Yahoo Finance) is temporarily unavailable for {ticker}. "
            "Please try again in a moment."
        ),
    )

def fetch_info_with_retry(
    ticker: str,
    retries: int = 3,
    backoff: float = 1.5,
):
    """
    Synchronous wrapper: fetch yfinance quote dict with retries.
    Results are cached per ticker for CACHE_QUOTE_TTL seconds.
    """
    cache_key = f"quote:{ticker}"
    cached = _cache_get(cache_key, CACHE_QUOTE_TTL)
    if cached is not None:
        return cached

    stock = yf.Ticker(ticker)
    last_error = None
    
    for attempt in range(retries):
        try:
            # fast_info is significantly faster than .info
            fast_info = stock.fast_info
            
            # fast_info raises KeyError or returns nothing if symbol invalid
            if not getattr(fast_info, "last_price", None):
                result = {}
                _cache_set(cache_key, result)
                return result

            # .info is slower but gets longName; we can fallback to ticker if it fails
            try:
                info = stock.info
                name = info.get("longName", info.get("shortName", ticker))
            except Exception:
                name = ticker
                
            currency = getattr(fast_info, "currency", "USD")

            result = {
                "longName": name,
                "currentPrice": fast_info.last_price,
                "currency": currency,
            }
            _cache_set(cache_key, result)
            return result

        except Exception as exc:
            last_error = exc
            err_str = str(exc).lower()
            
            if "not found" in err_str or "delisted" in err_str:
                result = {}
                _cache_set(cache_key, result)
                return result
                
            print(
                f"[yfinance] info attempt {attempt + 1}/{retries} "
                f"failed for {ticker}: {exc}"
            )
            if attempt < retries - 1:
                time.sleep(backoff * (attempt + 1))

    err_str = str(last_error).lower() if last_error else ""
    if "timeout" in err_str or "connection" in err_str:
        raise HTTPException(
            status_code=504,
            detail=f"Network timeout while fetching info for {ticker}."
        )

    raise HTTPException(
        status_code=503,
        detail="Data provider is temporarily unavailable. Please try again.",
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
        "message": "StockOS backend is live"
    }


@app.get("/ping")
def ping():
    """
    Lightweight keep-alive / warmup endpoint.
    The frontend calls this on page load and tab-refocus so the
    API is already warm before the user hits Analyze.
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

    name = ticker
    price = None
    currency = None

    # Attempt 1: quote endpoint
    try:
        info = fetch_info_with_retry(ticker, retries=2)
        if info:
            name = info.get("longName") or ticker
            price = info.get("currentPrice")
            currency = info.get("currency")
    except Exception as e:
        print(f"[get_stock] info failed for {ticker}: {e}")

    # Attempt 2: derive last price from recent history
    if price is None:
        try:
            _, hist = fetch_history_with_retry(ticker, period="5d")
            if hist is not None and not hist.empty:
                price = float(hist["Close"].iloc[-1])
        except Exception as e:
            print(f"[get_stock] history fallback failed for {ticker}: {e}")

    # If we still have nothing, the ticker is likely invalid
    if price is None and name == ticker:
        raise HTTPException(
            status_code=404,
            detail=f"Could not find data for ticker '{ticker}'. Check the symbol and try again.",
        )

    return {
        "ticker": ticker,
        "name": name,
        "price": price,
        "currency": currency or "USD",
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
            "Data provider history error "
            f"for {ticker}: {e}"
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Data provider is temporarily "
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
            info = fetch_info_with_retry(ticker, retries=2)
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
    Blocking worker that fetches 1 year of history and computes
    individual risk metrics for a single ticker.
    Returns a dict on success or raises an exception on failure.
    Runs inside a ThreadPoolExecutor. Relies on the cache so
    repeated calls for the same ticker (e.g. from /simulate)
    never trigger a fresh yfinance request.
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

    # Strip any NaN / Inf from illiquid tickers
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


def _compute_portfolio_metrics(
    successes: list,
    holdings: list,
    failures: list,
    simulated: bool = False,
) -> dict:
    """
    Pure aggregation: given the per-ticker fetch results, compute
    portfolio-level volatility, Sharpe, VaR, correlation matrix,
    and holding comparison.

    Shared by both /portfolio/risk and /portfolio/simulate so the
    math is never duplicated.
    """
    if not successes:
        failed_detail = "; ".join(
            f"{f['ticker']}: {f['reason']}" for f in failures
        )
        raise HTTPException(
            status_code=503,
            detail=f"Unable to fetch data for any holding. {failed_detail}",
            headers={"X-Failed-Tickers": ",".join(f["ticker"] for f in failures)},
        )

    failed_tickers = [
        {"ticker": f["ticker"], "reason": f["reason"]}
        for f in failures
    ]

    # ---------------------------------------------------
    # Build combined data structures from successes
    # ---------------------------------------------------

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
    total_value = sum(h["amount"] for h in holdings)
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

    # ---------------------------------------------------
    # Portfolio returns (weighted sum)
    # ---------------------------------------------------

    tickers = list(all_returns.keys())

    min_len = min(len(r) for r in all_returns.values())

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
            * np.array(all_returns[ticker])[:min_len]
        )

    # ---------------------------------------------------
    # Correlation matrix
    # ---------------------------------------------------

    corr_matrix = {}

    for ticker_one, ticker_two in combinations(tickers, 2):
        min_pair_len = min(
            len(all_returns[ticker_one]),
            len(all_returns[ticker_two]),
        )

        r1 = all_returns[ticker_one][:min_pair_len]
        r2 = all_returns[ticker_two][:min_pair_len]

        if min_pair_len < 2:
            continue

        corr = float(np.corrcoef(r1, r2)[0, 1])

        if np.isnan(corr):
            corr = 0.0

        corr_matrix[f"{ticker_one}_{ticker_two}"] = round(corr, 3)

    # ---------------------------------------------------
    # Relative holding comparison
    # ---------------------------------------------------

    comparison = build_stock_comparison(stock_stats)

    # ---------------------------------------------------
    # Final response
    # ---------------------------------------------------

    response = {
        "total_value": round(total_value, 2),

        "weights": {
            ticker: round(weights[ticker] * 100, 2)
            for ticker in tickers
        },

        "portfolio_volatility": safe_float(
            np.std(portfolio_returns) * 100, 3
        ),

        "portfolio_sharpe": safe_float(
            sharpe_ratio(portfolio_returns), 3
        ),

        "portfolio_var_95": safe_float(
            historical_var(portfolio_returns) * 100, 3
        ),

        "correlation": corr_matrix,

        "comparison": comparison,

        # Empty list when all tickers succeeded;
        # populated when some failed so the UI can surface detail.
        "failed_tickers": failed_tickers,
    }

    if simulated:
        response["simulated"] = True

    return response


@app.post("/portfolio/risk")
async def portfolio_risk(data: dict):

    holdings = data.get("holdings", [])

    if not holdings:
        raise HTTPException(
            status_code=400,
            detail="No holdings provided.",
        )

    # --------------------------------------------------
    # Validate holdings
    # --------------------------------------------------

    cleaned_holdings = []

    for holding in holdings:

        ticker = str(holding.get("ticker", "")).strip().upper()
        amount = holding.get("amount")

        if not ticker:
            raise HTTPException(
                status_code=400,
                detail="Every holding must have a ticker.",
            )

        try:
            amount = float(amount)
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid investment amount for {ticker}.",
            )

        if amount <= 0:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Investment amount for {ticker} must be greater than zero."
                ),
            )

        cleaned_holdings.append({"ticker": ticker, "amount": amount})

    # --------------------------------------------------
    # Merge duplicate tickers
    # --------------------------------------------------

    merged_holdings = {}
    for holding in cleaned_holdings:
        ticker = holding["ticker"]
        merged_holdings[ticker] = (
            merged_holdings.get(ticker, 0) + holding["amount"]
        )

    holdings = [
        {"ticker": ticker, "amount": amount}
        for ticker, amount in merged_holdings.items()
    ]

    # --------------------------------------------------
    # Total portfolio value
    # --------------------------------------------------

    total_value = sum(h["amount"] for h in holdings)

    if total_value <= 0:
        raise HTTPException(
            status_code=400,
            detail="Portfolio value must be greater than zero.",
        )

    # --------------------------------------------------
    # Fetch all tickers CONCURRENTLY in thread pool
    # Each ticker gets a 20-second timeout.
    # Failed tickers are collected rather than crashing.
    # --------------------------------------------------

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
                "reason": f"{ticker} timed out — data provider did not respond in time.",
            }
        except HTTPException as exc:
            return {"ok": False, "ticker": ticker, "reason": exc.detail}
        except Exception as exc:
            print(f"[portfolio] Error for {ticker}: {exc}")
            return {"ok": False, "ticker": ticker, "reason": str(exc)}

    results = await asyncio.gather(
        *[fetch_one(h["ticker"], h["amount"]) for h in holdings]
    )

    successes = [r for r in results if r["ok"]]
    failures = [r for r in results if not r["ok"]]

    return _compute_portfolio_metrics(successes, holdings, failures)


# =========================================================
# PORTFOLIO SIMULATE  (What If — read-only, uses cached data)
# =========================================================

@app.post("/portfolio/simulate")
async def portfolio_simulate(data: dict):
    """
    Stateless What If simulator.

    Accepts the same holdings list as /portfolio/risk plus an
    optional `adjustments` list that overrides individual amounts.
    Any ticker not mentioned in adjustments keeps its original amount.
    New tickers added only in adjustments are supported (hypothetical
    additions).

    This endpoint NEVER writes anything. It reuses the same cached
    yfinance responses already in memory from the previous
    /portfolio/risk call, so repeated simulation calls while the user
    drags a slider do NOT trigger fresh API requests.
    """
    holdings_raw = data.get("holdings", [])
    adjustments_raw = data.get("adjustments", [])

    if not holdings_raw:
        raise HTTPException(
            status_code=400,
            detail="No holdings provided.",
        )

    # Build base amounts map from original holdings
    base_amounts: dict[str, float] = {}
    for h in holdings_raw:
        ticker = str(h.get("ticker", "")).strip().upper()
        try:
            amount = float(h.get("amount", 0))
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid amount for {ticker}.",
            )
        if ticker:
            base_amounts[ticker] = base_amounts.get(ticker, 0) + amount

    # Apply adjustments (override amounts)
    for adj in adjustments_raw:
        ticker = str(adj.get("ticker", "")).strip().upper()
        try:
            new_amount = float(adj.get("new_amount", 0))
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid new_amount for {ticker}.",
            )
        if not ticker:
            continue
        if new_amount <= 0:
            # Treat a zero/negative as removing the holding
            base_amounts.pop(ticker, None)
        else:
            base_amounts[ticker] = new_amount

    if not base_amounts:
        raise HTTPException(
            status_code=400,
            detail="Simulated portfolio has no valid holdings.",
        )

    total_value = sum(base_amounts.values())
    if total_value <= 0:
        raise HTTPException(
            status_code=400,
            detail="Simulated portfolio total value must be greater than zero.",
        )

    holdings = [
        {"ticker": ticker, "amount": amount}
        for ticker, amount in base_amounts.items()
    ]

    # --------------------------------------------------
    # Fetch / reuse cached data concurrently
    # --------------------------------------------------

    loop = asyncio.get_running_loop()
    PER_TICKER_TIMEOUT = 20

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
            print(f"[simulate] Timeout fetching {ticker}")
            return {
                "ok": False,
                "ticker": ticker,
                "reason": f"{ticker} timed out.",
            }
        except HTTPException as exc:
            return {"ok": False, "ticker": ticker, "reason": exc.detail}
        except Exception as exc:
            print(f"[simulate] Error for {ticker}: {exc}")
            return {"ok": False, "ticker": ticker, "reason": str(exc)}

    results = await asyncio.gather(
        *[fetch_one(h["ticker"], h["amount"]) for h in holdings]
    )

    successes = [r for r in results if r["ok"]]
    failures = [r for r in results if not r["ok"]]

    return _compute_portfolio_metrics(
        successes, holdings, failures, simulated=True
    )


