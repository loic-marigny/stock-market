import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles.css'
import App from './App'
import { I18nProvider } from './i18n/I18nProvider'


const basename = (import.meta.env.BASE_URL ?? '/') as string;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <I18nProvider>
        <App />
      </I18nProvider>
    </BrowserRouter>
  </React.StrictMode>
)
