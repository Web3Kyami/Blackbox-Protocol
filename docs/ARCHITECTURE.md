# Architecture

## State machine

```text
REGISTRATION --start time--> LIVE --end/authorized close--> CLOSED --capped payout--> SETTLED
     |                         |
 register commitments         accept/reject receipts
```

Registration at or after the start is rejected. Actions before the start, after the end, or after explicit close are rejected. Close is permissionless after end (any account, not sponsor-only — f3), same for settle. Settlement is single-use and capped at `min(deposited, prize_cap)`. Escrow refunds are permissionless post-close.

## Authority model

- Sponsor: creates fixed rules, sets `price` + `float_token` before start only, deposits prize; cannot edit post-start. `add_allowed_asset/target` locked at start (rules freeze).
- Strategy operator: registers one opaque commitment (version hash); `registrant` stored and emitted; reported amounts never drive the Option B scorer.
- Arena adapter: bound at setup (`set_action_adapter` once, locked); only it may call the private `open_submit_action*` path. Public lifecycle calls are permissionless.
- Float token: ERC-20 whose `balance_of(registrant)` is the value axis when set — contract-owned measurement, not self-report.
- Web/dashboard: read-only projection via `starknetCall`; it cannot select or reorder the winner — winner is `get_winner()` on-chain.
- LLM: no scoring authority.

## Rules and commitment

SHA-256 over recursively key-sorted JSON (`packages/core/src/arena.mjs::commitRules()`), truncated to 31 bytes (felt252), stored as `rules_commitment`. Both off-chain manifest and on-chain read must agree (`BigInt` compare in `open-round-crosscheck`). Mixing algorithms is forbidden. Visible in dashboard as canonical JSON for local `sha256` recompute.

## Registration model

Each commitment = `poseidon`? No — label→commitment map is `sha256(canonicalJson)` truncated to 240 bits (see evidence `derived_by`). Commitment is identifier, not ZK proof of code. Registration order stored for tie-break; registrant binding verified per strategy via `get_registrant(commitment)`.

## Action receipts (two eras)

- **Legacy / escrow era (`v4–v5`):** `open_submit_action*` receipts carry `allocation_units × price` pulled via `transfer_from` into adapter per-pool custody (`get_custody(pool, receipt)`), plus `portfolio_value_before/after` (self-reported, D012). Scoring still used those values before Option B.
- **Option B era:** receipts remain for evidence/custody, but **scorer ignores `portfolio_value_after`** when `float_token` is set — it uses `balance_of` + checkpoints. The spoof demo (Tortoise inflated `5000`) proves the branch switch.

## Value axis — Option B attested float (RECOMMENDED, shipped B1)

**Why:** scorer cannot trust self-reported `current_value`; Starknet can't read historical wallet balances, but it can read live token balances at known times.

```text
set_float_token(token) [sponsor-only, before start, before any registration, once]
    -> stored float_token

register_strategy(commitment):
    -> balance_before = token.balance_of(registrant)  (if float != 0)
    -> store attest_start[commit], attest_peak[commit]=start, maxDD=0
    -> each commitment isolated

checkpoint(commitment):  # permissionless, any time while !closed && float set && registered
    -> cur = token.balance_of(registrant)  [high != 0 saturates to 2^128-1]
    -> peak = max(existing_peak, cur)
    -> cur_dd = peak > cur ? (peak - cur)*10000/peak : 0  (u256, saturating)
    -> max_dd = max(existing, cur_dd)
    -> index = counts[commit]++; key = poseidon([commitment, index]); store Checkpoint{balance:cur, ts:block_timestamp}
    -> emit CheckpointRecorded

get_score(commitment):
    if float==0 or attest_start==0:  # legacy path
        if start==0 => score -10000 (ineligible); else legacy return/drawdown
    else:
        cur = token.balance_of(registrant)  # live final, no arg
        peak = max(attest_start, attest_peak, cur)
        cur_dd = peak>cur ? (peak-cur)*10000/peak : 0
        max_dd = max(attest_max_dd, cur_dd)
        return_bps = clamped_return_bps(cur, start)  # trunc((cur-start)*10000/start), saturates i64
        eligible = max_dd <= 3500 bps && ...  # cap param
        score = eligible ? return_bps - max_dd : -10000 (or ineligible sentinel)
```

Custody (`open_submit_action_escrowed` / `ARENA_ADAPTER` `withdraw`) still enforces allocation bonds but no longer drives `get_winner`. Checkpoints are poseidon-hashed by `commitment+index` so partial replay must recompute hashes. Drawdown view is `effective_peak = max(start, peak_stored, current)`.

**Honest holes:** single float token (multi-token/LP wealth invisible), checkpoint liveness depends on someone calling `checkpoint()` (permissionless crank; mitigated by contest rule “≥N checkpoints or settle ineligible”), unexplained external inflows are forfeit.

Compare A/B/C in `docs/VALUE-AXIS-OPTIONS.md`. Decision: Option B — the only scorer that measures the result itself on-chain.

## Validation, scoring, drawdown

Legacy validation order (kept for receipt acceptance): shape, registration, time window, duplicate receipt, asset/target allowlist, current-value consistency, drawdown bounds, allocation cap `maxAllocationBps=3500`. Scoring when attested:

```
return_bps = trunc((final - start) * 10000 / start)   # final = live balance_of, start = attest_start
max_dd = max(attest_max_dd_stored, checkpoint drawdowns, current drawdown)
eligible = max_dd <= 3500  (+ allocation checks at action time)
score = eligible ? return_bps - max_dd : -10000
```

Sort: eligible desc, score desc, max_dd asc, registration order asc. Saturating `u256 -> i128 -> i64` prevents panic on huge values (201-level fix).

## Public RPC mode (Vercel, judge-demo, mainnet-ready)

Dashboard no longer hardwired to `127.0.0.1:4174`.

```text
resolvePublicRpcConfig() ->
  query ?network/?rpcUrl/?arena + localStorage bb:rpcUrl/bb:arenaAddress  (B1 demo defaults when ?network=sepolia or ?public=1)
  -> { rpcUrl, arenaAddress, adapterAddress, isPublic }
        |
        +--> starknetCall(rpcUrl, arena, selector, calldata)  # direct RpcProvider.call (starknet.js)
        +--> refreshPublicState() -> get_float_token, get_attest_*, get_checkpoint*, get_score (signed PRIME decode), get_winner, get_settlement, rules_commitment
        +--> renderPublicStatusHtml (topbar Sepolia·Public, block number, attest panel, leaderboard LEADER even when negative)
        +--> wallet self-register dual path (devnet vs public rpc + verifyRegistrantBinding on correct rpc)

Default Sepolia: https://starknet-sepolia-rpc.publicnode.com  (no Alchemy key, secret scan PASS)
Mainnet hint:    https://starknet-mainnet-rpc.publicnode.com
Offline fallback: devnet session fetch fails -> try public RPC before showing offline, with hint link ?network=sepolia&arena=0x52d...&rpcUrl=publicnode
Form injected by setupPublicRpcControls() in #disconnected-banner: Save/Clear/Load B1 Demo -> localStorage
```

Static `dist/web` is `vercel --prod` of vanilla JS; no `VERCEL_ENV`, no secrets. Judges on any network can verify B1 via `curl` + `starknetCall`.

## Adapter & custody (per-pool, f3 permissionless)

`ArenaAdapterV2` (class `0x418dbc...00bc`): `set_action_adapter` once, `open_submit_action*` pulls `allocation_units × price` via `transfer_from` into `custody: Map<(pool=caller+whitelisted_target, receipt), raw>`. `withdraw(pool, receipt)` only by pool registrant, post-settle, once per receipt; custody zeroed before transfer (CEI). Events `ActionEscrowed {raw, units}` / `EscrowRefunded {raw}`. Permissionless `close()` / `settle()` (any caller) + `refund_escrow()` on arena side enforce liveness without sponsor.

## Trust assumptions

- Fixture valuations are deterministic demo inputs (Case Study) — not oracle prices.
- Sponsor fixes rules before commitment; cannot edit post-start. `set_float_token` / `set_price` / `add_allowed_*` all REVERT after start.
- Option B attested values are contract-observed but single-token; off-float wealth is trust hole disclosed in README.
- Settlement pays `min(deposited, prize_cap)` to `get_registrant(winner)`; escrow drained to 0; token mechanics are contract-owned (P4.3+).
- Real STRK20 pool privacy depends on prover/discovery/relayer/pool config — privacy `UNVERIFIED` beyond adapter shape.
- Web is read-only; never fabricates scores (renders “Score unavailable — contract read failed” on RPC failure).

## Cairo authority now (not UNCOMPILED)

Cairo mirror **is** production authority: `contracts/src/arena.cairo` 998 lines, class `0x7ca7cd…10e360`, builds with Scarb 2.17.0, 67 Cairo tests (53 P1 + 14 B) compile-verified (snforge dlopen pending VPS). Legacy “UNCOMPILED” note is retired for Option B.
