import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

describe('Yahoo proxy worker', () => {
	it('returns usage message on root path (unit style)', async () => {
		const request = new Request('http://example.com');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchInlineSnapshot(`
			{
			  "message": "Usage: GET /history/{SYMBOL}?range=1y&interval=1d",
			}
		`);
	});

	it('returns usage message on root path (integration style)', async () => {
		const response = await SELF.fetch('http://example.com');
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchInlineSnapshot(`
			{
			  "message": "Usage: GET /history/{SYMBOL}?range=1y&interval=1d",
			}
		`);
	});
});
