# Bedrock AgentCore — deploy the digital-twin agent

The chat over the digital twin is a **Strands agent on Amazon Bedrock AgentCore
Runtime** (`agent/agent.py`). The demo's Node server (`server.js`) invokes it and
falls back to an offline answerer when it isn't deployed — so the booth demo works
either way.

## Files
- `agent/agent.py` — Strands `Agent` with tools (`get_zone`, `list_alarms`,
  `floor_summary`) + an AgentCore `@app.entrypoint`. Tools read the telemetry
  snapshot passed in the invocation payload (in production, point them at Amazon
  Timestream for InfluxDB via Flux instead).
- `agent/requirements.txt` — `bedrock-agentcore`, `strands-agents` as **required**
  deps (AgentCore Runtime installs required deps only, not optional extras).

## Deploy (bedrock-agentcore starter toolkit)
```bash
cd agent
python -m venv .venv && source .venv/bin/activate
pip install bedrock-agentcore-starter-toolkit strands-agents bedrock-agentcore

# configure — .bedrock_agentcore.yaml must use 'name' + 'entrypoint',
# and an explicit region/account/execution_role ARN (NOT 'auto').
agentcore configure --entrypoint agent.py --name plantTwinAgent \
  --execution-role arn:aws:iam::<ACCOUNT_ID>:role/<AgentCoreExecutionRole> \
  --region us-east-1

agentcore launch          # builds the ARM64 image and creates the runtime
```
Notes / gotchas (learned the hard way):
- Claude 4.x needs the **`us.` inference profile id** (`us.anthropic.claude-sonnet-4-5-...`),
  not the bare model id — already set in `agent.py`.
- If `agentcore launch` throws a `NoneType.upper()` error during the ARM64 dep
  build, that's a toolkit version bug — upgrade/downgrade `bedrock-agentcore-starter-toolkit`.
- The execution role needs `bedrock:InvokeModel*` for the model and CloudWatch logs.

## Wire it to the demo
`agentcore launch` prints the runtime ARN. Point the Node server at it:
```bash
export AGENTCORE_RUNTIME_ARN="arn:aws:bedrock-agentcore:us-east-1:<ACCOUNT_ID>:runtime/plantTwinAgent-XXXX"
export AWS_REGION=us-east-1
npm install && npm start        # http://localhost:8090
```
Now `/api/chat` routes to AgentCore. Without the ARN it uses the offline answerer;
set `ALLOW_DIRECT_BEDROCK=1` to use a direct Bedrock Converse call instead as a
middle option.

## The talking point
This is the L300 layer: the same digital twin, now with an **agent** that reasons
over live telemetry through tools — deployed on AgentCore (managed runtime, memory,
identity, observability), reachable from any app via one signed API call.
