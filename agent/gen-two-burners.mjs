// Generate two fresh burner keypairs + prefund addresses (OZ v1.0.0 class, salt 0x0).
// Writes credentials to .local/burner-b.env and .local/burner-c.env (gitignored).
// Prints PUBLIC ADDRESSES ONLY — never private keys.
import { readFileSync, writeFileSync } from "node:fs";
import { ec, hash } from "../_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js";

const OZ_ACCOUNT_CLASS_HASH = "0x05b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564";

function makeBurner(label) {
  const privBytes = ec.starkCurve.utils.randomPrivateKey();
  const privateKey = "0x" + Buffer.from(privBytes).toString("hex");
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  const address = "0x" + BigInt(
    hash.calculateContractAddressFromHash("0x0", OZ_ACCOUNT_CLASS_HASH, [publicKey], "0x0"),
  ).toString(16);
  return { label, privateKey, address };
}

const out = [];
for (const label of ["b", "c"]) {
  const b = makeBurner(label);
  writeFileSync(`.local/burner-${label}.env`,
    `STARKNET_ACCOUNT_ADDRESS=${b.address}\nSTARKNET_PRIVATE_KEY=${b.privateKey}\n# Network: sepolia\n`);
  out.push(b);
}

console.log("=== Two fresh burners created ===");
console.log("");
for (const b of out) {
  console.log(`Burner ${b.label.toUpperCase()} (fund this address):`);
  console.log(b.address);
  console.log("");
}
console.log("Credentials written to .local/burner-b.env and .local/burner-c.env (gitignored).");
