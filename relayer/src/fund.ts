// Tops up the treasury with testnet AUSD from the Agora faucet and prints balances.
// pnpm --filter relayer fund
import { formatEther, formatUnits } from 'viem';
import { deployments, FAUCET, faucetAbi, publicClient, send, tokenAbi, treasury } from './chain.ts';

const bal = () =>
    publicClient.readContract({ address: deployments.token, abi: tokenAbi, functionName: 'balanceOf', args: [treasury.address] });

console.log('treasury', treasury.address);
console.log('ETH ', formatEther(await publicClient.getBalance({ address: treasury.address })));
console.log('AUSD', formatUnits(await bal(), 6));
const { hash } = await send({ address: FAUCET, abi: faucetAbi, functionName: 'requestFunds', args: [treasury.address] });
console.log('faucet tx', hash);
console.log('AUSD', formatUnits(await bal(), 6));
