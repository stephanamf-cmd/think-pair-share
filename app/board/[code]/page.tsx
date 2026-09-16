import Board from "@/components/Board";
import { normaliseCode } from "@/lib/ids";

export const metadata = { title: "Board" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <Board code={normaliseCode(code)} />;
}
