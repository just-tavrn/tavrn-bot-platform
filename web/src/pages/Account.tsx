// SPDX-License-Identifier: Apache-2.0
/** The account: e-mail change (confirmed by mail), password change (ends the other sessions), deletion. */
import { useState } from "preact/hooks";
import { api, me } from "../api";
import { t } from "../i18n";
import { navigate, useValue } from "../state";
import { Alert, Input, useSubmit } from "./Auth";

export function Account() {
  const user = useValue(me);
  const [email, setEmail] = useState("");
  const [pw1, setPw1] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pw3, setPw3] = useState("");
  const [done, setDone] = useState("");
  const mail = useSubmit(async () => {
    await api("POST", "/me/email", { email, password: pw1 });
    setDone(t("changeEmailSent"));
  });
  const pass = useSubmit(async () => {
    await api("POST", "/me/password", { current, password: next });
    setDone(t("saved"));
  });
  const del = useSubmit(async () => {
    if (!confirm(t("deleteAccountHint"))) return;
    await api("POST", "/me/delete", { password: pw3 });
    me.value = null;
    navigate("/");
  });
  return (
    <div class="mx-auto max-w-xl space-y-6">
      <h1 class="text-xl font-semibold">
        {t("account")} · <span class="text-fg-1">{user?.email}</span>
      </h1>
      <Alert ok text={done} />
      <form class="card space-y-4" onSubmit={mail.submit}>
        <h2 class="font-semibold">{t("changeEmail")}</h2>
        <Input label={t("email")} type="email" value={email} onInput={setEmail} autocomplete="email" />
        <Input label={t("password")} type="password" value={pw1} onInput={setPw1} autocomplete="current-password" />
        <Alert text={mail.error} />
        <button class="btn" disabled={mail.busy}>{t("save")}</button>
      </form>
      <form class="card space-y-4" onSubmit={pass.submit}>
        <h2 class="font-semibold">{t("changePassword")}</h2>
        <Input label={t("currentPassword")} type="password" value={current} onInput={setCurrent} autocomplete="current-password" />
        <Input label={t("newPassword")} type="password" value={next} onInput={setNext} autocomplete="new-password" hint={t("passwordHint")} />
        <Alert text={pass.error} />
        <button class="btn" disabled={pass.busy}>{t("save")}</button>
      </form>
      <form class="card space-y-4 border-danger" onSubmit={del.submit}>
        <h2 class="font-semibold text-danger">{t("deleteAccount")}</h2>
        <p class="text-sm text-fg-2">{t("deleteAccountHint")}</p>
        <Input label={t("password")} type="password" value={pw3} onInput={setPw3} autocomplete="current-password" />
        <Alert text={del.error} />
        <button class="btn btn-danger" disabled={del.busy}>{t("deleteAccount")}</button>
      </form>
    </div>
  );
}
