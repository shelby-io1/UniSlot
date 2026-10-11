"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/admin/actions";
import type { FormState } from "@/lib/admin/entities";

const INITIAL: FormState = {};

export default function AdminLogin() {
  const [state, action, pending] = useActionState(loginAction, INITIAL);

  return (
    <div className="panel admin-login">
      <div className="card">
        <h3>Admin sign in</h3>
        <div style={{ padding: 14 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            Enter the shared admin token to manage programmes, batches, subjects, teachers, rooms
            and periods.
          </p>
          <form action={action} className="admin-form">
            <label className="fld">
              <span>Admin token</span>
              <input
                type="password"
                name="token"
                autoComplete="current-password"
                placeholder="ADMIN_TOKEN"
                required
              />
            </label>
            {state.error ? <div className="note error">{state.error}</div> : null}
            <div>
              <button type="submit" className="btn primary" disabled={pending}>
                {pending ? "Signing in…" : "Sign in"}
              </button>
            </div>
          </form>
        </div>
      </div>
      <p className="foot">
        The token is the same value as the <code>ADMIN_TOKEN</code> environment variable.
      </p>
    </div>
  );
}
