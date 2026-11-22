import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImportDialog from "./ImportDialog";
import { fakeServer } from "../../test/fakeServer";

// Import never looks like it did nothing: right after the click it says it's uploading, then what
// it's doing, and any error shows right under the button
const job = (over: Record<string, unknown>) => ({ id: 34, kind: "import-file", status: "queued", source: "Chili.pdf", result: null, error: null, createdAt: "2026-11-10T14:00:00Z", ...over });
const pdf = () => new File([new Uint8Array([37, 80, 68, 70])], "Chili.pdf", { type: "application/pdf" });
const later = () => {
  let done!: (v: unknown) => void;
  const p = new Promise((r) => (done = r));
  return { p, done };
};
const open = async () => {
  const u = userEvent.setup();
  render(<ImportDialog onClose={() => {}} />);
  await u.click(screen.getByRole("tab", { name: "From a file" }));
  await u.upload(screen.getByLabelText("Recipe file"), pdf());
  return u;
};
const feedback = () => screen.getByRole("region", { name: "Import progress" });

describe("feedback after clicking Import", () => {
  it("uploading: the button says so and can't be pressed again", async () => {
    const upload = later();
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: true }), "POST /api/recipes/import/file": () => upload.p });
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Import" }));
    const button = screen.getByRole("button", { name: "Uploading Chili.pdf…" });
    expect(button).toBeDisabled();
    expect(within(feedback()).getByRole("status")).toHaveTextContent("Uploading Chili.pdf…");
    upload.done({ status: 202, json: job({}) });
    await waitFor(() => expect(within(feedback()).getByRole("status")).toHaveTextContent(/Reading Chili\.pdf with your AI/));
    expect(screen.getByRole("button", { name: "Importing…" })).toBeDisabled();
  });

  it("the import fails: the reason shows right under the button, and Import works again", async () => {
    fakeServer({
      "GET /api/ai/status": () => ({ ready: true, photos: true }),
      "POST /api/recipes/import/file": () => ({ status: 202, json: job({}) }),
      "GET /api/imports/34": () => job({ status: "failed", error: "No recipes were found in Chili.pdf." }),
    });
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Import" }));
    expect(await within(feedback()).findByRole("alert", {}, { timeout: 4000 })).toHaveTextContent("No recipes were found in Chili.pdf.");
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  });

  it("the upload is refused: says why", async () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: true }), "POST /api/recipes/import/file": () => ({ status: 413, json: { error: "That file is too large (1 GB at most)" } }) });
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Import" }));
    expect(await within(feedback()).findByRole("alert")).toHaveTextContent("That file is too large (1 GB at most)");
  });

  it("an odd answer to the upload (no import to follow): says so instead of going quiet", async () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: true }), "POST /api/recipes/import/file": () => ({ status: 202, json: {} }) });
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Import" }));
    expect(await within(feedback()).findByRole("alert")).toHaveTextContent(/didn't say the import started/i);
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  });

  it("newer browsers, where scrolling into view gives back a promise: nothing breaks", async () => {
    const was = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = (() => Promise.resolve()) as never;
    try {
      fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: true }), "POST /api/recipes/import/file": () => ({ status: 202, json: job({}) }), "GET /api/imports/34": () => job({ status: "running" }) });
      const u = await open();
      await u.click(screen.getByRole("button", { name: "Import" }));
      await waitFor(() => expect(within(feedback()).getByRole("status")).toHaveTextContent(/Reading Chili\.pdf/));
    } finally {
      Element.prototype.scrollIntoView = was;
    }
  });

  it("checking on it keeps failing: says it lost touch, and that the import may still finish", async () => {
    fakeServer({
      "GET /api/ai/status": () => ({ ready: true, photos: true }),
      "POST /api/recipes/import/file": () => ({ status: 202, json: job({}) }),
      "GET /api/imports/34": () => ({ status: 502, json: { error: "Bad gateway" } }),
    });
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Import" }));
    expect(await within(feedback()).findByRole("alert", {}, { timeout: 8000 })).toHaveTextContent(/Lost touch with RecipeHub.*may still finish/i);
  }, 10000);
});
