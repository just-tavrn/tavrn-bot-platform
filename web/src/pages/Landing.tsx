// SPDX-License-Identifier: Apache-2.0
import { config, me } from "../api";
import { Link } from "../app";
import { t } from "../i18n";
import { useValue } from "../state";

export function Landing() {
  const cfg = useValue(config);
  const user = useValue(me);
  return (
    <section class="py-10">
      <h1 class="max-w-2xl text-3xl font-bold sm:text-4xl">{t("appName")}</h1>
      <p class="mt-4 max-w-2xl text-lg text-fg-1">{t("tagline")}</p>
      <p class="mt-3 max-w-2xl text-sm text-fg-2">{t("features")}</p>
      <div class="mt-8 flex flex-wrap gap-3">
        {cfg?.addLink && (
          <a class="btn btn-primary" href={cfg.addLink} rel="noopener">
            {t("addToRoom")}
          </a>
        )}
        {user ? (
          <Link href="/dashboard" class="btn">
            {t("dashboard")}
          </Link>
        ) : (
          <>
            <Link href="/register" class="btn">
              {t("register")}
            </Link>
            <Link href="/login" class="btn">
              {t("login")}
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
