import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { MercanPayClient } from './client.js';
import { createServer } from './server.js';

/** Connects an MCP client to the server; MercanPay API calls go to `api` instead of the network. */
async function connect(key: string, api: (method: string, path: string, body: unknown) => { status?: number; body: unknown }) {
  const calls: { method: string; url: string; body: unknown; auth: string | null }[] = [];
  const fetchFn = (async (url: URL, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const u = new URL(url);
    calls.push({ method: init.method!, url: u.pathname + u.search, body, auth: (init.headers as Record<string, string>).authorization });
    const r = api(init.method!, u.pathname, body);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const server = createServer(new MercanPayClient({ apiKey: key, baseUrl: 'https://pay.example/', fetch: fetchFn }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
  return { client, calls };
}

describe('mercanpay-mcp', () => {
  it('lists the payment tools; no payout tool exists; simulate only with a test key', async () => {
    const live = await connect('mp_live1234567890', () => ({ body: {} }));
    const names = (await live.client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['cancel_invoice', 'create_invoice', 'create_payment_link', 'find_invoice_by_order', 'get_invoice', 'get_rates', 'list_invoices', 'list_payment_links', 'update_payment_link']);
    expect(names.some((n) => /withdraw|payout/.test(n))).toBe(false);
    const test = await connect('mp_test_abc123', () => ({ body: {} }));
    const testNames = (await test.client.listTools()).tools.map((t) => t.name);
    expect(testNames).toContain('simulate_payment');
    expect(testNames).not.toContain('create_payment_link');
    expect((await test.client.listPrompts()).prompts.map((p) => p.name)).toEqual(['payment_request']);
  });

  it('creates an invoice through the REST API with the key', async () => {
    const { client, calls } = await connect('mp_test_abc123', (m, p) =>
      m === 'POST' && p === '/v1/invoices' ? { status: 201, body: { id: 'inv_1', status: 'pending', payment_url: 'https://pay.example/pay/inv_1' } } : { status: 404, body: { error: { code: 'not_found', message: 'nope' } } },
    );
    const r = await client.callTool({ name: 'create_invoice', arguments: { price_usd: '25', order_id: 'A-1', description: 'Logo design' } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ id: 'inv_1', payment_url: 'https://pay.example/pay/inv_1' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/v1/invoices', body: { price_usd: '25', order_id: 'A-1', description: 'Logo design' }, auth: 'Bearer mp_test_abc123' });

    const bad = await client.callTool({ name: 'create_invoice', arguments: { description: 'no price' } });
    expect(bad.isError).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('passes API errors back as tool errors and encodes path parts', async () => {
    const { client, calls } = await connect('mp_live1234567890', () => ({ status: 404, body: { error: { code: 'invoice_not_found', message: 'Invoice not found' } } }));
    const r = await client.callTool({ name: 'find_invoice_by_order', arguments: { order_id: 'a/b c' } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0]!.text).toContain('invoice_not_found');
    expect(calls[0]!.url).toBe('/v1/invoices/by-order/a%2Fb%20c');
  });

  it('lists invoices with filters and wraps arrays', async () => {
    const { client, calls } = await connect('mp_live1234567890', () => ({ body: { data: [{ id: 'x' }], has_more: false } }));
    const r = await client.callTool({ name: 'list_invoices', arguments: { status: 'paid', limit: 5 } });
    expect(r.structuredContent).toMatchObject({ data: [{ id: 'x' }] });
    expect(calls[0]!.url).toBe('/v1/invoices?status=paid&limit=5');
  });

  it('refuses keys that are not MercanPay keys', () => {
    expect(() => new MercanPayClient({ apiKey: 'sk_live_x' })).toThrow(/MERCANPAY_API_KEY/);
  });
});
