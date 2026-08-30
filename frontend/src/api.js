function defaultApiUrl() {
  if (typeof window === "undefined") {
    return "https://portfolioos-backend-1qdb.onrender.com";
  }

  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return "http://localhost:8000";
  }

  return "https://portfolioos-backend-1qdb.onrender.com";
}

export const API = process.env.REACT_APP_API_URL || defaultApiUrl();
