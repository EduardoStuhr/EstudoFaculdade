"use client";
import { useState } from "react";

type Mode = "login" | "register" | "resend-verification" | "forgot-password" | "verify-email" | "reset-password";
export type AuthLink = { mode: "verify-email" | "reset-password"; token: string };
const titles: Record<Mode, string> = {
  login: "Entre no seu caderno", register: "Crie sua conta",
  "resend-verification": "Confirme seu e-mail", "forgot-password": "Recupere sua senha",
  "verify-email": "Ative sua conta", "reset-password": "Escolha uma nova senha",
};
const actions: Record<Mode, string> = {
  login: "Entrar", register: "Criar conta", "resend-verification": "Reenviar confirmação",
  "forgot-password": "Enviar link de recuperação", "verify-email": "Confirmar e-mail e ativar",
  "reset-password": "Salvar nova senha",
};

export function AuthForm({ onAuthenticated, link }: { onAuthenticated: () => void; link: AuthLink | null }) {
  const [mode, setMode] = useState<Mode>(link?.mode ?? "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const tokenMode = mode === "verify-email" || mode === "reset-password";
  const newPassword = mode === "register" || tokenMode;
  const needsPassword = mode === "login" || newPassword;
  function navigate(next: Mode) {
    setMode(next); setPassword(""); setConfirmation(""); setError(""); setMessage("");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (Date.now() < retryAt) {
      setError(`Aguarde ${Math.ceil((retryAt - Date.now()) / 1000)} segundos antes de tentar novamente.`); return;
    }
    if (newPassword && password !== confirmation) { setError("As senhas não coincidem."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tokenMode ? { token: link?.token, password }
          : mode === "register" ? { name, email, password }
          : mode === "login" ? { email, password } : { email }),
      });
      const data = await response.json() as { error?: string; code?: string; message?: string };
      if (!response.ok) {
        if (response.status === 429) setRetryAt(Date.now() + Number(response.headers.get("Retry-After") || 900) * 1000);
        if (data.code === "EMAIL_NOT_VERIFIED") { setMode("resend-verification"); setPassword(""); }
        throw new Error(data.error || "Não foi possível continuar.");
      }
      if (mode === "login") { onAuthenticated(); return; }
      setMessage(data.message || "Verifique sua caixa de entrada.");
      setPassword(""); setConfirmation("");
      if (mode === "register") setMode("resend-verification");
      if (tokenMode) setMode("login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível continuar.");
    } finally { setBusy(false); }
  }
  return (
    <main className="workspace">
      <div className="main-content">
        <article className="paper subject-dialog auth-card">
          <p className="eyebrow">CADERNO DIGITAL</p>
          <h1>{titles[mode]}<span className="heading-dot">.</span></h1>
          <p className="subtitle">{mode === "verify-email"
            ? "Para confirmar a propriedade deste e-mail, defina a senha que você usará. Ela substituirá a informada no cadastro."
            : "Suas matérias e anotações ficam separadas e protegidas."}</p>
          {error && <p className="error-box" role="alert">{error}</p>}
          {message && <p className="auth-status" role="status">{message}</p>}
          <form onSubmit={submit} aria-busy={busy}>
            <fieldset disabled={busy}>
              {mode === "register" && <>
                <label htmlFor="auth-name">Seu nome</label>
                <input id="auth-name" autoComplete="name" required maxLength={100} value={name} onChange={e => setName(e.target.value)} />
              </>}
              {!tokenMode && <>
                <label htmlFor="auth-email">E-mail</label>
                <input id="auth-email" autoComplete="email" required type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} />
              </>}
              {needsPassword && <>
                <label htmlFor="auth-password">{newPassword ? "Defina sua senha" : "Senha"}</label>
                <input id="auth-password" autoComplete={newPassword ? "new-password" : "current-password"}
                  required minLength={newPassword ? 12 : 1} maxLength={200} type="password"
                  aria-describedby={newPassword ? "auth-password-help" : undefined}
                  value={password} onChange={e => setPassword(e.target.value)} />
              </>}
              {newPassword && <>
                <p id="auth-password-help" className="auth-help">Use de 12 a 200 caracteres. Uma frase longa é uma boa opção.</p>
                <label htmlFor="auth-confirm">Confirme a senha</label>
                <input id="auth-confirm" autoComplete="new-password" required minLength={12} maxLength={200}
                  type="password" value={confirmation} onChange={e => setConfirmation(e.target.value)} />
              </>}
              <button className="btn primary w-full" type="submit" disabled={busy}>{busy ? "Aguarde…" : actions[mode]}</button>
            </fieldset>
          </form>
          <nav className="auth-actions" aria-label="Opções de acesso">
            {mode !== "login" && <button className="text-button" type="button" disabled={busy} onClick={() => navigate("login")}>Voltar para entrar</button>}
            {mode === "login" && <>
              <button className="text-button" type="button" disabled={busy} onClick={() => navigate("register")}>Quero criar uma conta</button>
              <button className="text-button" type="button" disabled={busy} onClick={() => navigate("forgot-password")}>Esqueci minha senha</button>
            </>}
            {mode !== "resend-verification" && <button className="text-button" type="button" disabled={busy} onClick={() => navigate("resend-verification")}>Reenviar confirmação de e-mail</button>}
            {mode === "reset-password" && <button className="text-button" type="button" disabled={busy} onClick={() => navigate("forgot-password")}>Solicitar novo link de recuperação</button>}
          </nav>
        </article>
      </div>
    </main>
  );
}

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div>
    <button className="text-button" type="button" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try {
        const response = await fetch("/api/auth/logout", { method: "POST" });
        if (!response.ok) throw new Error();
        window.location.replace("/");
      } catch { setError("Não foi possível sair. Tente novamente."); setBusy(false); }
    }}>{busy ? "Saindo…" : "Sair da conta"}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
