// ConnectSukuu API endpoint selection. Local development uses the local API;
// deployed frontends use the production Render API.
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:4000'
  : 'https://connectsukuu.onrender.com';
window.API_BASE = API_BASE;
