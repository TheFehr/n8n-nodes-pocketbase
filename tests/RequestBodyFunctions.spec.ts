import { describe, it, expect, vi } from "vitest";
import { prepareRequestBody } from "../nodes/Common/RequestBodyFunctions";
import { IExecuteSingleFunctions, IHttpRequestOptions } from "n8n-workflow";
import FormData from "form-data";

describe("RequestBodyFunctions", () => {
  describe("prepareRequestBody", () => {
    it("should parse and assign bodyJson correctly in JSON mode", async () => {
      const mockThis = {
        getNodeParameter: vi.fn().mockImplementation((name, defaultValue) => {
          if (name === "bodyType") return ["bodyJson"];
          if (name === "bodyJson") return '{"a": 1}';
          return defaultValue;
        }),
        logger: {
          info: vi.fn(),
        },
      } as unknown as IExecuteSingleFunctions;

      const requestOptions: IHttpRequestOptions = { url: "http://test.com", method: "POST" };
      const result = await prepareRequestBody.call(mockThis, requestOptions);

      expect(result.body).toEqual({ a: 1 });
    });

    it("should use bodyJson directly if it is an object", async () => {
      const mockThis = {
        getNodeParameter: vi.fn().mockImplementation((name, defaultValue) => {
          if (name === "bodyType") return ["bodyJson"];
          if (name === "bodyJson") return { b: 2 };
          return defaultValue;
        }),
        logger: {
          info: vi.fn(),
        },
      } as unknown as IExecuteSingleFunctions;

      const requestOptions: IHttpRequestOptions = { url: "http://test.com", method: "POST" };
      const result = await prepareRequestBody.call(mockThis, requestOptions);

      expect(result.body).toEqual({ b: 2 });
    });

    it("should throw error for invalid JSON in bodyJson", async () => {
      const mockThis = {
        getNodeParameter: vi.fn().mockImplementation((name) => {
          if (name === "bodyType") return ["bodyJson"];
          if (name === "bodyJson") return '{invalid}';
          return undefined;
        }),
      } as unknown as IExecuteSingleFunctions;

      const requestOptions: IHttpRequestOptions = { url: "http://test.com", method: "POST" };
      await expect(prepareRequestBody.call(mockThis, requestOptions)).rejects.toThrow("Invalid JSON in Body");
    });

    it("should throw error if bodyJson is not an object", async () => {
      const mockThis = {
        getNodeParameter: vi.fn().mockImplementation((name) => {
          if (name === "bodyType") return ["bodyJson"];
          if (name === "bodyJson") return '"string"';
          return undefined;
        }),
      } as unknown as IExecuteSingleFunctions;

      const requestOptions: IHttpRequestOptions = { url: "http://test.com", method: "POST" };
      await expect(prepareRequestBody.call(mockThis, requestOptions)).rejects.toThrow("JSON Body must be a JSON object");
    });

    it("should parse and append bodyJson correctly in Multipart mode", async () => {
      const appendSpy = vi.spyOn(FormData.prototype, "append");
      const mockThis = {
        getNodeParameter: vi.fn().mockImplementation((name, defaultValue) => {
          if (name === "bodyType") return ["bodyJson", "binaryData"];
          if (name === "bodyJson") return '{"a": 1, "b": {"c": 2}}';
          if (name === "binaryPropertyName") return "data";
          if (name === "binaryFieldName") return "file";
          return defaultValue;
        }),
        logger: {
          info: vi.fn(),
        },
        helpers: {
          assertBinaryData: vi.fn().mockReturnValue({ mimeType: "text/plain", fileName: "test.txt" }),
          getBinaryDataBuffer: vi.fn().mockResolvedValue(Buffer.from("hello")),
        },
      } as unknown as IExecuteSingleFunctions;

      const requestOptions: IHttpRequestOptions = { url: "http://test.com", method: "POST" };
      const result = await prepareRequestBody.call(mockThis, requestOptions);

      expect(appendSpy).toHaveBeenCalledWith("a", "1");
      expect(appendSpy).toHaveBeenCalledWith("b", '{"c":2}');
      expect(appendSpy).toHaveBeenCalledWith("file", expect.any(Buffer), expect.objectContaining({
        contentType: "text/plain",
        filename: "test.txt",
      }));

      // Since it's a mock FormData if it was imported correctly, but it uses the actual form-data lib
      // We can check if the headers were set
      expect(result.headers).toBeDefined();
      expect(result.headers!["content-type"]).toContain("multipart/form-data");
      
      appendSpy.mockRestore();
    });
  });
});
