import { Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { Shell } from "@/components/Shell";
import { UploadModalProvider } from "@/components/UploadImeiModal";
import { LoginPage } from "@/pages/LoginPage";
import { DevicesByStatePage } from "@/pages/DevicesByStatePage";
import { DeviceDetailPage } from "@/pages/DeviceDetailPage";
import { UploadHistoryPage } from "@/pages/UploadHistoryPage";
import { ConfigStatesPage } from "@/pages/ConfigStatesPage";
import { ConfigActionsPage } from "@/pages/ConfigActionsPage";
import { TemplatesPage } from "@/pages/TemplatesPage";
import { TacsPage } from "@/pages/TacsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <UploadModalProvider>
              <Shell />
            </UploadModalProvider>
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/devices" replace />} />
        <Route path="devices" element={<DevicesByStatePage />} />
        <Route path="devices/:id" element={<DeviceDetailPage />} />
        <Route path="upload/history" element={<UploadHistoryPage />} />
        <Route path="config/states" element={<ConfigStatesPage />} />
        <Route path="config/actions" element={<ConfigActionsPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="tacs" element={<TacsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/devices" replace />} />
    </Routes>
  );
}
