import { useState, useEffect, useRef } from "react";
import axios from "axios";

const API =
  process.env.REACT_APP_API_URL ||
  "https://portfolioos-backend-1qdb.onrender.com";

/**
 * Debounced ticker search + suggestion dropdown.
 *
 * Controlled like a normal text input (value / onChange), plus an
 * onSelect callback fired when the user picks a suggestion (click,
 * Enter, or Tab). Calls the backend's /search endpoint, which reads
 * from the tickers.json directory in memory - no yfinance calls
 * happen until the user actually analyzes a ticker.
 *
 * Props:
 *   value        - current input text
 *   onChange(v)  - fired on every keystroke
 *   onSelect(t)  - fired when a suggestion is chosen; t = { symbol, name, exchange, etf }
 *   placeholder  - input placeholder text
 *   inputId      - id passed through to the <input>, for label htmlFor
 *   autoFocus    - optional
 */
function TickerAutocomplete({
  value,
  onChange,
  onSelect,
  onEnter,
  placeholder,
  inputId,
  autoFocus,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const debounceRef = useRef(null);
  const containerRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const query = value.trim();

    if (!query) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const thisRequestId = ++requestIdRef.current;
      setLoading(true);

      axios
        .get(`${API}/search`, {
          params: { q: query, limit: 10 },
        })
        .then((response) => {
          // Ignore stale responses if the user kept typing
          if (thisRequestId !== requestIdRef.current) {
            return;
          }
          setSuggestions(response.data.results || []);
          setOpen(true);
          setHighlightedIndex(-1);
        })
        .catch(() => {
          if (thisRequestId !== requestIdRef.current) {
            return;
          }
          setSuggestions([]);
        })
        .finally(() => {
          if (thisRequestId === requestIdRef.current) {
            setLoading(false);
          }
        });
    }, 180);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function selectSuggestion(suggestion) {
    onSelect(suggestion);
    setOpen(false);
    setSuggestions([]);
    setHighlightedIndex(-1);
  }

  function handleKeyDown(event) {
    if (!open || suggestions.length === 0) {
      if (event.key === "Enter" && onEnter) {
        onEnter();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((prev) =>
        prev < suggestions.length - 1 ? prev + 1 : 0
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : suggestions.length - 1
      );
    } else if (event.key === "Enter") {
      if (highlightedIndex >= 0) {
        event.preventDefault();
        selectSuggestion(suggestions[highlightedIndex]);
        return;
      }
      // No suggestion highlighted - close the dropdown and let the
      // caller's own Enter behavior (e.g. "analyze") run.
      setOpen(false);
      if (onEnter) onEnter();
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="ticker-autocomplete" ref={containerRef}>
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck="false"
        autoFocus={autoFocus}
      />

      {open && suggestions.length > 0 && (
        <ul className="ticker-suggestions" role="listbox">
          {suggestions.map((s, index) => (
            <li
              key={s.symbol}
              role="option"
              aria-selected={index === highlightedIndex}
              className={
                "ticker-suggestion-row" +
                (index === highlightedIndex ? " highlighted" : "")
              }
              onMouseDown={(event) => {
                // onMouseDown (not onClick) so it fires before the
                // input's onBlur/outside-click handler closes the list
                event.preventDefault();
                selectSuggestion(s);
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              <div className="ticker-suggestion-left">
                <span className="ticker-suggestion-symbol">
                  {s.symbol}
                </span>
                <span className="ticker-suggestion-name">
                  {s.name}
                </span>
              </div>

              <div className="ticker-suggestion-tags">
                {s.etf && (
                  <span className="ticker-tag ticker-tag-etf">
                    ETF
                  </span>
                )}
                <span className="ticker-tag">{s.exchange}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && !loading && suggestions.length === 0 && value.trim() && (
        <div className="ticker-suggestions ticker-suggestions-empty">
          No matches for "{value.trim()}"
        </div>
      )}
    </div>
  );
}

export default TickerAutocomplete;