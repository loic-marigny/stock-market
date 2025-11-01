/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

const CHART_HOST = 'https://query1.finance.yahoo.com';
const SUMMARY_HOST = 'https://query2.finance.yahoo.com';
const CHART_ENDPOINT = '/v8/finance/chart/';
const SUMMARY_ENDPOINT = '/v10/finance/quoteSummary/';
const CRUMB_URL = 'https://query2.finance.yahoo.com/v1/test/getcrumb';
const DEFAULT_SUMMARY_MODULES = 'assetProfile,summaryProfile,summaryDetail,financialData,price,defaultKeyStatistics';

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

const extractNumeric = (value) => {
	if (value === null || value === undefined) return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'object') {
		if (value === null) return null;
		if (typeof value.raw === 'number') return Number.isFinite(value.raw) ? value.raw : null;
		if (typeof value.fmt === 'number') return Number.isFinite(value.fmt) ? value.fmt : null;
		if (typeof value.fmt === 'string') {
			const parsed = Number(value.fmt.replace(/[^\d.-]/g, ''));
			return Number.isFinite(parsed) ? parsed : null;
		}
	}
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value.replace(/[^\d.-]/g, ''));
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
};

const sanitizeSummary = (rawSymbol, result) => {
	const summaryProfile = result?.summaryProfile || result?.assetProfile || {};
	const assetProfile = result?.assetProfile || {};

	const cleaned = {
		symbol: rawSymbol,
		longName: result?.price?.longName || result?.price?.shortName || null,
		longBusinessSummary: summaryProfile.longBusinessSummary || assetProfile.longBusinessSummary || null,
		website: summaryProfile.website || null,
		irWebsite: summaryProfile.irWebsite || null,
		industryDisp: summaryProfile.industryDisp || summaryProfile.industry || null,
		auditRisk: extractNumeric(assetProfile.auditRisk),
		beta: extractNumeric(result?.summaryDetail?.beta ?? result?.defaultKeyStatistics?.beta),
		recommendationMean: extractNumeric(result?.financialData?.recommendationMean),
	};

	return Object.fromEntries(
		Object.entries(cleaned).filter(([, value]) => value !== null && value !== undefined && value !== '')
	);
};

let crumbCache = null;
let cookieCache = '';
let crumbFetchedAt = 0;

const splitSetCookie = (header) => {
	if (!header) return [];
	return header.split(/,(?=[^;=]+=)/);
};

const createCookieJar = (initial) => {
	const store = new Map();
	const apply = (header) => {
		if (!header) return;
		for (const segment of splitSetCookie(header)) {
			const pair = segment.split(';')[0]?.trim();
			if (!pair) continue;
			const [name, ...rest] = pair.split('=');
			if (!name) continue;
			store.set(name.trim(), rest.join('=').trim());
		}
	};
	if (initial) apply(initial);
	return {
		apply,
		header: () =>
			Array.from(store.entries())
				.map(([k, v]) => `${k}=${v}`)
				.join('; '),
	};
};

async function fetchCrumb(cookieJar) {
	const headers = {
		'User-Agent': USER_AGENT,
		Referer: 'https://finance.yahoo.com/',
		Accept: 'text/plain',
	};
	const cookieHeader = cookieJar.header();
	if (cookieHeader) headers.Cookie = cookieHeader;

	const response = await fetch(CRUMB_URL, {
		headers,
		cf: { cacheTtl: 300, cacheEverything: true },
	});
	if (!response.ok) {
		throw new Error(`crumb fetch failed: ${response.status}`);
	}
	const text = (await response.text()).trim();
	if (!text) {
		throw new Error('crumb payload missing');
	}
	const setCookieHeader = response.headers.get('set-cookie');
	if (setCookieHeader) {
		cookieJar.apply(setCookieHeader);
	}
	return { crumb: text, cookie: cookieJar.header() };
}

async function ensureCrumb() {
	const now = Date.now();
	if (crumbCache && cookieCache && now - crumbFetchedAt < 5 * 60 * 1000) {
		return { crumb: crumbCache, cookie: cookieCache };
	}

	let lastError = null;
	for (const seedUrl of [
		'https://finance.yahoo.com',
		SUMMARY_HOST,
		CHART_HOST,
		'https://fc.yahoo.com',
		null,
	]) {
		const jar = createCookieJar(cookieCache);
		if (seedUrl) {
			try {
				const seedResp = await fetch(seedUrl, {
					headers: {
						'User-Agent': USER_AGENT,
						'Accept-Language': 'en-US,en;q=0.9',
					},
					cf: { cacheTtl: 300, cacheEverything: true },
				});
				if (seedResp.status === 429) {
					lastError = new Error(`seed throttle ${seedUrl}`);
					continue;
				}
				jar.apply(seedResp.headers.get('set-cookie'));
			} catch (seedError) {
				lastError = seedError;
				continue;
			}
		}

		try {
			const { crumb, cookie } = await fetchCrumb(jar);
			crumbCache = crumb;
			cookieCache = cookie;
			crumbFetchedAt = now;
			return { crumb, cookie };
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('crumb resolution failed');
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
					message: 'Usage: GET /history/{SYMBOL}?range=1y&interval=1d or GET /summary/{SYMBOL}',
				});
			}

			const symbolSegments = segments.slice(1);
			if (!symbolSegments.length) {
				return jsonResponse(400, { error: 'Missing symbol in path.' });
			}

			const rawSymbol = decodeURIComponent(symbolSegments.join('/'));
			const encodedSymbol = encodeURIComponent(rawSymbol).replace(/%3D/gi, '=');

			const ttl = Number(env.CACHE_TTL);
			const cacheTtl = Number.isFinite(ttl) && ttl > 0 ? ttl : 600;
			const cfOptions = { cacheEverything: true, cacheTtl };

			const resource = segments[0];

			if (resource === 'history') {
				const search = new URLSearchParams(url.search);
				if (!search.has('interval')) search.set('interval', '1d');
				if (!search.has('range')) search.set('range', '1y');

				const upstreamUrl = `${CHART_HOST}${CHART_ENDPOINT}${encodedSymbol}?${search.toString()}`;

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
			}

			if (resource === 'summary') {
				const search = new URLSearchParams(url.search);
				const modulesParam = search.get('modules');
				const modules = modulesParam && modulesParam.trim() ? modulesParam.trim() : DEFAULT_SUMMARY_MODULES;

				const { crumb, cookie } = await ensureCrumb();
				const upstreamUrl = `${SUMMARY_HOST}${SUMMARY_ENDPOINT}${encodedSymbol}?modules=${encodeURIComponent(modules)}&crumb=${encodeURIComponent(crumb)}`;

				const upstreamResponse = await fetch(upstreamUrl, {
					headers: {
						'User-Agent': USER_AGENT,
						Accept: 'application/json,text/plain,*/*',
						Cookie: cookie,
					},
					cf: cfOptions,
				});

				if (!upstreamResponse.ok) {
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
				}

				try {
					const parsed = await upstreamResponse.json();
					const result = parsed?.quoteSummary?.result?.[0];
					if (!result) {
						return jsonResponse(
							404,
							{ error: `Summary unavailable for ${rawSymbol}` },
							{ 'Cache-Control': `public, max-age=${cacheTtl}` },
						);
					}
					const summary = sanitizeSummary(rawSymbol, result);
					return jsonResponse(200, summary, { 'Cache-Control': `public, max-age=${cacheTtl}` });
				} catch (error) {
					return jsonResponse(
						502,
						{ error: 'Failed to parse upstream payload.', detail: `${error}` },
						{ 'Cache-Control': `public, max-age=${cacheTtl}` },
					);
				}
			}

			return jsonResponse(404, { error: 'Not found' });
		} catch (error) {
			return jsonResponse(502, {
				error: 'Upstream request failed',
				detail: `${error}`,
			});
		}
	},
};
