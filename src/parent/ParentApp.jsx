import { Navigate, Route, Routes } from "react-router-dom";

import NavigationPage from "./pages/jsx/NavigationPage.jsx";
import WelcomePage from "./pages/jsx/WelcomePage.jsx";

function ParentApp() {
  return (
    <Routes>
      <Route path="/" element={<WelcomePage />} />
      <Route path="/navigation" element={<NavigationPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default ParentApp;
