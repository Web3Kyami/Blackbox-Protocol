# Networks and verified sources

Initial access date: **2026-08-21**. Mainnet surface rechecked against official
sources and live read-only RPC on **2026-08-26**. Values are recorded for
research and are not automatically enabled in application configuration.

## Source pins

| Source | Commit/tag | Use | Status |
|---|---|---|---|
| [STRK20 Private Sprint](https://github.com/starkience/strk20-hackathon) | `45e280da9c870a32e37ea3feec984f73987d11d3` (`main`) | rules, mainnet Day 0 guide, starter link | official/current at access |
| [Starknet Privacy](https://github.com/starkware-libs/starknet-privacy) | `36eac4ea88cd8c59dde1493176e16501c6e90328` (`main`) | current architecture and compatibility matrix | official/current at access |
| Starknet Privacy compatibility checkout | `PRIVACY-0.14.3-RC.2` / `9bfeb8dd35565a2915a0617dff3f649bd5bb891a` | SDK/anonymizer interface inspection | official tag; selected because current main matrix names RC.2 |
| Starknet Privacy latest release | `PRIVACY-0.14.3-RC.5` / `66e3caae8c0201227a6719696d004e30d90aea65` | current mainnet Wallet/SDK readiness review | official release; BlackBox local capability E2E passed 2026-08-27 |
| [STRK20 starter kit](https://github.com/Akashneelesh/strk20-starter-kit) | `187fe789dd4f5de14ccb0953abfdb49a26643664` | wallet `strk20InvokeTransaction` and echo adapter pattern | linked by official sprint repo; demo values are not production pins |
| [Starknet Devnet](https://github.com/starknet-io/starknet-devnet) | `b272b8bc2569a218ad89a162ca090a5eb75aec87` (`main`) | current Devnet source | official/current source; not installed |
| [Starknet Foundry book](https://foundry-rs.github.io/starknet-foundry/getting-started/installation.html) | live docs accessed 2026-08-21 | install and Scarb requirement | official docs |

## Toolchain

| Tool | Chosen/observed version | Origin | Local status |
|---|---:|---|---|
| Node.js | 24.19.0 | existing `kyami` NVM installation | upstream SDK build and Devnet smoke pass |
| npm | 11.17.0 | existing `kyami` NVM installation | upstream locked SDK/E2E installs complete |
| Cairo/Scarb | 2.17.0 | privacy compatibility tag `.tool-versions` and Starkup/asdf | privacy and Blackbox contracts compile |
| Starknet Foundry | 0.59.0 | privacy compatibility tag `.tool-versions` and Starkup/asdf | Blackbox Cairo tests pass 111/111 |
| Rust/Cargo | 1.98.0 | existing `kyami` rustup installation | upstream discovery-service release build passes |
| starknet.js | 10.5.0 | official Privacy RC.5 E2E lockfile and BlackBox Devnet package | RC.5 local capability E2E passes; browser-wallet integration UNVERIFIED |
| Browser bundle | `starknet` 10.5.0, wallet discovery 6.0.2, esbuild 0.25.12 | BlackBox `package.json` lockfile | Wallet API console bundles locally; real extension execution `UNVERIFIED` |
| Privacy SDK/services | `PRIVACY-0.14.3-RC.2` reproducibility pin; RC.5 current release | official privacy repo | capability E2E passes locally on RC.2 and RC.5; mainnet execution `UNVERIFIED` |
| Privacy contracts | `PRIVACY-0.14.3-RC.0` compatibility target | current privacy README | ephemeral local Devnet smoke deployment passes |
| Pathfinder | `eqlabs/pathfinder:v0.22.7` | current privacy README | not installed |

The default tracked local integration remains pinned to RC.2 for reproducibility.
The same tracked capability test also passed against a clean official RC.5
checkout at commit `66e3caae8c0201227a6719696d004e30d90aea65` with its SDK,
screening pool, discovery service, and Starknet.js 10.5.0. This closes the local
SDK migration gate. It does not prove wallet availability, hosted relayer
behavior, or a successful mainnet transaction.

## Official class hashes from the current compatibility matrix

These are class hashes, **not deployment addresses**.

| Contract | Tag | Class hash | Status |
|---|---|---|---|
| Privacy Pool | RC.0 | `0x52107fadffab71bdcbb6b2ccb68ba3e1b5558d94036538053e159d3076ad633` | official matrix; unused |
| Ekubo Anonymizer | RC.0 | `0x2a4ac595283d4d64b9952f5ef5c0da1775bfdb7c9d92237524a21dd8d19ebd7` | official matrix; reference only |
| Vesu Anonymizer | RC.0 | `0x3751128dc3ebd36215f982766f14aaca8f78793e4b0f42a73e49372a8e24aae` | official matrix; reference only |

## Local / Devnet

- Intended local RPC in upstream examples: `http://127.0.0.1:5050` or E2E-specific `http://localhost:9545/rpc/v0_10`.
- Upstream tagged SDK README explicitly tests with `starknet-devnet v0.8.0-rc.3`; current Devnet main reports package version 0.9.2 and newer Starknet dependencies. Compatibility must use the tagged E2E requirement first, not arbitrary latest.
- Upstream Devnet smoke evidence: Devnet 0.8.0-rc.3, 1/1 test passed in 19.61 s on 2026-08-21. Deployment was ephemeral and produced no reusable address set.
- BlackBox capability contracts and the STRK20 pool are deployed ephemerally by
  the tracked Devnet E2E; addresses change per run. On 2026-08-27, the complete
  pass deposit → same-transaction delivery → Gatekeeper invoke path passed 1/1
  on both RC.2 and RC.5 for reusable-note rediscovery and one-shot burn. The E2E
  also verifies a relay transaction sender distinct from the holder. No
  reusable public-network address is claimed.

## Sepolia

Phase 7 dress-rehearsal state (verified live 2026-08-23):

**RPC providers — systematically evaluated:**
| Provider | Status |
|---|---|
| Alchemy `https://starknet-sepolia.g.alchemy.com/v2/$KEY` | ✅ **WORKS** — estimation, large bodies, all read methods. Key in `.env.local`. |
| publicnode | ⚠️ Partial — reads fine; drops multi-MB bodies; V3 estimator intermittently cold |
| dRPC | ❌ Missing `getBlockWithTxHashes`/`getNonce`; free-plan timeouts on big bodies |
| Lava testnet | ❌ "No pairings available" |
| OnFinality | ❌ Unreachable from this host |
| Nethermind free | ❌ Unreachable |
| BlastAPI public | ❌ Discontinued |

**Verified chain facts:**
- chainId `SN_SEPOLIA` (`0x534e5f5345504f4c4941`)
- Canonical tokens: STRK `0x04718f5a…938d`, ETH `0x049d3657…4dc7`
- OZ Account v1.0.0 class: `0x05b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564` (Foundry book; also used by upstream E2E)
- Blackbox burner deployer: `0x20853c681f6b669eac02a0e04ede83ff413f2396eea3b52568c6c14f66e850b` — deployed, ~85 STRK
- TestUSD prize token instance: `0x734ebf9f1494a3b82ae36aa08b5aa7be5287ada306a5bd48a94f278d6f6849a`

**Measured economics (D014):**
- STRK transfer invoke: 726,080 l2_gas actual
- Arena class DECLARE: 844,860,800 l2_gas actual (~41 STRK at market); sequencer admission applies surge multipliers beyond naive bounds math
- Pool class declare estimate ≈ 55 STRK → deferred per D014

**starknet.js v10-beta gotchas (learned the hard way):**
- `Account` takes object args `{provider, address, signer}`
- u256 via hand-written ABIs unreliable → use raw `starknet_call` with `starknetKeccak(selector)`
- `Signer.signRaw` returns `{r, s}` object — use `stark.formatSignature()`
- Raw declares to newer specs need `contract_class.abi` as JSON-encoded **string**
- `Account.declare` internally calls `getStarknetVersion` → needs a node with `getBlockWithTxHashes`

Arena/adapter Sepolia addresses: pending round execution. Pool on Sepolia: deferred (D014).

## Mainnet

Official sprint Day-0 values, rechecked 2026-08-26:

- chain: `SN_MAIN` (`0x534e5f4d41494e`)
- public RPC example: `https://rpc.starknet.lava.build`
- live STRK20 pool: `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`

Read-only RPC returned `SN_MAIN` and class hash
`0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`
at that pool address. This verifies address/code presence, not a successful
BlackBox invocation.

`npm run verify:mainnet-readiness` makes that exact chain-id and class-hash
check repeatable using the public Lava endpoint, or a supplied
`BLACKBOX_MAINNET_RPC`. It is read-only and never signs or submits a transaction.

The preferred dapp route is the Starknet Wallet API (wallet API 0.10.3,
`starknet` 10.4+). A compatible wallet owns viewing keys, discovery, proof
generation, and rotating-relayer submission, so the app needs no prover URL.
Wallet support must be detected rather than assumed.

The low-level Privacy SDK route still has no published mainnet proving-service
URL in the Day-0 guide. RC.5 also requires a hosted discovery indexer for that
route because its on-chain discovery provider is not exported. No endpoint will
be guessed. Mainnet deposits are screened and expose depositor, token, and
amount. No mainnet signing or transaction is authorized.
