// Run after `forge build`; after deployment also imports a confirmed Base Sepolia broadcast.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
mkdirSync(new URL('abi/', root), { recursive: true });
writeFileSync(new URL('abi/MarketPool.json', root), JSON.stringify(read('out/MarketPool.sol/MarketPool.json').abi, null, 2) + '\n');
const run = new URL('broadcast/DeployMarket.s.sol/84532/run-latest.json', root);
if (existsSync(run)) {
  const b = JSON.parse(readFileSync(run, 'utf8'));
  const tx = b.transactions.find((t) => t.contractName === 'MarketPool' && t.transactionType === 'CREATE');
  const receipt = b.receipts.find((r) => r.transactionHash === tx?.hash);
  if (!tx || !receipt || BigInt(receipt.status) !== 1n) throw new Error('No successful MarketPool deployment');
  writeFileSync(new URL('deployments/market-pool.json', root), JSON.stringify({
    chainId: 84532, address: tx.contractAddress, stakePool: tx.arguments[0], deployBlock: Number(BigInt(receipt.blockNumber)),
  }, null, 2) + '\n');
}
console.log('MarketPool ABI exported; deployment metadata changes only after a successful broadcast.');
