"use client";
import { useState } from "react";
import type { Criteria } from "@/lib/types";

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted hover:border-fg hover:text-fg"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function Code({ children }: { children: string }) {
  return (
    <div className="flex items-start gap-2 border border-line bg-panel p-3">
      <pre className="flex-1 overflow-x-auto whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-xs text-fg">{children}</pre>
      <Copy text={children} />
    </div>
  );
}

/** Tells the staker how to prove they control the repo or URL. */
export function ControlProof({ criteria, referee }: { criteria: Criteria; referee?: string }) {
  const p = criteria.params as Record<string, string | number>;
  const fromReferee = referee ? <p className="text-xs text-muted">Referee: {referee}</p> : null;
  if (criteria.type === "github_commits" && p.github_login) {
    return (
      <div className="space-y-2 text-sm">
        <p>
          Nothing to set up: GitHub confirmed <strong>@{String(p.github_login)}</strong> can push to <strong>{String(p.repo)}</strong>.
        </p>
        <p className="text-muted">
          Only commits the referee first sees after you stake count. Commit dates are ignored, so backdating does nothing.
        </p>
        {fromReferee}
      </div>
    );
  }
  if (criteria.type === "github_commits") {
    const cmd = `mkdir -p .referee && echo ${criteria.nonce} > .referee/${criteria.nonce}\ngit add .referee && git commit -m "referee: ${criteria.nonce}" && git push origin ${p.branch ?? "main"}`;
    return (
      <div className="space-y-2 text-sm">
        <p>
          Prove the repo is yours: add the file <code className="font-mono text-nose-deep">.referee/{criteria.nonce}</code> to{" "}
          <strong>{String(p.repo)}</strong> on branch <strong>{String(p.branch ?? "main")}</strong>.
        </p>
        <Code>{cmd}</Code>
        <p className="text-muted">
          Only commits the referee first sees after you stake count. Commit dates are ignored, so backdating does nothing.
        </p>
        {fromReferee}
      </div>
    );
  }
  if (criteria.type === "url_live") {
    let wellKnown = "/.well-known/referee.txt";
    try {
      wellKnown = new URL("/.well-known/referee.txt", String(p.url)).toString();
    } catch {}
    return (
      <div className="space-y-2 text-sm">
        <p>
          Prove the site is yours: put this text on <strong>{String(p.url)}</strong> or at{" "}
          <span className="font-mono text-nose-deep break-all">{wellKnown}</span>.
        </p>
        <Code>{criteria.nonce}</Code>
        <p className="text-muted">
          The page must <strong>not</strong> already show &ldquo;{String(p.must_contain)}&rdquo; right now. The referee checks at
          stake time and again at the deadline.
        </p>
        {fromReferee}
      </div>
    );
  }
  return (
    <div className="space-y-2 text-sm">
      <p>
        Canvas goals are limited to the team&apos;s own demo account. Assignment {String(p.assignment_id)} in course{" "}
        {String(p.course_id)}.
      </p>
      {fromReferee}
    </div>
  );
}
