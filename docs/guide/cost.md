# Tokens & cost

agtail surfaces token usage and an approximate USD cost at two granularities:

- **Per turn** — each assistant turn (one API call) gets a `42,548 tok ≈$0.5851` badge, in both the CLI `show` and the web timeline.
- **Per session** — `stats` and the web timeline header show the session totals (input / output / cache-read) and the summed cost.

Tokens are consumed by the assistant turn, not by individual tool calls — a tool call's cost is attributed to the turn that emitted it. Claude reports usage on each assistant message; Codex's `token_count` event is attached to the preceding response.

## Prices come from LiteLLM

Rather than hand-maintaining a price table, agtail sources model prices from LiteLLM's community-maintained sheet, [`model_prices_and_context_window.json`](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json).

- The file is fetched once and **cached on disk** at `~/.cache/agtail/litellm_prices.json`.
- It is refetched when the cache is older than **7 days**.
- Offline with a stale cache, the cached prices are used; with no cache at all, cost shows as unknown and a note is printed to stderr.

Model ids are matched by exact id, by the part after a provider `/`, and with a trailing `-YYYYMMDD` date stripped (treated as the same model).

## Unknown cost is deliberate

If LiteLLM doesn't list a model, agtail shows **"cost unknown"** instead of guessing a price — tokens are still shown exactly. This follows the project's no-fallback principle ([Concepts](./concepts)): a wrong number that looks authoritative is worse than an honest "unknown".

If a session mixes a priced and an unpriced model, the session total is reported as unknown (it would be incomplete), and the UI names which model wasn't priced.

## Accuracy notes

- Costs are **approximate**. Cache-read and cache-write tokens are billed differently from fresh input; agtail applies LiteLLM's per-token rates for each where available.
- Each assistant turn's input includes the full (largely cached) context, so summing per-turn input across a long session is expected to be large — that is what you are billed, with cache discounts applied.
