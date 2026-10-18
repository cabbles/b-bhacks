import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { config } from './config.ts';

const client =
    config.modelProvider === 'api' && config.modelApiKey ? new Anthropic({ apiKey: config.modelApiKey, maxRetries: 2 }) : null;

export const modelsReady = () => client !== null || (config.modelProvider === 'gemini' && Boolean(config.geminiApiKey));

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
            config.modelProvider === 'gemini' && config.geminiApiKey ? await geminiCall(model, system, user, schema, maxTokens)
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

/** Quote untrusted content as data. JSON-encoding neutralises any closing tags inside it. */
export function quote(label: string, content: unknown): string {
    return `<untrusted_${label}>\n${JSON.stringify(content)}\n</untrusted_${label}>`;
}
