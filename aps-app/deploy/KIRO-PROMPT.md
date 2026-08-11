# Developer persona — the Kiro prompt

This is the live "how easy it is to build on AWS" moment. You stand at the booth
with the APS sample app open in **Kiro**, type a plain-English request, and Kiro
generates the AWS infrastructure and deploys it. The `deploy-apprunner.sh` script
in this folder is exactly the kind of artifact Kiro produces — committed here so
the demo is repeatable even offline.

---

## The one-liner to type into Kiro

> I have this Autodesk Platform Services viewer app (a Node.js Express server on
> port 8080). Containerize it and deploy it to **AWS App Runner** so I get a
> public HTTPS URL. Put my APS Client ID and Secret in **AWS Secrets Manager**
> instead of the code, create the IAM roles App Runner needs, and use the
> `us-east-1` region. Then give me the live URL.

That's the whole ask. Kiro writes the `Dockerfile`, the ECR push, the Secrets
Manager entry, the two IAM roles, and the App Runner service — the same steps
this script automates.

## Good follow-up prompts (to show the agentic loop)

- "Add **Amazon Cognito** sign-in in front of it so only logged-in users can
  open the viewer."
- "Swap local file handling for **Amazon S3** with pre-signed upload URLs."
- "Set up **auto-scaling** and show me the estimated monthly cost."
- "Tear it all down." (Kiro deletes the service, secret, and roles.)

## The 60-second booth script

1. **Frame it (10s):** "This is a real Autodesk sample app. Watch how fast it
   gets to production on AWS — I'm just going to *describe* what I want."
2. **Type the one-liner (5s)** into Kiro and let it work.
3. **Narrate what Kiro is doing (20s):** "It's writing a Dockerfile, pushing the
   image to a container registry, storing my API secrets securely, wiring up the
   permissions, and creating the service — infrastructure I didn't hand-write."
4. **Show the URL (15s):** open the App Runner HTTPS link on a phone. "Same 3D
   model, now running on AWS, reachable anywhere."
5. **Land the message (10s):** "No servers to manage, scales on demand, secrets
   are never in the code. That's how fast a developer goes from a sample to a
   secure, scalable app on AWS."

## Why App Runner for this demo (100–200 level)

- **One concept, not five.** App Runner takes a container and gives back an HTTPS
  URL. No VPC, load balancer, or cluster to explain on stage.
- **Scales on demand**, including to a small idle floor — good "pay for what you
  use" talking point.
- **Secrets Manager + IAM** show the secure-by-default story without slides.

If the audience is more advanced, the same app also has an **ECS Fargate** path
(that's what the deck's architecture slide shows) — mention it as the "when you
need a VPC and fine-grained networking" step up.

## Fallback if Wi-Fi / live deploy is risky at the booth

Pre-run `deploy-apprunner.sh` before the event so the URL is already live, then
*replay* the Kiro prompt on stage to show the generation — you get the "watch it
build" moment without depending on a cold deploy over conference Wi-Fi.
