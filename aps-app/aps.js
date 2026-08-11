import {
  APS_CLIENT_ID,
  APS_CLIENT_SECRET,
  APS_BUCKET,
  credentialsPresent,
} from './config.js';

const BASE = 'https://developer.api.autodesk.com';

// Fail fast with a clear message if someone reaches an APS helper without creds.
function assertCredentials() {
  if (!credentialsPresent) {
    throw new Error(
      'APS credentials are not configured. Copy .env.example to .env and set ' +
        'APS_CLIENT_ID and APS_CLIENT_SECRET (from https://aps.autodesk.com).'
    );
  }
}

// Read an APS error body as text so thrown errors carry the real reason.
async function apsError(res, action) {
  let detail = '';
  try {
    detail = await res.text();
  } catch {
    detail = '<no response body>';
  }
  return new Error(`APS ${action} failed (${res.status} ${res.statusText}): ${detail}`);
}

// --- Authentication (v2) -------------------------------------------------

async function getToken(scopes) {
  assertCredentials();
  const basic = Buffer.from(`${APS_CLIENT_ID}:${APS_CLIENT_SECRET}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: scopes.join(' '),
  });
  const res = await fetch(`${BASE}/authentication/v2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    throw await apsError(res, 'authentication');
  }
  return res.json(); // { access_token, token_type, expires_in }
}

// Internal token: full scopes for server-side bucket/object/translation work.
export async function getInternalToken() {
  return getToken([
    'bucket:create',
    'bucket:read',
    'data:read',
    'data:write',
    'data:create',
  ]);
}

// Viewer token: minimal public scope, safe to hand to the browser.
export async function getViewerToken() {
  return getToken(['viewables:read']);
}

// --- Object Storage Service (OSS v2) -------------------------------------

// Create the bucket if it does not exist. 200 (created) and 409 (already
// exists) both mean "the bucket is ready".
export async function ensureBucket() {
  const { access_token } = await getInternalToken();
  const res = await fetch(`${BASE}/oss/v2/buckets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      bucketKey: APS_BUCKET,
      policyKey: 'persistent',
    }),
  });
  if (res.status === 200 || res.status === 409) {
    return APS_BUCKET;
  }
  throw await apsError(res, 'ensureBucket');
}

// Upload a model buffer using the signed-S3 upload flow.
export async function uploadModel(objectKey, buffer) {
  const { access_token } = await getInternalToken();
  const auth = { Authorization: `Bearer ${access_token}` };
  const signPath = `${BASE}/oss/v2/buckets/${APS_BUCKET}/objects/${encodeURIComponent(
    objectKey
  )}/signeds3upload`;

  // 1. Ask APS for a signed S3 URL.
  const signRes = await fetch(signPath, { headers: auth });
  if (!signRes.ok) {
    throw await apsError(signRes, 'signeds3upload (get URL)');
  }
  const { uploadKey, urls } = await signRes.json();

  // 2. PUT the bytes directly to the signed S3 URL.
  const putRes = await fetch(urls[0], {
    method: 'PUT',
    body: buffer,
  });
  if (!putRes.ok) {
    throw await apsError(putRes, 'signeds3upload (PUT bytes)');
  }

  // 3. Finalize the upload so APS assembles the object.
  const finishRes = await fetch(signPath, {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uploadKey }),
  });
  if (!finishRes.ok) {
    throw await apsError(finishRes, 'signeds3upload (finalize)');
  }
  const finished = await finishRes.json();
  return finished.objectId;
}

// List every object in the bucket, returning name + base64url URN.
export async function listModels() {
  const { access_token } = await getInternalToken();
  const res = await fetch(`${BASE}/oss/v2/buckets/${APS_BUCKET}/objects`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  // A brand-new bucket that has never been created yet returns 404 -- treat as
  // "no models" rather than an error.
  if (res.status === 404) {
    return [];
  }
  if (!res.ok) {
    throw await apsError(res, 'listModels');
  }
  const data = await res.json();
  return (data.items || []).map((item) => ({
    name: item.objectKey,
    urn: urnFor(item.objectId),
  }));
}

// --- Base64url URN -------------------------------------------------------

export function urnFor(objectId) {
  return Buffer.from(objectId)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// --- Model Derivative (v2) ----------------------------------------------

// Kick off an SVF2 translation job for both 2D and 3D views.
export async function translate(urn) {
  const { access_token } = await getInternalToken();
  const res = await fetch(`${BASE}/modelderivative/v2/designdata/job`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
      'x-ads-force': 'true',
    },
    body: JSON.stringify({
      input: { urn },
      output: {
        formats: [{ type: 'svf2', views: ['2d', '3d'] }],
      },
    }),
  });
  if (!res.ok) {
    throw await apsError(res, 'translate');
  }
  return res.json();
}

// Poll translation progress. Returns { status, progress }.
export async function manifest(urn) {
  const { access_token } = await getInternalToken();
  const res = await fetch(
    `${BASE}/modelderivative/v2/designdata/${urn}/manifest`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );
  if (!res.ok) {
    throw await apsError(res, 'manifest');
  }
  const data = await res.json();
  return { status: data.status, progress: data.progress };
}
