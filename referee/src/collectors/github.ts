import { config } from '../config.ts';

const API = 'https://api.github.com';

async function gh(path: string): Promise<Response> {
    return fetch(`${API}${path}`, {
        headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'ai-referee',
            ...(config.githubToken ? { Authorization: `Bearer ${config.githubToken}` } : {}),
        },
        signal: AbortSignal.timeout(15_000),
    });
}

export type RepoInfo = {
    exists: boolean;
    private: boolean;
    fork: boolean;
    default_branch?: string;
    parent?: { repo: string; default_branch: string };
};

export async function repoInfo(repo: string): Promise<RepoInfo> {
    const r = await gh(`/repos/${repo}`);
    if (r.status === 404) return { exists: false, private: false, fork: false };
    if (!r.ok) throw new Error(`github repo ${repo}: ${r.status}`);
    const j: any = await r.json();
    return {
        exists: true,
        private: Boolean(j.private),
        fork: Boolean(j.fork),
        default_branch: j.default_branch,
        parent: j.parent ? { repo: j.parent.full_name, default_branch: j.parent.default_branch } : undefined,
    };
}

/** SHAs reachable from the branch tip, newest first (one page of 100 is plenty inside a goal window). */
export async function listBranchShas(repo: string, branch: string): Promise<string[] | null> {
    const r = await gh(`/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=100`);
    if (r.status === 404 || r.status === 409) return []; // missing branch or empty repo
    if (!r.ok) throw new Error(`github commits ${repo}@${branch}: ${r.status}`);
    const j: any[] = (await r.json()) as any[];
    return j.map((c) => c.sha as string);
}

/** For a fork: SHAs on the fork's branch that are not in the parent's default branch (the fork's own work). */
export async function aheadOfParent(repo: string, branch: string, parent: { repo: string; default_branch: string }): Promise<Set<string>> {
    const owner = repo.split('/')[0];
    const r = await gh(`/repos/${parent.repo}/compare/${encodeURIComponent(parent.default_branch)}...${owner}:${encodeURIComponent(branch)}?per_page=250`);
    if (!r.ok) throw new Error(`github compare ${repo} with ${parent.repo}: ${r.status}`);
    const j: any = await r.json();
    return new Set(((j.commits ?? []) as any[]).map((c) => c.sha as string));
}

/** Another public repo that already contains this exact commit (history copied in unchanged), or null. */
export async function foundElsewhere(repo: string, sha: string): Promise<string | null> {
    const r = await gh(`/search/commits?q=hash:${sha}&per_page=5`);
    if (!r.ok) return null; // search is best effort (rate limits); never fail a user over it
    const j: any = await r.json();
    const other = ((j.items ?? []) as any[]).find((i) => i.repository?.full_name?.toLowerCase() !== repo.toLowerCase());
    return other ? other.repository.full_name : null;
}

/** Branch names in the repo (first 100; plenty for a hackathon repo). */
export async function listBranches(repo: string): Promise<string[]> {
    const r = await gh(`/repos/${repo}/branches?per_page=100`);
    if (r.status === 404 || r.status === 409) return [];
    if (!r.ok) throw new Error(`github branches ${repo}: ${r.status}`);
    return ((await r.json()) as any[]).map((b) => b.name as string);
}

export type CommitDetail = {
    sha: string;
    message: string;
    parents: number;
    files: { filename: string; status: string; additions: number; deletions: number; patch?: string }[];
};

export async function commitDetail(repo: string, sha: string): Promise<CommitDetail> {
    const r = await gh(`/repos/${repo}/commits/${sha}`);
    if (!r.ok) throw new Error(`github commit ${sha}: ${r.status}`);
    const j: any = await r.json();
    return {
        sha,
        message: String(j.commit?.message ?? ''),
        parents: (j.parents ?? []).length,
        files: (j.files ?? []).map((f: any) => ({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch,
        })),
    };
}

export async function fileExists(repo: string, branch: string, path: string): Promise<boolean> {
    const r = await gh(`/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`);
    if (r.status === 404) return false;
    if (!r.ok) throw new Error(`github contents ${path}: ${r.status}`);
    return true;
}

/** True when every changed line in the patch is blank or differs only in whitespace. */
export function isWhitespaceOnly(detail: CommitDetail): boolean {
    const added: string[] = [];
    const removed: string[] = [];
    for (const f of detail.files) {
        if (f.patch === undefined) return false; // binary or too large: not provably filler
        for (const line of f.patch.split('\n')) {
            if (line.startsWith('+') && !line.startsWith('+++')) added.push(line.slice(1).replace(/\s+/g, ''));
            if (line.startsWith('-') && !line.startsWith('---')) removed.push(line.slice(1).replace(/\s+/g, ''));
        }
    }
    const a = added.filter(Boolean).sort().join('\n');
    const b = removed.filter(Boolean).sort().join('\n');
    return a === b;
}
