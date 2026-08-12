#!/usr/bin/env python3
"""
Autodesk / APS 'Shop Floor Assistant' digital-twin architecture on AWS.

Renders an AWS architecture diagram (mingrammer `diagrams` style: official AWS
service icons, nested Cluster() boxes, arrows) to shop-floor-architecture.png.

Requires: `pip install diagrams` and the graphviz `dot` binary on PATH.
Run:      python3 shop_floor_arch.py
"""

import os

# The mise python bin dir ships an unrelated `dot` bash shim that shadows the
# real Graphviz binary. Force common Graphviz install locations to the FRONT of
# PATH (even if already present later) so the graphviz Python package invokes
# the genuine `dot`, not the shim.
_parts = os.environ.get("PATH", "").split(os.pathsep)
for _p in reversed(("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin")):
    if os.path.isfile(os.path.join(_p, "dot")):
        _parts = [x for x in _parts if x != _p]
        _parts.insert(0, _p)
os.environ["PATH"] = os.pathsep.join(_parts)

from diagrams import Diagram, Cluster, Edge
from diagrams.aws.security import WAF, Cognito, IAMPermissions
from diagrams.aws.network import CloudFront, APIGateway
from diagrams.aws.storage import S3, SimpleStorageServiceS3Bucket
from diagrams.aws.compute import Lambda
from diagrams.aws.ml import Bedrock, SagemakerModel
from diagrams.aws.iot import IotCore, IotGreengrass
from diagrams.aws.database import Timestream
from diagrams.aws.management import Cloudwatch
from diagrams.aws.general import General

OUTFILE = "shop-floor-architecture"  # .png appended by diagrams

graph_attr = {
    "fontsize": "20",
    "fontname": "Helvetica",
    "labelloc": "t",
    "pad": "0.6",
    "nodesep": "0.55",
    "ranksep": "0.9",
    "splines": "spline",
    "bgcolor": "white",
}

node_attr = {"fontsize": "11", "fontname": "Helvetica"}
edge_attr = {"fontsize": "10", "fontname": "Helvetica", "color": "#555555"}

# AWS category accent colours for the "generic / no-official-icon" custom labels.
CL_AGENTCORE = {"bgcolor": "#E9F0FB", "pencolor": "#3B48CC", "fontcolor": "#232F3E",
                "style": "rounded", "penwidth": "2"}
CL_GENAI = {"bgcolor": "#F3ECFB", "pencolor": "#7D3AC1", "fontcolor": "#232F3E",
            "style": "rounded", "penwidth": "2"}
CL_STREAM = {"bgcolor": "#FDF3E7", "pencolor": "#D9781E", "fontcolor": "#232F3E",
             "style": "rounded"}
CL_FRONTEND = {"bgcolor": "#EAF6EE", "pencolor": "#2E8B57", "fontcolor": "#232F3E",
               "style": "rounded"}
CL_DATA = {"bgcolor": "#EAF4F7", "pencolor": "#1D7FA3", "fontcolor": "#232F3E",
           "style": "rounded"}
CL_TOOLS = {"bgcolor": "#FFF7E0", "pencolor": "#B8860B", "fontcolor": "#232F3E",
            "style": "rounded,dashed"}
CL_CLOUD = {"bgcolor": "#FBFBFB", "pencolor": "#232F3E", "fontcolor": "#232F3E",
            "style": "rounded", "penwidth": "2"}


def bedrock(label):
    """A Bedrock-icon node used for AgentCore primitives that lack an official icon."""
    return Bedrock(label)


with Diagram(
    "APS Shop Floor Assistant - Digital Twin on AWS",
    filename=OUTFILE,
    show=False,
    direction="LR",
    graph_attr=graph_attr,
    node_attr=node_attr,
    edge_attr=edge_attr,
):
    client = General("Client\n(Operator / Browser)")

    with Cluster("AWS Cloud", graph_attr=CL_CLOUD):

        # ---------------- Frontend ----------------
        with Cluster("Frontend", graph_attr=CL_FRONTEND):
            waf = WAF("AWS WAF\n(CloudFront Protection)")
            cf = CloudFront("CloudFront\n(React Application)")
            react_s3 = S3("S3\n(React Front End)")
            cognito = Cognito("Cognito\nUser Pool")

            client >> Edge(label="HTTPS") >> waf >> cf
            cf >> Edge(label="static assets") >> react_s3
            cognito >> Edge(label="auth (OIDC)", style="dashed",
                            color="#2E8B57") >> cf

        # ---------------- Generative AI ----------------
        with Cluster("Generative AI", graph_attr=CL_GENAI):

            with Cluster("Prompt / Response Streaming", graph_attr=CL_STREAM):
                apigw = APIGateway("Amazon API Gateway\nBedrock AgentCore API\n(Response Streaming)")
                stream_fn = Lambda("Stream Processor")
                docs_fn = Lambda("Document Access")

                apigw << Edge(label="/chat") >> stream_fn
                apigw >> Edge(label="/docs") >> docs_fn

            with Cluster("Bedrock AgentCore", graph_attr=CL_AGENTCORE):
                runtime = bedrock("AgentCore Runtime\n(hosts Strands agent)")
                gateway = bedrock("AgentCore Gateway\n(Lambdas/OpenAPI -> MCP tools)")
                identity = bedrock("AgentCore Identity\n(inbound/outbound OAuth)")
                mem_short = bedrock("AgentCore Memory\nShort-term (session)")
                mem_long = bedrock("AgentCore Memory\nLong-term (semantic)")
                code_interp = bedrock("AgentCore Code Interpreter\n(OEE / calcs sandbox)")
                browser = bedrock("AgentCore Browser\n(headless browser tool)")
                observ = Cloudwatch("AgentCore Observability\n(GenAI traces/metrics)")
                cedar = IAMPermissions("Cedar Policy\nguardrails")

                agent = SagemakerModel("Strands\nShop Floor Assistant Agent")

                with Cluster("MCP Tools (via Gateway)", graph_attr=CL_TOOLS):
                    t_diag = General("Diagnosis")
                    t_sensor = General("Sensor Data")
                    t_nav = General("3D Navigation")
                    t_entity = General("Entity Info")
                    t_kb = General("Knowledge Base")

                # AgentCore internal wiring
                runtime >> Edge(label="runs") >> agent
                agent >> Edge(label="tool calls") >> gateway
                gateway >> Edge(color="#B8860B") >> [t_diag, t_sensor,
                                                     t_nav, t_entity, t_kb]
                cedar >> Edge(label="authorize", style="dashed",
                              color="#3B48CC") >> gateway
                identity >> Edge(label="OAuth", style="dashed",
                                 color="#3B48CC") >> gateway
                agent >> Edge(style="dashed") >> mem_short
                agent >> Edge(style="dashed") >> mem_long
                agent >> Edge(style="dashed") >> code_interp
                agent >> Edge(style="dashed") >> browser
                runtime >> Edge(style="dotted", color="#666") >> observ

            # Bedrock model + KB (AWS Service APIs)
            model = Bedrock("Bedrock Model\n(AWS Service API)")
            kb = Bedrock("Bedrock Knowledge Base\n(AWS Service API)")

            agent >> Edge(label="invoke model") >> model
            t_kb >> Edge(label="retrieve") >> kb

            # Stream path into AgentCore
            stream_fn >> Edge(label="invoke agent") >> runtime

        # ---------------- Industrial Data ----------------
        with Cluster("Industrial Data", graph_attr=CL_DATA):
            iot_core = IotCore("AWS IoT Core\n(device ingest)")
            sim_fn = Lambda("Data Simulation")
            tsdb = Timestream("Timestream for InfluxDB\n(telemetry store)")
            twinmaker = IotGreengrass("IoT TwinMaker\nCookie Factory Digital Twin")
            s3_vectors = SimpleStorageServiceS3Bucket("S3 Vectors\n(SOPs & Manuals)")

            iot_core >> Edge(label="telemetry") >> sim_fn >> tsdb
            tsdb >> Edge(label="reads", color="#1D7FA3") >> t_sensor
            twinmaker >> Edge(label="scene / dbId", color="#1D7FA3") >> t_nav
            s3_vectors >> Edge(label="embeddings") >> kb

        # CloudFront -> API Gateway (front to backend)
        cf >> Edge(label="API calls") >> apigw

    print("Diagram build block complete")
