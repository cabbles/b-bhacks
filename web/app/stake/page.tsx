"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { compileGoal, getConfig, relayStake, submitGoal } from "@/lib/api";
import { countdown, fmtTime, useNow } from "@/lib/time";
import { ATTACK_CATEGORIES, type CompileResponse, type GoalType, type RelayerConfig } from "@/lib/types";
import { fmtAmount, rememberGoal, signStakeAuthorization, tokenBalance, tokenDecimals, useWallet } from "@/lib/wallet";
import { ControlProof } from "@/components/ControlProof";
import { ErrorBox, Spinner } from "@/components/ui";

const TYPE_OPTIONS: { value: GoalType | ""; label: string }[] = [
  { value: "", label: "Let the referee decide" },
  { value: "github_commits", label: "GitHub commits" },
  { value: "url_live", label: "A URL goes live" },
];

const EXAMPLES = [
  "Push 2 commits adding a dark mode toggle to alice/portfolio on main",
  "Get https://myproject.dev live with a page that says \"Join the waitlist\"",
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

  const [text, setText] = useState("");
  const [typeHint, setTypeHint] = useState<GoalType | "">("");
  const [isAttack, setIsAttack] = useState(false);
  const [category, setCategory] = useState<string>(ATTACK_CATEGORIES[0]);
  const [note, setNote] = useState("");

  const [compiled, setCompiled] = useState<CompileResponse | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getConfig()
      .then((c) => {
        setCfg(c);
        const q = Number(params.get("cohort"));
        const open = c.cohorts.filter((x) => x.stake_deadline * 1000 > Date.now());
        setCohortId(c.cohorts.some((x) => x.id === q) ? q : (open[0]?.id ?? c.cohorts[0]?.id ?? null));
        tokenDecimals(c.token).then(setDec);
      })
      .catch((e: Error) => setErr(e.message));
  }, [params]);

  useEffect(() => {
    if (cfg && account) tokenBalance(cfg.token, account.address).then(setBal);
  }, [cfg, account, dripState, busy]);

  const cohort = cfg?.cohorts.find((c) => c.id === cohortId) || null;
  const stakeAmount = cohort ? BigInt(cohort.stake_amount) : 0n;
  const closed = cohort ? cohort.stake_deadline * 1000 <= now : true;
  const short = bal !== null && bal < stakeAmount;

  async function onCompile() {
    if (!account || !text.trim()) return;
    setErr(null);
    setBusy("Reading your goal…");
    setCompiled(null);
    setConfirmed(false);
    try {
      setCompiled(await compileGoal(text.trim(), account.address, typeHint || undefined));
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
      const authorization = await signStakeAuthorization(account, cfg, stakeAmount);
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
        ...(isAttack ? { is_attack: true, attack_note: `[${category}] ${note}`.trim() } : {}),
      });
      rememberGoal({ goal_id, cohort_id: cohort.id, goal_text: compiled.criteria.goal_text, created_at: new Date().toISOString() });
      router.push(`/goals/${goal_id}?new=1`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-black">Stake on a goal</h1>

      {cohort ? (
        <div className="card flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>
            Cohort <strong>#{cohort.id}</strong>
          </span>
          <span>
            Stake <strong>{fmtAmount(cohort.stake_amount, dec)} AUSD</strong>
          </span>
          <span>
            Staking closes <strong>{closed ? "closed" : `in ${countdown(cohort.stake_deadline, now)}`}</strong>
          </span>
          <span>
            Deadline <strong>{fmtTime(cohort.goal_deadline)}</strong>
          </span>
          <span className={short ? "text-red-300" : "text-zinc-400"}>
            Your balance {bal === null ? "…" : fmtAmount(bal, dec)} AUSD
          </span>
        </div>
      ) : (
        cfg && <p className="text-zinc-400">No cohort available.</p>
      )}

      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="goal">What will you finish by the deadline?</label>
          <textarea
            id="goal"
            className="input min-h-28"
            placeholder={EXAMPLES[0]}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCompiled(null);
            }}
          />
          <div className="mt-1 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="text-left text-xs text-zinc-400 underline" onClick={() => setText(ex)}>
                {ex}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="type">Evidence type</label>
          <select id="type" className="input" value={typeHint} onChange={(e) => setTypeHint(e.target.value as GoalType | "")}>
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className={`rounded-2xl border p-4 ${isAttack ? "border-red-500/50 bg-red-500/10" : "border-zinc-800"}`}>
          <label className="flex cursor-pointer items-center gap-3">
            <input type="checkbox" className="h-5 w-5 accent-red-500" checked={isAttack} onChange={(e) => setIsAttack(e.target.checked)} />
            <span className="font-semibold">😈 I am going to try to cheat</span>
          </label>
          <p className="mt-1 text-xs text-zinc-400">
            Fool the Ref: try to get an unfinished goal approved. The referee never sees this flag. Your attempt goes on the public
            board either way.
          </p>
          {isAttack && (
            <div className="mt-3 space-y-3">
              <div>
                <label className="label" htmlFor="cat">Category</label>
                <select id="cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {ATTACK_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="note">How will you cheat?</label>
                <input id="note" className="input" maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. backdate commits to last week" />
              </div>
            </div>
          )}
        </div>

        {!compiled && (
          <button className="btn-primary w-full" disabled={!account || !text.trim() || !!busy || closed} onClick={onCompile}>
            {busy ? <><Spinner />&nbsp;{busy}</> : "Check my goal"}
          </button>
        )}
      </div>

      <ErrorBox msg={err} />

      {compiled && (
        <div className="space-y-4">
          <div className="card space-y-2">
            <div className="label">The referee will check</div>
            <p className="text-lg font-semibold">{compiled.summary}</p>
            <p className="text-xs text-zinc-500">
              Type: {compiled.criteria.type} · window ends {fmtTime(compiled.criteria.window.deadline)}
            </p>
            <details className="text-xs text-zinc-400">
              <summary className="cursor-pointer">Exact criteria (frozen at stake time)</summary>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-black/60 p-2">{JSON.stringify(compiled.criteria, null, 2)}</pre>
              <div className="mt-1 break-all font-mono">goal_hash {compiled.goal_hash}</div>
            </details>
          </div>

          <div className="card space-y-2">
            <div className="label">Before the deadline</div>
            <ControlProof criteria={compiled.criteria} />
          </div>

          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-lime-400" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>
              This is my goal. I stake {cohort ? fmtAmount(cohort.stake_amount, dec) : "?"} test AUSD and lose it if the referee rules
              I failed.
            </span>
          </label>

          <div className="flex gap-3">
            <button className="btn-ghost" disabled={!!busy} onClick={() => setCompiled(null)}>Edit</button>
            <button className="btn-primary flex-1" disabled={!confirmed || !!busy || closed || short} onClick={onStake}>
              {busy ? <><Spinner />&nbsp;{busy}</> : short ? "Not enough AUSD yet" : "Stake"}
            </button>
          </div>
        </div>
      )}
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
