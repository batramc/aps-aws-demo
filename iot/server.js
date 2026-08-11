/* ============================================================
   APS Digital Twin — chat backend
   /api/chat resolves in this order:
     1. Bedrock AgentCore Runtime  (if AGENTCORE_RUNTIME_ARN is set)  -> the real thing
     2. Bedrock Converse (direct model)  (if ALLOW_DIRECT_BEDROCK=1 and creds)  -> fallback
     3. Deterministic offline answerer  -> always works, keeps the booth demo alive
   The browser posts { question, snapshot } where snapshot is the twin's
   live telemetry at the current time. Everything is grounded in that snapshot.
   ============================================================ */
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(__dirname));

const REGION = process.env.AWS_REGION || 'us-east-1';
const AGENTCORE_ARN = process.env.AGENTCORE_RUNTIME_ARN || '';
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const ALLOW_DIRECT = process.env.ALLOW_DIRECT_BEDROCK === '1';

// ---- system prompt shared by AgentCore + direct paths ----
function systemPrompt(snap) {
  return [
    'You are the Plant-Floor Digital Twin assistant for an Autodesk Platform Services + AWS demo.',
    'Answer ONLY from the telemetry snapshot below. Be concise (1-3 sentences), specific, and cite zone names and numbers.',
    'Thresholds: temperature >= 80C = ALARM, >= 60C = Warning, else Normal.',
    'If asked something the snapshot cannot answer, say so briefly.',
    '', 'TELEMETRY SNAPSHOT (current time ' + (snap.time || '?') + '):',
    JSON.stringify(snap, null, 2),
  ].join('\n');
}

// ---- 1. AgentCore Runtime ----
async function viaAgentCore(question, snap) {
  const { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } =
    await import('@aws-sdk/client-bedrock-agentcore');
  const client = new BedrockAgentCoreClient({ region: REGION });
  const payload = new TextEncoder().encode(JSON.stringify({ prompt: question, snapshot: snap }));
  const res = await client.send(new InvokeAgentRuntimeCommand({
    agentRuntimeArn: AGENTCORE_ARN,
    contentType: 'application/json',
    accept: 'application/json',
    payload,
  }));
  // response body is a stream/byte array depending on runtime; normalize to text
  let text = '';
  if (res.response && typeof res.response.transformToString === 'function') {
    text = await res.response.transformToString();
  } else if (res.response) {
    text = Buffer.from(res.response).toString('utf-8');
  }
  try { const j = JSON.parse(text); return j.result || j.output || j.completion || text; }
  catch { return text; }
}

// ---- 2. Direct Bedrock Converse (fallback) ----
async function viaBedrock(question, snap) {
  const { BedrockRuntimeClient, ConverseCommand } =
    await import('@aws-sdk/client-bedrock-runtime');
  const client = new BedrockRuntimeClient({ region: REGION });
  const res = await client.send(new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: systemPrompt(snap) }],
    messages: [{ role: 'user', content: [{ text: question }] }],
    inferenceConfig: { maxTokens: 400, temperature: 0.2 },
  }));
  return res.output.message.content[0].text;
}

// ---- 3. Deterministic offline answerer (grounded in the snapshot) ----
function offline(question, snap) {
  const q = (question || '').toLowerCase();
  const zones = snap.zones || [];
  const named = zones.find(z => q.includes(z.name.toLowerCase().split(' ')[0]));
  const fmt = z => `${z.name}: ${z.temp}°C (${z.status.toUpperCase()}), humidity ${z.hum}%, vibration ${z.vib} mm/s.`;

  if (named) return fmt(named) + (named.status === 'alarm'
    ? ` It is in ALARM because temperature ${named.temp}°C is over the 80°C threshold.` : '');
  if (/(alarm|alert|problem|wrong|issue|critical)/.test(q)) {
    const al = zones.filter(z => z.status === 'alarm');
    return al.length ? `${al.length} zone(s) in alarm: ${al.map(z => `${z.name} (${z.temp}°C)`).join(', ')}.`
                     : 'No zones are in alarm at this time — all within thresholds.';
  }
  if (/(hot|hottest|highest|peak|max)/.test(q)) {
    const h = [...zones].sort((a, b) => b.temp - a.temp)[0];
    return h ? `Hottest zone is ${h.name} at ${h.temp}°C (${h.status.toUpperCase()}).` : 'No data.';
  }
  if (/(humid)/.test(q)) {
    const h = [...zones].sort((a, b) => b.hum - a.hum)[0];
    return h ? `Most humid is ${h.name} at ${h.hum}%.` : 'No data.';
  }
  if (/(average|avg|overall|floor|summary|status|overview|how are things)/.test(q)) {
    const al = zones.filter(z => z.status === 'alarm').length;
    const wn = zones.filter(z => z.status === 'warn').length;
    return `Floor avg ${snap.avg}°C across ${zones.length} zones. ${al} alarm, ${wn} warning. Hottest: ${snap.peak}.`;
  }
  return 'I can answer about zone temperatures, humidity, vibration, alarms, the hottest zone, or a floor summary — grounded in the live telemetry. Try: "Why is Welding in alarm?"';
}

app.post('/api/chat', async (req, res) => {
  const { question, snapshot } = req.body || {};
  if (!question || !snapshot) return res.status(400).json({ error: 'question and snapshot required' });
  // 1. AgentCore
  if (AGENTCORE_ARN) {
    try { return res.json({ answer: await viaAgentCore(question, snapshot), source: 'agentcore' }); }
    catch (e) { console.warn('[agentcore] fell back:', e.message); }
  }
  // 2. direct Bedrock
  if (ALLOW_DIRECT) {
    try { return res.json({ answer: await viaBedrock(question, snapshot), source: 'bedrock' }); }
    catch (e) { console.warn('[bedrock] fell back:', e.message); }
  }
  // 3. offline
  return res.json({ answer: offline(question, snapshot), source: 'offline' });
});

app.get('/api/config', (_req, res) =>
  res.json({ agentcore: !!AGENTCORE_ARN, directBedrock: ALLOW_DIRECT, model: MODEL_ID, region: REGION }));

const PORT = process.env.PORT || 8090;
app.listen(PORT, () => {
  console.log(`APS digital-twin listening at http://localhost:${PORT}`);
  console.log(AGENTCORE_ARN ? `Chat -> Bedrock AgentCore (${AGENTCORE_ARN})`
    : ALLOW_DIRECT ? `Chat -> Bedrock Converse (${MODEL_ID}); set AGENTCORE_RUNTIME_ARN to use AgentCore`
    : 'Chat -> offline answerer; set AGENTCORE_RUNTIME_ARN (+ AWS creds) to use Bedrock AgentCore');
});
