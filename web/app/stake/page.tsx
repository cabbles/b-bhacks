"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { compileGoal, getCohort, getConfig, relayBond, relayStake, submitGoal } from "@/lib/api";
import { kindOf } from "@/lib/kinds";
import { countdown, fmtTime, useNow } from "@/lib/time";
import { type CompileResponse, type GoalType, type RelayerConfig } from "@/lib/types";
import { goalHashOf } from "@/lib/hashes";
import { MOCK_REFEREE, MOCK_RELAYER } from "@/lib/env";
import { fmtAmount, rememberGoal, signStakeAuthorization, tokenBalance, tokenDecimals, useWallet } from "@/lib/wallet";
import { signBondAuthorization } from "@/lib/erc3009";
import { ControlProof } from "@/components/ControlProof";
import { ErrorBox, Notice, Spinner } from "@/components/ui";

const TYPE_OPTIONS: { value: GoalType | ""; label: string }[] = [
  { value: "", label: "Let the referee decide" },
  { value: "github_commits", label: "GitHub commits" },
  { value: "url_live", label: "A URL goes live" },
  // Referee only accepts this for wallets in CANVAS_ALLOWED_STAKERS (the team's own demo account).
  { value: "canvas_submission", label: "Canvas assignment submitted (team demo)" },
];

const EXAMPLES = [
  "Push 2 commits adding a dark mode toggle to alice/portfolio on main",
  "Get https://myproject.dev live with a page that says \"Join the waitlist\"",
  "Publish my essay at https://alice.dev/essay with a section called \"Conclusion\"",
];

function StakeInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { account, dripState } = useWallet();
  const now = useNow();

  const [cfg, setCfg] = useState<RelayerConfig | null>(null);
  const [dec, setDec] = useState(6);
  const [bal, setBal] = useState<bigint | null>(null);
  const [cohortId, setCohortId] = useState<number | null>(null);

  // A market created at /cohorts/new arrives with the task and the owner's bond (their separate stake).
  const [text, setText] = useState(() => params.get("task") ?? "");
  const bondAusd = Number(params.get("bond") ?? 0);
  const [typeHint, setTypeHint] = useState<GoalType | "">("");

  const [compiled, setCompiled] = useState<CompileResponse | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getConfig()
      .then((c) => {
        setCfg(c);
        const q = Number(params.get("cohort"));
        // No market in the link means a solo stake: use the newest open solo round.
        const solo = c.cohorts.filter((x) => kindOf(x) === "solo" && x.stake_deadline * 1000 > Date.now()).sort((a, b) => b.id - a.id);
        setCohortId(c.cohorts.some((x) => x.id === q) ? q : (solo[0]?.id ?? null));
        tokenDecimals(c.token, c.decimals).then(setDec);
      })
      .catch((e: Error) => setErr(e.message));
  }, [params]);

  useEffect(() => {
    if (cfg && account) tokenBalance(cfg.token, account.address).then(setBal);
  }, [cfg, account, dripState, busy]);

  const cohort = cfg?.cohorts.find((c) => c.id === cohortId) || null;
  const market = kindOf(cohort) === "group";
  const stakeAmount = cohort ? BigInt(cohort.stake_amount) : 0n;
  const bondRaw = market && bondAusd > 0 ? BigInt(Math.round(bondAusd * 10 ** dec)) : 0n;
  // A market holds exactly one task: once its owner has staked, nobody else can add one.
  const taken = !!cohort && market && (cohort.staker_count ?? 0) >= 1;
  const closed = taken || (cohort ? cohort.stake_deadline * 1000 <= now : true);

  // A market that already has its task: go straight to that task's betting page.
  useEffect(() => {
    if (!taken || !cohort) return;
    getCohort(cohort.id)
      .then((r) => { if (r.goals[0]) router.replace(`/goals/${r.goals[0].goal_id}`); })
      .catch(() => {});
  }, [taken, cohort?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const short = bal !== null && bal < stakeAmount + bondRaw;
  // A real stake needs a deployed pool, and both services live (or both mocked, for rehearsal).
  const blocked = !cfg
    ? null
    : MOCK_RELAYER !== MOCK_REFEREE
      ? `Staking opens when the ${MOCK_REFEREE ? "referee" : "relayer"} is online.`
      : !cfg.poolDeployed
        ? "Staking opens once the pool contract is deployed."
        : null;

  async function onCompile() {
    if (!account || !text.trim()) return;
    setErr(null);
    setBusy("Reading your goal…");
    setCompiled(null);
    setConfirmed(false);
    try {
      const c = await compileGoal({
        text: text.trim(),
        staker: account.address,
        type_hint: typeHint || undefined,
        cohort_id: cohort?.id,
      });
      // We sign over goal_hash, so recompute it from the criteria instead of trusting the referee's value.
      if (!MOCK_REFEREE && goalHashOf(c.criteria) !== c.goal_hash) throw new Error("Referee returned a goal_hash that does not match the criteria.");
      setCompiled(c);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onStake() {
    if (!account || !cfg || !cohort || !compiled) return;
    setErr(null);
    try {
      setBusy("Signing the stake authorization…");
      const authorization = await signStakeAuthorization(account, cfg, {
        cohortId: cohort.id,
        goalHash: compiled.goal_hash,
        value: stakeAmount,
      });
      setBusy("Sending stake on-chain…");
      const { tx_hash } = await relayStake({
        cohort_id: cohort.id,
        staker: account.address,
        goal_hash: compiled.goal_hash,
        authorization,
      });
      setBusy("Registering with the referee…");
      const { goal_id } = await submitGoal({
        cohort_id: cohort.id,
        criteria: compiled.criteria,
        stake_tx_hash: tx_hash,
      });
      if (bondAusd > 0 && cfg.bond_pool) {
        setBusy("Signing your stake on the task…");
        const value = BigInt(Math.round(bondAusd * 10 ** dec));
        const bondAuth = await signBondAuthorization(account, cfg, { pool: cfg.bond_pool, cohortId: cohort.id, value });
        setBusy("Posting your stake on-chain…");
        await relayBond({ cohort_id: cohort.id, owner: account.address, amount: value.toString(), authorization: bondAuth });
      }
      rememberGoal({ goal_id: String(goal_id), cohort_id: cohort.id, goal_text: compiled.criteria.goal_text, created_at: new Date().toISOString() });
      router.push(`/goals/${goal_id}?new=1`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-y-10 lg:grid-cols-12 lg:gap-x-12">
      <header className="lg:col-span-12">
        {kindOf(cohort) === "solo" ? (
          <>
            <div className="label">Solo stake{cohort ? ` · round #${cohort.id}` : ""}</div>
            <h1 className="display text-6xl sm:text-8xl">Bet on yourself.</h1>
            <p className="mt-4 max-w-2xl text-lg text-fg/80">
              Put AUSD behind your own task. Finish by the deadline and you get it back. Miss it and you lose it to the other solo
              stakers who finished. The referee turns your words into exact, checkable criteria before you stake.
            </p>
          </>
        ) : (
          <>
            <div className="label">Your market #{cohort?.id ?? "…"}{bondAusd > 0 ? ` · your stake ${bondAusd} AUSD` : ""}</div>
            <h1 className="display text-6xl sm:text-8xl">Confirm your task.</h1>
            <p className="mt-4 max-w-2xl text-lg text-fg/80">
              The referee turns your task into exact criteria. Then you sign your stake: finish and you get exactly it back, miss it
              and it goes to whoever bet NO. Once it is live, share the page so friends can bet YES or NO.
            </p>
          </>
        )}
        {taken && (
          <p className="mt-6 max-w-2xl rounded-xl bg-panel p-4 font-medium">
            This market already has its task. Taking you to its betting page… <a className="link" href={`/cohorts/${cohort?.id}`}>Go now</a>
          </p>
        )}
      </header>

      {/* Left: the form. */}
      <section className="order-2 space-y-8 lg:order-none lg:col-span-7">
        <div>
          <label className="label" htmlFor="goal">What will you get done by the deadline?</label>
          <textarea
            id="goal"
            className="input min-h-32 text-lg"
            placeholder={EXAMPLES[0]}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCompiled(null);
            }}
          />
          <div className="mt-2 space-y-1">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="block text-left text-sm text-muted hover:text-fg" onClick={() => setText(ex)}>
                <span className="text-nose-deep">↳</span> {ex}
              </button>
            ))}
          </div>
        </div>

        <div className="sm:max-w-xs">
          <label className="label" htmlFor="type">Evidence</label>
          <select id="type" className="input" value={typeHint} onChange={(e) => setTypeHint(e.target.value as GoalType | "")}>
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {!compiled && (
          <button className="btn-primary w-full sm:w-auto" disabled={!account || !text.trim() || !!busy || closed} onClick={onCompile}>
            {busy ? <><Spinner /> {busy}</> : "Check my task →"}
          </button>
        )}

        {blocked && <Notice>{blocked}</Notice>}
        <ErrorBox msg={err} />

        {compiled && (
          <div className="space-y-8">
            <section className="border-t-2 border-accent pt-4">
              <div className="label">The referee will check</div>
              <p className="font-display text-2xl font-bold leading-snug tracking-tight sm:text-3xl">{compiled.summary}</p>
              <p className="num mt-2 text-xs text-muted">
                {compiled.criteria.type} · window ends {fmtTime(compiled.criteria.window.deadline)}
              </p>
              <details className="mt-3 text-xs text-muted">
                <summary className="cursor-pointer hover:text-fg">Exact criteria, frozen at stake time</summary>
                <pre className="num mt-2 overflow-x-auto border border-line bg-panel p-3">{JSON.stringify(compiled.criteria, null, 2)}</pre>
                <div className="num mt-1 break-all">goal_hash {compiled.goal_hash}</div>
              </details>
            </section>

            <section className="rule pt-4">
              <div className="label">Before the deadline</div>
              <ControlProof criteria={compiled.criteria} referee={compiled.control_proof} />
            </section>

            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#1E1E1E]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>
                {market && bondRaw > 0n ? (
                  <>
                    This is my task. I put {fmtAmount(bondRaw, dec)} AUSD behind it. Finish and I get exactly that back. Miss it and it goes to the people who bet NO. The {cohort ? fmtAmount(cohort.stake_amount, dec) : "?"} AUSD entry is refunded.
                  </>
                ) : (
                  <>
                    This is my task. I stake {cohort ? fmtAmount(cohort.stake_amount, dec) : "?"} test AUSD and lose it if the referee rules I failed.
                  </>
                )}
              </span>
            </label>

            <div className="flex gap-3">
              <button className="btn-ghost" disabled={!!busy} onClick={() => setCompiled(null)}>Edit</button>
              <div className="flex-1">
                <button className="btn-primary w-full" disabled={!confirmed || !!busy || closed || short || !!blocked} onClick={onStake}>
                    {busy ? <><Spinner /> {busy}</> : short ? "Not enough AUSD yet" : "Stake"}
                  </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Right: the terms, as a ruled data list. */}
      <aside className="order-1 lg:order-none lg:col-span-4 lg:col-start-9">
        <div className="label">Terms</div>
        {cohort ? (
          <dl className="grid grid-cols-2 border-t border-line text-sm [&>*]:border-b [&>*]:border-line [&>*]:py-3">
            {market && bondRaw > 0n ? (
              <>
                <dt className="text-muted">Your stake</dt>
                <dd className="num text-right text-lg font-semibold">{fmtAmount(bondRaw, dec)} AUSD</dd>
                <dt className="text-muted">Entry (refunded)</dt>
                <dd className="num text-right">{fmtAmount(cohort.stake_amount, dec)} AUSD</dd>
              </>
            ) : (
              <>
                <dt className="text-muted">Stake</dt>
                <dd className="num text-right text-lg font-semibold">{fmtAmount(cohort.stake_amount, dec)} AUSD</dd>
              </>
            )}
            <dt className="text-muted">{market ? "Betting closes" : "Staking closes"}</dt>
            <dd className="num text-right">{closed ? "closed" : countdown(cohort.stake_deadline, now)}</dd>
            <dt className="text-muted">Deadline</dt>
            <dd className="num text-right">{fmtTime(cohort.goal_deadline)}</dd>
            <dt className="text-muted">Your balance</dt>
            <dd className={`num text-right ${short ? "text-fail" : ""}`}>{bal === null ? "…" : fmtAmount(bal, dec)} AUSD</dd>
          </dl>
        ) : (
          <p className="border-t border-line py-3 text-muted">{cfg ? "No market is open right now." : <Spinner />}</p>
        )}
        <p className="mt-4 text-xs leading-relaxed text-muted">
          {market
            ? "Finish and your stake comes back in full. Miss it and that stake is split among the people who bet NO. Bets are a separate pot. If no verdict is posted, everyone is refunded."
            : "Everyone who delivers gets their stake back plus an equal share of the missed stakes. No house, no fee. If no verdict is posted, everyone is refunded."}
        </p>
      </aside>
    </div>
  );
}

export default function StakePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <StakeInner />
    </Suspense>
  );
}
