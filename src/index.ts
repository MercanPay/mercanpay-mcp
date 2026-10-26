#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MercanPayClient } from './client.js';
import { createServer, VERSION } from './server.js';

/**
 * mercanpay-mcp — MCP server for MercanPay (stdio).
 *   MERCANPAY_API_KEY   required (mp_… live key or mp_test_… test key; scopes: invoices, read)
 *   MERCANPAY_BASE_URL  optional, default https://mercanpay.com
 */
async function main() {
  if (process.argv.includes('--version')) {
    console.log(VERSION);
    return;
  }
  const client = new MercanPayClient({
    apiKey: process.env.MERCANPAY_API_KEY ?? '',
    baseUrl: process.env.MERCANPAY_BASE_URL,
    userAgent: `mercanpay-mcp/${VERSION}`,
  });
  await createServer(client).connect(new StdioServerTransport());
  // stdout carries the protocol: log to stderr only
  console.error(`mercanpay-mcp ${VERSION} ready (${client.test ? 'test' : 'live'} key, ${client.baseUrl})`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
