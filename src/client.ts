/** Minimal MercanPay REST client used by the MCP tools. */

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** sent as User-Agent so MercanPay can see which integration made the call */
  userAgent?: string;
}

export class MercanPayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class MercanPayClient {
  readonly baseUrl: string;
  readonly test: boolean;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly o: ClientOptions) {
    if (!o.apiKey || !/^mp_/.test(o.apiKey)) throw new Error('MERCANPAY_API_KEY is missing or invalid (keys start with mp_ or mp_test_)');
    this.baseUrl = (o.baseUrl ?? 'https://mercanpay.com').replace(/\/+$/, '');
    this.test = o.apiKey.startsWith('mp_test_');
    this.fetchFn = o.fetch ?? globalThis.fetch;
  }

  async request<T = unknown>(method: string, path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = new URL(this.baseUrl + '/v1' + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const res = await this.fetchFn(url, {
      method,
      headers: {
        authorization: `Bearer ${this.o.apiKey}`,
        accept: 'application/json',
        'user-agent': this.o.userAgent ?? 'mercanpay-mcp',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new MercanPayError(res.status, 'bad_response', `Unexpected response from MercanPay (HTTP ${res.status})`);
    }
    if (!res.ok) {
      const e = (data as { error?: { code?: string; message?: string } } | null)?.error;
      throw new MercanPayError(res.status, e?.code ?? 'http_error', e?.message ?? `HTTP ${res.status}`);
    }
    return data as T;
  }
}
