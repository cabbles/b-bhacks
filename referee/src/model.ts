import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { config } from './config.ts';

const client =
    config.modelProvider === 'api' && config.modelApiKey ? new Anthropic({ apiKey: config.modelApiKey, maxRetries: 2 }) : null;

export const modelsReady = () =>
    config.modelProvider === 'claude-cli' || client !== null || (config.modelProvider === 'gemini' && Boolean(config.geminiApiKey));

/**
 * One schema-constrained model call. Returns null on any failure (error, refusal, timeout,
 * schema mismatch) so every caller can fail closed.
 */
export async function structuredCall<T extends z.ZodType>(
    model: string,
    system: string,
    user: string,
    schema: T,
    maxTokens = 4000,
): Promise<z.infer<T> | null> {
    try {
        const raw =
            config.modelProvider === 'claude-cli' ? await cliCall(model, system, user, schema)
            : config.modelProvider === 'gemini' && config.geminiApiKey ? await geminiCall(model, system, user, schema, maxTokens)
            : client ? await apiCall(model, system, user, schema, maxTokens)
            : null;
        const parsed = schema.safeParse(raw);
        return parsed.success ? parsed.data : null;
    } catch (err) {
        console.error(`[model] ${model} call failed:`, (err as Error).message);
        return null;
    }
}

async function apiCall(model: string, system: string, user: string, schema: z.ZodType, maxTokens: number) {
    const res = await client!.messages.parse({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { effort: 'low', format: zodOutputFormat(schema) },
    });
    return res.stop_reason === 'end_turn' ? res.parsed_output : null;
}

/* ------------------------------------------------------------ gemini */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Plain fetch, no SDK, so the same code runs on Node and Cloudflare Workers.
async function geminiCall(model: string, system: string, user: string, schema: z.ZodType, maxTokens: number) {
    const { $schema, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
    const body = JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema: jsonSchema,
            // Thinking tokens count against this limit, so leave room beyond the answer itself.
            maxOutputTokens: maxTokens + 8192,
        },
    });
    for (let attempt = 0; ; attempt++) {
        // Key goes in a header, never the URL, so it can't leak into logs or error messages.
        const res = await fetch(`${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
            body,
            signal: AbortSignal.timeout(120_000),
        });
        // Free-tier rate limit: wait as long as Google asks (capped), then try once more.
        if (res.status === 429 && attempt === 0) {
            const delay = retryDelayMs(await res.text());
            await new Promise((r) => setTimeout(r, delay));
            continue;
        }
        if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const j = (await res.json()) as any;
        const cand = j.candidates?.[0];
        if (cand?.finishReason !== 'STOP') return null;
        const text = (cand.content?.parts ?? [])
            .filter((p: any) => !p.thought)
            .map((p: any) => p.text ?? '')
            .join('');
        return JSON.parse(text);
    }
}

function retryDelayMs(errorBody: string): number {
    const s = Number(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(errorBody)?.[1] ?? 5);
    return Math.min(s, 30) * 1000;
}

/* ------------------------------------------------------------ claude -p */

// The CLI runs in an empty directory with no tools, no MCP servers and no settings,
// so gathered evidence can only ever be read, never acted on.
const sandboxDir = mkdtempSync(join(tmpdir(), 'referee-claude-'));
const MAX_PARALLEL = Number(process.env.CLAUDE_MAX_PARALLEL ?? 6);
let active = 0;
const waiting: (() => void)[] = [];

async function cliCall(model: string, system: string, user: string, schema: z.ZodType): Promise<unknown> {
    if (active >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
        const { $schema, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
        return await runClaude(model, system, user, JSON.stringify(jsonSchema));
    } finally {
        active--;
        waiting.shift()?.();
    }
}

function runClaude(model: string, system: string, user: string, jsonSchema: string): Promise<unknown> {
    // Never let an API key in the environment turn this into a billed API call.
    const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, MODEL_API_KEY, ...env } = process.env;
    const args = [
        '-p',
        '--output-format', 'json',
        '--model', model,
        '--tools', '',
        '--strict-mcp-config',
        '--setting-sources', '',
        '--no-session-persistence',
        '--system-prompt', system,
        '--json-schema', jsonSchema,
    ];
    return new Promise((resolve, reject) => {
        const child = spawn(config.claudeBin, args, { cwd: sandboxDir, env, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error('claude -p timed out'));
        }, 180_000);
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        child.on('error', (e) => {
            clearTimeout(timer);
            reject(e);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            try {
                const j = JSON.parse(out);
                if (j.is_error || j.subtype !== 'success') return reject(new Error(`claude -p: ${j.subtype} ${j.result ?? ''}`.slice(0, 300)));
                resolve(j.structured_output ?? null);
            } catch {
                reject(new Error(`claude -p exited ${code}: ${(err || out).slice(0, 300)}`));
            }
        });
        // Prompt goes over stdin so large evidence never hits argv limits.
        child.stdin.end(user);
    });
}

/** Quote untrusted content as data. JSON-encoding neutralises any closing tags inside it. */
export function quote(label: string, content: unknown): string {
    return `<untrusted_${label}>\n${JSON.stringify(content)}\n</untrusted_${label}>`;
}
