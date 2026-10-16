// SPDX-License-Identifier: Apache-2.0
/** Layout, navigation and the routes of the dashboard. */
import type { ComponentChildren } from "preact";
import { api, me } from "./api";
import { lang, t, toggleLang } from "./i18n";
import { Account } from "./pages/Account";
import { Admin } from "./pages/Admin";
import { Confirm, Login, Register, Reset } from "./pages/Auth";
import { Dashboard } from "./pages/Dashboard";
import { Landing } from "./pages/Landing";
import { PublicLeaderboard } from "./pages/Leaderboard";
import { RoomPage } from "./pages/Room";
import { navigate, path, useValue } from "./state";

export function Link({ href, children, class: cls }: { href: string; children: ComponentChildren; class?: string }) {
  return (
    <a
      href={href}
      class={cls ?? "link"}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

function route(p: string) {
  const [pathname, query = ""] = p.split("?");
  const q = new URLSearchParams(query);
  const parts = (pathname ?? "/").split("/").filter(Boolean);
  if (!parts.length) return <Landing />;
  switch (parts[0]) {
    case "login":
      return <Login />;
    case "register":
      return <Register />;
    case "confirm":
      return <Confirm token={q.get("token") ?? ""} />;
    case "reset":
      return <Reset token={q.get("token") ?? ""} />;
    case "leaderboard":
      return <PublicLeaderboard id={parts[1] ?? ""} />;
  }
  const user = me.value;
  if (user === undefined) return <p class="text-fg-2">…</p>;
  if (user === null) return <Login />;
  switch (parts[0]) {
    case "dashboard":
      return <Dashboard />;
    case "rooms":
      return <RoomPage id={parts[1] ?? ""} tab={parts[2] ?? ""} />;
    case "account":
      return <Account />;
    case "admin":
      return <Admin />;
  }
  return <p>{t("notFound")}</p>;
}

export function App() {
  const p = useValue(path);
  useValue(lang);
  const user = useValue(me);
  const logout = async () => {
    await api("POST", "/auth/logout");
    me.value = null;
    navigate("/");
  };
  return (
    <div class="min-h-screen bg-bg-0">
      <header class="border-b border-line bg-bg-1">
        <nav class="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" aria-label="Main">
          <Link href={user ? "/dashboard" : "/"} class="mr-auto text-lg font-semibold text-fg-0">
            <span class="text-accent">tavrn</span> bot
          </Link>
          {user && <Link href="/dashboard">{t("dashboard")}</Link>}
          {user && <Link href="/account">{t("account")}</Link>}
          {user?.admin && <Link href="/admin">{t("admin")}</Link>}
          <button type="button" class="btn min-h-10" onClick={toggleLang} lang={lang.value === "en" ? "de" : "en"}>
            {t("language")}
          </button>
          {user ? (
            <button type="button" class="btn" onClick={logout}>
              {t("logout")}
            </button>
          ) : (
            <Link href="/login" class="btn">
              {t("login")}
            </Link>
          )}
        </nav>
      </header>
      <main class="mx-auto max-w-5xl px-4 py-6">{route(p)}</main>
    </div>
  );
}
