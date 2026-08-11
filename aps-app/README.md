# APS on AWS -- AU 2026 Demo

A real, runnable Autodesk Platform Services (APS) viewer app. Upload a CAD
model, APS translates it in the cloud, and the Autodesk Viewer renders it in the
browser. Built as the AU 2026 demo of **APS running on AWS**.

Modeled on the official
[aps-simple-viewer-nodejs](https://github.com/autodesk-platform-services/aps-simple-viewer-nodejs)
sample, using the current APS **v2** endpoints.

## Quick start

```bash
cp .env.example .env
# edit .env and add APS_CLIENT_ID and APS_CLIENT_SECRET
# (create an app at https://aps.autodesk.com and enable
#  Data Management API + Model Derivative API)

npm install
npm start
# open http://localhost:8080
```

The server boots **without** credentials too -- the UI shows a banner and the
API routes return a friendly JSON error until you add them. This lets you run
and inspect the app before wiring in real APS access.

> Real APS API calls (translation, storage) may incur charges on your Autodesk
> account. Use your own credentials.

## What happens end-to-end (and its AWS analog)

1. **Authenticate** -- the server exchanges your client ID/secret for a token
   (`/authentication/v2/token`). *AWS analog: IAM / Cognito issuing scoped
   credentials.*
2. **Store** -- your file is uploaded to an APS OSS bucket via the signed-S3
   flow. *AWS analog: durable object storage like **Amazon S3**.*
3. **Translate** -- Model Derivative converts the model to SVF2 (2D + 3D) in the
   cloud. *AWS analog: scalable, on-demand **compute** (e.g. ECS/Lambda/Batch).*
4. **View** -- the Autodesk Viewer streams the translated geometry to the
   browser. *AWS analog: global low-latency delivery like **Amazon CloudFront**.*

## Taking it cloud-native on AWS

A production deployment of this same app on AWS:

```
Browser
  -> Amazon CloudFront        (global CDN, TLS, caching of static assets)
  -> Amazon Cognito           (user auth in front of the app)
  -> ECS Fargate              (this Node.js app, no servers to manage)
  -> APS APIs                 (auth, OSS, Model Derivative)
```

- **Uploads** go straight to **Amazon S3** using pre-signed URLs (the same
  signed-upload pattern this app uses with APS OSS), keeping large binaries off
  the app tier.
- **Deploy** the whole stack with Kiro natural-language IaC -- describe the
  architecture and let Kiro generate the CloudFormation/CDK.

## Sample model

Need something to upload? The
[aws-samples/aws-iot-twinmaker-samples](https://github.com/aws-samples/aws-iot-twinmaker-samples)
repo includes a waste-basket model in `.stl` / `.step` form that works well for
a quick demo.

## Project layout

```
aps-app/
  server.js        Express server + API routes
  aps.js           APS v2 client (auth, OSS, Model Derivative)
  config.js        env loading; never crashes on missing creds
  package.json
  .env.example
  public/          front-end (Autodesk Viewer v7)
    index.html
    main.js
    style.css
```
