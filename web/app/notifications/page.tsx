import type { Metadata } from "next";

import { NotificationList } from "@/components/Notifications";

export const metadata: Metadata = { title: "通知 · unimap" };

export default function NotificationsPage() {
  return (
    <div className="page narrow notifications-page">
      <h1>通知</h1>
      <NotificationList />
    </div>
  );
}
