import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AdminLlmPage() {
  redirect("/admin/connections?tab=llm");
}
