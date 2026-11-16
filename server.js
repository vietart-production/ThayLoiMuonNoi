require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRouter = require('./src/routes');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // serves index.html, dat-don.html, assets/, etc. straight from repo root
app.use('/api', apiRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on :${port}`));
