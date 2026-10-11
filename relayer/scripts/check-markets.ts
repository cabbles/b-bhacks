/** Real local chain + full relayer + browser signing code. No testnet funds or private credentials. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { canonical } from '../../shared/canonical.ts';
import { createPublicClient, createWalletClient, http, keccak256, toHex, type Address, type Hex, type Abi } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { signBetAuthorization, signStakeAuthorization } from '../../web/lib/erc3009.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temp = mkdtempSync(resolve(tmpdir(), 'referee-markets-'));
const children: ChildProcess[] = [];
async function freePort(): Promise<number> {
    const server = createServer(); await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((r) => server.close(() => r())); return port;
}
async function until(check: () => Promise<unknown>) {
    for (let i = 0; i < 100; i++) {
        try { if (await check()) return; } catch {}
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Local service did not become ready');
}
const artifact = (name: string) => JSON.parse(readFileSync(resolve(root, `contracts/out/${name}.sol/${name}.json`), 'utf8'));
let relayerLog = '';
try {
    const rpc = `http://127.0.0.1:${await freePort()}`;
    const port = await freePort();
    const anvil = spawn(process.env.ANVIL_BIN || 'anvil', ['--host', '127.0.0.1', '--port', rpc.split(':').at(-1)!, '--chain-id', '84532', '--silent'], { stdio: 'ignore' });
    children.push(anvil);
    anvil.on('error', (e) => { relayerLog += `anvil: ${e.message}\n`; });
    const client = createPublicClient({ chain: baseSepolia, transport: http(rpc), pollingInterval: 50 });
    await until(() => client.getChainId());
    const key = generatePrivateKey(); const treasury = privateKeyToAccount(key);
    const wallet = createWalletClient({ account: treasury, chain: baseSepolia, transport: http(rpc) });
    await client.request({ method: 'anvil_setBalance' as any, params: [treasury.address, toHex(10n ** 20n)] as any });
    async function write(address: Address, abi: Abi, functionName: string, args: unknown[]) {
        const hash = await wallet.writeContract({ address, abi, functionName, args });
        const receipt = await client.waitForTransactionReceipt({ hash }); assert.equal(receipt.status, 'success'); return receipt;
    }
    async function deploy(name: string, args: unknown[]) {
        const a = artifact(name);
        const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args });
        const receipt = await client.waitForTransactionReceipt({ hash }); assert.equal(receipt.status, 'success'); return receipt.contractAddress!;
    }
    const token = await deploy('MockAUSD', []);
    const pool = await deploy('StakePool', [token, treasury.address]);
    const market = await deploy('MarketPool', [pool]);
    const ta = artifact('MockAUSD').abi; const pa = artifact('StakePool').abi; const ma = artifact('MarketPool').abi;
    const accounts = [privateKeyToAccount(generatePrivateKey()), privateKeyToAccount(generatePrivateKey()), privateKeyToAccount(generatePrivateKey())];
    await write(token, ta, 'mint', [treasury.address, 10000_000000n]);
    for (const a of accounts) await write(token, ta, 'mint', [a.address, 100_000000n]);
    const processEnv = { ...process.env, RPC_URL: rpc, TREASURY_PRIVATE_KEY: key, TOKEN_ADDRESS: token, POOL_ADDRESS: pool,
        MARKET_POOL_ADDRESS: market, PORT: String(port), KEEPER: '0', RELAYER_DB: resolve(temp, 'relayer.db') };
    const relayer = spawn(process.execPath, [resolve(root, 'relayer/node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
        cwd: resolve(root, 'relayer'), env: processEnv, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(relayer);
    relayer.stdout?.on('data', (s) => { relayerLog += String(s); }); relayer.stderr?.on('data', (s) => { relayerLog += String(s); });
    const url = `http://127.0.0.1:${port}`;
    await until(async () => (await fetch(`${url}/health`)).ok);
    async function post(path: string, body: unknown, expected = 200) {
        const res = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const json = await res.json() as any;
        assert.equal(res.status, expected, JSON.stringify(json)); return json;
    }
    const cfg = await (await fetch(url + '/config')).json() as any;
    assert.equal(cfg.market_pool, market);
    const owner = accounts[0]; const alice = accounts[1]; const bob = accounts[2];
    async function setupGoal() {
        const start = Number((await client.getBlock()).timestamp);
        const receipt = await write(pool, pa, 'createCohort', [keccak256(toHex('rules')), BigInt(start + 300), BigInt(start + 600), 10_000000n]);
        const cohort = Number(await client.readContract({ address: pool, abi: pa, functionName: 'cohortCount' }));
        const criteria = { version: 1, type: 'github_commits', staker: owner.address, goal_text: 'Local QA: publish the project parser and tests',
            window: { start: new Date(start * 1000).toISOString(), deadline: new Date((start + 600) * 1000).toISOString() }, nonce: 'ref-local-qa',
            params: { repo: 'team/project', branch: 'main', min_commits: 2 } };
        const goalHash = keccak256(toHex(canonical(criteria)));
        const authorization = await signStakeAuthorization({ address: owner.address, signTypedData: (params) => owner.signTypedData(params) }, cfg, { cohortId: cohort, goalHash, value: 10_000000n });
        const stake = await post('/stake', { cohort_id: cohort, staker: owner.address, goal_hash: goalHash, authorization });
        return { cohort, start, receipt, criteria, stake_tx_hash: stake.tx_hash };
    }
    const qaGoal = await setupGoal();
    const { cohort, start } = qaGoal;
    const initialSnapshot = await client.request({ method: 'evm_snapshot' as any });
    const snapshot = async (id: number, bettor: Address) => {
        const res = await fetch(`${url}/markets/${id}/${owner.address}?bettor=${bettor}`);
        assert.equal(res.status, 200); return await res.json() as any;
    };
    async function bet(id: number, bettor: typeof alice, yes: boolean, value: bigint, expected = 200) {
        const m = await snapshot(id, bettor.address);
        const authorization = await signBetAuthorization({ address: bettor.address, signTypedData: (params) => bettor.signTypedData(params) }, cfg, { pool: market, cohortId: id, owner: owner.address, yes, value, sequence: BigInt(m.sequence), deadline: m.betting_deadline });
        const body = { cohort_id: id, owner: owner.address, bettor: bettor.address, yes, amount: String(value), authorization };
        const result = await post('/markets/bet', body, expected); return { body, result };
    }
    const yes = await bet(cohort, alice, true, 10_000000n);
    await bet(cohort, bob, false, 20_000000n);
    assert.equal((await snapshot(cohort, alice.address)).yes_total, '10000000');
    await post('/markets/bet', yes.body, 400); // exact replay
    await bet(cohort, owner, false, 1_000000n, 400); // owner restriction
    await post('/markets/bet', { ...yes.body, yes: 'false' }, 400); // no truthy-string coercion
    await post('/markets/bet', { ...yes.body, amount: '-1' }, 400);
    await post('/markets/resolve', { cohort_id: cohort, owner: owner.address }, 400);
    await client.request({ method: 'evm_setNextBlockTimestamp' as any, params: [start + 601] as any });
    await write(pool, pa, 'postVerdict', [BigInt(cohort), owner.address, true, keccak256(toHex('pass'))]);
    await client.request({ method: 'evm_setNextBlockTimestamp' as any, params: [start + 1200] as any });
    await write(pool, pa, 'settle', [BigInt(cohort)]);
    await post('/markets/resolve', { cohort_id: cohort, owner: owner.address });
    let view = await snapshot(cohort, alice.address); assert.equal(view.result, 1); assert.equal(view.claimable, '30000000');
    await post('/markets/claim', { cohort_id: cohort, owner: owner.address, bettor: alice.address });
    view = await snapshot(cohort, alice.address); assert.equal(view.claimed, true); assert.equal(view.claimable, '0');
    assert.equal(await client.readContract({ address: token, abi: ta, functionName: 'balanceOf', args: [alice.address] }), 120_000000n);
    assert.equal(await client.readContract({ address: token, abi: ta, functionName: 'balanceOf', args: [pool] }), 10_000000n);
    await post('/markets/claim', { cohort_id: cohort, owner: owner.address, bettor: alice.address }, 400);
    console.log('PASS: real browser signatures → relayer → YES/NO bets → settlement → resolve → winner payout; replay, owner NO and invalid bodies rejected; commitment stake untouched.');
    // Optional browser QA: keep the real local services and a minimal read-only goal API alive.
    if (process.env.MARKET_QA_CONFIG) {
        await client.request({ method: 'evm_revert' as any, params: [initialSnapshot] as any });
        // Reset the relayer's transaction nonce cache after rewinding the local chain.
        await new Promise<void>((r) => { relayer.once('exit', () => r()); relayer.kill('SIGTERM'); });
        const qaRelayer = spawn(process.execPath, [resolve(root, 'relayer/node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
            cwd: resolve(root, 'relayer'), env: processEnv, stdio: ['ignore', 'pipe', 'pipe'],
        });
        children.push(qaRelayer);
        qaRelayer.stdout?.on('data', (s) => { relayerLog += String(s); }); qaRelayer.stderr?.on('data', (s) => { relayerLog += String(s); });
        await until(async () => (await fetch(`${url}/health`)).ok);
        const refereePort = await freePort();
        const referee = httpServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Headers', 'content-type, ngrok-skip-browser-warning');
            res.setHeader('content-type', 'application/json');
            if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
            res.end(JSON.stringify(req.url === '/health' ? { ok: true } : {
                status: 'watching', cohort_id: cohort, goal_id: 'qa', criteria: qaGoal.criteria, stake_tx_hash: qaGoal.stake_tx_hash,
            }));
        });
        await new Promise<void>((r) => referee.listen(refereePort, '127.0.0.1', r));
        writeFileSync(process.env.MARKET_QA_CONFIG, JSON.stringify({ rpc, relayer: url, referee: `http://127.0.0.1:${refereePort}`, cohort, token, pool, market, owner: owner.address, start }));
        console.log('Local browser QA ready.');
        await new Promise(() => {});
    }
} catch (err) {
    console.error(err instanceof Error ? err.message : err);
    // Relayer logs contain request metadata only; never dump inherited env or generated private keys.
    console.error(relayerLog.slice(-3000)); process.exitCode = 1;
} finally {
    for (const child of children.reverse()) child.kill('SIGTERM');
    rmSync(temp, { recursive: true, force: true });
}
