import Link from "next/link";
import { Brand } from "@/components/ui";

export default function NotFound() {
  return (
    <>
      <Brand />
      <div className="center-screen">
        <h1>Page not found</h1>
        <Link className="btn btn-primary" href="/">
          Go to the join page
        </Link>
      </div>
    </>
  );
}
