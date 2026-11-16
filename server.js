require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.get('/healthz', (req, res) => res.send('ok'));
app.use(express.static(__dirname)); // serves index.html, dat-don.html, assets/, etc. straight from repo root

try {
  app.use('/api', require('./src/routes'));
} catch (e) {
  // Missing/invalid env vars (Firebase service account, payOS keys) shouldn't take down the
  // whole server — the static site and /healthz must keep working while that gets fixed.
  console.error('API not mounted:', e.message);
  app.use('/api', (req, res) => res.status(503).json({ error: 'Backend chưa cấu hình xong (thiếu biến môi trường). Xem logs.' }));
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on :${port}`));
