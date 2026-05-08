import { Navigate, Route, Routes } from "react-router-dom";

import MessengerInboxListener from "./MessengerInboxListener.jsx";
import RoomListPage from "./pages/jsx/RoomListPage.jsx";

function MessengerApp() {
  return (
    <>
      <MessengerInboxListener />
      <Routes>
        <Route path="/" element={<Navigate to="/messenger/rooms" replace />} />
        <Route path="/rooms" element={<RoomListPage />} />
        <Route path="*" element={<Navigate to="/messenger/rooms" replace />} />
      </Routes>
    </>
  );
}

export default MessengerApp;
