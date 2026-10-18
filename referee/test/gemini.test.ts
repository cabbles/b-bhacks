import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

// config.ts reads env at import time, so set it before loading the model client.
process.env.MODEL_PROVIDER = 'gemini';
process.env.GEMINI_API_KEY = 'test-key';
const { structuredCall, modelsReady } = await import('../src/model.ts');

const Vote = z.object({ passed: z.boolean(), reason: z.string() });

type Call = { url: string; init: RequestInit };
function fakeFetch(...responses: (() => Response)[]) {
    const calls: Call[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return responses[Math.min(calls.length - 1, responses.length - 1)]();
    }) as typeof fetch;
    return calls;
}
const ok = (parts: object[], finishReason = 'STOP') => () =>
    Response.json({ candidates: [{ finishReason, content: { role: 'model', parts } }] });

test('gemini: ready with a key', () => {
    assert.equal(modelsReady(), true);
});

test('gemini: sends system prompt, schema and key header; parses the answer', async () => {
    const calls = fakeFetch(ok([{ text: '{"passed":true,"reason":"real work"}' }]));
    const out = await structuredCall('gemini-3.8-flash', 'SYS', 'USER', Vote, 1500);
    assert.deepEqual(out, { passed: true, reason: 'real work' });

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/models\/gemini-3\.8-flash:generateContent$/);
    assert.ok(!calls[0].url.includes('test-key'), 'key must not be in the URL');
    assert.equal((calls[0].init.headers as Record<string, string>)['x-goog-api-key'], 'test-key');
    const body = JSON.parse(calls[0].init.body as string);
    assert.equal(body.systemInstruction.parts[0].text, 'SYS');
    assert.equal(body.contents[0].parts[0].text, 'USER');
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(body.generationConfig.responseJsonSchema.type, 'object');
    assert.equal(body.generationConfig.responseJsonSchema.$schema, undefined);
});

test('gemini: ignores thought parts', async () => {
    fakeFetch(ok([{ text: 'thinking…', thought: true }, { text: '{"passed":false,"reason":"filler"}' }]));
    assert.deepEqual(await structuredCall('m', 's', 'u', Vote), { passed: false, reason: 'filler' });
});

test('gemini: fails closed on non-STOP, bad JSON, schema mismatch and HTTP errors', async () => {
    fakeFetch(ok([{ text: '{"passed":true,"reason":"x"}' }], 'MAX_TOKENS'));
    assert.equal(await structuredCall('m', 's', 'u', Vote), null);
    fakeFetch(ok([{ text: 'not json' }]));
    assert.equal(await structuredCall('m', 's', 'u', Vote), null);
    fakeFetch(ok([{ text: '{"passed":"yes"}' }]));
    assert.equal(await structuredCall('m', 's', 'u', Vote), null);
    fakeFetch(() => new Response('boom', { status: 500 }));
    assert.equal(await structuredCall('m', 's', 'u', Vote), null);
    fakeFetch(() => Response.json({ promptFeedback: { blockReason: 'SAFETY' } }));
    assert.equal(await structuredCall('m', 's', 'u', Vote), null);
});

test('gemini: retries once after a 429, honouring retryDelay', async () => {
    const limited = () => Response.json({ error: { code: 429, details: [{ retryDelay: '0s' }] } }, { status: 429 });
    let calls = fakeFetch(limited, ok([{ text: '{"passed":true,"reason":"ok"}' }]));
    assert.deepEqual(await structuredCall('m', 's', 'u', Vote), { passed: true, reason: 'ok' });
    assert.equal(calls.length, 2);

    calls = fakeFetch(limited);
    assert.equal(await structuredCall('m', 's', 'u', Vote), null);
    assert.equal(calls.length, 2, 'only one retry');
});
