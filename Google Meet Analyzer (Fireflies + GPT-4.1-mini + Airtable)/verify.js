// Standalone test for the meeting-ID extraction logic used inside the n8n
// "Extract Meeting ID" Code node. Run with: `node verify.js`
//
// Mirrors the JS in the workflow's Extract Meeting ID node so we can verify
// behaviour without booting n8n.

function extractMeetingId(rawJson) {
  const raw = rawJson;
  const body = (raw && typeof raw.body === 'object' && raw.body !== null) ? raw.body : raw;

  const meetingId =
    body.meetingId ||
    body.meeting_id ||
    body.transcriptId ||
    body.transcript_id ||
    body.id ||
    body.data?.meetingId ||
    body.data?.meeting_id ||
    body.data?.transcriptId ||
    body.data?.transcript_id ||
    body.data?.id ||
    body.payload?.meeting_id ||
    body.payload?.meetingId ||
    '';

  if (!meetingId) {
    throw new Error(
      'Could not find a meeting/transcript ID in the Fireflies webhook payload. ' +
      'Raw body received: ' + JSON.stringify(body)
    );
  }

  return meetingId;
}

const cases = [
  {
    name: 'v1 payload         ',
    input: { body: { meetingId: 'ASxwZxCstx', eventType: 'Transcription completed' } },
    expect: 'ASxwZxCstx',
  },
  {
    name: 'v2 payload         ',
    input: { body: { event: 'meeting.transcribed', timestamp: 1710876543210, meeting_id: 'ASxwZxCstx' } },
    expect: 'ASxwZxCstx',
  },
  {
    name: 'nested under data  ',
    input: { body: { data: { transcript_id: 'nested123' } } },
    expect: 'nested123',
  },
  {
    name: 'top-level (no body)',
    input: { meetingId: 'manualTest' },
    expect: 'manualTest',
  },
  {
    name: 'empty body         ',
    input: { body: { eventType: 'something_else' } },
    expect: null,
    shouldThrow: true,
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  try {
    const got = extractMeetingId(c.input);
    if (c.shouldThrow) {
      console.log(`FAIL ${c.name} -> expected throw, got '${got}'`);
      fail++;
    } else if (got === c.expect) {
      console.log(`PASS ${c.name} -> meetingId = ${got}`);
      pass++;
    } else {
      console.log(`FAIL ${c.name} -> expected '${c.expect}', got '${got}'`);
      fail++;
    }
  } catch (e) {
    if (c.shouldThrow) {
      console.log(`PASS ${c.name} -> threw: ${e.message}`);
      pass++;
    } else {
      console.log(`FAIL ${c.name} -> unexpected throw: ${e.message}`);
      fail++;
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
