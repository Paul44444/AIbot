import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import "./utils/posthog";
//import "./lib/posthog"

import posthog from "posthog-js";

posthog.init(
    "phc_1HiV35YJIIU8z4K0tp4SCkviladPieFdmj3nHh1k8Ns",
    {
        api_host: "https://eu.posthog.com",
        capture_pageview: true
    }
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
