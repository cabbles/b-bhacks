/** Deploy against the existing pool using the configured treasury; never prints credentials. */
import { readFileSync, writeFileSync } from 'node:fs';
import { deployments, publicClient, requirePool, treasury, wallet } from '../src/chain.ts';

if (await publicClient.getChainId() !== 84532) throw new Error('Market deployment is restricted to Base Sepolia');
const pool = requirePool();
const artifact = JSON.parse(readFileSync(new URL('../../contracts/out/MarketPool.sol/MarketPool.json', import.meta.url), 'utf8'));
const prior = JSON.parse(readFileSync(new URL('../../contracts/deployments/market-pool.json', import.meta.url), 'utf8'));
if (prior.address) throw new Error('A MarketPool is already recorded; review its deployment before replacing it');
if (!await publicClient.getCode({ address: pool })) throw new Error('StakePool has no deployed code');
const data = { abi: artifact.abi, bytecode: artifact.bytecode.object, args: [pool] };
const hash = await wallet.deployContract(data);
const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`Deployment failed: ${hash}`);
const address = receipt.contractAddress;
const linked = await publicClient.readContract({ address, abi: artifact.abi, functionName: 'stakePool', blockNumber: receipt.blockNumber });
if (String(linked).toLowerCase() !== pool.toLowerCase()) throw new Error('Deployed contract has an unexpected StakePool');
writeFileSync(new URL('../../contracts/deployments/market-pool.json', import.meta.url), JSON.stringify({
    chainId: deployments.chainId, address, stakePool: pool, deployBlock: Number(receipt.blockNumber), txHash: hash,
}, null, 2) + '\n');
console.log(JSON.stringify({ address, txHash: hash, deployBlock: Number(receipt.blockNumber), deployer: treasury.address }, null, 2));
