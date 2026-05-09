import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { useEffect } from 'react'

import MessengerApp from './messenger/MessengerApp.jsx'
import ParentApp from './parent/ParentApp.jsx'
import { wakeupAllServices } from './lib/wakeupServices'

function App() {
  useEffect(() => {
    // Wake up backend services on app initialization
    wakeupAllServices()
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/messenger/*" element={<MessengerApp />} />
        <Route path="/*" element={<ParentApp />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
