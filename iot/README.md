# APS Digital Twin on AWS — Shop Floor Assistant

A booth-ready **plant-floor digital twin** that overlays live IoT telemetry on a
3D model, lets you scrub 24 hours of history, watches an incident unfold, and
answers natural-language questions through an **Amazon Bedrock AgentCore** agent
grounded in the live telemetry.

Built for Autodesk University 2026. It mirrors the pattern of the **Autodesk
Platform Services (APS) Data Visualization (IoT) Extension** — sensor sprites,
heatmaps, and time-series charts bound to model elements — with an AWS backend
and a Gen-AI assistant on top.

---

## What it is

- A **3D plant floor** (Three.js) with six zones — Assembly, Welding, Paint,
  Packaging, QC, Utilities — each carrying temperature, humidity, and vibration
  sensors rendered as floating tags.
- A **heatmap** that recolors each zone by temperature, a **24-hour time slider**
  (5-minute resolution), and per-zone **charts** and **KPIs**.
- A layered **tabbed panel**: Overview · Sensors · Equipment · Diagnosis · SOPs.
- A **Diagnosis chat** that routes to Bedrock AgentCore (with graceful fallbacks).
- A **6-step guided tour** and a **Trigger incident** button for live demos.

---

## End-to-end AWS flow

```
Plant sensors / PLCs
      │  (MQTT · InfluxDB line protocol)
      ▼
AWS IoT Core ──► Data Simulation Lambda ──► Amazon Timestream for InfluxDB
                                                     │  (Flux query)
                                                     ▼
                                            Amazon API Gateway
                                                     │
                                                     ▼
                                       Amazon Bedrock AgentCore  ──► Amazon Bedrock (Claude)
                                                     │
                                                     ▼
                                    APS Viewer + Gen-AI chat (this UI)
```

1. **Ingest** — sensors publish to **AWS IoT Core** over MQTT.
2. **Simulate / write** — a **Data Simulation Lambda** writes points into
   **Amazon Timestream for InfluxDB** (managed InfluxDB 2.x, port 8086).
3. **Serve** — a query **Lambda** behind **Amazon API Gateway** runs Flux queries.
4. **Reason** — a **Bedrock AgentCore** agent reads that telemetry and answers with
   **Amazon Bedrock (Claude)**.
5. **Present** — the **APS Viewer** overlays the live data and hosts the chat.

---

## How to run

```bash
npm install
npm start
# open http://localhost:8090
```

Requires Node ≥ 18. With no AWS credentials the chat uses the built-in offline
answerer, so the booth demo always works.

To use a different port for a quick smoke test:

```bash
PORT=8123 npm start
```

---

## The 6-step guided tour

Click **▶ Start guided demo** (top-right). It runs a ~3–5 minute scripted
walkthrough with a narration card (Next / Back / Exit, step counter). Each step
auto-performs its actions and highlights the relevant part of the UI:

1. **Sensors on the floor** — highlights the plant and the live sensor tags.
2. **The data pipeline on AWS** — pulses the end-to-end pipeline strip so you can
   see data flowing edge → IoT Core → Timestream → API Gateway → AgentCore → APS.
3. **An incident emerges** — triggers the Welding Bay overheat: jumps the timeline
   to the alarm time (~15:50), flies the camera to the zone, heatmap turns red.
4. **Ask the twin** — opens the Diagnosis tab and auto-asks *“Why is Welding Bay
   in alarm?”*, showing the AgentCore answer grounded in the live snapshot.
5. **Root cause + equipment** — opens the Equipment tab with that zone's asset
   metadata (model, firmware, install date, last service, MTBF).
6. **Recommended action** — opens the SOPs tab with the matching fix procedure,
   then resolves the alarm.

The tour is fully **exitable and re-runnable**. Two extra live controls:

- **⚡ Trigger incident** — live-ramps the selected zone from warning to alarm
  over ~15 s so visitors watch detection happen in real time.
- **Time slider / ▶ play** — scrub or auto-play the last 24 hours.

---

## AgentCore wiring

`/api/chat` resolves the answer in this order (see `server.js`):

1. **Bedrock AgentCore Runtime** — used when `AGENTCORE_RUNTIME_ARN` is set. The
   browser posts `{ question, snapshot }`; the snapshot is the twin's live
   telemetry at the current time.
2. **Direct Bedrock Converse** — fallback when `ALLOW_DIRECT_BEDROCK=1` and AWS
   credentials are available. Model via `BEDROCK_MODEL_ID`
   (default `us.anthropic.claude-sonnet-4-5-...`).
3. **Deterministic offline answerer** — always available; keeps the booth alive
   with grounded answers even with no AWS access.

Environment variables:

| Variable | Purpose |
|---|---|
| `AGENTCORE_RUNTIME_ARN` | ARN of the deployed AgentCore runtime → enables the real path |
| `ALLOW_DIRECT_BEDROCK`  | set to `1` to allow the direct Bedrock Converse fallback |
| `BEDROCK_MODEL_ID`      | override the model used by the direct path |
| `AWS_REGION`            | defaults to `us-east-1` |
| `PORT`                  | HTTP port, defaults to `8090` |

`GET /api/config` reports which path is active.

---

## Honest note on the simulation

The **3D scene and the telemetry are simulated stand-ins**. The plant is a
Three.js scene (not the real APS Viewer), and the sensor readings are generated
locally by `generateSeries()` — no live sensors, IoT Core, or Timestream are
contacted. This keeps the demo credential-free and reliable on a booth network.

To go live: render the real model in the **APS Viewer** with the **Data
Visualization (IoT) Extension**, and swap `generateSeries()` for a data adapter
that reads from **API Gateway → Timestream for InfluxDB**. The AgentCore chat
path is already real — set `AGENTCORE_RUNTIME_ARN` and it calls your deployed
runtime.
