// Writes shared/abi/StakePool.json (always) and shared/deployments.json (after a Base Sepolia broadcast).
// Usage: node contracts/scripts/export.mjs   (run `forge build` or the deploy script first)
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shared = resolve(root, '../shared');

const artifact = JSON.parse(readFileSync(resolve(root, 'out/StakePool.sol/StakePool.json'), 'utf8'));
mkdirSync(resolve(shared, 'abi'), { recursive: true });
writeFileSync(resolve(shared, 'abi/StakePool.json'), JSON.stringify(artifact.abi, null, 2) + '\n');
console.log('wrote shared/abi/StakePool.json');

const run = resolve(root, 'broadcast/Deploy.s.sol/84532/run-latest.json');
if (!existsSync(run)) {
    console.log('no Base Sepolia broadcast yet; deployments.json unchanged');
    process.exit(0);
}
const b = JSON.parse(readFileSync(run, 'utf8'));
const tx = b.transactions.find((t) => t.contractName === 'StakePool' && t.transactionType === 'CREATE');
const receipt = b.receipts.find((r) => r.transactionHash === tx.hash);
const depPath = resolve(shared, 'deployments.json');
const dep = JSON.parse(readFileSync(depPath, 'utf8'));
const [token, referee] = tx.arguments;
Object.assign(dep, {
    chainId: 84532,
    pool: tx.contractAddress,
    token,
    referee,
    deployBlock: Number(BigInt(receipt.blockNumber)),
});
writeFileSync(depPath, JSON.stringify(dep, null, 2) + '\n');
console.log('wrote shared/deployments.json', dep);
