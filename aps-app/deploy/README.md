# Deploy the APS app to AWS App Runner

The developer-persona demo for AU 2026: take a real Autodesk Platform Services
sample app and get it live on AWS with a public HTTPS URL — the "how easy it is
to build on AWS" story. See `KIRO-PROMPT.md` for the live Kiro script; this
README is the manual/repeatable path.

## What you get

```
Browser ──HTTPS──> AWS App Runner ──> your APS app (container)
                       │                 │
                       │                 └─ APS OAuth → OSS → Model Derivative → Viewer
                       └─ pulls image from Amazon ECR
                          reads APS creds from AWS Secrets Manager (via IAM role)
```

No VPC, load balancer, or servers to manage. App Runner scales on demand.

## Prerequisites

- **AWS CLI v2**, signed in to the target account (`aws sts get-caller-identity`
  should return it). Use a least-privilege deploy profile, not admin, if you have
  one: pass `--profile <name>`.
- **Docker** running locally (the script builds a `linux/amd64` image).
- **APS credentials** in `../.env` (copy `../.env.example`, add your Client ID
  and Secret from https://aps.autodesk.com with Data Management + Model
  Derivative enabled).

## One-command deploy

```bash
cd aps-app/deploy
./deploy-apprunner.sh --region us-east-1            # add --profile <name> if needed
```

It will:
1. Build the container from `../Dockerfile` and push it to **Amazon ECR**.
2. Store your APS Client ID/Secret in **AWS Secrets Manager** (`aps-aws-demo/creds`)
   — never in the image or the code.
3. Create two small **IAM roles** (one so App Runner can pull the image, one so
   the running app can read the secret).
4. Create the **App Runner service** and print the public HTTPS URL.

First deploy takes ~3–5 minutes. The URL prints at the end.

## Two paths, pick one

- **Container path (this script).** Most control, works with the `Dockerfile`.
- **Source path (no Docker).** Point an App Runner service at the GitHub repo and
  let it build using the root `apprunner.yaml`. Simplest if Docker isn't handy;
  set the two secrets in the App Runner console.

## Cost (rough, us-east-1)

App Runner bills for provisioned container memory + active CPU. A single small
instance (1 vCPU / 2 GB) is a few dollars a day if left running; **tear it down
after the event** to stop charges. APS API calls are billed separately on the
account behind your credentials.

## Tear down

```bash
# get the ARN, then delete
aws apprunner list-services --region us-east-1
aws apprunner delete-service --service-arn <arn> --region us-east-1
# optional cleanup
aws secretsmanager delete-secret --secret-id aps-aws-demo/creds --force-delete-without-recovery --region us-east-1
aws ecr delete-repository --repository-name aps-aws-demo --force --region us-east-1
```

## Security notes

- Secrets live in **Secrets Manager**, injected as env vars at runtime via an IAM
  role — they never enter the image, the repo, or `.env` in the container.
- App Runner gives you **HTTPS by default**.
- **No user auth yet.** The app is publicly reachable once deployed. For a real
  audience-facing deployment, add the Cognito step (see `KIRO-PROMPT.md`
  follow-ups) so only signed-in users can open the viewer.
- The `.dockerignore` keeps `.env`, `.git`, and `node_modules` out of the image.
