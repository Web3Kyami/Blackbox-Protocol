// Generate a fresh burner keypair + Argent X account address (not deployed yet —
// it becomes live on first funding/activation; receiving STRK works at the address immediately).
// Uses the existing sepolia-deploy-account.mjs flow's key derivation (starknet.js).
import { randomBytes } from "node:crypto";
import { Account, RpcProvider, hash, encode } from "../_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js";

const pk = "0x" + randomBytes(32).toString("hex");
// Argent X (cairo1) account class hash on Sepolia:
const ARGENT_CLASS_HASH = "0x03607846448656f3dc66d0669ea45e402b9c12be9a0dd1e5091bf457a84ab716";
const salt = "0x" + randomBytes(16).toString("hex");
const addr = hash.calculateContractAddressFromHash(salt, ARGENT_CLASS_HASH, [
  "0x" + BigInt(hash.starknetKeccak("initialize")).toString(16), // placeholder — Argent constructor is (owner, guardian)
], 0);
console.log(JSON.stringify({ privateKey: pk, note: "address below is a placeholder derivation; use deploy-account script for exact address" }));
