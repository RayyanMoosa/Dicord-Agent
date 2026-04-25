# Google Meet Analyzer (Fireflies + GPT-4.1-mini + Airtable)

n8n workflow that:

1. Receives a Fireflies.ai webhook when a Google Meet transcript is ready.
2. Fetches the full transcript over the Fireflies GraphQL API.
3. Sends the transcript to GPT-4.1-mini for an 11-point sales analysis.
4. Writes the structured analysis (42 fields) into an Airtable "Call Analysis" base.

Tested on n8n cloud `2.15.1`.

---

## Fix for "meetingId is empty" (Issue 2)

### Root cause

The n8n Webhook node always wraps an incoming HTTP request as:

```json
{
  "headers": { ... },
  "params":  { ... },
  "query":   { ... },
  "body":    { ... }   // <-- the JSON body lives here
}
```

So inside the next node, `$json.meetingId` is **always** `undefined` — you have
to read `$json.body.meetingId`. The previous `Extract Meeting ID` node already
had a `$json.body || $json` fallback for that, but it was still missing the
key Fireflies actually uses today.

Fireflies has two webhook payload shapes (per the
[official docs](https://docs.fireflies.ai/graphql-api/webhooks-v2)):

| Version | Example body |
| --- | --- |
| Webhooks v1 | `{"meetingId": "ASxwZxCstx", "eventType": "Transcription completed"}` |
| Webhooks v2 | `{"event": "meeting.transcribed", "timestamp": 1710876543210, "meeting_id": "ASxwZxCstx"}` |

The old code only checked `meetingId`, `transcriptId`, and `id` — it did **not**
check `meeting_id` (the snake_case key v2 sends). Result: an empty string was
silently passed downstream. The HTTP Request node then sent
`{"query":"{ transcript(id: \"\") ..."}` to Fireflies, and Fireflies rejected
it with the misleading message:

> POST body missing, invalid Content-Type, or JSON object has no keys

### Changes made to the workflow

1. **`Extract Meeting ID` node** now:
   - Unwraps `$json.body` correctly (and falls back to `$json` for manual tests).
   - Looks at every key Fireflies (or a manual test) might use:
     `meetingId`, `meeting_id`, `transcriptId`, `transcript_id`, `id`,
     plus the same set nested under `data` and `payload`.
   - **Throws** if no ID is found, including the raw body in the error message.
     This surfaces the real problem in the n8n execution view instead of
     producing a confusing GraphQL error one node later.
   - Forwards `eventType` and the original `rawBody` so they're visible in the
     execution log for debugging.

2. **`Fetch Transcript from Fireflies` node** now uses a proper GraphQL
   *variable* instead of string-interpolating the ID into the query body:

   ```text
   ={{ JSON.stringify({
        query: 'query Transcript($transcriptId: String!) {
                  transcript(id: $transcriptId) {
                    id title
                    sentences { speaker_name raw_words }
                    summary { keywords action_items outline overview }
                  }
                }',
        variables: { transcriptId: $json.meetingId }
      }) }}
   ```

   Benefits:
   - No more backslash-escaping pain inside the `{{ ... }}` expression.
   - Matches the pattern Fireflies recommends in its
     [Zapier integration guide](https://docs.fireflies.ai/integrations/zapier).
   - If `$json.meetingId` is empty for any reason, Fireflies returns a clear
     `Variable "$transcriptId" of required type "String!" was not provided`
     error instead of a generic "POST body missing" reply.

3. **Removed the hard-coded Fireflies API key** from
   `Fetch Transcript from Fireflies`. Replace the `Bearer YOUR_FIREFLIES_API_KEY`
   placeholder with your own key (preferably via an n8n **HTTP Header Auth**
   credential rather than typing it directly into the node).

   > ⚠️ The previous version of this file contained a real-looking Fireflies
   > bearer token. **Rotate that token in your Fireflies account immediately**
   > if it was ever committed or shared.

---

## How to verify the fix

### 1. Local payload smoke test (no n8n required)

A `verify.js` script next to this README mirrors the `Extract Meeting ID` logic
and runs it against both Fireflies payload shapes plus a couple of edge cases.

```bash
node verify.js
```

Expected output:

```
v1 payload          -> meetingId = ASxwZxCstx
v2 payload          -> meetingId = ASxwZxCstx
nested under data   -> meetingId = nested123
empty body          -> threw: Could not find a meeting/transcript ID ...
top-level (no body) -> meetingId = manualTest
```

### 2. End-to-end test in n8n

1. Open the workflow, click `Fireflies Webhook`, switch it to **Listen for
   test event**, and copy the test URL.
2. From a terminal, send the real v2 payload shape:

   ```bash
   curl -X POST "<your-test-webhook-url>" \
     -H 'Content-Type: application/json' \
     -d '{"event":"meeting.transcribed","timestamp":1710876543210,"meeting_id":"<a-real-id-from-your-fireflies-account>"}'
   ```

3. Inspect the execution. The `Extract Meeting ID` node should output
   `meetingId` populated, and the `rawBody` field will show you exactly what
   Fireflies (or your test client) sent — handy for debugging future format
   changes.

> Use a **real** transcript ID from `app.fireflies.ai/transcript/<ID>/`. A made
> up ID like `abc123` will be accepted by GraphQL syntactically but Fireflies
> will return `null` for the `transcript` field, which will then break the
> `Format Transcript` node downstream.

---

## Files

- `Google Meet Analyzer (Fireflies + GPT-4.1-mini + Airtable).json` — the n8n
  workflow you import via **Workflows → Import from File**.
- `verify.js` — standalone Node script that exercises the meeting-ID
  extraction logic against the documented Fireflies payload shapes.
