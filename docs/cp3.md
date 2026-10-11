# CP3 deployment check

Checked on October 11, 2026 by Agent C against the live service URLs in `shared/deployments.json`.

- Public web: https://considering-particles-fraction-bool.trycloudflare.com returned HTTP 200.
- Referee `/health` returned `{ "ok": true }` with `ngrok-skip-browser-warning: 1`.
- Relayer `/config` returned the deployed Base Sepolia pool, AUSD domain, and markets 1–4.
- Relayer `POST /groups` rejected an invalid joining window with the documented validation error; no market was created by this check.

The web tunnel runs from Agent A’s laptop. Its issue #1 update says UI changes require a rebuild through `infra/run-web.sh`. Keep the laptop and tunnel running during the demo.

## Agent C continuation

`/split` now offers Start a group with time to join, additional time to finish, and test AUSD per friend. It calls the live relayer, selects the returned market, and generates task invite links for that market. Creation is disabled in mock mode. Existing markets remain available.

Validation: TypeScript check, ERC-3009 signature check (20/20), production Next.js build in an isolated temporary copy, browser inspection of the form and a project-prefilled task link, and `git diff --check` all passed. The valid creation transaction has not been exercised in this continuation.

Remaining: publish/rebuild the updated web; exercise valid group creation; capture final real-browser screenshots; fill live cohort totals at freeze; record/upload the two-minute video. YES/NO betting remains roadmap until a deployed MarketPool ABI/address is available.
