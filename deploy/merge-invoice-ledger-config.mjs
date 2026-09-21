import { readFile, writeFile } from "node:fs/promises";

const [configPath] = process.argv.slice(2);
if (!configPath) throw new Error("Missing target configuration path.");
const encoded = process.env.LEDGER_CONFIG_B64;
if (!encoded) throw new Error("Missing invoice-ledger configuration fragment.");

const config = JSON.parse(await readFile(configPath, "utf8"));
const invoiceLedger = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
config.invoiceLedger = invoiceLedger;
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
