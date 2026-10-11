"use server";

import { revalidatePath, updateTag } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { safeEqual } from "@/lib/admin/auth";
import { parseEntityForm } from "@/lib/admin/entities";
import type { FormState } from "@/lib/admin/entities";
import { ADMIN_COOKIE, ADMIN_SESSION_MAX_AGE, isAdminAuthenticated } from "@/lib/admin/session";
import { getDb } from "@/lib/db";
import { createEntity, deleteEntity, isAdminEntity, updateEntity } from "@/lib/services/admin";
import { listAuditEntries } from "@/lib/services/audit";
import type { AuditEntry } from "@/lib/services/audit";
import { assignSubjectsToBatch, unassignSubjectFromBatch } from "@/lib/services/batch-subjects";
import { setTheme } from "@/lib/services/settings";
import { THEME_TAG } from "@/lib/services/theme";

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return { error: "Admin is not configured (ADMIN_TOKEN is not set)." };
  const token = String(formData.get("token") ?? "");
  if (!token || !safeEqual(expected, token)) return { error: "Incorrect admin token." };
  (await cookies()).set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: ADMIN_SESSION_MAX_AGE,
  });
  // Re-fetch the route so the server-driven header reflects the new session.
  redirect("/admin");
}

export async function saveEntityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await isAdminAuthenticated())) {
    return { error: "Your session expired. Please sign in again." };
  }
  const entity = String(formData.get("entity") ?? "");
  if (!isAdminEntity(entity)) return { error: "Unknown entity." };

  const idRaw = String(formData.get("id") ?? "").trim();
  const body = parseEntityForm(entity, formData);
  try {
    const db = await getDb();
    if (idRaw) {
      const row = await updateEntity(db, entity, Number(idRaw), body, "admin");
      if (!row) return { error: "That record no longer exists." };
    } else {
      await createEntity(db, entity, body, "admin");
    }
  } catch (error) {
    console.error("admin save failed", error);
    return { error: error instanceof Error ? error.message : "Could not save the record." };
  }
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteEntityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await isAdminAuthenticated())) {
    return { error: "Your session expired. Please sign in again." };
  }
  const entity = String(formData.get("entity") ?? "");
  const id = Number(formData.get("id"));
  if (!isAdminEntity(entity) || !Number.isInteger(id)) {
    return { error: "Invalid delete request." };
  }
  try {
    const db = await getDb();
    const deleted = await deleteEntity(db, entity, id, "admin");
    if (!deleted) return { error: "That record no longer exists." };
  } catch (error) {
    console.error("admin delete failed", error);
    return { error: error instanceof Error ? error.message : "Could not delete the record." };
  }
  revalidatePath("/admin");
  return { ok: true };
}

export async function assignSubjectsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await isAdminAuthenticated())) {
    return { error: "Your session expired. Please sign in again." };
  }
  const batchId = Number(formData.get("batchId"));
  const subjectId = Number(formData.get("subjectId"));
  if (!Number.isInteger(batchId) || !Number.isInteger(subjectId)) {
    return { error: "Invalid assignment request." };
  }
  try {
    const db = await getDb();
    await assignSubjectsToBatch(db, batchId, [subjectId], "admin");
  } catch (error) {
    console.error("assign subject failed", error);
    return { error: error instanceof Error ? error.message : "Could not assign the subject." };
  }
  revalidatePath("/admin");
  return { ok: true };
}

export async function setThemeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await isAdminAuthenticated())) {
    return { error: "Your session expired. Please sign in again." };
  }
  const theme = String(formData.get("theme") ?? "");
  try {
    const db = await getDb();
    await setTheme(db, theme, "admin");
  } catch (error) {
    console.error("set theme failed", error);
    return { error: error instanceof Error ? error.message : "Could not change the theme." };
  }
  // Themes are cached in the static shell; expire the tag so the next render
  // (this action's response, and any page load) picks up the new value.
  updateTag(THEME_TAG);
  return { ok: true };
}

export type AuditLoadState = {
  entries?: AuditEntry[];
  nextId?: number | null;
  error?: string;
};

/** Loads the next (older) page of the audit log for the "Load older" button. */
export async function loadAuditAction(
  _prev: AuditLoadState,
  formData: FormData,
): Promise<AuditLoadState> {
  if (!(await isAdminAuthenticated())) {
    return { error: "Your session expired. Please sign in again." };
  }
  const raw = String(formData.get("before") ?? "").trim();
  let beforeId: number | undefined;
  if (raw) {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) return { error: "Invalid audit cursor." };
    beforeId = parsed;
  }
  try {
    const db = await getDb();
    const page = await listAuditEntries(db, { beforeId });
    return { entries: page.entries, nextId: page.nextId };
  } catch (error) {
    console.error("load audit failed", error);
    return { error: "Could not load more audit entries." };
  }
}

export async function unassignSubjectAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await isAdminAuthenticated())) {
    return { error: "Your session expired. Please sign in again." };
  }
  const batchId = Number(formData.get("batchId"));
  const subjectId = Number(formData.get("subjectId"));
  if (!Number.isInteger(batchId) || !Number.isInteger(subjectId)) {
    return { error: "Invalid unassign request." };
  }
  try {
    const db = await getDb();
    const removed = await unassignSubjectFromBatch(db, batchId, subjectId, "admin");
    if (!removed) return { error: "That subject is not assigned to this batch." };
  } catch (error) {
    console.error("unassign subject failed", error);
    return { error: error instanceof Error ? error.message : "Could not remove the subject." };
  }
  revalidatePath("/admin");
  return { ok: true };
}
