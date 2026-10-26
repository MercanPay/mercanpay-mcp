import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MercanPayClient, MercanPayError } from './client.js';

export const VERSION = '1.0.0';

const decimal = z.string().regex(/^\d+(\.\d+)?$/, 'decimal string such as "25" or "10.5"');
const coin = z.enum(['USDT', 'TRX']);

/**
 * MCP server exposing MercanPay payments to AI assistants: invoices, payment links and rates.
 * Payouts (withdrawals) are deliberately not exposed — an assistant can create and read payments,
 * never move money out of the account.
 */
export function createServer(client: MercanPayClient): McpServer {
  const server = new McpServer(
    { name: 'mercanpay', title: 'MercanPay', version: VERSION },
    {
      instructions:
        'MercanPay accepts USDT (TRC20) and TRX payments on the TRON network. Create an invoice for a one-off payment and give the customer its payment_url; ' +
        'create a payment link for a reusable page (fixed price or open amount / donations). Prices in USD let the customer pick TRX or USDT at a locked rate. ' +
        'Invoices are paid after 20 confirmations (about a minute). ' +
        (client.test ? 'This server uses a TEST key: no real money moves; use simulate_payment to try outcomes.' : 'This server uses a LIVE key: invoices are real.'),
    },
  );

  const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }], structuredContent: data as Record<string, unknown> });
  const run = async (fn: () => Promise<unknown>) => {
    try {
      const data = await fn();
      return ok(Array.isArray(data) ? { data } : data);
    } catch (e) {
      const msg = e instanceof MercanPayError ? `MercanPay error ${e.status} (${e.code}): ${e.message}` : e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text' as const, text: msg }], isError: true };
    }
  };

  // ─── invoices ──────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'create_invoice',
    {
      title: 'Create invoice',
      description:
        'Create a payment request and get a hosted payment page (payment_url) to send to the customer. Either price_usd (customer picks TRX or USDT, rate locked) ' +
        'or token + amount (fixed coin amount). Minimum 10 USD. Use order_id to make it idempotent and to find it later.',
      inputSchema: {
        price_usd: decimal.optional().describe('Price in US dollars, e.g. "49.90". The customer chooses the coin.'),
        tokens: z.array(coin).optional().describe('Coins the customer may pick for a USD invoice (default: all).'),
        token: coin.optional().describe('Fixed coin, used with amount.'),
        amount: decimal.optional().describe('Amount in the fixed coin, e.g. "100".'),
        order_id: z.string().min(1).max(128).optional().describe('Your order reference; the same order_id returns the existing invoice.'),
        description: z.string().max(500).optional().describe('Shown to the customer on the payment page.'),
        success_url: z.url().optional().describe('Where the customer goes after paying.'),
        expires_in_minutes: z.number().int().min(5).max(1440).optional().describe('How long the invoice stays open (default set by the account, max 24 h).'),
        metadata: z.record(z.string(), z.unknown()).optional().describe('Free-form data returned in webhooks (max 4 KB).'),
      },
      annotations: { title: 'Create invoice', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (a) =>
      run(async () => {
        if (!a.price_usd && !(a.token && a.amount)) throw new Error('Give price_usd, or token and amount.');
        return client.request('POST', '/invoices', a);
      }),
  );

  server.registerTool(
    'get_invoice',
    {
      title: 'Get invoice',
      description: 'Status and details of one invoice: pending, partial, paid, overpaid, expired or cancelled, amounts, payments and payment_url.',
      inputSchema: { id: z.string().min(1).describe('Invoice id') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) => run(() => client.request('GET', `/invoices/${encodeURIComponent(id)}`)),
  );

  server.registerTool(
    'find_invoice_by_order',
    {
      title: 'Find invoice by order id',
      description: 'Look up the invoice created for one of your order ids.',
      inputSchema: { order_id: z.string().min(1).max(128) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ order_id }) => run(() => client.request('GET', `/invoices/by-order/${encodeURIComponent(order_id)}`)),
  );

  server.registerTool(
    'list_invoices',
    {
      title: 'List invoices',
      description: 'Recent invoices, newest first. Filter by status; page with before (created_at of the last item).',
      inputSchema: {
        status: z.enum(['pending', 'partial', 'paid', 'overpaid', 'expired', 'cancelled']).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        before: z.string().optional().describe('ISO timestamp: only invoices created before it'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (a) => run(() => client.request('GET', '/invoices', undefined, a)),
  );

  server.registerTool(
    'cancel_invoice',
    {
      title: 'Cancel invoice',
      description: 'Cancel an unpaid invoice so it can no longer be paid. Ask the user to confirm first.',
      inputSchema: { id: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ id }) => run(() => client.request('POST', `/invoices/${encodeURIComponent(id)}/cancel`)),
  );

  if (client.test) {
    server.registerTool(
      'simulate_payment',
      {
        title: 'Simulate payment (test mode)',
        description: 'Test keys only: pretend the customer paid, paid part, overpaid, or let the invoice expire. Fires the same webhooks as real payments.',
        inputSchema: { id: z.string().min(1), outcome: z.enum(['paid', 'partial', 'overpaid', 'expired']), amount: decimal.optional().describe('For partial / overpaid') },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      async ({ id, ...b }) => run(() => client.request('POST', `/invoices/${encodeURIComponent(id)}/simulate`, b)),
    );
  }

  // ─── payment links (live keys only: links always take real payments) ───────────────────
  if (!client.test) {
  server.registerTool(
    'create_payment_link',
    {
      title: 'Create payment link',
      description:
        'Create a reusable payment page (with QR code) to share on Telegram, Instagram, WhatsApp or a website. kind "fixed" = one price (price_usd); ' +
        'kind "open" = the payer types the amount (donations, tips) within min_usd / max_usd. Every payment opens its own invoice.',
      inputSchema: {
        title: z.string().min(1).max(80),
        kind: z.enum(['fixed', 'open']),
        price_usd: decimal.optional().describe('Required for kind "fixed". Minimum 10.'),
        min_usd: decimal.optional(),
        max_usd: decimal.optional(),
        suggested_amounts: z.array(decimal).max(6).optional().describe('Quick-pick amounts for open links'),
        description: z.string().max(500).optional(),
        tokens: z.array(coin).optional(),
        success_url: z.url().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (a) => run(() => client.request('POST', '/payment-links', a)),
  );

  server.registerTool(
    'list_payment_links',
    {
      title: 'List payment links',
      description: 'Your payment links with their URL, QR code links, status and totals.',
      inputSchema: { active: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ active, limit }) => run(() => client.request('GET', '/payment-links', undefined, { active, limit })),
  );

  server.registerTool(
    'update_payment_link',
    {
      title: 'Update payment link',
      description: 'Change a payment link (title, price, description) or switch it off / on with active.',
      inputSchema: {
        id: z.number().int().positive(),
        active: z.boolean().optional(),
        title: z.string().min(1).max(80).optional(),
        price_usd: decimal.optional(),
        description: z.string().max(500).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ id, ...b }) => run(() => client.request('PATCH', `/payment-links/${id}`, b)),
  );
  }

  // ─── reference data ────────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_rates',
    {
      title: 'Get rates',
      description: 'Current USD prices of the supported coins (USDT and TRX), as used for USD-priced invoices.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => run(() => client.request('GET', '/rates')),
  );

  server.registerPrompt(
    'payment_request',
    {
      title: 'Request a payment',
      description: 'Create an invoice for a customer and write them a short message with the payment link.',
      argsSchema: { amount_usd: z.string().describe('Amount in USD'), purpose: z.string().describe('What the payment is for'), language: z.string().optional().describe('Message language, e.g. Turkish') },
    },
    ({ amount_usd, purpose, language }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Create a MercanPay invoice for ${amount_usd} USD for "${purpose}" (use create_invoice with price_usd). Then write a short, friendly message${language ? ` in ${language}` : ''} for the customer with the payment_url, saying they can pay with USDT or TRX on the TRON (TRC20) network and that the link expires.`,
          },
        },
      ],
    }),
  );

  return server;
}
