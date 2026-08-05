import { redirect } from "next/navigation";

/** Root route redirects to the daily briefing. */
export default function RootPage() {
  redirect("/briefing");
}
