/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

const DEFAULT_UPSTREAM = 'https://query1.finance.yahoo.com';
const CHART_ENDPOINT = '/v8/finance/chart/';

const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Access-Control-Allow-Headers': '*',
};

function jsonResponse(status, body, extraHeaders = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			...corsHeaders,
			...extraHeaders,
		},
	});
}

const safeNumber = (value) => {
	const num = Number(value);
	return Number.isFinite(num) ? num : null;
};

const isoFromTs = (ts) => {
	if (!Number.isFinite(ts)) return null;
	return new Date(ts * 1000).toISOString().slice(0, 10);
};

function buildCandle(date, open, high, low, close) {
	if (!date) return null;
	const closeVal = safeNumber(close);
	if (closeVal === null) return null;

	let openVal = safeNumber(open);
	let highVal = safeNumber(high);
	let lowVal = safeNumber(low);

	if (openVal === null) openVal = closeVal;
	if (highVal === null) highVal = Math.max(openVal, closeVal);
	if (lowVal === null) lowVal = Math.min(openVal, closeVal);

	highVal = Math.max(highVal, openVal, closeVal);
	lowVal = Math.min(lowVal, openVal, closeVal);

	if (lowVal > highVal) [lowVal, highVal] = [highVal, lowVal];

	return {
		date,
		open: openVal,
		high: highVal,
		low: lowVal,
		close: closeVal,
	};
}

function extractCandles(payload) {
	const result = payload?.chart?.result?.[0];
	if (!result) return [];

	const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
	const quote = (result.indicators?.quote || [])[0] || {};
	const opens = quote.open || [];
	const highs = quote.high || [];
	const lows = quote.low || [];
	const closes = quote.close || [];

	const candles = [];
	for (let idx = 0; idx < timestamps.length; idx += 1) {
		const date = isoFromTs(timestamps[idx]);
		const candle = buildCandle(date, opens[idx], highs[idx], lows[idx], closes[idx]);
		if (candle) {
			candles.push(candle);
		}
	}
	return candles;
}

export default {
	async fetch(request, env) {
		try {
			if (request.method === 'OPTIONS') {
				return new Response(null, { status: 204, headers: corsHeaders });
			}

			if (env.WORKER_TOKEN) {
				const provided = request.headers.get('x-worker-token') || request.headers.get('authorization');
				const cleaned = provided?.replace(/^Bearer\s+/i, '').trim();
				if (!cleaned || cleaned !== env.WORKER_TOKEN) {
					return jsonResponse(401, { error: 'Unauthorized' });
				}
			}

			const url = new URL(request.url);
			const segments = url.pathname.split('/').filter(Boolean);

			if (segments.length === 0) {
				return jsonResponse(200, {
					message: 'Usage: GET /history/{SYMBOL}?range=1y&interval=1d',
				});
			}

			if (segments[0] !== 'history') {
				return jsonResponse(404, { error: 'Not found' });
			}

			const symbolSegments = segments.slice(1);
			if (!symbolSegments.length) {
				return jsonResponse(400, { error: 'Missing symbol in path.' });
			}

			const rawSymbol = symbolSegments.join('/');
			const encodedSymbol = encodeURIComponent(rawSymbol);

			const search = new URLSearchParams(url.search);
			if (!search.has('interval')) search.set('interval', '1d');
			if (!search.has('range')) search.set('range', '1y');

			const upstreamUrl = `${DEFAULT_UPSTREAM}${CHART_ENDPOINT}${encodedSymbol}?${search.toString()}`;

			const cfOptions = { cacheEverything: true };
			const ttl = Number(env.CACHE_TTL);
			const cacheTtl = Number.isFinite(ttl) && ttl > 0 ? ttl : 600;
			cfOptions.cacheTtl = cacheTtl;

			const upstreamResponse = await fetch(upstreamUrl, {
				headers: {
					'User-Agent': USER_AGENT,
					Accept: 'application/json,text/plain,*/*',
				},
				cf: cfOptions,
			});

			if (upstreamResponse.ok) {
				try {
					const parsed = await upstreamResponse.clone().json();
					const candles = extractCandles(parsed);
					if (candles.length) {
						return jsonResponse(200, candles, { 'Cache-Control': `public, max-age=${cacheTtl}` });
					}
					return jsonResponse(
						502,
						{ error: 'Upstream payload empty or invalid.' },
						{ 'Cache-Control': `public, max-age=${cacheTtl}` },
					);
				} catch (error) {
					return jsonResponse(
						502,
						{ error: 'Failed to parse upstream payload.', detail: `${error}` },
						{ 'Cache-Control': `public, max-age=${cacheTtl}` },
					);
				}
			}

			const headers = new Headers(upstreamResponse.headers);
			headers.set('Access-Control-Allow-Origin', '*');
			headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
			headers.set('Access-Control-Allow-Headers', '*');
			headers.set('Cache-Control', `public, max-age=${cacheTtl}`);
			headers.delete('content-security-policy');
			headers.delete('content-security-policy-report-only');

			return new Response(upstreamResponse.body, {
				status: upstreamResponse.status,
				statusText: upstreamResponse.statusText,
				headers,
			});
		} catch (error) {
			return jsonResponse(502, {
				error: 'Upstream request failed',
				detail: `${error}`,
			});
		}
	},
};
