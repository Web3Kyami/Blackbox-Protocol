import { RpcProvider, constants } from "starknet";

const DEFAULT_RPC = "https://rpc.starknet.lava.build";
const MAINNET_POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const EXPECTED_POOL_CLASS_HASH = "0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d";

function canonicalHex(value) {
  return `0x${BigInt(value).toString(16)}`;
}

const rpcUrl = process.env.BLACKBOX_MAINNET_RPC ?? DEFAULT_RPC;
const provider = new RpcProvider({ nodeUrl: rpcUrl });
const [chainId, poolClassHash] = await Promise.all([
  provider.getChainId(),
  provider.getClassHashAt(MAINNET_POOL),
]);

if (canonicalHex(chainId) !== canonicalHex(constants.StarknetChainId.SN_MAIN)) {
  throw new Error(`Wrong network: expected SN_MAIN, got ${chainId}.`);
}
if (canonicalHex(poolClassHash) !== EXPECTED_POOL_CLASS_HASH) {
  throw new Error(
    `Unexpected STRK20 pool class hash: expected ${EXPECTED_POOL_CLASS_HASH}, got ${canonicalHex(poolClassHash)}.`,
  );
}

console.log("Mainnet readiness checks passed (read-only).");
console.log(`RPC: ${rpcUrl}`);
console.log(`Chain: ${chainId}`);
console.log(`STRK20 pool: ${MAINNET_POOL}`);
console.log(`Pool class hash: ${canonicalHex(poolClassHash)}`);
console.log("No transaction was signed, submitted, declared, or deployed.");
