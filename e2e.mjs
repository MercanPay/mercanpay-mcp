// Manual end-to-end check: spawns the built server over stdio like Claude Desktop would.
//   MERCANPAY_API_KEY=mp_test_… MERCANPAY_BASE_URL=http://127.0.0.1:3998 node e2e.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], env: { ...process.env } });
const client = new Client({ name: 'e2e', version: '1' });
await client.connect(transport);
const tools = (await client.listTools()).tools.map((t) => t.name);
console.log('tools:', tools.join(', '));
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  console.log(`\n${name}${r.isError ? ' (ERROR)' : ''}:`, r.isError ? r.content[0].text : JSON.stringify(r.structuredContent).slice(0, 300));
  return r.structuredContent;
};
const inv = await call('create_invoice', { price_usd: '25', order_id: 'mcp-e2e-' + Date.now(), description: 'MCP e2e test' });
await call('get_invoice', { id: inv.id });
await call('simulate_payment', { id: inv.id, outcome: 'paid' });
await call('get_invoice', { id: inv.id });
await call('list_invoices', { limit: 2 });
const link = await call('create_payment_link', { title: 'MCP bağış', kind: 'open', min_usd: '10' });
await call('list_payment_links', { limit: 2 });
if (link?.id) await call('update_payment_link', { id: link.id, active: false });
await call('get_rates', {});
await call('find_invoice_by_order', { order_id: 'nope-404' });
await client.close();
