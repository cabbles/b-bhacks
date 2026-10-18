// Writes shared/abi/*.json (always) and shared/deployments.json (after a Base Sepolia broadcast).
// Usage: node contracts/scripts/export.mjs   (run `forge build` or the deploy script first)
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shared = resolve(root, '../shared');

mkdirSync(resolve(shared, 'abi'), { recursive: true });
for (const name of ['StakePool', 'MarketPool', 'CommitmentBond']) {
    const artifact = JSON.parse(readFileSync(resolve(root, `out/${name}.sol/${name}.json`), 'utf8'));
    writeFileSync(resolve(shared, `abi/${name}.json`), JSON.stringify(artifact.abi, null, 2) + '\n');
    console.log(`wrote shared/abi/${name}.json`);
}

const run = resolve(root, 'broadcast/Deploy.s.sol/84532/run-latest.json');
if (!existsSync(run)) {
    console.log('no Base Sepolia broadcast yet; deployments.json unchanged');
    process.exit(0);
}
const b = JSON.parse(readFileSync(run, 'utf8'));
const created = (name) => {
    const tx = b.transactions.find((t) => t.contractName === name && t.transactionType === 'CREATE');
    const receipt = b.receipts.find((r) => r.transactionHash === tx?.hash);
    if (!tx || !receipt || BigInt(receipt.status) !== 1n) throw new Error(`no successful ${name} deployment in ${run}`);
    return { tx, receipt };
};
const market = created('MarketPool');
const depPath = resolve(shared, 'deployments.json');
const dep = JSON.parse(readFileSync(depPath, 'utf8'));
// STAKE_POOL redeploys reuse the pool already in deployments.json; MarketPool must point at it.
const hasPool = b.transactions.some((t) => t.contractName === 'StakePool' && t.transactionType === 'CREATE');
const pool = hasPool ? created('StakePool') : null;
const poolAddress = pool ? pool.tx.contractAddress : dep.pool;
if (market.tx.arguments[0].toLowerCase() !== poolAddress.toLowerCase()) throw new Error('MarketPool points at a different StakePool than deployments.json');
const bond = created('CommitmentBond');
Object.assign(dep, {
    chainId: 84532,
    market_pool: market.tx.contractAddress,
    bond_pool: bond.tx.contractAddress,
    ...(pool && {
        pool: pool.tx.contractAddress,
        token: pool.tx.arguments[0],
        referee: pool.tx.arguments[1],
        deployBlock: Number(BigInt(pool.receipt.blockNumber)),
    }),
});
writeFileSync(depPath, JSON.stringify(dep, null, 2) + '\n');
console.log('wrote shared/deployments.json', dep);
