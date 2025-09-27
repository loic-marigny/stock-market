import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles.css'
import App from './App'
import { I18nProvider } from './i18n/I18nProvider'

const rawBase = ((import.meta as any)?.env?.BASE_URL ?? '/') as string;
const basename = (rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase) || '/';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <I18nProvider>
        <App />
      </I18nProvider>
    </BrowserRouter>
  </React.StrictMode>
)
