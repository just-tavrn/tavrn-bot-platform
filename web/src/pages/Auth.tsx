// SPDX-License-Identifier: Apache-2.0
/** Log in, register, confirm the address, reset the password. */
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api, config, loadSession } from "../api";
import { Link } from "../app";
import { t } from "../i18n";
import { navigate } from "../state";

export function Box({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="card mx-auto max-w-md">
      <h1 class="mb-4 text-xl font-semibold">{title}</h1>
      {children}
    </section>
  );
}

export function Input({ label, type = "text", value, onInput, autocomplete, hint }: { label: string; type?: string; value: string; onInput: (v: string) => void; autocomplete?: string; hint?: string }) {
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label for={id} class="mb-1 block text-sm font-medium text-fg-1">
        {label}
      </label>
      <input id={id} class="input" type={type} value={value} required autocomplete={autocomplete} aria-describedby={hint ? `${id}-hint` : undefined} onInput={(e) => onInput(e.currentTarget.value)} />
      {hint && <p id={`${id}-hint`} class="mt-1 text-xs text-fg-2">{hint}</p>}
    </div>
  );
}

/** A form that posts and shows the server's answer or error. */
function useSubmit(run: () => Promise<unknown>) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await run();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, submit };
}
const Alert = ({ text, ok }: { text: string; ok?: boolean }) => (text ? <p role={ok ? "status" : "alert"} class={`text-sm ${ok ? "text-ok" : "text-danger"}`}>{text}</p> : null);

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { error, busy, submit } = useSubmit(async () => {
    await api("POST", "/auth/login", { email, password });
    await loadSession();
    navigate("/dashboard");
  });
  return (
    <Box title={t("login")}>
      <form class="space-y-4" onSubmit={submit}>
        <Input label={t("email")} type="email" value={email} onInput={setEmail} autocomplete="email" />
        <Input label={t("password")} type="password" value={password} onInput={setPassword} autocomplete="current-password" />
        <Alert text={error} />
        <button class="btn btn-primary w-full" disabled={busy}>
          {t("login")}
        </button>
      </form>
      <p class="mt-4 text-sm">
        <Link href="/reset">{t("forgot")}</Link> · {t("noAccount")} <Link href="/register">{t("register")}</Link>
      </p>
    </Box>
  );
}

export function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const { error, busy, submit } = useSubmit(async () => {
    await api("POST", "/auth/register", { email, password });
    setDone(true);
  });
  return (
    <Box title={t("register")}>
      {done ? (
        <div class="space-y-2">
          <Alert ok text={t("checkMail")} />
          {config.value && !config.value.mailConfigured && <p class="text-sm text-warn">{t("mailOff")}</p>}
        </div>
      ) : (
        <form class="space-y-4" onSubmit={submit}>
          <Input label={t("email")} type="email" value={email} onInput={setEmail} autocomplete="email" />
          <Input label={t("password")} type="password" value={password} onInput={setPassword} autocomplete="new-password" hint={t("passwordHint")} />
          <Alert text={error} />
          <button class="btn btn-primary w-full" disabled={busy}>
            {t("register")}
          </button>
          <p class="text-sm">
            {t("haveAccount")} <Link href="/login">{t("login")}</Link>
          </p>
        </form>
      )}
    </Box>
  );
}

export function Confirm({ token }: { token: string }) {
  const [state, setState] = useState<{ ok: boolean; text: string }>({ ok: true, text: t("confirming") });
  useEffect(() => {
    api<{ kind: string }>("POST", "/auth/confirm", { token })
      .then(async (r) => {
        setState({ ok: true, text: t("confirmed") });
        await loadSession();
        if (r.kind === "confirm") navigate("/dashboard");
      })
      .catch((e: Error) => setState({ ok: false, text: e.message }));
  }, [token]);
  return (
    <Box title={t("email")}>
      <Alert ok={state.ok} text={state.text} />
    </Box>
  );
}

export function Reset({ token }: { token: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState("");
  const { error, busy, submit } = useSubmit(async () => {
    if (token) await api("POST", "/auth/reset", { token, password });
    else await api("POST", "/auth/reset-request", { email });
    setDone(token ? t("resetDone") : t("resetSent"));
  });
  return (
    <Box title={t("resetTitle")}>
      {done ? (
        <div class="space-y-3">
          <Alert ok text={done} />
          {token && <Link href="/login">{t("login")}</Link>}
        </div>
      ) : (
        <form class="space-y-4" onSubmit={submit}>
          {token ? <Input label={t("newPassword")} type="password" value={password} onInput={setPassword} autocomplete="new-password" hint={t("passwordHint")} /> : <Input label={t("email")} type="email" value={email} onInput={setEmail} autocomplete="email" />}
          <Alert text={error} />
          <button class="btn btn-primary w-full" disabled={busy}>
            {t("send")}
          </button>
        </form>
      )}
    </Box>
  );
}

export { Alert, useSubmit };
