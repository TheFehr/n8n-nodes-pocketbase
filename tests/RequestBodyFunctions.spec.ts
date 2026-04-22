import { describe, it, expect, vi, afterEach } from "vitest";
import { prepareRequestBody } from "../nodes/Common/RequestBodyFunctions";
import { IExecuteSingleFunctions, IHttpRequestOptions } from "n8n-workflow";
import FormData from "form-data";

describe("RequestBodyFunctions", () => {
  describe("prepareRequestBody", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should parse and assign bodyJson correctly in JSON mode", async () => {
      const mockThis = {
        getNodeParameter: vi.fn().mockImplementation((name, defaultValue) => {
          if (name === "bodyType") return ["bodyJson"];
          if (name === "bodyJson") return '{"a": 1}';
          return defaultValue;
        }),
        logger: {
          info: vi.fn(),
          debug: vi.fn(),
        },
      } as unknown as IExecuteSingleFunctions;

      const requestOptions: IHttpRequestOptions = { url: "http://test.com", method: "POST" };
      const result = await prepareRequestBody.call(mockThis, requestOptions);

      expect(result.body).toEqual({ a: 1 });
    });

    it("should stringify nested objects and include null values in bodyJson in JSON mode", async () => {
      const mockThis = {
        getNodeParameter: vi.fn().mockImplementation((name, defaultValue) => {
          if (name === "bodyType") return ["bodyJson"];
          if (name === "bodyJson") return '{"a": 1, "b": {"c": 2}, "": "empty", " ": "whitespace", "nullVal": null}';
          return defaultValue;
        }),
        logger: {
          info: vi.fn(),
          debug: vi.fn(),
        },
      } as unknown as IExecuteSingleFunctions;

      const requestOptions: IHttpRequestOptions = { url: "http://test.com", method: "POST" };
      const result = await prepareRequestBody.call(mockThis, requestOptions);

      expect(result.body).toEqual({
        a: 1,
        b: '{"c":2}',
        nullVal: null,
      });
    });

    it("should throw error for invalid JSON in bodyJson", async () => {
      const mockThis = {
        getNodeParameter: vi.fn().mockImplementation((name) => {
          if (name === "bodyType") return ["bodyJson"];
          if (name === "bodyJson") return "{invalid}";
          return undefined;
        }),
      } as unknown as IExecuteSingleFunctions;

      const requestOptions: IHttpRequestOptions = { url: "http://test.com", method: "POST" };
      await expect(prepareRequestBody.call(mockThis, requestOptions)).rejects.toThrow(
        "Invalid JSON in Body",
      );
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
      await expect(prepareRequestBody.call(mockThis, requestOptions)).rejects.toThrow(
        "JSON Body must be a JSON object",
      );
    });

    it("should parse and append bodyJson correctly in Multipart mode, converting null to 'null' string", async () => {
      const appendSpy = vi.spyOn(FormData.prototype, "append");
      const mockThis = {
        getNodeParameter: vi.fn().mockImplementation((name, defaultValue) => {
          if (name === "bodyType") return ["bodyJson", "binaryData"];
          if (name === "bodyJson") return '{"a": 1, "b": {"c": 2}, "nullVal": null}';
          if (name === "binaryPropertyName") return "data";
          if (name === "binaryFieldName") return "file";
          return defaultValue;
        }),
        logger: {
          info: vi.fn(),
          debug: vi.fn(),
        },
        helpers: {
          assertBinaryData: vi
            .fn()
            .mockReturnValue({ mimeType: "text/plain", fileName: "test.txt" }),
          getBinaryDataBuffer: vi.fn().mockResolvedValue(Buffer.from("hello")),
        },
      } as unknown as IExecuteSingleFunctions;

      const requestOptions: IHttpRequestOptions = { url: "http://test.com", method: "POST" };
      const result = await prepareRequestBody.call(mockThis, requestOptions);

      expect(appendSpy).toHaveBeenCalledWith("a", "1");
      expect(appendSpy).toHaveBeenCalledWith("b", '{"c":2}');
      expect(appendSpy).toHaveBeenCalledWith("nullVal", "null");
      expect(appendSpy).toHaveBeenCalledWith(
        "file",
        expect.any(Buffer),
        expect.objectContaining({
          contentType: "text/plain",
          filename: "test.txt",
        }),
      );

      expect(result.headers).toBeDefined();
      expect(result.headers!["content-type"]).toContain("multipart/form-data");
    });

    describe("fields bodyType", () => {
      const fields = {
        assignments: [
          { name: "", value: "empty name" },
          { name: "  ", value: "whitespace name" },
          { name: 123 as any, value: "non-string name" },
          { name: "nullValue", value: null },
          { name: "undefinedValue", value: undefined },
          { name: "validString", value: "hello" },
          { name: "validObject", value: { foo: "bar" } },
        ],
      };

      it("should filter invalid entries and include null as null in JSON mode", async () => {
        const mockThis = {
          getNodeParameter: vi.fn().mockImplementation((name, defaultValue) => {
            if (name === "bodyType") return ["fields"];
            if (name === "fields") return fields;
            return defaultValue;
          }),
          logger: {
            info: vi.fn(),
            debug: vi.fn(),
          },
        } as unknown as IExecuteSingleFunctions;

        const requestOptions: IHttpRequestOptions = { url: "http://test.com", method: "POST" };
        const result = await prepareRequestBody.call(mockThis, requestOptions);

        expect(result.body).toEqual({
          nullValue: null,
          validString: "hello",
          validObject: { foo: "bar" },
        });
      });

      it("should filter invalid entries and convert null to 'null' string in Multipart mode", async () => {
        const appendSpy = vi.spyOn(FormData.prototype, "append");
        const mockThis = {
          getNodeParameter: vi.fn().mockImplementation((name, defaultValue) => {
            if (name === "bodyType") return ["fields", "binaryData"];
            if (name === "fields") return fields;
            if (name === "binaryPropertyName") return "data";
            if (name === "binaryFieldName") return "file";
            return defaultValue;
          }),
          logger: {
            info: vi.fn(),
            debug: vi.fn(),
          },
          helpers: {
            assertBinaryData: vi
              .fn()
              .mockReturnValue({ mimeType: "text/plain", fileName: "test.txt" }),
            getBinaryDataBuffer: vi.fn().mockResolvedValue(Buffer.from("hello")),
          },
        } as unknown as IExecuteSingleFunctions;

        const requestOptions: IHttpRequestOptions = { url: "http://test.com", method: "POST" };
        const result = await prepareRequestBody.call(mockThis, requestOptions);

        expect(appendSpy).toHaveBeenCalledWith("validString", "hello");
        expect(appendSpy).toHaveBeenCalledWith("validObject", '{"foo":"bar"}');
        expect(appendSpy).toHaveBeenCalledWith("nullValue", "null");

        const appendedKeys = appendSpy.mock.calls.map((call) => call[0]);
        expect(appendedKeys).not.toContain("");
        expect(appendedKeys).not.toContain("  ");
        expect(appendedKeys).not.toContain(123);
        expect(appendedKeys).not.toContain("undefinedValue");

        expect(result.headers!["content-type"]).toContain("multipart/form-data");
      });
    });
  });
});
