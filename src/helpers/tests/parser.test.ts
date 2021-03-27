import { setupFolderStructure, cleanup } from "./utils";
import * as parser from "../parser";
import * as paths from "../paths";
import * as tsReader from "../tsReader";

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
function getExpectedString(filename: string) {
  return fs.readFileSync(path.join(__dirname, `artifacts/${filename}`), "utf8");
}

function cleanupModelsInMemory() {
  delete mongoose.models.User;
  delete mongoose.connection.collections.users;
  delete mongoose.modelSchemas.User;
}

// these tests are more integration tests than unit - should split them out

// ensure folders are cleaned before starting and after each test
beforeEach(cleanup);
afterAll(cleanup);

describe("generateTypes", () => {
  afterEach(cleanupModelsInMemory);

  const genFilePath = "mtgen-test.ts";

  test("generate file string success", async () => {
    setupFolderStructure("./models", "user", true);
    const modelsPaths = await paths.getModelsPaths("");
    const cleanupTs = parser.registerUserTs("tsconfig.test.json");

    const schemas = parser.loadSchemas(modelsPaths);
    let sourceFile = parser.createSourceFile(genFilePath);
    sourceFile = await parser.generateTypes({ schemas, sourceFile });

    const modelTypes = tsReader.getModelTypes(modelsPaths);
    parser.replaceModelTypes(sourceFile, modelTypes, schemas);

    cleanupTs?.();
    expect(sourceFile.getFullText()).toBe(getExpectedString("user.gen.ts"));
  });

  // TODO: this test is kinda random and out of place, but it covers all the latest changes
  // related to allowing multiple schemas per model file. It should be split into unit tests
  // once that code has been modularized
  test("generate different types of model inits", async () => {
    const modelsPaths = await paths.getModelsPaths("./src/helpers/tests/artifacts/device.ts");
    const cleanupTs = parser.registerUserTs("tsconfig.test.json");

    const schemas = parser.loadSchemas(modelsPaths);

    let sourceFile = parser.createSourceFile(genFilePath);
    sourceFile = await parser.generateTypes({ schemas, sourceFile });

    const modelTypes = tsReader.getModelTypes(modelsPaths);
    parser.replaceModelTypes(sourceFile, modelTypes, schemas);

    cleanupTs?.();
    expect(sourceFile.getFullText()).toBe(getExpectedString("device.gen.ts"));
  });
});

describe("getParseKeyFn", () => {
  test("handles untyped Array equivalents as `any[]`", () => {
    // see https://mongoosejs.com/docs/schematypes.html#arrays
    const parseKey = parser.getParseKeyFn(false, {
      test1a: { type: [mongoose.Schema.Types.Mixed], default: undefined }
    });

    expect(parseKey("test1a", { type: [mongoose.Schema.Types.Mixed] })).toBe("test1a: any[];\n");
    expect(parseKey("test1b", [mongoose.Schema.Types.Mixed])).toBe("test1b: any[];\n");

    expect(parseKey("test2a", { type: [] })).toBe("test2a: any[];\n");
    expect(parseKey("test2b", [])).toBe("test2b: any[];\n");

    expect(parseKey("test3a", { type: Array })).toBe("test3a: any[];\n");
    expect(parseKey("test3b", Array)).toBe("test3b: any[];\n");

    expect(parseKey("test4a", { type: [{}] })).toBe("test4a: any[];\n");
    expect(parseKey("test4b", [{}])).toBe("test4b: any[];\n");
  });

  test("handles Object equivalents as `any`", () => {
    // see https://mongoosejs.com/docs/schematypes.html#mixed
    const parseKey = parser.getParseKeyFn(false, {});

    expect(parseKey("test1a", { type: mongoose.Schema.Types.Mixed })).toBe("test1a?: any;\n");
    expect(parseKey("test1b", mongoose.Schema.Types.Mixed)).toBe("test1b?: any;\n");
    expect(parseKey("test1c", { type: mongoose.Schema.Types.Mixed, required: true })).toBe(
      "test1c: any;\n"
    );

    expect(parseKey("test2a", { type: mongoose.Mixed })).toBe("test2a?: any;\n");
    expect(parseKey("test2b", mongoose.Mixed)).toBe("test2b?: any;\n");
    expect(parseKey("test2c", { type: mongoose.Mixed, required: true })).toBe("test2c: any;\n");

    expect(parseKey("test3a", { type: {} })).toBe("test3a?: any;\n");
    expect(parseKey("test3b", {})).toBe("test3b?: any;\n");
    expect(parseKey("test3c", { type: {}, required: true })).toBe("test3c: any;\n");

    expect(parseKey("test4a", { type: Object })).toBe("test4a?: any;\n");
    expect(parseKey("test4b", Object)).toBe("test4b?: any;\n");
    expect(parseKey("test4c", { type: Object, required: true })).toBe("test4c: any;\n");
  });

  test("handles 2dsphere index edge case", () => {
    const parseKey = parser.getParseKeyFn(false, {});

    // should be optional; not required like normal arrays
    expect(parseKey("test1a", { type: [Number], index: "2dsphere" })).toBe("test1a?: number[];\n");
    // should be required, as usual
    expect(parseKey("test2a", { type: [Number] })).toBe("test2a: number[];\n");
  });
});
