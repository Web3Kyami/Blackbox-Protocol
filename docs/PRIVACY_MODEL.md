# Privacy model

Accessed and reviewed 2026-08-21. `VERIFIED` below means supported by a local test or a cited official architecture statement; it does not mean Blackbox has deployed that property.

| data item | storage location | public/private | visible to whom | leakage | reason required | verified status |
|---|---|---|---|---|---|---|
| Arena rules | contract/public snapshot | public | everyone | business constraints and timing | equal-condition proof | VERIFIED locally |
| Rules commitment | contract/public snapshot | public | everyone | identifies exact rule bytes/hash | tamper evidence | VERIFIED locally |
| Strategy public label | public snapshot | public | everyone | chosen pseudonym may correlate operator | understandable ranking | VERIFIED locally |
| Strategy version commitment | contract/public snapshot | public | everyone | repeated commitment links appearances | registration and replay identity | VERIFIED locally |
| Prompt and model configuration | builder-controlled offchain storage | private | builder and authorized operators | endpoint/log compromise | not required publicly | VERIFIED absent from fixtures by test |
| Proprietary code, signals, weights | builder-controlled offchain storage | private | builder and authorized operators | behavior can still reveal patterns | not required publicly | VERIFIED absent from fixtures by test |
| Arena action receipt fields | contract events/public snapshot | public or potentially public | everyone | timing, strategy commitment, allocation and route may enable inference | validation and audit | VERIFIED locally; onchain UNVERIFIED |
| Accepted/rejected counts and codes | contract/public snapshot | public | everyone | reveals failed policy attempts | auditability | VERIFIED locally |
| Final value, drawdown, score, rank | contract/public snapshot | public | everyone | performance profile revealed | qualification result | VERIFIED locally |
| Shielding deposit address/token/amount | Starknet/STRK20 pool | public | chain observers | direct deposit linkage and amount | public-to-private entry | VERIFIED from official docs; not tested by Blackbox |
| Shielded note contents | encrypted pool state | private | owner/viewing-key holders; selective disclosure actors where applicable | timing and surrounding activity remain | private balance | UNVERIFIED by Blackbox |
| Note-to-note parties and amount | STRK20 pool transaction | private by protocol design | intended participants/viewing authority | interaction timing and proof transaction exist | private transfer | UNVERIFIED by Blackbox |
| Anonymizer actor linkage | relayer/pool/anonymizer route | private or reduced-linkage | chain observer should see shared adapter, not operator | unique timing/amount can correlate; services may see metadata | private app action | UNVERIFIED |
| Anonymizer action amount/timing | target contract and chain | public or potentially observable | chain observers | distinctive action correlation | app execution | VERIFIED from official docs; not tested by Blackbox |
| Withdrawal destination/amount | token and pool contracts | public | everyone | exit address and amount; timing correlation | private-to-public exit | VERIFIED from official docs; not tested by Blackbox |
| Viewing key | wallet/local secret storage | private | owner; authorized disclosure path as designed | loss reveals discoverable notes | note discovery/spending | UNVERIFIED; never handled here |
| Prover request metadata | prover infrastructure | service-visible/policy-dependent | service operator/network observers depending on transport | IP, timing, request sizing | proof generation | UNVERIFIED |
| Discovery request metadata | discovery infrastructure | service-visible unless protected route is used | service/relay/network observers depending on OHTTP | IP, queried channels, timing | note discovery | UNVERIFIED |
| Settlement recipient and amount | depends on selected Green/Yellow route | potentially public | chain observers/services | output correlation | capped reward | UNVERIFIED |

## Claims policy

Allowed now: “Blackbox keeps proprietary strategy logic offchain and publishes deterministic qualification evidence.”

Not allowed now: “fully anonymous,” “completely hidden trades,” “zero metadata,” “private Arena actions,” or “private payout.” The official sprint guide states shielding is public and that DeFi action amount/timing can remain visible even when the actor identity is hidden.

Primary references: [hackathon Day 0 guide](https://github.com/starkience/strk20-hackathon/blob/main/docs/MAINNET-DAY-0.md), [Starknet Privacy repository](https://github.com/starkware-libs/starknet-privacy), and [STRK20 by Example](https://strk20-by-example.org/what-is-strk20).

