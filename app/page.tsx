import Link from "next/link";
import { Brand } from "@/components/ui";
import JoinForm from "@/components/JoinForm";
import HeroArt from "@/components/HeroArt";

export default function Home() {
  return (
    <>
      <Brand>
        <Link href="/teach" className="btn btn-ghost btn-sm">
          I&apos;m a teacher
        </Link>
      </Brand>
      <main className="container">
        <section className="hero">
          <div>
            <h1>
              Think. Pair. Share. <span>Link.</span>
            </h1>
            <p className="hero-lead">
              Write your ideas, talk them through with a partner, then watch the whole class&apos;s thinking connect
              on one live map.
            </p>
            <div className="card join-card">
              <h2>Join your class</h2>
              <JoinForm />
            </div>
          </div>
          <div className="hero-art" aria-hidden>
            <HeroArt />
          </div>
        </section>

        <section className="steps-list" aria-label="How it works">
          <div className="card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/hpl-meta-thinking.png" alt="" />
            <div>
              <h3>1 · Think</h3>
              <p className="muted small">On your own. Your ideas stay private until the Share phase.</p>
            </div>
          </div>
          <div className="card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/hpl-empathetic.png" alt="" />
            <div>
              <h3>2 · Pair</h3>
              <p className="muted small">Read your partner&apos;s ideas, improve them together and link them.</p>
            </div>
          </div>
          <div className="card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/hpl-linking.png" alt="" />
            <div>
              <h3>3 · Share</h3>
              <p className="muted small">Every idea appears on the class graph. Connect yours to others.</p>
            </div>
          </div>
        </section>
      </main>
      <footer className="footer">Network International School · Yangon</footer>
    </>
  );
}
