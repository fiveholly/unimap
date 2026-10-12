import type { Metadata } from "next";

import { NotificationList, NotificationsTitle } from "@/components/Notifications";

export const metadata: Metadata = { title: "通知 · unimap" };

export default function NotificationsPage() {
  return (
    <div className="page narrow notifications-page">
      <NotificationsTitle />
      <NotificationList />
    </div>
  );
}
