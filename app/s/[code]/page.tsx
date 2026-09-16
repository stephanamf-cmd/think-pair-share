import StudentRoom from "@/components/StudentRoom";
import { normaliseCode } from "@/lib/ids";

export const metadata = { title: "Your class" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <StudentRoom code={normaliseCode(code)} />;
}
