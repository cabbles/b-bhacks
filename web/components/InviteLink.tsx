"use client";
import { useEffect, useState } from "react";

/** The market's shareable link with a copy button. */
export function InviteLink({ cohortId }: { cohortId: number }) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setUrl(`${window.location.origin}/cohorts/${cohortId}`);
  }, [cohortId]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the link stays visible to copy by hand */
    }
  }

  return (
    <div className="rounded-xl bg-panel p-4">
      <div className="label">Invite people</div>
      <div className="num break-all text-sm">{url || "…"}</div>
      <button type="button" className="btn-ghost mt-3 w-full" onClick={copy} disabled={!url}>
        {copied ? "Copied" : "Copy invite link"}
      </button>
    </div>
  );
}
