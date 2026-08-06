import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import './mobile-navigation.css'
import './logo-visibility.css'

const root = document.getElementById('root')
if (!root) throw new Error('Portal-Wurzelelement fehlt.')
createRoot(root).render(<App />)
