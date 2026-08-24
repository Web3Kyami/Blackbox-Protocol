# Architecture

## State machine

```text
REGISTRATION --start time--> LIVE --end/authorized close--> CLOSED --capped payout--> SETTLED
     |                         |
 register commitments         accept/reject receipts
```

Registration at or after the start is rejected. Actions before the start, after the end, or after explicit close are rejected. Close is sponsor-only and cannot occur before the end. Settlement is sponsor-only, single-use, and capped.

## Authority model

- Sponsor: creates fixed rules, closes after the end, and initiates a capped settlement.
- Strategy operator: registers an opaque version commitment; no source, prompt, or model settings are stored.
- Arena adapter: the only intended onchain action caller. It must authenticate the configured STRK20 pool.
- Web/indexer: read-only projection; it cannot select, reorder, or alter the winner.
- LLM: no scoring or winner authority.

The current local JavaScript engine enforces this model as an executable specification. The Cairo mirror is `UNCOMPILED` and must not be treated as production authority.

## Rules and commitment

The local commitment is SHA-256 over recursively key-sorted JSON, including the scoring and rounding policy. Arrays retain order. Production must either use the same canonical byte specification offchain and verify the digest onchain, or switch both layers to a documented Starknet-native commitment. Mixing algorithms is forbidden.

## Registration model

Each public label maps to a 32-byte commitment identifying one sealed strategy version. Registration order is stored for the final tie-break. Commitments are identifiers, not zero-knowledge proofs of the strategy code.

## Action receipt

Public evidence contains: receipt ID, strategy commitment, submission time, asset, target, allocation, accepted flag, and reason code. Validation also receives portfolio values and drawdown; the local public projection omits the after-value per receipt because final values are sufficient for this demo. Production oracle/valuation provenance remains `UNVERIFIED`.

## Validation order and replay protection

Checks run in a stable order: shape, registration, time window, duplicate receipt, asset allowlist, target allowlist, current-value consistency, drawdown bounds, then allocation. A processed receipt ID cannot be reused. Invalid non-duplicate receipts are consumed to prevent alternate replay semantics.

## Scoring

`return_bps = trunc((final_value − starting_value) × 10,000 / starting_value)`

Eligible entries have `max_drawdown_bps <= limit`. Their score is `return_bps − max_drawdown_bps`. Sort by eligibility, higher score, lower drawdown, then earlier registration. Pulse receives no ranked score when disqualified.

## STRK20 Green hypothesis

```text
shielded input note
  -> pool Invoke action
  -> ArenaAdapter.privacy_invoke
  -> authenticated Arena.submit_action
  -> receipt/state update
  -> adapter approves pool
  -> OpenNoteDeposit returns input/change to a note
```

The adapter shape follows the official starter and anonymizer pattern: the pool transfers input before invoke, calls `privacy_invoke`, then pulls approved output described by `OpenNoteDeposit`. Blackbox adds pool authentication and the Arena call. This path is `UNVERIFIED` until the official base flow and custom call succeed on Devnet.

## Yellow fallback

If generic registration/shield/private transfer succeeds but custom invoke is unstable or unavailable, keep actions/scoring public and deterministic while using STRK20 only for private entry or capped payout/identity-linkage reduction. UI and documentation must label action amount, timing, contract state, and receipts public. This fallback is not yet verified either.

## Trust assumptions

- Test fixture valuations are deterministic inputs, not live oracle prices.
- Sponsor may choose Arena rules only before commitment/registration; it cannot edit results.
- `portfolio_value_after` is self-reported (D012): the contract checks the before-value against stored state but cannot independently verify reported performance without signed valuations or an oracle. Both are deferred; UI must disclose this.
- Settlement pays an escrowed prize token to the winner's registrant (D013); settlement token mechanics are contract-owned as of P4.3, with a private Green-path payout still open as an alternative.
- A real integration depends on official prover, discovery, screening, relayer, and pool configuration.
- Privacy depends on the observed STRK20 route and anonymity set, not only contract code.

