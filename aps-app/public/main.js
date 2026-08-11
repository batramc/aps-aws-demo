/* global Autodesk */

let viewer = null;

// --- Viewer bootstrap ----------------------------------------------------

// The Viewer calls this whenever it needs a fresh access token.
async function getAccessToken(onTokenReady) {
  try {
    const res = await fetch('/api/auth/token');
    const data = await res.json();
    if (!res.ok || !data.access_token) {
      throw new Error(data.detail || data.error || 'token request failed');
    }
    onTokenReady(data.access_token, data.expires_in);
  } catch (err) {
    console.error('Failed to get access token:', err);
    setStatus(`Auth error: ${err.message}`, true);
  }
}

function initViewer() {
  return new Promise((resolve) => {
    Autodesk.Viewing.Initializer(
      { env: 'AutodeskProduction', getAccessToken },
      () => {
        const container = document.getElementById('viewer');
        viewer = new Autodesk.Viewing.GuiViewer3D(container);
        viewer.start();
        resolve(viewer);
      }
    );
  });
}

// --- Model loading -------------------------------------------------------

function loadModel(urn) {
  function onDocumentLoadSuccess(doc) {
    const root = doc.getRoot();
    viewer.loadDocumentNode(doc, root.getDefaultGeometry());
  }
  function onDocumentLoadFailure(code, message) {
    setStatus(`Could not load model (${code}): ${message}`, true);
  }
  Autodesk.Viewing.Document.load(
    'urn:' + urn,
    onDocumentLoadSuccess,
    onDocumentLoadFailure
  );
}

// --- Model list ----------------------------------------------------------

async function refreshModels() {
  const list = document.getElementById('model-list');
  try {
    const res = await fetch('/api/models');
    const models = await res.json();
    if (!res.ok) {
      throw new Error(models.detail || models.error || 'failed to list models');
    }
    list.innerHTML = '';
    if (models.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No models yet -- upload one to begin.';
      list.appendChild(li);
      return;
    }
    for (const model of models) {
      const li = document.createElement('li');
      li.textContent = model.name;
      li.className = 'model-item';
      li.addEventListener('click', () => {
        document
          .querySelectorAll('.model-item')
          .forEach((el) => el.classList.remove('active'));
        li.classList.add('active');
        loadModel(model.urn);
      });
      list.appendChild(li);
    }
  } catch (err) {
    list.innerHTML = `<li class="empty error">${err.message}</li>`;
  }
}

// --- Upload + poll -------------------------------------------------------

function setStatus(msg, isError = false) {
  const el = document.getElementById('upload-status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

async function pollUntilComplete(urn) {
  for (;;) {
    const res = await fetch(`/api/models/${urn}/status`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || data.error || 'status check failed');
    }
    if (data.status === 'complete' || data.status === 'success') {
      return;
    }
    if (data.status === 'failed' || data.status === 'timeout') {
      throw new Error(`translation ${data.status}`);
    }
    const pct = data.progress || '...';
    setStatus(`Translating: ${pct}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function handleUpload() {
  const input = document.getElementById('model-file');
  if (!input.files || input.files.length === 0) {
    setStatus('Choose a file first.', true);
    return;
  }
  const file = input.files[0];
  const form = new FormData();
  form.append('model-file', file);

  setStatus(`Uploading ${file.name}...`);
  try {
    const res = await fetch('/api/models', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || data.error || 'upload failed');
    }
    setStatus('Uploaded. Translating (this can take a minute)...');
    await refreshModels();
    await pollUntilComplete(data.urn);
    setStatus('Translation complete. Loading...');
    loadModel(data.urn);
    setStatus('Done.');
  } catch (err) {
    setStatus(`Error: ${err.message}`, true);
  }
}

// --- Boot ----------------------------------------------------------------

async function checkCredentials() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (!data.credentialsPresent) {
      document.getElementById('creds-banner').classList.remove('hidden');
    }
  } catch {
    /* non-fatal */
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  await checkCredentials();
  document
    .getElementById('upload-btn')
    .addEventListener('click', handleUpload);
  await initViewer();
  await refreshModels();
});
