"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getConfig } from "@/lib/api";
import { ErrorBox, Spinner } from "@/components/ui";

/** "Market" in the nav: go to the market that is open now, else the most recent one. */
export default function CurrentMarket() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getConfig()
      .then((c) => {
        const now = Date.now() / 1000;
        const byNewest = [...c.cohorts].sort((a, b) => b.id - a.id);
        const pick = byNewest.find((x) => x.stake_deadline > now) ?? byNewest.find((x) => x.goal_deadline > now) ?? byNewest[0];
        if (pick) router.replace(`/cohorts/${pick.id}`);
        else setErr("No market has been created yet.");
      })
      .catch((e: Error) => setErr(e.message));
  }, [router]);
  return err ? <ErrorBox msg={err} /> : <Spinner />;
}
