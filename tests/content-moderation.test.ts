import { describe, it, expect } from "vitest";
import { moderate } from "../src/lib/content-moderation";

describe("content moderation [Master_Prompt v7.0 §13.4]", () => {
  it("blocks hard-keyword text", async () => {
    const r = await moderate({}, { text: "go fuck yourself", field: "review.body" });
    expect(r.decision).toBe("block");
    expect(r.reasons.some(x => x.startsWith("hard"))).toBe(true);
  });

  it("quarantines PII", async () => {
    const r = await moderate({}, { text: "email me at jane@example.com", field: "contact.message" });
    expect(r.decision).toBe("quarantine");
    expect(r.reasons.some(x => x.includes("email"))).toBe(true);
  });

  it("blocks phone numbers", async () => {
    const r = await moderate({}, { text: "call me at 01712345678", field: "contact.message" });
    expect(r.decision).toBe("quarantine");
  });

  it("blocks URLs in user content", async () => {
    const r = await moderate({}, { text: "see https://example.com for more", field: "review.body" });
    expect(r.decision).toBe("quarantine");
  });

  it("blocks credit card numbers", async () => {
    const r = await moderate({}, { text: "card is 4111 1111 1111 1111", field: "contact.message" });
    expect(r.decision).toBe("quarantine");
  });

  it("blocks vendor pitches", async () => {
    const r = await moderate({}, { text: "I'm a dropshipper looking for wholesale price", field: "review.body" });
    expect(r.decision).toBe("block");
  });

  it("blocks empty content", async () => {
    const r = await moderate({}, { text: "", field: "review.body" });
    expect(r.decision).toBe("block");
  });

  it("allows clean text", async () => {
    const r = await moderate({}, { text: "Beautiful saree, fast delivery. Recommended.", field: "review.body" });
    expect(r.decision).toBe("allow");
  });
});
