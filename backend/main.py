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
from dotenv import load_dotenv
from google import genai
from itertools import combinations
import numpy as np


# =========================================================
# CONFIGURATION
# =========================================================

load_dotenv()

client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY")
)

app = FastAPI(
    title="PortfolioOS API",
    description="Stock and portfolio risk analytics API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# HELPERS
# =========================================================

def normalize_scores(values, higher_is_better=True):
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
# ROOT
# =========================================================

@app.get("/")
def root():
    return {
        "message": "PortfolioOS backend is live"
    }


# =========================================================
# STOCK INFORMATION
# =========================================================

@app.get("/stock/{ticker}")
def get_stock(ticker: str):
    ticker = ticker.strip().upper()

    stock = yf.Ticker(ticker)

    try:
        info = stock.info

    except Exception as e:
        print(
            f"Yahoo Finance info error for "
            f"{ticker}: {e}"
        )

        try:
            fast_info = stock.fast_info

            price = fast_info.get(
                "lastPrice"
            )

            currency = fast_info.get(
                "currency"
            )

            return {
                "ticker": ticker,
                "name": ticker,
                "price": price,
                "currency": currency,
            }

        except Exception as fallback_error:
            print(
                "Yahoo Finance fallback error "
                f"for {ticker}: "
                f"{fallback_error}"
            )

            raise HTTPException(
                status_code=503,
                detail=(
                    "Yahoo Finance is temporarily "
                    "unavailable. Please try again."
                ),
            )

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
        stock = yf.Ticker(ticker)

        hist = stock.history(
            period=period
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
        stock = yf.Ticker(ticker)

        hist = stock.history(
            period="1y"
        )

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
        stock = yf.Ticker(ticker)

        hist = stock.history(
            period="1y"
        )

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
# GEMINI RISK SUMMARY
# =========================================================

@app.get("/stock/{ticker}/summary")
def get_summary(ticker: str):
    ticker = ticker.strip().upper()

    try:
        stock = yf.Ticker(ticker)

        hist = stock.history(
            period="1y"
        )

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

        # ---------------------------------------------
        # Company information
        # ---------------------------------------------

        try:
            info = stock.info

        except Exception as e:
            print(
                f"Yahoo Finance info error "
                f"for {ticker}: {e}"
            )

            try:
                fast_info = stock.fast_info

                name = ticker

                current_price = fast_info.get(
                    "lastPrice"
                )

            except Exception as fallback_error:
                print(
                    "Yahoo Finance fast_info "
                    f"error for {ticker}: "
                    f"{fallback_error}"
                )

                name = ticker
                current_price = prices[-1]

        else:
            name = (
                info.get("longName")
                or ticker
            )

            current_price = (
                info.get("currentPrice")
                or prices[-1]
            )

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
        # Gemini prompt
        # ---------------------------------------------

        prompt = f"""
You are a professional private banker explaining investment risk
to a retail investor.

Given this data for {risk_data['name']} ({ticker}):

- Current Price: {risk_data['price']}
- Daily Volatility: {risk_data['volatility']}%
- Sharpe Ratio: {risk_data['sharpe_ratio']}
- Historical VaR 95%: {risk_data['var_95']}%
- Monte Carlo Expected Price (1yr):
  {risk_data['mc']['expected_price']}
- Monte Carlo Worst Case:
  {risk_data['mc']['worst_case']}
- Monte Carlo Best Case:
  {risk_data['mc']['best_case']}

Write a 3 sentence plain-English risk summary.

Be direct and specific with the numbers.
Explain what the risk means for the investor's actual money.
Avoid financial jargon.
Do not give a generic disclaimer.
"""

        response = client.models.generate_content(
            model="gemini-3.6-flash",
            contents=prompt,
        )

        return {
            "summary": response.text
        }

    except HTTPException:
        raise

    except Exception as e:
        print(
            f"Summary error for "
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
# PORTFOLIO RISK + COMPARISON
# =========================================================

@app.post("/portfolio/risk")
def portfolio_risk(data: dict):
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
    # Historical data + individual metrics
    # -----------------------------------------------------

    all_returns = {}
    weights = {}
    stock_stats = {}

    for holding in holdings:
        ticker = holding[
            "ticker"
        ]

        amount = holding[
            "amount"
        ]

        try:
            stock = yf.Ticker(
                ticker
            )

            hist = stock.history(
                period="1y"
            )

            if hist.empty:
                raise HTTPException(
                    status_code=404,
                    detail=(
                        f"No historical data "
                        f"found for {ticker}"
                    ),
                )

            prices = hist[
                "Close"
            ].tolist()

            if len(prices) < 2:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Insufficient historical "
                        f"data for {ticker}"
                    ),
                )

            returns = get_returns(
                prices
            )

            if len(returns) == 0:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Unable to calculate "
                        f"returns for {ticker}"
                    ),
                )

            all_returns[ticker] = returns

            weights[ticker] = (
                amount / total_value
            )

            # ---------------------------------------------
            # Individual stock comparison metrics
            # ---------------------------------------------

            one_year_return = (
                (
                    prices[-1]
                    / prices[0]
                )
                - 1
            ) * 100

            stock_stats[ticker] = {
                "ticker": ticker,

                "return_1y": round(
                    float(
                        one_year_return
                    ),
                    2,
                ),

                "volatility": round(
                    float(
                        volatility(
                            returns
                        )
                    ) * 100,
                    3,
                ),

                "sharpe": round(
                    float(
                        sharpe_ratio(
                            returns
                        )
                    ),
                    3,
                ),

                "var_95": round(
                    float(
                        historical_var(
                            returns
                        )
                    ) * 100,
                    3,
                ),
            }

        except HTTPException:
            raise

        except Exception as e:
            print(
                f"Portfolio data error "
                f"for {ticker}: {e}"
            )

            raise HTTPException(
                status_code=503,
                detail=(
                    f"Unable to retrieve data "
                    f"for {ticker}. Please try again."
                ),
            )

    # -----------------------------------------------------
    # Portfolio returns
    # -----------------------------------------------------

    tickers = list(
        all_returns.keys()
    )

    if not tickers:
        raise HTTPException(
            status_code=400,
            detail="No valid holdings were found.",
        )

    min_len = min(
        len(returns)
        for returns in all_returns.values()
    )

    if min_len <= 0:
        raise HTTPException(
            status_code=422,
            detail=(
                "Insufficient return history "
                "to calculate portfolio risk."
            ),
        )

    portfolio_returns = np.zeros(
        min_len
    )

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

        "portfolio_volatility": round(
            float(
                np.std(
                    portfolio_returns
                )
            ) * 100,
            3,
        ),

        "portfolio_sharpe": round(
            float(
                sharpe_ratio(
                    portfolio_returns
                )
            ),
            3,
        ),

        "portfolio_var_95": round(
            float(
                historical_var(
                    portfolio_returns
                )
            ) * 100,
            3,
        ),

        "correlation": corr_matrix,

        "comparison": comparison,
    }