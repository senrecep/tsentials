import { fetchResult } from "../../src/http/fetch-result.js";

/** A Response whose body.cancel is spied on. */
function spiedResponse(
  body: string | null,
  init: ResponseInit,
): { response: Response; cancel: ReturnType<typeof vi.fn> } {
  const response = new Response(body, init);
  const cancel = vi.fn(() => Promise.resolve());
  if (response.body)
    Object.defineProperty(response.body, "cancel", { value: cancel });
  return { response, cancel };
}

/** A body-carrying stub for statuses the Response constructor rejects with a body (204). */
function stubResponse(
  status: number,
  contentType?: string,
): { response: Response; cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn(() => Promise.resolve());
  const headers = new Headers(
    contentType ? { "content-type": contentType } : undefined,
  );
  const response = {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers,
    body: { cancel },
  };
  return { response: response as unknown as Response, cancel };
}

const stubFetch = (response: Response): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response)),
  );
};

describe("fetchResult cancels response bodies it does not read", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cancels a non-JSON error body", async () => {
    const { response, cancel } = spiedResponse("<html>oops</html>", {
      status: 500,
      headers: { "content-type": "text/html" },
    });
    stubFetch(response);
    const result = await fetchResult.get("https://api.example.com/x");
    expect(result.ok).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels a 204 body", async () => {
    const { response, cancel } = stubResponse(204, "application/json");
    stubFetch(response);
    const result = await fetchResult.get("https://api.example.com/x");
    expect(result.ok).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels a 205 body", async () => {
    const { response, cancel } = stubResponse(205);
    stubFetch(response);
    const result = await fetchResult.get("https://api.example.com/x");
    expect(result.ok).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels a non-JSON 2xx body", async () => {
    const { response, cancel } = spiedResponse("plain text", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
    stubFetch(response);
    const result = await fetchResult.get("https://api.example.com/x");
    expect(result.ok).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("swallows a cancel that rejects or throws", async () => {
    const { response, cancel } = stubResponse(200, "text/plain");
    cancel.mockImplementation(() => Promise.reject(new Error("boom")));
    stubFetch(response);
    expect((await fetchResult.get("https://api.example.com/x")).ok).toBe(true);

    const thrower = stubResponse(500);
    thrower.cancel.mockImplementation(() => {
      throw new Error("sync boom");
    });
    stubFetch(thrower.response);
    expect((await fetchResult.get("https://api.example.com/x")).ok).toBe(false);
  });

  it("does not cancel a JSON 2xx body it reads", async () => {
    const { response, cancel } = spiedResponse('{"id":1}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    stubFetch(response);
    const result = await fetchResult.get("https://api.example.com/x");
    expect(result.ok).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("does not cancel a JSON error body it reads", async () => {
    const { response, cancel } = spiedResponse('{"title":"bad"}', {
      status: 400,
      headers: { "content-type": "application/problem+json" },
    });
    stubFetch(response);
    const result = await fetchResult.get("https://api.example.com/x");
    expect(result.ok).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });
});
