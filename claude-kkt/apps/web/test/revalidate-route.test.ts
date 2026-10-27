import { afterEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag, revalidatePath, unstable_cache: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));

const { POST } = await import("@/app/api/revalidate/route");

const SECRET = "s".repeat(40);
const call = (body: unknown, token?: string) =>
  POST(
    new Request("http://web/api/revalidate", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-kkt-revalidate-token": token } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("POST /api/revalidate (on-demand ISR, called by the API after CMS writes)", () => {
  afterEach(() => {
    delete process.env.WEB_REVALIDATE_TOKEN;
    revalidateTag.mockReset();
    revalidatePath.mockReset();
  });

  it("is off (404) when no secret is configured", async () => {
    expect((await call({}, SECRET)).status).toBe(404);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong token (401)", async () => {
    process.env.WEB_REVALIDATE_TOKEN = SECRET;
    expect((await call({})).status).toBe(401);
    expect((await call({}, `${SECRET}x`)).status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("purges the kkt-public tag by default and re-renders the whole site; filters junk tags and paths", async () => {
    process.env.WEB_REVALIDATE_TOKEN = SECRET;
    const ok = await call({}, SECRET);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ revalidated: true, tags: ["kkt-public"] });
    expect(revalidateTag).toHaveBeenCalledWith("kkt-public");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    revalidateTag.mockReset();
    const custom = await call(
      { tags: ["project:sgh", "bad tag!", 7], paths: ["/projects/sgh", "javascript:x"] },
      SECRET,
    );
    expect(await custom.json()).toMatchObject({ tags: ["project:sgh"], paths: ["/projects/sgh"] });
    expect(revalidateTag.mock.calls).toEqual([["project:sgh"]]);
    expect((await call("{not json", SECRET)).status).toBe(400);
  });
});
