# Goldstar CMC Ingestion — dedicated Staging service

The standalone Worker is deployed as `goldstar-cmc-ingest-staging`. It is separate from the legacy CMC/TradingView Worker, the NDS knowledge database, and the MT5 gateway.

## Live endpoints

- Health: `GET https://goldstar-cmc-ingest-staging.goldstar-nsl83.workers.dev/health`.
- Owner console: one-time bootstrap link, then `/console`.
- Owner ingestion API: `POST /api/cmc/quotes`; requires the HttpOnly owner session cookie and exact same-origin request.
- Credential onboarding: `POST /api/cmc/credential`; validates the supplied CMC key against `/v1/key/info`, stores it encrypted with AES-256-GCM in a separate EU D1 vault, and performs one BTC/USD verification ingestion.

## Bound resources

- `MARKET_DB` → `goldstar_market_research_staging` (D1 ID `e5978640-6035-41fe-8947-4e6fc58c5a92`).
- `VAULT_DB` → `goldstar_cmc_vault_staging` (EU D1 ID `d62bb4da-bb83-47b2-84cc-baea6dda6fb6`).
- `CREDENTIAL_VAULT_KEY` is a Cloudflare Secret. Its value is never stored in GitHub, D1, chat, or logs.
- The CMC API key is encrypted at rest in `VAULT_DB`; only ciphertext and IV are stored.

## Bootstrap and session security

- The bootstrap token is 256-bit random material. Only its SHA-256 hash is stored in D1 and it expires after 7 days.
- `GET /bootstrap/:token` is read-only and displays a confirmation page; link previews and scanners cannot consume the token.
- An explicit same-origin `POST /bootstrap/activate` atomically consumes the token and creates a 30-day HttpOnly, Secure, SameSite=Strict session cookie.
- API POST requests require an exact Origin match and a valid owner session.
- No CORS access, public quote-ingest route, Cron, automatic trading, or Production binding is configured.

## Ingestion guarantees

- Only 1–20 unique uppercase ticker symbols and a 3–5 character quote currency are accepted.
- Request bodies are size-bounded while streaming.
- Each run creates a running audit record. Quote upserts and the success audit are committed in one D1 batch; provider/D1 errors do not return a success response.
- The API key is never included in API responses or application logs.
- The same market D1 is read by the Financial L2 staging candidate; no NDS D1 is bound.

## Owner action still required

The CMC key cannot be recovered from the prior Worker Secret. The owner must retrieve a current key from the CoinMarketCap Developer Portal and enter it directly in the HTTPS console. Do not paste it into GitHub, chat, PowerShell history, or issue comments.

## Operations / release boundary

- No Cron schedules are configured.
- This service is Staging-only. The old `trading-research-agent` deployment and its Secrets remain unchanged.
- `npm test` includes bootstrap replay, cross-origin rejection, and read-only GET tests.
