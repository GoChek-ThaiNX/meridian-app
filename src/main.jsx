import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './GoChek_CRM_V12.jsx'
import './index.css'
import { initDevToolsGuard } from './devtools-guard.js'

// Chỉ bật guard ở production
if (import.meta.env.PROD) {
  initDevToolsGuard();
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
