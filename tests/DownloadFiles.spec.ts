import { Readable } from "node:stream";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  NodeOperationError,
  type DeclarativeRestApiSettings,
  type IDataObject,
  type IExecutePaginationFunctions,
  type IExecuteSingleFunctions,
  type IHttpRequestOptions,
} from "n8n-workflow";
import {
  downloadRecordFiles,
  pagination,
  _resetFileCachesForTesting,
  _resetTokenCacheForTesting,
} from "../nodes/Common/GenericFunctions";

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}

const inSeconds = (seconds: number) => Math.floor(Date.now() / 1000) + seconds;

const record = {
  id: "rec1",
  collectionId: "pbc_1",
  collectionName: "docs",
  title: "Report",
  single: "report_abc.pdf",
  multiple: ["photo_def.png", "notes ghi.txt"],
};

const readStream = async (stream: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
};

describe("downloadRecordFiles", () => {
  let httpRequest: ReturnType<typeof vi.fn<(options: IHttpRequestOptions) => Promise<unknown>>>;
  let parameters: Record<string, unknown>;
  let password: string;
  let executionId: string;
  let fileTokenExp: number;
  let context: IExecuteSingleFunctions;

  beforeEach(() => {
    _resetTokenCacheForTesting();
    _resetFileCachesForTesting();
    parameters = { resource: "docs", "parameters.downloadFiles": true };
    password = "password123";
    executionId = "1";
    fileTokenExp = inSeconds(180);
    let fileTokenCount = 0;
    httpRequest = vi.fn<(options: IHttpRequestOptions) => Promise<unknown>>();
    httpRequest.mockImplementation(async (options) => {
      if (options.url.endsWith("/auth-with-password")) {
        return { token: buildJwt({ exp: inSeconds(3600), type: "auth", password }) };
      }
      if (options.url.endsWith("/api/files/token")) {
        return { token: buildJwt({ exp: fileTokenExp, n: ++fileTokenCount }) };
      }
      if (options.url.endsWith("/api/collections/docs")) {
        return {
          name: "docs",
          fields: [
            { name: "id", type: "text" },
            { name: "title", type: "text" },
            { name: "single", type: "file" },
            { name: "multiple", type: "file" },
          ],
        };
      }
      const fileName = decodeURIComponent(options.url.split("/").pop()!);
      return {
        body: Readable.from([Buffer.from(`content of ${fileName}`)]),
        headers: { "content-type": fileName.endsWith(".pdf") ? "application/pdf" : "image/png" },
      };
    });
    context = {
      getNodeParameter: vi.fn((name: string, fallback?: unknown) => parameters[name] ?? fallback),
      getCredentials: vi.fn(async () => ({
        url: "http://localhost:8090/",
        username: "admin@example.com",
        password,
      })),
      getNode: vi.fn().mockReturnValue({ name: "Pocketbase HTTP", type: "pocketbaseHttp" }),
      getExecutionId: vi.fn(() => executionId),
      getItemIndex: vi.fn().mockReturnValue(3),
      helpers: {
        httpRequest,
        prepareBinaryData: vi.fn(async (data: Readable, fileName: string, mimeType: string) => ({
          data: (await readStream(data)).toString("base64"),
          fileName,
          mimeType,
        })),
      },
    } as unknown as IExecuteSingleFunctions;
  });

  const download = (...records: IDataObject[]) =>
    downloadRecordFiles.call(
      context,
      (records.length ? records : [record]).map((json) => ({ json: { ...json } })),
    );
  const requestsTo = (pattern: RegExp) =>
    httpRequest.mock.calls.map(([options]) => options).filter(({ url }) => pattern.test(url));
  const decode = (binary: IDataObject) => Buffer.from(binary.data as string, "base64").toString();

  it("returns the items untouched and sends no requests when Download Files is off", async () => {
    delete parameters["parameters.downloadFiles"];
    const items = [{ json: { ...record } }];

    expect(await downloadRecordFiles.call(context, items)).toBe(items);
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it("attaches every file of the record under its field name, keeping the JSON", async () => {
    const [item] = await download();

    expect(item.json).toEqual(record);
    expect(Object.keys(item.binary!)).toEqual(["single", "multiple_0", "multiple_1"]);
    expect(item.binary!.single).toMatchObject({
      fileName: "report_abc.pdf",
      mimeType: "application/pdf",
    });
    expect(item.binary!.multiple_1).toMatchObject({
      fileName: "notes ghi.txt",
      mimeType: "image/png",
    });
    expect(decode(item.binary!.multiple_1 as unknown as IDataObject)).toBe(
      "content of notes ghi.txt",
    );
  });

  it("names a multi-file field with a single file with an index", async () => {
    const [item] = await download({ id: "rec1", single: "", multiple: ["photo_def.png"] });

    expect(Object.keys(item.binary!)).toEqual(["multiple_0"]);
  });

  it("downloads only the file fields present in the record", async () => {
    const [item] = await download({ id: "rec1", multiple: ["photo_def.png"] });

    expect(Object.keys(item.binary!)).toEqual(["multiple_0"]);
    expect(requestsTo(/report_abc\.pdf$/)).toHaveLength(0);
  });

  it("adds no binary data and sends no file requests for empty file fields", async () => {
    const [item] = await download({ id: "rec1", single: "", multiple: [] });

    expect(item.binary).toEqual({});
    expect(requestsTo(/\/api\/files\//)).toHaveLength(0);
  });

  it("fails when a record with files has no id", async () => {
    await expect(download({ single: "report_abc.pdf" })).rejects.toBeInstanceOf(NodeOperationError);
  });

  const withFileFields = (...names: string[]) => {
    const handler = httpRequest.getMockImplementation()!;
    httpRequest.mockImplementation(async (options) => {
      if (options.url.endsWith("/api/collections/docs")) {
        const schema = (await handler(options)) as { fields: IDataObject[] };
        return {
          ...schema,
          fields: [...schema.fields, ...names.map((name) => ({ name, type: "file" }))],
        };
      }
      return await handler(options);
    });
  };

  it("ignores file fields the record doesn't have, even if the name exists on Object", async () => {
    withFileFields("constructor");

    const [item] = await download({ id: "rec1", single: "report_abc.pdf" });

    expect(Object.keys(item.binary!)).toEqual(["single"]);
    expect(requestsTo(/\/api\/files\/docs\//)).toHaveLength(1);
  });

  it("fails before downloading when two fields would share a binary field name", async () => {
    withFileFields("multiple_0");

    await expect(
      download({ id: "rec1", multiple: ["photo_def.png"], multiple_0: "other_jkl.txt" }),
    ).rejects.toThrow('Two file fields would both be saved as binary field "multiple_0"');
    expect(requestsTo(/\/api\/files\//)).toHaveLength(0);
  });

  it("streams each file with a file token so protected files are served", async () => {
    await download();

    const [tokenRequest] = requestsTo(/\/api\/files\/token$/);
    const [fileRequest] = requestsTo(/\/api\/files\/docs\//);
    expect(tokenRequest).toMatchObject({
      method: "POST",
      headers: { Authorization: expect.any(String) },
    });
    expect(fileRequest).toMatchObject({
      method: "GET",
      url: "http://localhost:8090/api/files/docs/rec1/report_abc.pdf",
      encoding: "stream",
      returnFullResponse: true,
    });
    expect(fileRequest.qs!.token).toEqual(expect.stringContaining("."));
    expect(fileRequest.headers).toBeUndefined();
    expect(requestsTo(/notes%20ghi\.txt$/)).toHaveLength(1);
  });

  it("pairs each item with the input item", async () => {
    const items = await download(record, { ...record, id: "rec2" });

    expect(items.map((item) => item.pairedItem)).toEqual([{ item: 3 }, { item: 3 }]);
  });

  it("fetches the collection schema once per execution", async () => {
    await Promise.all([download(), download()]);
    await download();
    expect(requestsTo(/\/api\/collections\/docs$/)).toHaveLength(1);

    executionId = "2";
    await download();
    expect(requestsTo(/\/api\/collections\/docs$/)).toHaveLength(2);
  });

  it("doesn't keep a failed schema request", async () => {
    const handler = httpRequest.getMockImplementation()!;
    httpRequest.mockImplementation(async (options) => {
      if (options.url.endsWith("/api/collections/docs")) {
        httpRequest.mockImplementation(handler);
        throw new Error("Unavailable");
      }
      return await handler(options);
    });

    await expect(download()).rejects.toThrow("Unavailable");
    await download();

    expect(requestsTo(/\/api\/collections\/docs$/)).toHaveLength(2);
  });

  it("doesn't let a failed schema request evict a newer execution's entry", async () => {
    const handler = httpRequest.getMockImplementation()!;
    let failFirst!: (error: Error) => void;
    httpRequest.mockImplementation(async (options) => {
      if (options.url.endsWith("/api/collections/docs")) {
        httpRequest.mockImplementation(handler);
        return await new Promise((_, reject) => (failFirst = reject));
      }
      return await handler(options);
    });

    const first = download();
    await vi.waitFor(() => expect(failFirst).toBeDefined());
    executionId = "2";
    await download();
    failFirst(new Error("Unavailable"));
    await expect(first).rejects.toThrow("Unavailable");
    await download();

    expect(requestsTo(/\/api\/collections\/docs$/)).toHaveLength(2);
  });

  it("reuses the file token across records and executions", async () => {
    await download(record, { ...record, id: "rec2" });
    executionId = "2";
    await download();

    expect(requestsTo(/\/api\/files\/token$/)).toHaveLength(1);
    const tokens = new Set(requestsTo(/\/api\/files\/docs\//).map(({ qs }) => qs!.token));
    expect(tokens.size).toBe(1);
  });

  it("requests a new file token shortly before the cached one expires", async () => {
    fileTokenExp = inSeconds(59);
    await download();
    await download();

    expect(requestsTo(/\/api\/files\/token$/)).toHaveLength(2);
  });

  it("replaces the cached file token when the auth token changes", async () => {
    await download();
    _resetTokenCacheForTesting();
    password = "changed";
    await download();

    const [first, second] = requestsTo(/\/api\/files\/token$/);
    expect(second.headers!.Authorization).not.toBe(first.headers!.Authorization);
  });

  it("doesn't cache a failed file token request", async () => {
    const handler = httpRequest.getMockImplementation()!;
    httpRequest.mockImplementation(async (options) => {
      if (options.url.endsWith("/api/files/token")) {
        httpRequest.mockImplementation(handler);
        throw new Error("Unavailable");
      }
      return await handler(options);
    });

    await expect(download()).rejects.toThrow("Unavailable");
    await download();

    expect(requestsTo(/\/api\/files\/token$/)).toHaveLength(2);
    expect(requestsTo(/\/api\/files\/docs\//)).toHaveLength(3);
  });

  describe("with List/Search", () => {
    const requestOptions = (): DeclarativeRestApiSettings.ResultOptions => ({
      options: { qs: {} },
      preSend: [],
      postReceive: [],
      requestOperations: {},
    });
    let makeRoutingRequest: ReturnType<typeof vi.fn>;
    const paginate = () =>
      pagination.call(
        Object.assign(Object.create(context), {
          makeRoutingRequest,
          logger: { warn: vi.fn() },
        }) as IExecutePaginationFunctions,
        requestOptions(),
      );

    beforeEach(() => {
      makeRoutingRequest = vi.fn();
      parameters["parameters.allElements"] = true;
      makeRoutingRequest
        .mockResolvedValueOnce([{ json: { page: 1, perPage: 2, items: [record, { id: "rec2" }] } }])
        .mockResolvedValueOnce([
          { json: { page: 2, perPage: 2, items: [{ ...record, id: "rec3" }] } },
        ]);
    });

    it("attaches the files of every record on every page, paired with the input item", async () => {
      const items = await paginate();

      expect(items.map((item) => item.json.id)).toEqual(["rec1", "rec2", "rec3"]);
      expect(items.map((item) => Object.keys(item.binary!))).toEqual([
        ["single", "multiple_0", "multiple_1"],
        [],
        ["single", "multiple_0", "multiple_1"],
      ]);
      expect(items.map((item) => item.pairedItem)).toEqual([{ item: 3 }, { item: 3 }, { item: 3 }]);
      expect(requestsTo(/\/api\/collections\/docs$/)).toHaveLength(1);
      expect(requestsTo(/\/api\/files\/token$/)).toHaveLength(1);
      expect(requestsTo(/\/api\/files\/docs\//)).toHaveLength(6);
    });

    it("sends no requests when Download Files is off", async () => {
      delete parameters["parameters.downloadFiles"];

      const items = await paginate();

      expect(items).toEqual([
        { json: record },
        { json: { id: "rec2" } },
        { json: { ...record, id: "rec3" } },
      ]);
      expect(httpRequest).not.toHaveBeenCalled();
    });

    it("doesn't fetch the schema when there are no records", async () => {
      makeRoutingRequest.mockReset();
      makeRoutingRequest.mockResolvedValueOnce([{ json: { page: 1, perPage: 2, items: [] } }]);

      expect(await paginate()).toEqual([]);
      expect(httpRequest).not.toHaveBeenCalled();
    });
  });
});
