import { BrowserRouter, Route, Routes } from 'react-router-dom'

import MessengerApp from './messenger/MessengerApp.jsx'
import ParentApp from './parent/ParentApp.jsx'

function App() {
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
