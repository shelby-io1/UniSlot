import { describe, expect, it } from "vitest";
import { ENTITY_SCHEMAS, parseEntityForm } from "@/lib/admin/entities";
import { ADMIN_ENTITIES } from "@/lib/services/admin";

describe("entity schemas", () => {
  it("covers every admin entity exactly once", () => {
    expect(ENTITY_SCHEMAS.map((s) => s.key).sort()).toEqual([...ADMIN_ENTITIES].sort());
  });

  it("references valid entities and fields for primary/summary", () => {
    const keys = new Set(ENTITY_SCHEMAS.map((s) => s.key));
    for (const schema of ENTITY_SCHEMAS) {
      const names = schema.fields.map((f) => f.name);
      expect(names).toContain(schema.primary);
      for (const name of schema.summaryFields) expect(names).toContain(name);
      for (const field of schema.fields) {
        if (field.type === "reference") {
          expect(field.reference).toBeDefined();
          expect(keys.has(field.reference!)).toBe(true);
        }
      }
    }
  });
});

describe("parseEntityForm", () => {
  it("parses text, number, checkbox and reference fields", () => {
    const form = new FormData();
    form.set("name", "CR-101");
    form.set("kind", "lab");
    const body = parseEntityForm("rooms", form);
    expect(body).toEqual({ name: "CR-101", kind: "lab" });
  });

  it("always emits booleans for checkboxes (unchecked -> false)", () => {
    const checked = new FormData();
    checked.set("isWorking", "on");
    expect(parseEntityForm("working-days", checked).isWorking).toBe(true);

    const unchecked = new FormData();
    unchecked.set("name", "Sunday");
    expect(parseEntityForm("working-days", unchecked).isWorking).toBe(false);
  });

  it("converts numbers and omits empty numeric/reference fields", () => {
    const form = new FormData();
    form.set("programId", "7");
    form.set("semesterNumber", "4");
    form.set("label", "BSCS-4A");
    expect(parseEntityForm("batches", form)).toEqual({
      programId: 7,
      semesterNumber: 4,
      label: "BSCS-4A",
    });

    const sparse = new FormData();
    sparse.set("title", "Data Structures");
    sparse.set("creditHours", "");
    expect(parseEntityForm("subjects", sparse)).toEqual({ title: "Data Structures" });
  });

  it("keeps empty text so optional fields are cleared and required ones fail server-side", () => {
    const form = new FormData();
    form.set("title", "Algorithms");
    form.set("code", "");
    form.set("category", "");
    expect(parseEntityForm("subjects", form)).toEqual({
      title: "Algorithms",
      code: "",
      category: "",
    });
  });
});
