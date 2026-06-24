const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const port = process.env.PORT || 3001;

app.use('/api', createProxyMiddleware({
  target: process.env.API_GATEWAY_URL || 'http://nginx:80',
  changeOrigin: true,
  pathRewrite: (path) => '/api' + path,
}));

app.use('/config', createProxyMiddleware({
  target: process.env.CONFIG_SERVICE_URL || 'http://config-service:4000',
  changeOrigin: true,
  pathRewrite: (path) => '/config' + path,
}));

app.use('/prometheus', createProxyMiddleware({
  target: process.env.PROMETHEUS_URL || 'http://prometheus:9090',
  changeOrigin: true,
}));

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Dashboard running on port ${port}`);
});
