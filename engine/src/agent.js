// Agent terminal BCIO: Claude + tool engine, loop manual dengan streaming.
// Setiap kejadian (teks, tool mulai/selesai) dikirim ke browser lewat `emit`.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { TOOLS, runTool, toolByName } from './tools.js';
import { SYMBOLS } from './assets.js';

const client = new Anthropic(); // membaca ANTHROPIC_API_KEY dari environment (.env)
const MODEL = process.env.BCIO_MODEL || 'claude-opus-5-5';
const MAX_TURNS = 10;

const SYSTEM = `You are the BCIO terminal agent: a cross-asset market analyst for stock tokens and crypto on Robinhood Chain.

What the user sees: a three-panel terminal. Left is a live watchlist (${SYMBOLS.join(', ')}) and a correlation matrix, the center is this chat, the right panel shows their wallet portfolio, basket proposals, automation rules and activity.

Execution runs on the BCIO desk on Robinhood Chain testnet with test tokens (tUSDC, tNVDA, tTSLA, tQQQ, tBTC, tETH, tSOL) priced by an oracle fed with live market prices. Test tokens have no real value; say so when it matters. RENDER, TAO and FET can be analysed but not traded on the desk.

How to work:
- Every number you state (price, change, correlation, lag) must come from a tool call in this conversation. Never invent or recall market data.
- Stock tokens (NVDA, TSLA, QQQ) are Robinhood tokenized stocks that trade 24/7 on-chain, so they move while Wall Street is closed. Use market_status when timing matters.
- For "does X follow Y", "which coin moves with NVDA", lead/lag or weekend questions, use correlate, correlation_matrix and weekend_shield. Explain the lag in plain words (who moves first, by how many hours) and how strong the link is.
- When the user wants to buy, split, rotate or hedge now, build it with propose_basket. The user approves and signs it with their own wallet in the right panel; you never place that trade yourself, so never say it was placed.
- Automation (the user's wallet must be connected; tools use it automatically):
  - Phase 2, weekend shield: draft_shield_rule. Phase 3, rebalancer: draft_rebalance_rule. Both only draft; the user activates them in the right panel by granting the agent an on-chain permission (per-trade limit, daily limit, expiry) and signing the rule. Suggest sensible limits sized to their portfolio (check get_portfolio).
  - Explain plainly what the rule will do and when, and that they can turn it off or revoke the agent at any time.
  - get_automation shows the permission, rules and past automatic trades; run_automation_now evaluates active rules immediately.
  - If a tool says no wallet is connected, ask the user to connect one (button at the top).
- If the user gives a condition (earnings beat, BTC above a level), check what you can with the tools and say plainly which part of the condition you cannot verify (e.g. earnings results are not in the data yet).
- Reply in the user's language. Be brief: short paragraphs or a compact list, numbers rounded sensibly. Mention once, briefly, that this is analysis and not financial advice when you suggest a trade.`;

function inputSchema(schema) {
  const js = z.toJSONSchema(schema);
  delete js.$schema;
  return js;
}

const API_TOOLS = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: inputSchema(t.schema),
  eager_input_streaming: true,
}));
API_TOOLS[API_TOOLS.length - 1].cache_control = { type: 'ephemeral' };

const sessions = new Map();
export function getSession(id) {
  let s = sessions.get(id);
  if (!s) { s = { messages: [], busy: false, touched: Date.now() }; sessions.set(id, s); }
  s.touched = Date.now();
  return s;
}
setInterval(() => {
  for (const [id, s] of sessions) if (Date.now() - s.touched > 2 * 3600_000) sessions.delete(id);
}, 600_000).unref();

export async function runAgent(session, text, emit, ctx = {}) {
  session.messages.push({ role: 'user', content: text });
  let jsonRetries = 0;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: API_TOOLS,
      messages: session.messages,
    });
    stream.on('text', (delta) => emit('text', { delta }));

    let msg;
    try {
      msg = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // hanya input tool yang tidak bisa di-parse yang diulang; error API dilempar ke atas
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
      continue;
    }

    session.messages.push({ role: 'assistant', content: msg.content });

    if (msg.stop_reason === 'refusal') {
      emit('notice', { text: 'The model declined this request.' });
      break;
    }
    if (msg.stop_reason === 'max_tokens') {
      emit('notice', { text: 'Reply was cut off (length limit).' });
      break;
    }
    if (msg.stop_reason === 'pause_turn') continue;

    const uses = msg.content.filter((b) => b.type === 'tool_use');
    if (!uses.length) break;

    const results = await Promise.all(uses.map(async (u) => {
      const group = toolByName(u.name)?.group || 'tool';
      emit('tool_start', { id: u.id, name: u.name, group, input: u.input });
      const r = await runTool(u.name, u.input, ctx);
      emit('tool_end', { id: u.id, name: u.name, group, ok: r.ok, result: r.ok ? r.result : null, error: r.ok ? null : r.error });
      return {
        type: 'tool_result',
        tool_use_id: u.id,
        content: JSON.stringify(r.ok ? r.result : { error: r.error }),
        ...(r.ok ? {} : { is_error: true }),
      };
    }));
    session.messages.push({ role: 'user', content: results });
    emit('turn', {});
  }
}

export { Anthropic };
