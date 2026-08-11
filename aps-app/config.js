import dotenv from 'dotenv';

dotenv.config();

export const APS_CLIENT_ID = process.env.APS_CLIENT_ID || '';
export const APS_CLIENT_SECRET = process.env.APS_CLIENT_SECRET || '';
export const APS_BUCKET = process.env.APS_BUCKET || 'aps-aws-demo-au2026';
export const PORT = process.env.PORT || 8080;

// True only when both APS credentials are present.
export const credentialsPresent = Boolean(APS_CLIENT_ID && APS_CLIENT_SECRET);

// Report missing credentials clearly, but DO NOT crash -- the server should
// still boot so the UI can render and explain what to configure.
if (!credentialsPresent) {
  const missing = [
    !APS_CLIENT_ID && 'APS_CLIENT_ID',
    !APS_CLIENT_SECRET && 'APS_CLIENT_SECRET',
  ].filter(Boolean);
  console.warn(
    `[config] Missing ${missing.join(', ')}. ` +
      'The server will start, but APS API routes will return a friendly error ' +
      'until you copy .env.example to .env and add your credentials from ' +
      'https://aps.autodesk.com.'
  );
}
