"use client";
import { useState } from "react";
import { signMessage } from "wagmi/actions";
import { disconnectGithub, getGithubStatus, githubLinkMessage, startGithubConnect } from "@/lib/api";
import { usePoll } from "@/lib/time";
import { wagmiConfig } from "@/lib/wagmi";
import { useWallet } from "@/lib/wallet";
import { ErrorBox, Spinner } from "./ui";

/**
 * Links the connected wallet to a GitHub account through GitHub's own sign-in. GitHub tasks are only accepted on
 * repos that account can push to, which proves the repo is yours without any setup file.
 */
export function GithubConnect({ returnPath, onChange }: { returnPath: string; onChange?: (login: string | null) => void }) {
  const { account } = useWallet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const { data: status } = usePoll(
    async () => {
      if (!account) return null;
      const s = await getGithubStatus(account.address);
      onChange?.(s.linked ? s.login : null);
      return s;
    },
    30_000,
    [account?.address, version],
  );
  if (!account || !status) return null;

  async function signed(action: "connect" | "disconnect") {
    const issued_at = new Date().toISOString();
    const signature = await signMessage(wagmiConfig, { message: githubLinkMessage(action, account!.address, issued_at) });
    return { wallet: account!.address, signature, issued_at };
  }

  async function connect() {
    setBusy(true);
    setErr(null);
    try {
      const { url } = await startGithubConnect({ ...(await signed("connect")), return_path: returnPath });
      window.location.assign(url);
    } catch (e) {
      const msg = (e as Error).message;
      if (!/reject|denied|cancel/i.test(msg)) setErr(msg.split("\n")[0]);
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setErr(null);
    try {
      await disconnectGithub(await signed("disconnect"));
      setVersion((v) => v + 1);
    } catch (e) {
      const msg = (e as Error).message;
      if (!/reject|denied|cancel/i.test(msg)) setErr(msg.split("\n")[0]);
    } finally {
      setBusy(false);
    }
  }

  if (!status.configured) return <p className="text-sm text-muted">GitHub sign-in isn&apos;t set up on the referee yet.</p>;

  return (
    <div className="rounded-xl bg-panel p-4 text-sm">
      {status.linked ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>
            GitHub connected as <strong>@{status.login}</strong>. You can stake on any public repo this account can push to.
          </span>
          <button type="button" className="link text-sm" disabled={busy} onClick={() => void disconnect()}>
            {busy ? <Spinner /> : "Disconnect"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p>
            <strong>Connect GitHub first.</strong> Tasks are checked on a public repo you can push to, so the referee needs to know
            which GitHub account is yours. It only sees your public profile.
          </p>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void connect()}>
            {busy ? <><Spinner /> Opening GitHub…</> : "Connect GitHub"}
          </button>
        </div>
      )}
      <ErrorBox msg={err} />
    </div>
  );
}
