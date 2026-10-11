import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { config } from './config.ts';

const client = config.modelApiKey ? new Anthropic({ apiKey: config.modelApiKey, maxRetries: 2 }) : null;

export const modelsReady = () => client !== null;

/**
 * One schema-constrained model call. Returns null on any failure (API error, refusal,
 * truncation, schema mismatch) so every caller can fail closed.
 */
export async function structuredCall<T extends z.ZodType>(
    model: string,
    system: string,
    user: string,
    schema: T,
    maxTokens = 4000,
): Promise<z.infer<T> | null> {
    if (!client) return null;
    try {
        const res = await client.messages.parse({
            model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: 'user', content: user }],
            output_config: { effort: 'low', format: zodOutputFormat(schema) },
        });
        if (res.stop_reason !== 'end_turn') return null;
        const parsed = schema.safeParse(res.parsed_output);
        return parsed.success ? parsed.data : null;
    } catch (err) {
        console.error(`[model] ${model} call failed:`, (err as Error).message);
        return null;
    }
}

/** Quote untrusted content as data. JSON-encoding neutralises any closing tags inside it. */
export function quote(label: string, content: unknown): string {
    return `<untrusted_${label}>\n${JSON.stringify(content)}\n</untrusted_${label}>`;
}
