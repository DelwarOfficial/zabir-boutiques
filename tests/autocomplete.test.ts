import { describe, it, expect, vi, beforeEach } from "vitest";
import { addProduct, autocomplete, triGrams } from "../src/lib/autocomplete-index";

class FakeKV implements KVNamespace {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<unknown> {
    const v = this.store.get(key);
    if (v == null) return null;
    if (type === "json") return JSON.parse(v);
    return v;
  }
  async put(key: string, value: string, _opts?: { expirationTtl?: number; metadata?: unknown }): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  list(_opts?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor: string }> {
    return Promise.resolve({ keys: [], list_complete: true, cursor: "" });
  }
  getWithMetadata(): Promise<{ value: string | null; metadata: unknown }> {
    return Promise.resolve({ value: null, metadata: null });
  }
}

describe("autocomplete index [Master_Prompt v7.0 §13.2]", () => {
  let kv: FakeKV;
  let env: { DB: D1Database; CACHE: FakeKV };

  beforeEach(() => {
    kv = new FakeKV();
    env = { DB: {} as D1Database, CACHE: kv };
  });

  it("extracts tri-grams from a name", () => {
    expect(triGrams("Saree")).toEqual(expect.arrayContaining(["sar", "are", "ree", "saree"]));
  });

  it("adds a product and finds it by exact prefix", async () => {
    await addProduct(env, { id: "p1", name: "Banarasi Saree Red" });
    const r = await autocomplete({ CACHE: kv }, "Ban");
    expect(r.map(x => x.id)).toContain("p1");
  });

  it("ranks products with more matching tri-grams higher", async () => {
    await addProduct(env, { id: "p1", name: "Red Banarasi Saree" });
    await addProduct(env, { id: "p2", name: "Saree Indian" });
    const r = await autocomplete({ CACHE: kv }, "Banarasi");
    expect(r[0]?.id).toBe("p1");
  });

  it("returns empty list for empty query", async () => {
    const r = await autocomplete({ CACHE: kv }, "");
    expect(r).toEqual([]);
  });

  it("caps results at the requested limit", async () => {
    for (let i = 0; i < 20; i++) {
      await addProduct(env, { id: `p${i}`, name: `Cotton Saree ${i}` });
    }
    const r = await autocomplete({ CACHE: kv }, "cot", 5);
    expect(r.length).toBeLessThanOrEqual(5);
  });
});
