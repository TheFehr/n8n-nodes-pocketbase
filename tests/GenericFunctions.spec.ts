import { describe, it, expect, vi, beforeEach } from "vitest";
import { pagination } from "../nodes/Common/GenericFunctions";
import { IExecutePaginationFunctions, DeclarativeRestApiSettings } from "n8n-workflow";

describe("GenericFunctions", () => {
  describe("pagination", () => {
    let mockThis: any;

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

    it("should handle normal pagination correctly", async () => {
      mockThis.getNodeParameter.mockImplementation((name: string, defaultValue: any) => {
        if (name === "parameters.allElements") return true;
        if (name === "parameters.page") return 1;
        return defaultValue;
      });

      // Mock first page response
      mockThis.makeRoutingRequest.mockResolvedValueOnce([
        {
          json: {
            page: 1,
            totalPages: 2,
            items: [{ id: 1 }, { id: 2 }],
          },
        },
      ]);

      // Mock second page response
      mockThis.makeRoutingRequest.mockResolvedValueOnce([
        {
          json: {
            page: 2,
            totalPages: 2,
            items: [{ id: 3 }],
          },
        },
      ]);

      const requestOptions: DeclarativeRestApiSettings.ResultOptions = {};
      const result = await pagination.call(
        mockThis as unknown as IExecutePaginationFunctions,
        requestOptions,
      );

      expect(result).toHaveLength(3);
      expect(result).toEqual([{ json: { id: 1 } }, { json: { id: 2 } }, { json: { id: 3 } }]);
      expect(mockThis.makeRoutingRequest).toHaveBeenCalledTimes(2);
    });

    it("should break early and log warning if items.length === 0 even if page < totalPages", async () => {
      mockThis.getNodeParameter.mockImplementation((name: string, defaultValue: any) => {
        if (name === "parameters.allElements") return true;
        if (name === "parameters.page") return 1;
        return defaultValue;
      });

      // Mock first page response indicating more pages exist, but returning 0 items
      mockThis.makeRoutingRequest.mockResolvedValueOnce([
        {
          json: {
            page: 1,
            totalPages: 5,
            items: [],
          },
        },
      ]);

      const requestOptions: DeclarativeRestApiSettings.ResultOptions = {};
      const result = await pagination.call(
        mockThis as unknown as IExecutePaginationFunctions,
        requestOptions,
      );

      expect(result).toHaveLength(0);
      expect(mockThis.makeRoutingRequest).toHaveBeenCalledTimes(1);
      expect(mockThis.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("returned 0 items for page 1 even though totalPages is 5"),
        expect.any(Object),
      );
    });

    it("should not log warning if items.length === 0 and page === totalPages", async () => {
      mockThis.getNodeParameter.mockImplementation((name: string, defaultValue: any) => {
        if (name === "parameters.allElements") return true;
        if (name === "parameters.page") return 1;
        return defaultValue;
      });

      // Mock first page response where it is the last page and empty
      mockThis.makeRoutingRequest.mockResolvedValueOnce([
        {
          json: {
            page: 1,
            totalPages: 1,
            items: [],
          },
        },
      ]);

      const requestOptions: DeclarativeRestApiSettings.ResultOptions = {};
      await pagination.call(mockThis as unknown as IExecutePaginationFunctions, requestOptions);

      expect(mockThis.makeRoutingRequest).toHaveBeenCalledTimes(1);
      expect(mockThis.logger.warn).not.toHaveBeenCalled();
    });

    it("should throw error if maxPages exceeded", async () => {
      mockThis.getNodeParameter.mockImplementation((name: string, defaultValue: any) => {
        if (name === "parameters.allElements") return true;
        if (name === "parameters.page") return 1001;
        return defaultValue;
      });

      const requestOptions: DeclarativeRestApiSettings.ResultOptions = {};
      await expect(
        pagination.call(mockThis as unknown as IExecutePaginationFunctions, requestOptions),
      ).rejects.toThrow("Pagination exceeded maximum of 1000 pages");
    });
  });
});
