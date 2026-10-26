# MercanPay MCP server

Let **Claude, Cursor, Windsurf** and any other [Model Context Protocol](https://modelcontextprotocol.io) client take crypto payments for you.
Ask in plain words — *"create a 49 USD invoice for the logo design and write the customer a message"* — and the assistant creates a
[MercanPay](https://mercanpay.com) invoice that your customer pays in **USDT (TRC20) or TRX**.

```text
You:        Bill Acme 250 USD for the October retainer, order ACME-10.
Assistant:  Created invoice for 250 USD (order ACME-10). Payment page: https://mercanpay.com/pay/3f2c…
            The customer can pay with USDT or TRX; the rate is locked for 30 minutes.
```

- **Invoices** — create, look up (by id or your order id), list, cancel
- **Payment links** — reusable pay pages with a QR code for Telegram, Instagram, WhatsApp or your site (fixed price or open amount)
- **Rates** — current USD prices of USDT and TRX
- **Test mode** — with a `mp_test_…` key nothing real moves, and `simulate_payment` lets you try paid / partial / expired
- **Safe by design** — there is **no payout tool**: an assistant can create and read payments, never send money out of your account

## Quick start

1. Create a free MercanPay account at [mercanpay.com](https://mercanpay.com/merchant?utm_source=github&utm_medium=readme&utm_campaign=mcp#signup).
2. In the panel open **API keys** and create a key with the `invoices` and `read` scopes. Start with a **test key** (`mp_test_…`).
3. Add the server to your client (below). Node.js 18+ is required; `npx` downloads the package for you.

### Claude Desktop

`claude_desktop_config.json` (Settings → Developer → Edit config):

```json
{
  "mcpServers": {
    "mercanpay": {
      "command": "npx",
      "args": ["-y", "mercanpay-mcp"],
      "env": { "MERCANPAY_API_KEY": "mp_test_your_key" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add mercanpay --env MERCANPAY_API_KEY=mp_test_your_key -- npx -y mercanpay-mcp
```

### Cursor / Windsurf / VS Code

Add the same block to `.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json` or your VS Code MCP settings:

```json
{ "mcpServers": { "mercanpay": { "command": "npx", "args": ["-y", "mercanpay-mcp"], "env": { "MERCANPAY_API_KEY": "mp_test_your_key" } } } }
```

## Tools

| Tool | What it does |
| --- | --- |
| `create_invoice` | New payment request. `price_usd` (customer picks USDT or TRX, rate locked) or `token` + `amount`. Optional `order_id`, `description`, `success_url`, `expires_in_minutes`, `metadata`. Returns `payment_url`. |
| `get_invoice` | Status (pending, partial, paid, overpaid, expired, cancelled), amounts and payments of one invoice. |
| `find_invoice_by_order` | The invoice created for one of your order ids. |
| `list_invoices` | Recent invoices, filter by status. |
| `cancel_invoice` | Cancel an unpaid invoice (marked destructive, so clients ask you first). |
| `create_payment_link` | Reusable pay page with QR code, `fixed` or `open` amount. *Live keys only.* |
| `list_payment_links` / `update_payment_link` | Your links; change title or price, switch on / off. *Live keys only.* |
| `get_rates` | USD prices of USDT and TRX. |
| `simulate_payment` | *Test keys only:* mark a test invoice paid, partial, overpaid or expired (webhooks fire as usual). |

Prompt: `payment_request` — creates an invoice and drafts a customer message with the link, in the language you choose.

## Configuration

| Variable | Required | Default |
| --- | --- | --- |
| `MERCANPAY_API_KEY` | yes | — (`mp_…` live or `mp_test_…` test key) |
| `MERCANPAY_BASE_URL` | no | `https://mercanpay.com` |

Use a key with only the `invoices` and `read` scopes. The server talks to the MercanPay REST API over HTTPS and stores nothing.

## About MercanPay

MercanPay is a crypto payment gateway for USDT (TRC20) and TRX: hosted payment page, REST API, signed webhooks, payment links,
free plugins for WooCommerce, WordPress and OpenCart, and PHP / Python libraries. Fees from 0.4%, no chargebacks, payments final in about a minute.
[Documentation](https://mercanpay.com/en/documentation) · [Integrations](https://mercanpay.com/en/integrations) · [Free tools](https://mercanpay.com/en/tools)

## Development

```bash
npm install
npm run build
npm test
MERCANPAY_API_KEY=mp_test_… node e2e.mjs   # end-to-end over stdio against the API
```

MIT © MercanPay
