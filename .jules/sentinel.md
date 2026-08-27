## 2024-08-27 - [Overly Permissive CORS Config]
**Vulnerability:** The backend had an overly permissive CORS configuration allowing all origins `["*"]` and all methods `["*"]`.
**Learning:** This could expose the backend to Cross-Site Request Forgery (CSRF) or other attacks if malicious domains made requests to the backend endpoints, which were meant to be accessed only from trusted frontend clients.
**Prevention:** Always restrict CORS `allow_origins` to known trusted domains (e.g., frontend URLs) using environment variables and limit `allow_methods` to only those used by the frontend (e.g., `GET`, `POST`, `OPTIONS`).
