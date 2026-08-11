import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT, credentialsPresent } from './config.js';
import {
  getViewerToken,
  ensureBucket,
  uploadModel,
  urnFor,
  translate,
  manifest,
  listModels,
} from './aps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Serve the front-end.
app.use(express.static(path.join(__dirname, 'public')));

// Expose whether credentials are configured so the UI can show a banner.
app.get('/api/config', (req, res) => {
  res.json({ credentialsPresent });
});

// Public viewer token for the browser-side Autodesk Viewer.
app.get('/api/auth/token', async (req, res) => {
  try {
    const token = await getViewerToken();
    res.json(token);
  } catch (err) {
    res.status(500).json({
      error: 'Could not obtain a viewer token.',
      detail: err.message,
    });
  }
});

// List translated/uploaded models in the bucket.
app.get('/api/models', async (req, res) => {
  try {
    const models = await listModels();
    res.json(models);
  } catch (err) {
    res.status(500).json({ error: 'Could not list models.', detail: err.message });
  }
});

// Upload a model: ensure bucket -> upload bytes -> start translation.
app.post('/api/models', upload.single('model-file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided (field "model-file").' });
    }
    const objectKey = req.file.originalname;
    await ensureBucket();
    const objectId = await uploadModel(objectKey, req.file.buffer);
    const urn = urnFor(objectId);
    await translate(urn);
    res.json({ name: objectKey, urn });
  } catch (err) {
    res.status(500).json({ error: 'Upload/translation failed.', detail: err.message });
  }
});

// Translation status for a given URN.
app.get('/api/models/:urn/status', async (req, res) => {
  try {
    const status = await manifest(req.params.urn);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Could not read manifest.', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`APS AWS demo listening at http://localhost:${PORT}`);
  if (!credentialsPresent) {
    console.log(
      '[server] Running without APS credentials -- add them to .env to enable ' +
        'uploads, translation, and viewing.'
    );
  }
});
