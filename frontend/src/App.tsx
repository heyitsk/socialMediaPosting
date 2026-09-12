import { Route, Routes } from "react-router";
import { ComposerPage } from "@/routes/composer";
import { DashboardPage } from "@/routes/dashboard";
import { HistoryPage } from "@/routes/history";
import { AppLayout } from "@/routes/layout";
import { LoginPage } from "@/routes/login";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="composer" element={<ComposerPage />} />
        <Route path="history" element={<HistoryPage />} />
      </Route>
    </Routes>
  );
}
