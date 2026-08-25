# Option B — Attested Float Requirements (frozen 2026-08-25)

Source: `docs/HANDOFF.md` Option B + `docs/VALUE-AXIS-OPTIONS.md` Option B (RECOMMENDED).
Gates below grade the CONTRACT change only; script declare/honest-round B1 graded separately.

R1 — Float token lock: `set_float_token(token)` sets `float_token` iff caller == sponsor, token.is_non_zero(), not yet set, before `start_time`, registration_count == 0. After start or after first registration, rejects. Emits `FloatTokenSet`.

R2 — Registration attestation: `register_strategy` when `float_token` is set, reads `token.balance_of(registrant)` (u256, low/high) at call block, stores per-commitment `starting_value` (saturates high!=0 to u128::MAX), `attested_peak = starting_value`, `attested_max_dd = 0`, emits correct. When `float_token` zero, legacy path unchanged (starting_units). Registration after float set but with zero start is recorded but scores ineligible (division by zero guard).

R3 — Checkpoint: `checkpoint(commitment)` permissionless, requires !closed, float_token!=0, commitment registered. Reads live `balance_of(registrant)`, appends `Checkpoint{balance: u128, timestamp: u64}` at index `count` (keyed by commitment+index, hash), increments count, updates `attested_peak`/`attested_max_dd` incrementally (peak = max(peak, balance); drawdown = (peak - balance)*10000/peak if balance<peak). Emits `CheckpointRecorded`. Viewable via `get_checkpoint_count` / `get_checkpoint`.

R4 — Attested scoring: `get_score(commitment)` when float set AND starting_value !=0 uses attested axis: current = `balance_of(registrant)` (live), return_bps = clamped_return_bps(current, start) (saturating u256→i64), effective_peak = max(start, attested_peak, current), cur_dd = drawdown(peak,current), max_dd = max(attested_max_dd, cur_dd), eligible = max_dd <= cap, score = return_bps - max_dd (if eligible else 0). Otherwise legacy axis (current_value vs starting_units, strategy.max_drawdown_bps). No panic on u128::MAX or 0.

R5 — Winner: `get_winner` (permissionless after end, idempotent) iterates commitments via stored order, calls `get_score` per candidate, picks best eligible by score_bps with registration_order tie-break; seeds `found=false` so all-negative fields still crown least-bad; returns 0 if none eligible. Same for `close` path reading. Measured-value spoof via `submit_action`/`open_submit_action` cannot change `get_score` in attested mode.

R6 — Saturating safety: `u256_high !=0` → `u128::MAX`; `clamped_return_bps` handles u128::MAX vs arbitrary start saturating to I64_MAX/−10000 without unwrap; get_score readable for 0 and MAX values (view never panics). New tests assert 0→-10000 and MAX→I64_MAX.

R7 — Lifecycle intact: `max_strategies` cap (REG_FULL), `rules_commitment` freeze post-start, CEI settle (state writes before transfer) still holds; escrowed actions (`open_submit_action_escrowed`) still pull raw=alloc*price, store raw custody, refund exact after close, permissionless.

R8 — Tests: ≥10 new Cairo tests covering R2,R3,R4,R5,R6, plus negative spoof test (inflate reported value, measured winner unchanged). Full suite ≥63 (was 53) green under glibc scarb + snforge 0.59.0; `npm run verify` 40/40 still green.

R9 — Declarations: new Arena class declared on Sepolia via Alchemy (fee via estimateDeclareFee), and honest round B1 (adapter-mediated still) verified: starting_value == historical block balance_at registration, checkpoint balances observable, winner recomputed from chain reads == contract get_winner, settlement == min(deposited,cap), custody 0 after withdraw.

R10 — Anti-placeholder: no demo constants / mock sinks / hardcoded localhost/0xdead in arena.cairo product paths; float_token zero fallback is documented, not a shortcut.
