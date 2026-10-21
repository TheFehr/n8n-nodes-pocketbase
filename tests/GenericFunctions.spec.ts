import { describe, it, expect, vi, beforeEach } from "vitest";
import { pagination } from "../nodes/Common/GenericFunctions";
import { IDataObject, IExecutePaginationFunctions, DeclarativeRestApiSettings } from "n8n-workflow";

interface MockPaginationThis {
  getNodeParameter: ReturnType<typeof vi.fn>;
  makeRoutingRequest: ReturnType<typeof vi.fn>;
  logger: {
    debug: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

describe("GenericFunctions", () => {
  describe("pagination", () => {
    let mockThis: MockPaginationThis;

    beforeEach(() => {
      vi.clearAllMocks();
      mockThis = {
        getNodeParameter: vi.fn(),
        makeRoutingRequest: vi.fn(),
        logger: {
          debug: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      };
    });

    it("should fetch all pages until a page has fewer items than perPage", async () => {
      mockThis.getNodeParameter.mockImplementation((name: string, defaultValue: unknown) => {
        if (name === "parameters.allElements") return true;
        if (name === "parameters.page") return 1;
        return defaultValue;
      });

      mockThis.makeRoutingRequest
        .mockResolvedValueOnce([
          { json: { page: 1, perPage: 2, totalPages: -1, items: [{ id: 1 }, { id: 2 }] } },
        ])
        .mockResolvedValueOnce([
          { json: { page: 2, perPage: 2, totalPages: -1, items: [{ id: 3 }] } },
        ]);

      const requestOptions: DeclarativeRestApiSettings.ResultOptions = {
        options: { qs: {} },
        preSend: [],
        postReceive: [],
      };
      const result = await pagination.call(
        mockThis as unknown as IExecutePaginationFunctions,
        requestOptions,
      );

      expect(result).toEqual([{ json: { id: 1 } }, { json: { id: 2 } }, { json: { id: 3 } }]);
      expect(mockThis.makeRoutingRequest).toHaveBeenCalledTimes(2);
    });

    it("should skip the total count and default to 1000 per page when fetching all elements", async () => {
      mockThis.getNodeParameter.mockImplementation((name: string, defaultValue: unknown) => {
        if (name === "parameters.allElements") return true;
        if (name === "parameters.page") return 1;
        return defaultValue;
      });

      mockThis.makeRoutingRequest.mockResolvedValueOnce([
        { json: { page: 1, perPage: 1000, totalPages: -1, items: [{ id: 1 }] } },
      ]);

      const requestOptions: DeclarativeRestApiSettings.ResultOptions = {
        options: { qs: {} },
        preSend: [],
        postReceive: [],
      };
      await pagination.call(mockThis as unknown as IExecutePaginationFunctions, requestOptions);

      expect(requestOptions.options.qs).toMatchObject({ skipTotal: true, perPage: 1000 });
    });

    it("should keep a user-set perPage when fetching all elements", async () => {
      mockThis.getNodeParameter.mockImplementation((name: string, defaultValue: unknown) => {
        if (name === "parameters.allElements") return true;
        if (name === "parameters.page") return 1;
        return defaultValue;
      });

      mockThis.makeRoutingRequest.mockResolvedValueOnce([
        { json: { page: 1, perPage: 50, totalPages: -1, items: [{ id: 1 }] } },
      ]);

      const requestOptions: DeclarativeRestApiSettings.ResultOptions = {
        options: { qs: { perPage: 50 } },
        preSend: [],
        postReceive: [],
      };
      await pagination.call(mockThis as unknown as IExecutePaginationFunctions, requestOptions);

      expect(requestOptions.options.qs).toMatchObject({ skipTotal: true, perPage: 50 });
    });

    it("should start from the selected page and keep the other query parameters", async () => {
      mockThis.getNodeParameter.mockImplementation((name: string, defaultValue: unknown) => {
        if (name === "parameters.allElements") return true;
        if (name === "parameters.page") return 3;
        return defaultValue;
      });

      const requestedQueries: IDataObject[] = [];
      mockThis.makeRoutingRequest.mockImplementation(
        async (options: DeclarativeRestApiSettings.ResultOptions) => {
          requestedQueries.push({ ...options.options.qs });
          const page = options.options.qs!.page as number;
          const items = page === 3 ? [{ id: 5 }, { id: 6 }] : [{ id: 7 }];
          return [{ json: { page, perPage: 2, totalPages: -1, items } }];
        },
      );

      const requestOptions: DeclarativeRestApiSettings.ResultOptions = {
        options: { qs: { perPage: 2, filter: "status = 'done'" } },
        preSend: [],
        postReceive: [],
      };
      const result = await pagination.call(
        mockThis as unknown as IExecutePaginationFunctions,
        requestOptions,
      );

      expect(result.map((item) => item.json.id)).toEqual([5, 6, 7]);
      expect(requestedQueries).toEqual([
        { perPage: 2, filter: "status = 'done'", skipTotal: true, page: 3 },
        { perPage: 2, filter: "status = 'done'", skipTotal: true, page: 4 },
      ]);
    });

    it("should stop on an empty page when the item count is an exact multiple of perPage", async () => {
      mockThis.getNodeParameter.mockImplementation((name: string, defaultValue: unknown) => {
        if (name === "parameters.allElements") return true;
        if (name === "parameters.page") return 1;
        return defaultValue;
      });

      mockThis.makeRoutingRequest
        .mockResolvedValueOnce([
          { json: { page: 1, perPage: 2, totalPages: -1, items: [{ id: 1 }, { id: 2 }] } },
        ])
        .mockResolvedValueOnce([{ json: { page: 2, perPage: 2, totalPages: -1, items: [] } }]);

      const requestOptions: DeclarativeRestApiSettings.ResultOptions = {
        options: { qs: {} },
        preSend: [],
        postReceive: [],
      };
      const result = await pagination.call(
        mockThis as unknown as IExecutePaginationFunctions,
        requestOptions,
      );

      expect(result).toHaveLength(2);
      expect(mockThis.makeRoutingRequest).toHaveBeenCalledTimes(2);
      expect(mockThis.logger.warn).not.toHaveBeenCalled();
    });

    it("should not cap the number of pages when fetching all elements", async () => {
      mockThis.getNodeParameter.mockImplementation((name: string, defaultValue: unknown) => {
        if (name === "parameters.allElements") return true;
        if (name === "parameters.page") return 1;
        return defaultValue;
      });

      mockThis.makeRoutingRequest.mockImplementation(
        async (options: DeclarativeRestApiSettings.ResultOptions) => {
          const page = options.options.qs!.page as number;
          return [
            {
              json: { page, perPage: 1, totalPages: -1, items: page <= 1500 ? [{ id: page }] : [] },
            },
          ];
        },
      );

      const requestOptions: DeclarativeRestApiSettings.ResultOptions = {
        options: { qs: {} },
        preSend: [],
        postReceive: [],
      };
      const result = await pagination.call(
        mockThis as unknown as IExecutePaginationFunctions,
        requestOptions,
      );

      expect(result).toHaveLength(1500);
      expect(mockThis.makeRoutingRequest).toHaveBeenCalledTimes(1501);
    });

    it("should skip the total count for a single page too", async () => {
      mockThis.getNodeParameter.mockImplementation((name: string, defaultValue: unknown) => {
        if (name === "parameters.allElements") return false;
        if (name === "parameters.page") return 1;
        return defaultValue;
      });

      mockThis.makeRoutingRequest.mockResolvedValueOnce([
        { json: { page: 1, perPage: 30, totalPages: -1, items: [{ id: 1 }] } },
      ]);

      const requestOptions: DeclarativeRestApiSettings.ResultOptions = {
        options: { qs: {} },
        preSend: [],
        postReceive: [],
      };
      await pagination.call(mockThis as unknown as IExecutePaginationFunctions, requestOptions);

      expect(mockThis.makeRoutingRequest).toHaveBeenCalledTimes(1);
      expect(requestOptions.options.qs).toEqual({ skipTotal: true, page: 1 });
    });

    it("should not apply page limit if allElements is false", async () => {
      mockThis.getNodeParameter.mockImplementation((name: string, defaultValue: unknown) => {
        if (name === "parameters.allElements") return false;
        if (name === "parameters.page") return 2000;
        return defaultValue;
      });

      mockThis.makeRoutingRequest.mockResolvedValueOnce([
        {
          json: {
            page: 2000,
            totalPages: 2000,
            items: [{ id: 1 }],
          },
        },
      ]);

      const requestOptions: DeclarativeRestApiSettings.ResultOptions = {
        options: { qs: {} },
        preSend: [],
        postReceive: [],
      };
      await pagination.call(mockThis as unknown as IExecutePaginationFunctions, requestOptions);
      expect(mockThis.makeRoutingRequest).toHaveBeenCalled();
    });

    it("should throw error if response body is not an object", async () => {
      mockThis.getNodeParameter.mockImplementation((name: string, defaultValue: unknown) => {
        if (name === "parameters.allElements") return false;
        if (name === "parameters.page") return 1;
        return defaultValue;
      });

      mockThis.makeRoutingRequest.mockResolvedValueOnce([{ json: null }]);

      const requestOptions: DeclarativeRestApiSettings.ResultOptions = {
        options: { qs: {} },
        preSend: [],
        postReceive: [],
      };
      await expect(
        pagination.call(mockThis as unknown as IExecutePaginationFunctions, requestOptions),
      ).rejects.toThrow("Invalid response from PocketBase");
    });

    it("should throw error if page is missing from the first response", async () => {
      mockThis.getNodeParameter.mockImplementation((name: string, defaultValue: unknown) => {
        if (name === "parameters.allElements") return false;
        if (name === "parameters.page") return 1;
        return defaultValue;
      });

      mockThis.makeRoutingRequest.mockResolvedValueOnce([
        { json: { totalPages: 1, items: [] } },
      ]);

      const requestOptions: DeclarativeRestApiSettings.ResultOptions = {
        options: { qs: {} },
        preSend: [],
        postReceive: [],
      };
      await expect(
        pagination.call(mockThis as unknown as IExecutePaginationFunctions, requestOptions),
      ).rejects.toThrow("Missing or invalid page in PocketBase response");
    });

    it("should throw error if returned page does not match requested page", async () => {
      mockThis.getNodeParameter.mockImplementation((name: string, defaultValue: unknown) => {
        if (name === "parameters.allElements") return false;
        if (name === "parameters.page") return 1;
        return defaultValue;
      });

      mockThis.makeRoutingRequest.mockResolvedValueOnce([
        { json: { page: 2, totalPages: 2, items: [] } },
      ]);

      const requestOptions: DeclarativeRestApiSettings.ResultOptions = {
        options: { qs: {} },
        preSend: [],
        postReceive: [],
      };
      await expect(
        pagination.call(mockThis as unknown as IExecutePaginationFunctions, requestOptions),
      ).rejects.toThrow("PocketBase returned page 2 but we requested 1");
    });

    it("should throw error if perPage is missing while fetching all elements", async () => {
      mockThis.getNodeParameter.mockImplementation((name: string, defaultValue: unknown) => {
        if (name === "parameters.allElements") return true;
        if (name === "parameters.page") return 1;
        return defaultValue;
      });

      mockThis.makeRoutingRequest.mockResolvedValueOnce([
        { json: { page: 1, items: [{ id: 1 }] } },
      ]);

      const requestOptions: DeclarativeRestApiSettings.ResultOptions = {
        options: { qs: {} },
        preSend: [],
        postReceive: [],
      };
      await expect(
        pagination.call(mockThis as unknown as IExecutePaginationFunctions, requestOptions),
      ).rejects.toThrow("Missing or invalid perPage in PocketBase response");
    });

    it("should throw error if items is not an array", async () => {
      mockThis.getNodeParameter.mockImplementation((name: string, defaultValue: unknown) => {
        if (name === "parameters.allElements") return false;
        if (name === "parameters.page") return 1;
        return defaultValue;
      });

      mockThis.makeRoutingRequest.mockResolvedValueOnce([
        { json: { page: 1, items: "not-an-array" } },
      ]);

      const requestOptions: DeclarativeRestApiSettings.ResultOptions = {
        options: { qs: {} },
        preSend: [],
        postReceive: [],
      };
      await expect(
        pagination.call(mockThis as unknown as IExecutePaginationFunctions, requestOptions),
      ).rejects.toThrow("PocketBase response for page 1 did not contain an items array");
    });
  });
});
