import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ILoadOptionsFunctions } from "n8n-workflow";
import { LoadOptions } from "../nodes/Common/LoadOptions";
import { _resetTokenCacheForTesting } from "../nodes/Common/GenericFunctions";

interface MockLoadOptionsThis {
  getCredentials: ReturnType<typeof vi.fn>;
  getNodeParameter: ReturnType<typeof vi.fn>;
  helpers: {
    httpRequest: ReturnType<typeof vi.fn>;
  };
}

function buildMockThis(resource = "posts"): MockLoadOptionsThis {
  return {
    getCredentials: vi.fn().mockResolvedValue({
      url: "http://localhost:8090",
      username: "admin@example.com",
      password: "password123",
    }),
    getNodeParameter: vi.fn().mockReturnValue(resource),
    helpers: {
      httpRequest: vi.fn(),
    },
  };
}

describe("LoadOptions", () => {
  describe("getRows", () => {
    beforeEach(() => {
      _resetTokenCacheForTesting();
    });

    it('returns a "No Records Found" placeholder option when the collection has no records', async () => {
      const mockThis = buildMockThis();
      mockThis.helpers.httpRequest
        .mockResolvedValueOnce({ token: "mock-token" }) // auth call made by fetchPocketbaseToken
        .mockResolvedValueOnce({ items: [], totalPages: 1 }); // empty records page

      const result = await LoadOptions.getRows.call(
        mockThis as unknown as ILoadOptionsFunctions,
      );

      expect(result).toEqual([{ name: "No Records Found", value: "" }]);
    });

    it("returns record options derived from item data when records exist", async () => {
      const mockThis = buildMockThis();
      mockThis.helpers.httpRequest
        .mockResolvedValueOnce({ token: "mock-token" })
        .mockResolvedValueOnce({
          items: [{ id: "rec1", name: "First Post" }],
          totalPages: 1,
        });

      const result = await LoadOptions.getRows.call(
        mockThis as unknown as ILoadOptionsFunctions,
      );

      expect(result).toEqual([{ name: "First Post", value: "rec1" }]);
    });

    it("requests records for the resource passed via the 'resource' node parameter", async () => {
      const mockThis = buildMockThis("comments");
      mockThis.helpers.httpRequest
        .mockResolvedValueOnce({ token: "mock-token" })
        .mockResolvedValueOnce({ items: [], totalPages: 1 });

      await LoadOptions.getRows.call(mockThis as unknown as ILoadOptionsFunctions);

      const recordsCall = mockThis.helpers.httpRequest.mock.calls.find((call) =>
        String((call[0] as { url: string }).url).includes("/records"),
      );
      expect(recordsCall).toBeDefined();
      expect((recordsCall![0] as { url: string }).url).toBe(
        "http://localhost:8090/api/collections/comments/records",
      );
    });
  });
});