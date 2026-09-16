import TeacherDashboard from "@/components/TeacherDashboard";
import { normaliseCode } from "@/lib/ids";

export const metadata = { title: "Teacher dashboard" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <TeacherDashboard code={normaliseCode(code)} />;
}
