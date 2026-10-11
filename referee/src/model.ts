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

export const modelsReady = () => config.modelProvider === 'claude-cli' || client !== null;

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

/* ------------------------------------------------------------ claude -p */

// The CLI runs in an empty directory with no tools, no MCP servers and no settings,
// so gathered evidence can only ever be read, never acted on.
const sandboxDir = mkdtempSync(join(tmpdir(), 'referee-claude-'));
const MAX_PARALLEL = Number(process.env.CLAUDE_MAX_PARALLEL ?? 3);
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
