# Swiftbox Dispatch: a Chord teammate that books bike deliveries on WhatsApp

A Lagos bike courier takes every booking over WhatsApp. This teammate turns "how much from Yaba to Lekki?" into a paid, confirmed job. It auto prices from the **road distance**, issues a **Paystack transfer account for exactly that price**, and books a rider only once **Paystack confirms the money arrived**. An uploaded payment receipt/screenshot doesn't count.

See [SUBMISSION.md](SUBMISSION.md) for the role and problem statement, [FIELD_NOTES.md](FIELD_NOTES.md) for what broke, and [GO_LIVE.md](GO_LIVE.md) for the owner's hand-over note.

## How it fits together

```
WhatsApp ─► Chord teammate ── skill: skill/swiftbox-dispatch (persona, flow, policy)
                 │
                 └─ MCP (Streamable HTTP, bearer auth) ─► server/ on Render
                        resolve_address ─► Google Places
                        get_quote       ─► Google Routes → pricing rules
                        create_payment  ─► Paystack Charge API (bank transfer)
                        confirm_booking ─► Paystack verify → mock rider roster
```

| Tool | Does | Returns (statuses) |
|---|---|---|
| `resolve_address` | Typed street or landmark → stored `address_id` | `ok`, `ambiguous`, `too_broad`, `not_found`, `out_of_area`, `provider_error` |
| `get_quote` | Two address ids → locked quote (30 min) | `ok`, `out_of_range`, `same_place`, `unknown_address_id`, `provider_error` |
| `create_payment` | Quote → Paystack transfer account for its exact total | `ok`, `invalid_email`, `quote_expired`, `already_issued`, `paystack_error` |
| `confirm_booking` | Verify with Paystack → book a rider | `confirmed`, `not_received_yet`, `expired`, `failed`, `amount_mismatch`, `no_payment_started`, `paystack_error` |

Every result carries a `next_step` telling the agent what to do with that status.

## Design choices

- **The model never handles a price.** `get_quote` stores the quote server-side and returns only its id. `create_payment` charges the stored total. The model can't mis-copy an amount, round it, or be talked into "make it ₦3,000". The charge has to be bound to the computed quote, not to an amount the model passes in.
- **Paystack is the booking record, so there's no database.** `create_payment` writes the whole job (addresses, contacts, item, price) onto the transaction's metadata, with reference `SWB-<quote_id>`. `confirm_booking` rebuilds the booking from Paystack, and rider assignment is deterministic. A booking survives a restart (tested: killed the server, confirmed again, got the same booking), and asking twice can't double-book. Quotes live in memory for 30 minutes. If the server sleeps, the agent re-quotes.
- **No fallback price.** Every failure (Google maps down, an address outside Lagos, an address too vague to price) returns a reason and a hand-off, never a guess.
- **Cheap refusals first.** A straight-line check runs before the paid Routes call, because road distance is never shorter than the straight line. An address matched in the wrong place is refused for free.

## Run it(Locally)

```bash
cd server
cp .env.example .env        # fill in a Paystack TEST key, a Google key, any bearer token
npm ci
npm test                    # 89 unit tests; Google and Paystack are mocked
npm run dev                 # from source, reloads on change; or: npm run build && npm start
```

Both `dev` and `start` load `server/.env` when it exists. On Render there is no `.env`, and the variables come from the dashboard.

Smoke test with the MCP Inspector (`npx @modelcontextprotocol/inspector`, Streamable HTTP, `http://localhost:3000/mcp`, header `Authorization: Bearer <token>`), or curl:

```bash
curl -s localhost:3000/mcp -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"resolve_address","arguments":{"query":"Ikeja City Mall"}}}'
```

To pay a test transfer account, send the exact amount from Paystack's **Demo Bank** app, then call `confirm_booking`.

## Deploy

1. **Render:** New → Blueprint → this repo (uses `render.yaml`). Set `PAYSTACK_SECRET_KEY` and `GOOGLE_MAPS_API_KEY`. `MCP_BEARER_TOKEN` is generated for you. Check `GET /health`.
2. **Chord:** register the server, give the teammate access, enable it, then probe it:
   ```bash
   curl -sS -X POST "$CHORD_BASE_URL/v1/workspaces/$WS/mcp-servers" -H "Authorization: Bearer $CHORD_API_KEY" \
     -H 'Content-Type: application/json' -d '{"name":"Swiftbox tools","url":"https://<render-host>/mcp",
     "auth_type":"bearer","auth_token":"<MCP_BEARER_TOKEN>","transport":"streamable_http","enabled":false}'
   curl -sS -X PUT "$CHORD_BASE_URL/v1/teammates/$TM" -H "Authorization: Bearer $CHORD_API_KEY" \
     -H 'Content-Type: application/json' -d '{"set_mcp_server_ids":["<mcp-id>"]}'
   curl -sS -X PUT "$CHORD_BASE_URL/v1/workspaces/$WS/mcp-servers/<mcp-id>" -H "Authorization: Bearer $CHORD_API_KEY" \
     -H 'Content-Type: application/json' -d '{"enabled":true}'
   curl -sS -X POST "$CHORD_BASE_URL/v1/workspaces/$WS/mcp-servers/<mcp-id>/health" -H "Authorization: Bearer $CHORD_API_KEY"
   ```
3. **Skill:** upload `skill/swiftbox-dispatch/` (the folder, `SKILL.md` as Instructions), then **publish**. A saved draft doesn't change replies.

**Swapping keys:** the server reads `PAYSTACK_SECRET_KEY` and `GOOGLE_MAPS_API_KEY` per request, so you can replace them in Render with your own test keys without redeploying.

## Layout

```
skill/swiftbox-dispatch/     SKILL.md + references/ (service policy, conversation guide)
server/src/config.ts         rate card, Lagos bounds, hours, rider roster: the only place prices live
server/src/services/         pricing, dispatch (pure); places, routes, paystack (I/O, never throw); TTL store
server/src/tools/            the four MCP tools: thin handlers that map results to status + next_step
server/src/mcp.ts, index.ts  tool registration (descriptions written for the model), Express + stateless transport
server/tests/                mirrors src/; Vitest
```

## How I used AI tools

I built this with Claude Code as a pair. It drafted code and tests from my design decisions. Choosing the problem, the payment and booking approach, and the trade-offs were mine. Every external behaviour was checked against the real APIs, not just mocks: the Paystack DVA gate on my test account, transfer completion, error payloads and district-level geocoding were all found by running real calls, and they changed the design.

Time spent: 5 hours
