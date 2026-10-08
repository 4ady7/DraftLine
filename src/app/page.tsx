import Link from "next/link";
import { HomeScreen } from "@/components/home-screen";

export default function HomePage() {
  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/">
          <strong>Draftline</strong>
          <span>Editorial workflow</span>
        </Link>
      </header>
      <HomeScreen />
    </>
  );
}
