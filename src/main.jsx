import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import SupplyChainApp from './supply-chain-prototype.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* <App /> */}
    <SupplyChainApp />
  </React.StrictMode>,
)
