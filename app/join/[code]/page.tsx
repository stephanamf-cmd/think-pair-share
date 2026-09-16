import { redirect } from "next/navigation";
import { normaliseCode } from "@/lib/ids";

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  redirect(`/s/${normaliseCode(code)}`);
}
