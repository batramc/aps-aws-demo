"""
Plant-Floor Digital Twin agent — runs on Amazon Bedrock AgentCore Runtime.

The browser (via the demo's /api/chat proxy) invokes this agent with a payload:
    { "prompt": "<user question>", "snapshot": { ...live telemetry... } }

The agent uses Strands tools to answer, grounded in the snapshot. In production
the tools would query Amazon Timestream for InfluxDB (Flux) instead of the passed-in snapshot.

Deploy with the bedrock-agentcore starter toolkit (see AGENTCORE.md).
"""
from bedrock_agentcore import BedrockAgentCoreApp
from strands import Agent, tool
from strands.models import BedrockModel

app = BedrockAgentCoreApp()

# Snapshot for the current invocation (set by the entrypoint before the agent runs).
_SNAPSHOT: dict = {}


@tool
def get_zone(name: str) -> str:
    """Current telemetry for a single zone by (partial) name."""
    for z in _SNAPSHOT.get("zones", []):
        if name.lower() in z["name"].lower():
            return (f'{z["name"]}: {z["temp"]}C ({z["status"]}), '
                    f'humidity {z["hum"]}%, vibration {z["vib"]} mm/s')
    return f"No zone matching '{name}'."


@tool
def list_alarms() -> str:
    """Zones currently in ALARM (temperature >= 80C)."""
    al = [z for z in _SNAPSHOT.get("zones", []) if z["status"] == "alarm"]
    if not al:
        return "No zones are in alarm."
    return "; ".join(f'{z["name"]} {z["temp"]}C' for z in al)


@tool
def floor_summary() -> str:
    """Overall plant-floor summary: average temp, zone count, hottest zone."""
    zs = _SNAPSHOT.get("zones", [])
    return (f'Average {_SNAPSHOT.get("avg")}C across {len(zs)} zones; '
            f'hottest is {_SNAPSHOT.get("peak")}.')


# Claude 4.x REQUIRES the us. inference profile id (not the bare model id).
model = BedrockModel(
    model_id="us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    region_name="us-east-1",
    temperature=0.2,
)

agent = Agent(
    model=model,
    tools=[get_zone, list_alarms, floor_summary],
    system_prompt=(
        "You are the Plant-Floor Digital Twin assistant for an Autodesk Platform "
        "Services + AWS demo. Use the tools to answer strictly from live telemetry. "
        "Be concise (1-3 sentences) and cite zone names and numbers. Thresholds: "
        "temperature >= 80C = ALARM, >= 60C = Warning, otherwise Normal."
    ),
)


@app.entrypoint
def invoke(payload):
    global _SNAPSHOT
    _SNAPSHOT = payload.get("snapshot", {}) or {}
    prompt = payload.get("prompt", "") or "Give me a floor summary."
    result = agent(prompt)
    return {"result": str(result)}


if __name__ == "__main__":
    app.run()
