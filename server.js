require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
// Frontend lives on Firebase Hosting, a different origin — only it (plus local dev via
// VS Code's Live Server, default port 5500) may call this API.
app.use(cors({ origin: [
  'https://thayloimuonnoi-8d725.web.app',
  'https://thayloimuonnoi-8d725.firebaseapp.com',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
] }));
// 1 MB, not express's 100 KB default: a freelancer's ~20 s voice demo arrives as a base64
// data URL (src/db.js caps it at 600k characters).
app.use(express.json({ limit: '1mb' }));
app.get('/healthz', (req, res) => res.send('ok'));

try {
  app.use('/api', require('./src/routes'));
} catch (e) {
  // Missing/invalid env vars (Firebase service account, payOS keys) shouldn't take down the
  // whole server — /healthz must keep working while that gets fixed.
  console.error('API not mounted:', e.message);
  app.use('/api', (req, res) => res.status(503).json({ error: 'Backend chưa cấu hình xong (thiếu biến môi trường). Xem logs.' }));
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on :${port}`));
