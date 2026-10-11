"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getConfig } from "@/lib/api";
import { WEB_URL } from "@/lib/env";
import { countdown, useNow } from "@/lib/time";
import type { Cohort } from "@/lib/types";
import { ErrorBox, Spinner } from "@/components/ui";

const PLACEHOLDERS = [
  "Push 2 commits with the parser and its tests to team/proj on main",
  "Publish the project write-up at https://team.dev/report with a section called \"Results\"",
  "Push 2 commits adding the demo UI to team/proj on main",
];

/** Split a group project into three tasks and hand each friend an invite link with their task filled in. */
export default function SplitPage() {
  const now = useNow();
  const [groups, setGroups] = useState<Cohort[] | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [project, setProject] = useState("");
  const [tasks, setTasks] = useState(["", "", ""]);
  const [origin, setOrigin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    setOrigin(WEB_URL || window.location.origin);
    getConfig()
      .then((c) => {
        const open = c.cohorts.filter((x) => x.stake_deadline * 1000 > Date.now());
        setGroups(open);
        setGroupId(open[0]?.id ?? null);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  const group = groups?.find((g) => g.id === groupId) ?? null;
  const links = useMemo(
    () =>
      tasks.map((t) => {
        if (!t.trim() || groupId === null) return null;
        const task = project.trim() ? `${project.trim()}: ${t.trim()}` : t.trim();
        return `${origin}/stake?cohort=${groupId}&task=${encodeURIComponent(task)}`;
      }),
    [tasks, project, groupId, origin],
  );

  return (
    <div className="grid gap-y-12 lg:grid-cols-12 lg:gap-x-12">
      <header className="lg:col-span-12">
        <div className="label">Groups · do it with friends</div>
        <h1 className="display text-6xl sm:text-8xl">Split it three ways.</h1>
        <p className="mt-4 max-w-2xl text-lg text-fg/80">
          One task per friend. Each of you bets on your own part. If someone drops theirs, their stake goes to the two who
          delivered.
        </p>
      </header>

      <section className="space-y-8 lg:col-span-6">
        <ErrorBox msg={err} />
        <div>
          <label className="label" htmlFor="group">Market</label>
          {!groups ? (
            <Spinner />
          ) : groups.length === 0 ? (
            <p className="text-muted">No market is open right now.</p>
          ) : (
            <select id="group" className="input" value={groupId ?? ""} onChange={(e) => setGroupId(Number(e.target.value))}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  Market #{g.id} · staking closes in {countdown(g.stake_deadline, now)}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label className="label" htmlFor="project">Project</label>
          <input id="project" className="input" value={project} onChange={(e) => setProject(e.target.value)} placeholder="CS 61B Project 2" />
        </div>
        {tasks.map((t, i) => (
          <div key={i}>
            <label className="label" htmlFor={`task-${i}`}>Task {i + 1}</label>
            <textarea
              id={`task-${i}`}
              className="input min-h-20"
              value={t}
              placeholder={PLACEHOLDERS[i]}
              onChange={(e) => setTasks((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
            />
          </div>
        ))}
        <p className="text-sm text-muted">
          Write each task so the referee can check it: commits to a public repo, or a page that goes live with specific content.
        </p>
      </section>

      <aside className="lg:col-span-5 lg:col-start-8">
        <div className="label">Invite links</div>
        <ol className="border-t border-line">
          {links.map((link, i) => (
            <li key={i} className="grid grid-cols-[2.5rem_1fr] gap-x-3 border-b border-line py-4">
              <span className="num text-sm text-muted">0{i + 1}</span>
              {link ? (
                <div className="flex items-start gap-4">
                  <div className="min-w-0 space-y-2">
                    <p className="text-sm">{tasks[i].trim()}</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-ghost !px-3 !py-1.5 !text-[11px]"
                        onClick={() =>
                          navigator.clipboard?.writeText(link).then(() => {
                            setCopied(i);
                            setTimeout(() => setCopied(null), 1200);
                          })
                        }
                      >
                        {copied === i ? "Copied" : "Copy link"}
                      </button>
                      <Link href={link.replace(origin, "")} className="btn-ghost !px-3 !py-1.5 !text-[11px]">
                        Open
                      </Link>
                    </div>
                  </div>
                </div>
              ) : (
                <span className="text-sm text-muted">Write task {i + 1} to get its link.</span>
              )}
            </li>
          ))}
        </ol>
        {group && (
          <p className="mt-4 text-xs text-muted">
            Each friend opens their link on their own phone, gets a wallet and test AUSD, and confirms their task. Follow everyone on the{" "}
            <Link href={`/cohorts/${group.id}`} className="link">market page</Link>.
          </p>
        )}
      </aside>
    </div>
  );
}
